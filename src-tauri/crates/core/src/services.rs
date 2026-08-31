//! 服务层：所有写操作在事务内完成"写入 + 状态重算"，读操作聚合联查。
//! Tauri command（P0-4）与 P1 axum 都只调这里。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::entities::{
    is_open_enum_key, now_ts, ts, Application, ApplicationDetail, ApplicationEvent,
    ApplicationListItem, Attachment, Company, CustomEventType, DictionaryItem, Interview,
    InterviewDetail, InterviewQuestion, ResumeVersion, BATCH_KEYS, CHANNEL_KEYS, PRIORITY_KEYS,
};
use crate::error::{Error, Result};
use crate::models::{EventResult, EventType, InterviewOutcome, InterviewStatus, ProjectionEffect};
use crate::state_machine::{self, TimelineItem, TimelineKind};

pub use crate::analytics::{CountRow, ResumeFunnelRow, SilentApplication, StatsDto};

/// 终态（已挂/已放弃）不可再添加阶段类事件
fn ensure_not_terminal(status: &str) -> Result<()> {
    if status == "REJECTED" || status == "WITHDRAWN" {
        return Err(Error::Invalid(
            "该投递已处于终态（已挂/已放弃），不能添加阶段事件；如需复活请先删除对应的结果事件"
                .into(),
        ));
    }
    Ok(())
}

/// 阶段定义：固定顺序（阶段链）。任何阶段事件加入前，它之前的所有阶段必须已通过；
/// 未经历的更早阶段按用户模型视为跳过（公司没安排该环节）。
const STAGE_CHAIN: &[(&str, &[&str], &str)] = &[
    // (该阶段的代表事件类型, 该阶段的全部事件类型, 名称)
    (
        "ASSESSMENT_INVITED",
        &["ASSESSMENT_INVITED", "ASSESSMENT_DONE", "ASSESSMENT_FAILED"],
        "测评",
    ),
    (
        "WRITTEN_INVITED",
        &["WRITTEN_INVITED", "WRITTEN_DONE", "WRITTEN_FAILED"],
        "笔试",
    ),
    // 面试阶段单独处理（多轮 + 结果在 interview 表）
];

/// 取某阶段的最新结果：None=未经历；Some(None)=已进入未出结果；Some(Some(r))=已出结果
async fn stage_latest_result(
    tx: &mut sqlx::SqliteConnection,
    app_id: &str,
    types: &[&str],
) -> Result<Option<Option<String>>> {
    let placeholders = vec!["?"; types.len()].join(", ");
    let sql = format!(
        "SELECT result FROM application_event \
         WHERE application_id = ? AND type IN ({placeholders}) \
         ORDER BY occurred_at DESC, created_at DESC LIMIT 1"
    );
    let mut q = sqlx::query_scalar::<_, Option<String>>(&sql).bind(app_id);
    for t in types {
        q = q.bind(t);
    }
    Ok(q.fetch_optional(tx).await?)
}

/// 面试阶段状态：None=无有效面试；Some(通过)=最后一轮已完成且过；
/// Some(未完成)=存在已约未进行或最后一轮未出结果。
/// 已取消轮次不参与门禁，否则“取消后新约下一轮”会被永久锁死。
async fn interview_stage_state(
    tx: &mut sqlx::SqliteConnection,
    app_id: &str,
) -> Result<Option<bool>> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT status, outcome FROM interview WHERE application_id = ? AND status != 'CANCELLED' \
         ORDER BY round DESC LIMIT 1",
    )
    .bind(app_id)
    .fetch_optional(tx)
    .await?;
    Ok(row.map(|(status, outcome)| status == "COMPLETED" && outcome == "PASS"))
}

/// 统一顺序门禁（用户模型）：
/// 添加阶段事件时，按阶段链依次检查——出现在目标阶段之前的每个"已经历"阶段，
/// 其最新结果必须为通过；面试未全部通过时，任何前序/后续阶段都不可添加。
async fn ensure_stage_rules(
    tx: &mut sqlx::SqliteConnection,
    app_id: &str,
    status_now: &str,
    event_type: &str,
) -> Result<()> {
    let gate_or_stage = matches!(
        event_type,
        "ASSESSMENT_INVITED"
            | "ASSESSMENT_DONE"
            | "ASSESSMENT_FAILED"
            | "WRITTEN_INVITED"
            | "WRITTEN_DONE"
            | "WRITTEN_FAILED"
            | "OC"
            | "INTENT_LETTER"
            | "OFFER"
            | "DUAL_AGREEMENT"
            | "TRIPARTITE"
            | "SIGNED"
    );
    if !gate_or_stage {
        // 已挂/主动放弃本身即终态事件；沟通/简历结果/备注不设门禁
        return ensure_not_terminal(status_now);
    }
    ensure_not_terminal(status_now)?;

    // 已投递是前提
    if status_now == "SAVED" {
        return Err(Error::Invalid("请先记录投递，再添加后续阶段事件".into()));
    }

    // 阶段链上的位置：测评=0，笔试=1，面试=2，OC及以后=3
    let target_pos: usize = match event_type {
        "ASSESSMENT_INVITED" | "ASSESSMENT_DONE" | "ASSESSMENT_FAILED" => 0,
        "WRITTEN_INVITED" | "WRITTEN_DONE" | "WRITTEN_FAILED" => 1,
        "__INTERVIEW__" => 2,
        _ => 3,
    };

    // 结果事件（同阶段的完成/挂）是对已进入阶段的收尾，永远放行
    let is_result_event = event_type.ends_with("_DONE") || event_type.ends_with("_FAILED");

    for (pos, (_repr, types, name)) in STAGE_CHAIN.iter().enumerate() {
        let experienced = stage_latest_result(tx, app_id, types).await?;
        if let Some(res) = experienced {
            let passed = res.as_deref() == Some("PASS");
            if pos >= target_pos {
                // 目标为更早或同阶段（不含该阶段自身的收尾事件）：
                // 已经历且未通过 → 不可重复进入 / 不可回退
                if !passed && !(pos == target_pos && is_result_event) {
                    return Err(Error::Invalid(format!(
                        "{name}尚未通过，通过后才能进行后续操作"
                    )));
                }
            } else if !passed {
                // 前置阶段未通过 → 任何后续阶段都不可添加
                return Err(Error::Invalid(format!(
                    "{name}尚未通过，通过后才能进入下一阶段"
                )));
            }
        }
    }

    // 面试阶段：一旦开始（存在面试），未全部通过时任何阶段事件都不可添加
    let iv_state = interview_stage_state(tx, app_id).await?;
    if let Some(passed) = iv_state {
        if !passed && target_pos != 3 {
            // 未通过时不可添加测评/笔试（回退被拦）
            return Err(Error::Invalid(
                "面试尚未全部通过，不能回退添加测评/笔试；如需记录请先删除或完成对应面试".into(),
            ));
        }
        if !passed {
            return Err(Error::Invalid(
                "面试尚未全部通过，通过后才能进入下一阶段".into(),
            ));
        }
    }

    // 目标为 OC+ 时：前置的测评/笔试若经历过必须通过，面试若开始必须通过（上面已覆盖）
    Ok(())
}

fn status_label(s: crate::models::Status) -> String {
    match s {
        crate::models::Status::Saved => "已保存".into(),
        crate::models::Status::Applied => "已投递".into(),
        crate::models::Status::Assessment => "测评中".into(),
        crate::models::Status::Written => "笔试中".into(),
        crate::models::Status::Interviewing => "面试中".into(),
        crate::models::Status::Oc => "已OC".into(),
        crate::models::Status::Intent => "意向书".into(),
        crate::models::Status::Offer => "offer".into(),
        crate::models::Status::Signed => "已签约".into(),
        crate::models::Status::Rejected => "已挂".into(),
        crate::models::Status::Withdrawn => "已放弃".into(),
    }
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn not_found(what: &str) -> Error {
    Error::NotFound(what.to_string())
}

const APP_SELECT: &str = "SELECT a.id, a.company_id, c.name AS company_name, a.position_title, \
a.department, a.work_location, a.channel, a.batch, a.priority, a.status, a.applied_date, \
a.job_url, a.jd_text, a.jd_snapshot_at, a.salary_range, a.tags, a.resume_version_id, \
rv.name AS resume_version_name, a.referred_by_id, a.notes, a.is_archived, a.created_at, a.updated_at \
FROM application a \
JOIN company c ON c.id = a.company_id \
LEFT JOIN resume_version rv ON rv.id = a.resume_version_id";

// ==================== 输入 DTO ====================

/// Patch DTO 中区分“字段未提供”与“显式传 null清空”。
///
/// 外层 None = 未提供；Some(None) = 清空；Some(Some(value)) = 设置新值。
fn deserialize_double_option<'de, D, T>(
    deserializer: D,
) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)] // 表单字段即如此
pub struct CreateApplicationInput {
    pub company_name: String,
    pub company_website: Option<String>,
    pub company_careers_url: Option<String>,
    pub position_title: String,
    pub department: Option<String>,
    pub work_location: Option<String>,
    pub channel: Option<String>,
    pub batch: Option<String>,
    pub priority: Option<String>,
    /// true 时自动补一条 APPLIED 事件（occurred_at = applied_date 或当前时间）
    pub applied: Option<bool>,
    pub applied_date: Option<DateTime<Utc>>,
    pub job_url: Option<String>,
    pub jd_text: Option<String>,
    pub salary_range: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub resume_version_id: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationImportRow {
    pub row_number: usize,
    /// 前端无法序列化的原始值（例如非法日期）通过这里进入统一预检结果。
    pub validation_error: Option<String>,
    #[serde(flatten)]
    pub input: CreateApplicationInput,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationImportPreviewItem {
    pub row_number: usize,
    pub company_name: String,
    pub position_title: String,
    pub status: String,
    pub message: Option<String>,
    pub duplicate_application_id: Option<String>,
    pub normalized_channel: Option<String>,
    pub normalized_batch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationImportPreview {
    pub items: Vec<ApplicationImportPreviewItem>,
    pub ready: usize,
    pub duplicates: usize,
    pub invalid: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationImportSummary {
    pub imported: usize,
    pub skipped_duplicates: usize,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub struct UpdateApplicationInput {
    pub company_name: Option<String>,
    pub position_title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub department: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub work_location: Option<Option<String>>,
    pub channel: Option<String>,
    pub batch: Option<String>,
    pub priority: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub job_url: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub jd_text: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub salary_range: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub resume_version_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEventInput {
    pub application_id: String,
    /// 内置键或 custom:<id>
    #[serde(rename = "type")]
    pub event_type: String,
    pub occurred_at: Option<DateTime<Utc>>,
    pub deadline: Option<DateTime<Utc>>,
    pub result: Option<EventResult>,
    pub note: Option<String>,
    /// MANUAL / EMAIL（扩展走 HTTP 时也会置 EXTENSION）
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEventInput {
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub occurred_at: Option<DateTime<Utc>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub deadline: Option<Option<DateTime<Utc>>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub result: Option<Option<EventResult>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub note: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddInterviewInput {
    pub application_id: String,
    pub round: Option<i64>,
    pub round_label: Option<String>,
    pub format: Option<String>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub duration_min: Option<i64>,
    pub location_or_link: Option<String>,
    pub interviewer_note: Option<String>,
    pub status: Option<InterviewStatus>,
    pub outcome: Option<InterviewOutcome>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInterviewInput {
    pub round: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub round_label: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub format: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub scheduled_at: Option<Option<DateTime<Utc>>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub duration_min: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub location_or_link: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub interviewer_note: Option<Option<String>>,
    pub status: Option<InterviewStatus>,
    pub outcome: Option<InterviewOutcome>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub self_rating: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub overall_reflection: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddQuestionInput {
    pub interview_id: String,
    pub question: String,
    pub my_answer: Option<String>,
    pub quality: Option<String>,
    pub reflection: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQuestionInput {
    pub question: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub my_answer: Option<Option<String>>,
    pub quality: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub reflection: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingItem {
    pub kind: String,
    pub application_id: String,
    pub company_name: String,
    pub position_title: String,
    pub detail: Option<String>,
    pub at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionBankItem {
    pub question_id: String,
    pub interview_id: String,
    pub question: String,
    pub my_answer: Option<String>,
    pub quality: String,
    pub reflection: Option<String>,
    pub tags: Vec<String>,
    pub round: i64,
    pub round_label: Option<String>,
    pub application_id: String,
    pub company_name: String,
    pub position_title: String,
    pub department: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListFilter {
    #[serde(default)]
    pub statuses: Vec<String>,
    #[serde(default)]
    pub channels: Vec<String>,
    #[serde(default)]
    pub batches: Vec<String>,
    pub search: Option<String>,
    pub tag: Option<String>,
    pub resume_version_id: Option<String>,
    /// 默认查未归档；archived_only=true 只看归档
    pub include_archived: Option<bool>,
    pub archived_only: Option<bool>,
}

// ==================== 服务 ====================

#[derive(Clone)]
pub struct Services {
    pub pool: SqlitePool,
}

impl Services {
    pub fn new(pool: SqlitePool) -> Services {
        Services { pool }
    }

    // ---------- 公司 ----------

    /// 按名称精确查找，不存在则创建；可顺带补全网站/招聘官网
    pub async fn upsert_company(
        &self,
        name: &str,
        website: Option<&str>,
        careers_url: Option<&str>,
    ) -> Result<Company> {
        let mut tx = self.pool.begin().await?;
        let existing: Option<String> = sqlx::query_scalar("SELECT id FROM company WHERE name = ?")
            .bind(name)
            .fetch_optional(&mut *tx)
            .await?;
        let id = match existing {
            Some(id) => {
                // 有新信息则补全（不覆盖已有值）
                sqlx::query(
                    "UPDATE company SET website = COALESCE(?, website), \
                     careers_url = COALESCE(?, careers_url), updated_at = ? WHERE id = ?",
                )
                .bind(website)
                .bind(careers_url)
                .bind(now_ts())
                .bind(&id)
                .execute(&mut *tx)
                .await?;
                id
            }
            None => {
                let id = new_id();
                sqlx::query(
                    "INSERT INTO company (id, name, website, careers_url, created_at, updated_at) \
                     VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(&id)
                .bind(name)
                .bind(website)
                .bind(careers_url)
                .bind(now_ts())
                .bind(now_ts())
                .execute(&mut *tx)
                .await?;
                id
            }
        };
        tx.commit().await?;
        self.get_company(&id).await
    }

    pub async fn get_company(&self, id: &str) -> Result<Company> {
        let row = sqlx::query("SELECT * FROM company WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("company"))?;
        Ok(Company::from_row(&row))
    }

    pub async fn search_companies(&self, q: &str, limit: u32) -> Result<Vec<Company>> {
        let rows = sqlx::query(
            "SELECT * FROM company WHERE name LIKE ? OR aliases LIKE ? ORDER BY name LIMIT ?",
        )
        .bind(format!("%{q}%"))
        .bind(format!("%{q}%"))
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(Company::from_row).collect())
    }

    // ---------- 投递 ----------

    async fn normalize_dictionary_value(
        &self,
        category: &str,
        value: Option<String>,
        builtins: &[&str],
        fallback: &str,
    ) -> Result<String> {
        let value = value.unwrap_or_else(|| fallback.to_string());
        let value = value.trim();
        if is_open_enum_key(builtins, value) {
            return Ok(value.to_string());
        }
        let mapped: Option<String> = sqlx::query_scalar(
            "SELECT key FROM dictionary WHERE category = ? AND is_active = 1 \
             AND (key = ? OR label = ?) LIMIT 1",
        )
        .bind(category)
        .bind(value)
        .bind(value)
        .fetch_optional(&self.pool)
        .await?;
        mapped.ok_or_else(|| {
            Error::Invalid(format!(
                "未知{}: {value}",
                if category == "CHANNEL" {
                    "渠道"
                } else {
                    "批次"
                }
            ))
        })
    }

    async fn normalize_create_input(
        &self,
        mut input: CreateApplicationInput,
    ) -> Result<CreateApplicationInput> {
        input.company_name = input.company_name.trim().to_string();
        input.position_title = input.position_title.trim().to_string();
        if input.company_name.is_empty() {
            return Err(Error::Invalid("公司名不能为空".into()));
        }
        if input.position_title.is_empty() {
            return Err(Error::Invalid("岗位名不能为空".into()));
        }
        input.channel = Some(
            self.normalize_dictionary_value("CHANNEL", input.channel, CHANNEL_KEYS, "COMPANY_SITE")
                .await?,
        );
        input.batch = Some(
            self.normalize_dictionary_value("BATCH", input.batch, BATCH_KEYS, "FORMAL")
                .await?,
        );
        let priority = input.priority.unwrap_or_else(|| "MEDIUM".into());
        let priority = match priority.trim() {
            "高" => "HIGH",
            "中" => "MEDIUM",
            "低" => "LOW",
            other => other,
        };
        if !PRIORITY_KEYS.contains(&priority) {
            return Err(Error::Invalid(format!("未知优先级: {priority}")));
        }
        input.priority = Some(priority.to_string());
        input.department = clean_optional(input.department);
        input.work_location = clean_optional(input.work_location);
        input.job_url = clean_optional(input.job_url);
        input.jd_text = clean_optional(input.jd_text);
        input.salary_range = clean_optional(input.salary_range);
        input.notes = clean_optional(input.notes);
        let mut seen_tags = HashSet::new();
        input.tags = input
            .tags
            .into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty() && seen_tags.insert(tag.clone()))
            .collect();
        Ok(input)
    }

    pub async fn create_application(&self, input: CreateApplicationInput) -> Result<Application> {
        let input = self.normalize_create_input(input).await?;
        let mut tx = self.pool.begin().await?;
        let id = insert_application_tx(&mut tx, input).await?;
        tx.commit().await?;
        self.get_application(&id).await
    }

    /// 按岗位 URL 优先、公司/岗位/部门/批次/投递日次之查找重复记录。
    /// 浏览器扩展与批量导入共用同一套指纹规则。
    pub async fn find_duplicate_application(
        &self,
        input: &CreateApplicationInput,
    ) -> Result<Option<Application>> {
        let normalized = self.normalize_create_input(input.clone()).await?;
        let (urls, metadata) = self.import_fingerprints().await?;
        let duplicate_id = match normalized.job_url.as_deref().and_then(canonical_job_url) {
            Some(key) => urls.get(&key).cloned(),
            None => metadata.get(&fingerprint_for_input(&normalized)).cloned(),
        };
        match duplicate_id {
            Some(id) => self.get_application(&id).await.map(Some),
            None => Ok(None),
        }
    }

    async fn import_fingerprints(
        &self,
    ) -> Result<(HashMap<String, String>, HashMap<String, String>)> {
        let rows = sqlx::query(
            "SELECT a.id, c.name AS company_name, a.position_title, a.department, a.batch, \
             a.applied_date, a.job_url FROM application a JOIN company c ON c.id = a.company_id",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut urls = HashMap::new();
        let mut metadata = HashMap::new();
        for row in rows {
            let id: String = row.try_get("id").unwrap_or_default();
            let job_url: Option<String> = row.try_get("job_url").ok().flatten();
            if let Some(url) = job_url.as_deref().and_then(canonical_job_url) {
                urls.entry(url).or_insert_with(|| id.clone());
            }
            let key = metadata_fingerprint(
                row.try_get::<String, _>("company_name")
                    .unwrap_or_default()
                    .as_str(),
                row.try_get::<String, _>("position_title")
                    .unwrap_or_default()
                    .as_str(),
                row.try_get::<Option<String>, _>("department")
                    .ok()
                    .flatten()
                    .as_deref(),
                row.try_get::<String, _>("batch")
                    .unwrap_or_default()
                    .as_str(),
                row.try_get::<Option<String>, _>("applied_date")
                    .ok()
                    .flatten()
                    .as_deref(),
            );
            metadata.entry(key).or_insert(id);
        }
        Ok((urls, metadata))
    }

    pub async fn preview_application_import(
        &self,
        rows: &[ApplicationImportRow],
    ) -> Result<ApplicationImportPreview> {
        let (mut urls, mut metadata) = self.import_fingerprints().await?;
        let mut items = Vec::with_capacity(rows.len());
        let mut ready = 0;
        let mut duplicates = 0;
        let mut invalid = 0;

        for row in rows {
            let mut item = ApplicationImportPreviewItem {
                row_number: row.row_number,
                company_name: row.input.company_name.trim().to_string(),
                position_title: row.input.position_title.trim().to_string(),
                status: "READY".into(),
                message: None,
                duplicate_application_id: None,
                normalized_channel: None,
                normalized_batch: None,
            };
            if let Some(error) = row
                .validation_error
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                item.status = "INVALID".into();
                item.message = Some(error.to_string());
                invalid += 1;
                items.push(item);
                continue;
            }
            let input = match self.normalize_create_input(row.input.clone()).await {
                Ok(value) => value,
                Err(error) => {
                    item.status = "INVALID".into();
                    item.message = Some(error.to_string());
                    invalid += 1;
                    items.push(item);
                    continue;
                }
            };
            item.normalized_channel = input.channel.clone();
            item.normalized_batch = input.batch.clone();
            let url_key = input.job_url.as_deref().and_then(canonical_job_url);
            let meta_key = fingerprint_for_input(&input);
            let duplicate_id = match url_key.as_ref() {
                Some(key) => urls.get(key).cloned(),
                None => metadata.get(&meta_key).cloned(),
            };
            if let Some(id) = duplicate_id {
                item.status = "DUPLICATE".into();
                item.message = Some("与已有投递或本次文件中的前一行重复".into());
                item.duplicate_application_id = Some(id);
                duplicates += 1;
            } else {
                let provisional = format!("import-row-{}", row.row_number);
                if let Some(key) = url_key {
                    urls.insert(key, provisional.clone());
                }
                metadata.insert(meta_key, provisional);
                ready += 1;
            }
            items.push(item);
        }
        Ok(ApplicationImportPreview {
            items,
            ready,
            duplicates,
            invalid,
        })
    }

    pub async fn import_application_rows(
        &self,
        rows: Vec<ApplicationImportRow>,
        skip_duplicates: bool,
    ) -> Result<ApplicationImportSummary> {
        let preview = self.preview_application_import(&rows).await?;
        if preview.invalid > 0 {
            return Err(Error::Invalid(format!(
                "仍有 {} 行未通过预检，请修正后再导入",
                preview.invalid
            )));
        }
        let duplicate_rows: HashSet<usize> = preview
            .items
            .iter()
            .filter(|item| item.status == "DUPLICATE")
            .map(|item| item.row_number)
            .collect();
        let mut normalized = Vec::with_capacity(rows.len());
        for row in rows {
            normalized.push((
                row.row_number,
                self.normalize_create_input(row.input).await?,
            ));
        }

        let mut tx = self.pool.begin().await?;
        let mut imported = 0;
        let mut skipped_duplicates = 0;
        for (row_number, input) in normalized {
            if skip_duplicates && duplicate_rows.contains(&row_number) {
                skipped_duplicates += 1;
                continue;
            }
            insert_application_tx(&mut tx, input).await?;
            imported += 1;
        }
        tx.commit().await?;
        Ok(ApplicationImportSummary {
            imported,
            skipped_duplicates,
        })
    }

    pub async fn get_application(&self, id: &str) -> Result<Application> {
        let sql = format!("{APP_SELECT} WHERE a.id = ?");
        let row = sqlx::query(&sql)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("application"))?;
        Ok(Application::from_row(&row))
    }

    pub async fn update_application(
        &self,
        id: &str,
        input: UpdateApplicationInput,
    ) -> Result<Application> {
        let mut tx = self.pool.begin().await?;
        // 确保存在
        let _: String = sqlx::query_scalar("SELECT id FROM application WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| not_found("application"))?;

        let now = now_ts();
        if let Some(company_name) = input.company_name {
            if !company_name.trim().is_empty() {
                let company_id =
                    upsert_company_tx(&mut tx, company_name.trim(), None, None).await?;
                sqlx::query("UPDATE application SET company_id = ?, updated_at = ? WHERE id = ?")
                    .bind(company_id)
                    .bind(&now)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        if let Some(v) = input.position_title {
            set_col(&mut tx, id, "position_title", v.trim().to_string(), &now).await?;
        }
        if let Some(v) = input.department {
            set_nullable_col(&mut tx, id, "department", v, &now).await?;
        }
        if let Some(v) = input.work_location {
            set_nullable_col(&mut tx, id, "work_location", v, &now).await?;
        }
        if let Some(v) = input.channel {
            if !is_open_enum_key(CHANNEL_KEYS, &v) {
                return Err(Error::Invalid(format!("未知渠道: {v}")));
            }
            set_col(&mut tx, id, "channel", v, &now).await?;
        }
        if let Some(v) = input.batch {
            if !is_open_enum_key(BATCH_KEYS, &v) {
                return Err(Error::Invalid(format!("未知批次: {v}")));
            }
            set_col(&mut tx, id, "batch", v, &now).await?;
        }
        if let Some(v) = input.priority {
            if !PRIORITY_KEYS.contains(&v.as_str()) {
                return Err(Error::Invalid(format!("未知优先级: {v}")));
            }
            set_col(&mut tx, id, "priority", v, &now).await?;
        }
        if let Some(v) = input.job_url {
            set_nullable_col(&mut tx, id, "job_url", v, &now).await?;
        }
        if let Some(v) = input.salary_range {
            set_nullable_col(&mut tx, id, "salary_range", v, &now).await?;
        }
        if let Some(v) = input.notes {
            set_nullable_col(&mut tx, id, "notes", v, &now).await?;
        }
        if let Some(v) = input.resume_version_id {
            set_nullable_col(&mut tx, id, "resume_version_id", v, &now).await?;
        }
        if let Some(v) = input.tags {
            let json = serde_json::to_string(&v).unwrap_or_else(|_| "[]".into());
            set_col(&mut tx, id, "tags", json, &now).await?;
        }
        if let Some(v) = input.jd_text {
            sqlx::query(
                "UPDATE application SET jd_text = ?, jd_snapshot_at = ?, updated_at = ? WHERE id = ?",
            )
            .bind(&v)
            .bind(v.as_ref().map(|_| now.clone()))
            .bind(&now)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.get_application(id).await
    }

    /// 删除投递聚合，同时删除多态附件元数据，并返回需由应用层清理的文件路径。
    pub async fn delete_application(&self, id: &str) -> Result<Vec<String>> {
        let mut tx = self.pool.begin().await?;
        let paths: Vec<String> = sqlx::query_scalar(
            "SELECT file_path FROM attachment \
             WHERE (parent_type = 'APPLICATION' AND parent_id = ?) \
                OR (parent_type = 'INTERVIEW' AND parent_id IN \
                    (SELECT id FROM interview WHERE application_id = ?))",
        )
        .bind(id)
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
        sqlx::query(
            "DELETE FROM attachment \
             WHERE (parent_type = 'APPLICATION' AND parent_id = ?) \
                OR (parent_type = 'INTERVIEW' AND parent_id IN \
                    (SELECT id FROM interview WHERE application_id = ?))",
        )
        .bind(id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        let n = sqlx::query("DELETE FROM application WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(not_found("application"));
        }
        tx.commit().await?;
        Ok(paths)
    }

    pub async fn set_archived(&self, id: &str, archived: bool) -> Result<()> {
        let n = sqlx::query("UPDATE application SET is_archived = ?, updated_at = ? WHERE id = ?")
            .bind(archived)
            .bind(now_ts())
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(not_found("application"));
        }
        Ok(())
    }

    /// 手动排序：按给定 id 顺序写 sort_order（表格拖拽后调用）
    pub async fn reorder_applications(&self, ordered_ids: &[String]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        for (i, id) in ordered_ids.iter().enumerate() {
            sqlx::query("UPDATE application SET sort_order = ? WHERE id = ?")
                .bind((i + 1) as i64)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn list_applications(&self, f: &ListFilter) -> Result<Vec<ApplicationListItem>> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
            "SELECT a.id, a.company_id, c.name AS company_name, a.position_title, a.department, \
             a.work_location, a.channel, a.batch, a.priority, a.status, a.applied_date, a.job_url, \
             a.jd_text, a.jd_snapshot_at, a.salary_range, a.tags, a.resume_version_id, \
             rv.name AS resume_version_name, a.referred_by_id, a.notes, a.is_archived, \
             a.created_at, a.updated_at, \
             (SELECT MIN(e.deadline) FROM application_event e WHERE e.application_id = a.id AND e.deadline >= ",
        );
        qb.push_bind(now_ts());
        qb.push(
            ") AS next_deadline, \
             (SELECT COUNT(*) FROM interview i WHERE i.application_id = a.id) AS interview_count, \
             (SELECT COALESCE(MAX(i.round), 0) FROM interview i WHERE i.application_id = a.id) AS max_interview_round, \
             (SELECT i.round FROM interview i WHERE i.application_id = a.id AND i.status = 'SCHEDULED' \
                ORDER BY i.round DESC LIMIT 1) AS active_interview_round, \
             EXISTS(SELECT 1 FROM interview i WHERE i.application_id = a.id \
                AND i.status = 'SCHEDULED') AS has_scheduled_interview, \
             EXISTS(SELECT 1 FROM interview i WHERE i.application_id = a.id \
                AND i.status = 'SCHEDULED' AND i.scheduled_at IS NOT NULL AND i.scheduled_at < ",
        );
        qb.push_bind(now_ts());
        qb.push(
            ") AS has_overdue_interview, \
             (SELECT e2.type FROM application_event e2 WHERE e2.application_id = a.id \
                ORDER BY e2.occurred_at DESC, e2.created_at DESC LIMIT 1) AS last_event_type, \
             (SELECT e3.occurred_at FROM application_event e3 WHERE e3.application_id = a.id \
                ORDER BY e3.occurred_at DESC, e3.created_at DESC LIMIT 1) AS last_event_at \
             FROM application a \
             JOIN company c ON c.id = a.company_id \
             LEFT JOIN resume_version rv ON rv.id = a.resume_version_id",
        );

        let mut first = true;
        let cond = |qb: &mut QueryBuilder<Sqlite>, first: &mut bool| {
            // 简化 where 拼接：调用方保证只在有条件时进入
            let sep = if *first { " WHERE " } else { " AND " };
            *first = false;
            qb.push(sep);
        };

        let archived_only = f.archived_only.unwrap_or(false);
        if archived_only {
            cond(&mut qb, &mut first);
            qb.push("a.is_archived = 1");
        } else if !f.include_archived.unwrap_or(false) {
            cond(&mut qb, &mut first);
            qb.push("a.is_archived = 0");
        }
        if !f.statuses.is_empty() {
            cond(&mut qb, &mut first);
            qb.push("a.status IN (");
            for (i, s) in f.statuses.iter().enumerate() {
                if i > 0 {
                    qb.push(", ");
                }
                qb.push_bind(s.clone());
            }
            qb.push(")");
        }
        if !f.channels.is_empty() {
            cond(&mut qb, &mut first);
            qb.push("a.channel IN (");
            for (i, s) in f.channels.iter().enumerate() {
                if i > 0 {
                    qb.push(", ");
                }
                qb.push_bind(s.clone());
            }
            qb.push(")");
        }
        if !f.batches.is_empty() {
            cond(&mut qb, &mut first);
            qb.push("a.batch IN (");
            for (i, s) in f.batches.iter().enumerate() {
                if i > 0 {
                    qb.push(", ");
                }
                qb.push_bind(s.clone());
            }
            qb.push(")");
        }
        if let Some(tag) = &f.tag {
            cond(&mut qb, &mut first);
            qb.push("a.tags LIKE ");
            qb.push_bind(format!("%\"{tag}\"%"));
        }
        if let Some(rv) = &f.resume_version_id {
            cond(&mut qb, &mut first);
            qb.push("a.resume_version_id = ");
            qb.push_bind(rv.clone());
        }
        if let Some(search) = f.search.as_deref().filter(|s| !s.trim().is_empty()) {
            cond(&mut qb, &mut first);
            let like = format!("%{}%", search.trim());
            qb.push("(a.position_title LIKE ");
            qb.push_bind(like.clone());
            qb.push(" OR a.department LIKE ");
            qb.push_bind(like.clone());
            qb.push(" OR a.notes LIKE ");
            qb.push_bind(like.clone());
            qb.push(" OR a.jd_text LIKE ");
            qb.push_bind(like.clone());
            qb.push(" OR c.name LIKE ");
            qb.push_bind(like);
            qb.push(")");
        }
        qb.push(" ORDER BY a.sort_order ASC, a.updated_at DESC LIMIT 500");

        let rows = qb.build().fetch_all(&self.pool).await?;
        Ok(rows.iter().map(ApplicationListItem::from_row).collect())
    }

    pub async fn get_application_detail(&self, id: &str) -> Result<ApplicationDetail> {
        let application = self.get_application(id).await?;
        let events: Vec<ApplicationEvent> = sqlx::query(
            "SELECT * FROM application_event WHERE application_id = ? \
             ORDER BY occurred_at DESC, created_at DESC",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?
        .iter()
        .map(ApplicationEvent::from_row)
        .collect();

        let interview_rows = sqlx::query(
            "SELECT iv.*, (SELECT COUNT(*) FROM interview_question q WHERE q.interview_id = iv.id) AS question_count \
             FROM interview iv WHERE iv.application_id = ? \
             ORDER BY COALESCE(iv.scheduled_at, iv.created_at) DESC",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;

        let question_rows = sqlx::query(
            "SELECT q.* FROM interview_question q \
             JOIN interview iv ON iv.id = q.interview_id \
             WHERE iv.application_id = ? ORDER BY q.ordinal",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;

        let mut questions_by_iv: HashMap<String, Vec<InterviewQuestion>> = HashMap::new();
        for row in &question_rows {
            let q = InterviewQuestion::from_row(row);
            questions_by_iv
                .entry(q.interview_id.clone())
                .or_default()
                .push(q);
        }
        let interviews = interview_rows
            .iter()
            .map(|row| {
                let iv = Interview::from_row(row);
                InterviewDetail {
                    questions: questions_by_iv.remove(&iv.id).unwrap_or_default(),
                    interview: iv,
                }
            })
            .collect();

        let attachments: Vec<Attachment> = sqlx::query(
            "SELECT * FROM attachment WHERE parent_type = 'APPLICATION' AND parent_id = ?              ORDER BY created_at DESC",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?
        .iter()
        .map(Attachment::from_row)
        .collect();

        Ok(ApplicationDetail {
            application,
            events,
            interviews,
            attachments,
        })
    }

    // ---------- 今日待办（P1-b） ----------

    /// 待补结果的过期面试 + 未来 days 天内截止 + scheduled 天内面试。
    pub async fn get_upcoming(
        &self,
        deadline_days: i64,
        interview_days: i64,
    ) -> Result<Vec<UpcomingItem>> {
        let now = now_ts();
        let dl_end = ts(&(Utc::now() + chrono::Duration::days(deadline_days)));
        let iv_end = ts(&(Utc::now() + chrono::Duration::days(interview_days)));
        let rows = sqlx::query(
            "SELECT 0 AS bucket, 'overdue_interview' AS kind, a.id AS application_id, c.name AS company_name, \
             a.position_title, CAST(iv.round AS TEXT) AS detail, iv.scheduled_at AS at \
             FROM interview iv \
             JOIN application a ON a.id = iv.application_id \
             JOIN company c ON c.id = a.company_id \
             WHERE iv.scheduled_at < ? AND iv.status = 'SCHEDULED' AND a.is_archived = 0 \
             UNION ALL \
             SELECT 1 AS bucket, 'deadline' AS kind, a.id AS application_id, c.name AS company_name, \
             a.position_title, e.type AS detail, e.deadline AS at \
             FROM application_event e \
             JOIN application a ON a.id = e.application_id \
             JOIN company c ON c.id = a.company_id \
             WHERE e.deadline >= ? AND e.deadline <= ? AND a.is_archived = 0 \
             UNION ALL \
             SELECT 1 AS bucket, 'interview' AS kind, a.id AS application_id, c.name AS company_name, \
             a.position_title, CAST(iv.round AS TEXT) AS detail, iv.scheduled_at AS at \
             FROM interview iv \
             JOIN application a ON a.id = iv.application_id \
             JOIN company c ON c.id = a.company_id \
             WHERE iv.scheduled_at >= ? AND iv.scheduled_at <= ? \
               AND iv.status = 'SCHEDULED' AND a.is_archived = 0 \
             ORDER BY bucket ASC, at ASC",
        )
        .bind(&now)
        .bind(&now)
        .bind(&dl_end)
        .bind(&now)
        .bind(&iv_end)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| UpcomingItem {
                kind: r.try_get::<String, _>("kind").unwrap_or_default(),
                application_id: r.try_get("application_id").unwrap_or_default(),
                company_name: r.try_get("company_name").unwrap_or_default(),
                position_title: r.try_get("position_title").unwrap_or_default(),
                detail: r.try_get::<Option<String>, _>("detail").ok().flatten(),
                at: r.try_get("at").unwrap_or_default(),
            })
            .collect())
    }

    /// 按明确时间区间返回月历条目，包含投递日、截止时间和未取消的面试。
    /// 区间为 [start, end)，由前端按本地月份转换成 UTC。
    pub async fn get_calendar_items(
        &self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<UpcomingItem>> {
        if end <= start {
            return Err(Error::Invalid("日历结束时间必须晚于开始时间".into()));
        }
        let start = ts(&start);
        let end = ts(&end);
        let rows = sqlx::query(
            "SELECT 'applied' AS kind, a.id AS application_id, c.name AS company_name, \
             a.position_title, NULL AS detail, a.applied_date AS at \
             FROM application a JOIN company c ON c.id = a.company_id \
             WHERE a.applied_date >= ? AND a.applied_date < ? \
             UNION ALL \
             SELECT 'deadline' AS kind, a.id AS application_id, c.name AS company_name, \
             a.position_title, e.type AS detail, e.deadline AS at \
             FROM application_event e \
             JOIN application a ON a.id = e.application_id \
             JOIN company c ON c.id = a.company_id \
             WHERE e.deadline >= ? AND e.deadline < ? \
             UNION ALL \
             SELECT 'interview' AS kind, a.id AS application_id, c.name AS company_name, \
             a.position_title, iv.round_label AS detail, iv.scheduled_at AS at \
             FROM interview iv \
             JOIN application a ON a.id = iv.application_id \
             JOIN company c ON c.id = a.company_id \
             WHERE iv.scheduled_at >= ? AND iv.scheduled_at < ? AND iv.status != 'CANCELLED' \
             ORDER BY at ASC",
        )
        .bind(&start)
        .bind(&end)
        .bind(&start)
        .bind(&end)
        .bind(&start)
        .bind(&end)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| UpcomingItem {
                kind: r.try_get::<String, _>("kind").unwrap_or_default(),
                application_id: r.try_get("application_id").unwrap_or_default(),
                company_name: r.try_get("company_name").unwrap_or_default(),
                position_title: r.try_get("position_title").unwrap_or_default(),
                detail: r.try_get::<Option<String>, _>("detail").ok().flatten(),
                at: r.try_get("at").unwrap_or_default(),
            })
            .collect())
    }

    // ---------- 公司库管理 ----------

    pub async fn list_companies(&self) -> Result<Vec<Company>> {
        let rows = sqlx::query(
            "SELECT c.*, (SELECT COUNT(*) FROM application a WHERE a.company_id = c.id) AS application_count \
             FROM company c ORDER BY application_count DESC, c.name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(Company::from_row).collect())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_company(
        &self,
        id: &str,
        name: &str,
        aliases: Vec<String>,
        industry: Option<String>,
        nature: Option<String>,
        website: Option<String>,
        careers_url: Option<String>,
        notes: Option<String>,
    ) -> Result<Company> {
        if name.trim().is_empty() {
            return Err(Error::Invalid("公司名不能为空".into()));
        }
        let n = sqlx::query(
            "UPDATE company SET name = ?, aliases = ?, industry = ?, nature = ?, website = ?, \
             careers_url = ?, notes = ?, updated_at = ? WHERE id = ?",
        )
        .bind(name.trim())
        .bind(serde_json::to_string(&aliases).unwrap_or_else(|_| "[]".into()))
        .bind(industry)
        .bind(nature)
        .bind(website)
        .bind(careers_url)
        .bind(notes)
        .bind(now_ts())
        .bind(id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if n == 0 {
            return Err(not_found("company"));
        }
        self.get_company(id).await
    }

    /// 删除公司；有投递引用时拒绝（FK 为 RESTRICT，这里提前给出友好错误）
    pub async fn delete_company(&self, id: &str) -> Result<()> {
        let in_use: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM application WHERE company_id = ?")
                .bind(id)
                .fetch_one(&self.pool)
                .await?;
        if in_use > 0 {
            return Err(Error::Invalid(format!(
                "该公司下还有 {in_use} 条投递，暂不能删除"
            )));
        }
        let n = sqlx::query("DELETE FROM company WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(not_found("company"));
        }
        Ok(())
    }

    // ---------- 面经知识库（P2-a） ----------

    pub async fn list_all_questions(&self, search: Option<&str>) -> Result<Vec<QuestionBankItem>> {
        const BASE_SQL: &str = "SELECT q.id AS question_id, q.interview_id, q.question, q.my_answer, q.quality, q.reflection, q.tags, \
             iv.round, iv.round_label, a.id AS application_id, c.name AS company_name, \
             a.position_title, a.department, a.status \
             FROM interview_question q \
             JOIN interview iv ON iv.id = q.interview_id \
             JOIN application a ON a.id = iv.application_id \
             JOIN company c ON c.id = a.company_id ";
        let term = search.map(str::trim).filter(|t| !t.is_empty());
        let rows = if let Some(t) = term {
            // 参数绑定防注入
            let like = format!("%{t}%");
            sqlx::query(&format!(
                "{BASE_SQL} WHERE q.question LIKE ? OR q.reflection LIKE ? OR q.tags LIKE ? OR c.name LIKE ? \
                 ORDER BY q.created_at DESC LIMIT 1000"
            ))
            .bind(&like)
            .bind(&like)
            .bind(&like)
            .bind(&like)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(&format!("{BASE_SQL} ORDER BY q.created_at DESC LIMIT 1000"))
                .fetch_all(&self.pool)
                .await?
        };
        Ok(rows
            .iter()
            .map(|r| QuestionBankItem {
                question_id: r.try_get("question_id").unwrap_or_default(),
                interview_id: r.try_get("interview_id").unwrap_or_default(),
                question: r.try_get("question").unwrap_or_default(),
                my_answer: r.try_get("my_answer").ok().flatten(),
                quality: r.try_get("quality").unwrap_or_default(),
                reflection: r.try_get("reflection").ok().flatten(),
                tags: r
                    .try_get::<String, _>("tags")
                    .map(|t| crate::entities::parse_json_strings(&t))
                    .unwrap_or_default(),
                round: r.try_get("round").unwrap_or(0),
                round_label: r.try_get("round_label").ok().flatten(),
                application_id: r.try_get("application_id").unwrap_or_default(),
                company_name: r.try_get("company_name").unwrap_or_default(),
                position_title: r.try_get("position_title").unwrap_or_default(),
                department: r.try_get("department").ok().flatten(),
                status: r.try_get("status").unwrap_or_default(),
            })
            .collect())
    }

    // ---------- CSV 导出（P1-e，飞书模板兼容列） ----------

    pub async fn export_csv(&self, path: &str) -> Result<u64> {
        let rows = sqlx::query(
            "SELECT c.name AS company_name, a.position_title, a.department, a.work_location, \
             a.channel, a.batch, a.priority, a.status, a.applied_date, a.tags, \
             (SELECT GROUP_CONCAT(e.deadline) FROM application_event e \
                WHERE e.application_id = a.id AND e.deadline IS NOT NULL) AS deadlines, \
             (SELECT COUNT(*) FROM interview iv WHERE iv.application_id = a.id) AS interview_count, \
             rv.name AS resume_name, a.job_url, a.jd_text, a.salary_range, a.notes \
             FROM application a \
             JOIN company c ON c.id = a.company_id \
             LEFT JOIN resume_version rv ON rv.id = a.resume_version_id \
             ORDER BY a.applied_date DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        fn esc(v: &str) -> String {
            if v.contains(',') || v.contains('"') || v.contains('\n') {
                format!("\"{}\"", v.replace('"', "\"\""))
            } else {
                v.to_string()
            }
        }
        let label = |map: &std::collections::HashMap<String, String>, key: &str| {
            map.get(key).cloned().unwrap_or_else(|| key.to_string())
        };
        let dicts = sqlx::query_as::<_, (String, String, String)>(
            "SELECT category, key, label FROM dictionary WHERE is_active = 1",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut dict_map: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for (cat, k, v) in dicts {
            dict_map.insert(format!("{cat}:{k}"), v);
        }
        let status_cn = |s: &str| -> String {
            crate::models::Status::parse(s)
                .map(status_label)
                .unwrap_or_else(|| s.to_string())
        };

        let mut out = String::from("公司,岗位,部门,Base城市,渠道,批次,优先级,当前状态,投递日期,最近截止,面试轮数,简历版本,岗位链接,JD文本,薪资范围,标签,备注\n");
        for r in &rows {
            let get = |col: &str| {
                r.try_get::<Option<String>, _>(col)
                    .ok()
                    .flatten()
                    .unwrap_or_default()
            };
            let deadline = get("deadlines")
                .split(',')
                .filter_map(crate::entities::parse_ts)
                .max()
                .map(|d| crate::entities::ts(&d))
                .unwrap_or_default();
            let row = vec![
                get("company_name"),
                get("position_title"),
                get("department"),
                get("work_location"),
                label(&dict_map, &format!("CHANNEL:{}", get("channel"))),
                label(&dict_map, &format!("BATCH:{}", get("batch"))),
                get("priority"),
                status_cn(&get("status")),
                get("applied_date"),
                deadline,
                r.try_get::<i64, _>("interview_count")
                    .unwrap_or(0)
                    .to_string(),
                get("resume_name"),
                get("job_url"),
                get("jd_text"),
                get("salary_range"),
                get("tags"),
                get("notes"),
            ];
            out.push_str(&row.iter().map(|c| esc(c)).collect::<Vec<_>>().join(","));
            out.push('\n');
        }
        std::fs::write(path, out)?;
        Ok(rows.len() as u64)
    }

    // ---------- 附件 ----------

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_attachment(
        &self,
        parent_type: &str,
        parent_id: &str,
        file_name: &str,
        file_path: &str,
        mime_type: Option<&str>,
        size: Option<i64>,
    ) -> Result<Attachment> {
        if !matches!(parent_type, "APPLICATION" | "INTERVIEW") {
            return Err(Error::Invalid("附件只能挂在投递或面试上".into()));
        }
        let parent_exists: i64 = match parent_type {
            "APPLICATION" => {
                sqlx::query_scalar("SELECT COUNT(*) FROM application WHERE id = ?")
                    .bind(parent_id)
                    .fetch_one(&self.pool)
                    .await?
            }
            "INTERVIEW" => {
                sqlx::query_scalar("SELECT COUNT(*) FROM interview WHERE id = ?")
                    .bind(parent_id)
                    .fetch_one(&self.pool)
                    .await?
            }
            _ => unreachable!(),
        };
        if parent_exists == 0 {
            return Err(not_found(if parent_type == "APPLICATION" {
                "application"
            } else {
                "interview"
            }));
        }
        let id = new_id();
        sqlx::query(
            "INSERT INTO attachment (id, parent_type, parent_id, file_name, file_path, mime_type, size, created_at)              VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(parent_type)
        .bind(parent_id)
        .bind(file_name)
        .bind(file_path)
        .bind(mime_type)
        .bind(size)
        .bind(now_ts())
        .execute(&self.pool)
        .await?;
        let row = sqlx::query("SELECT * FROM attachment WHERE id = ?")
            .bind(&id)
            .fetch_one(&self.pool)
            .await?;
        Ok(Attachment::from_row(&row))
    }

    pub async fn delete_attachment(&self, id: &str) -> Result<String> {
        let path: Option<String> =
            sqlx::query_scalar("SELECT file_path FROM attachment WHERE id = ?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?
                .flatten();
        let n = sqlx::query("DELETE FROM attachment WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(not_found("attachment"));
        }
        Ok(path.unwrap_or_default())
    }

    // ---------- 事件 ----------

    pub async fn add_event(&self, input: AddEventInput) -> Result<ApplicationEvent> {
        let event_type = self.resolve_event_type(&input.event_type).await?;
        let mut tx = self.pool.begin().await?;
        ensure_application(&mut tx, &input.application_id).await?;
        // 阶段门禁：只有当前阶段通过，才能添加下一阶段的事件
        let status_now: String = sqlx::query_scalar("SELECT status FROM application WHERE id = ?")
            .bind(&input.application_id)
            .fetch_one(&mut *tx)
            .await?;
        ensure_stage_rules(
            &mut tx,
            &input.application_id,
            &status_now,
            &input.event_type,
        )
        .await?;
        let id = new_id();
        let occurred = input.occurred_at.unwrap_or_else(Utc::now);
        let source = input.source.clone().unwrap_or_else(|| "MANUAL".into());
        sqlx::query(
            "INSERT INTO application_event (id, application_id, type, occurred_at, deadline, result, note, source, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&input.application_id)
        .bind(event_type.db_key())
        .bind(ts(&occurred))
        .bind(input.deadline.map(|d| ts(&d)))
        .bind(input.result.map(|r| r.as_str().to_string()))
        .bind(input.note)
        .bind(&source)
        .bind(now_ts())
        .execute(&mut *tx)
        .await?;
        recompute_status(&mut tx, &input.application_id).await?;
        tx.commit().await?;
        self.get_event(&id).await
    }

    pub async fn update_event(
        &self,
        id: &str,
        input: UpdateEventInput,
    ) -> Result<ApplicationEvent> {
        let mut tx = self.pool.begin().await?;
        let app_id: String =
            sqlx::query_scalar("SELECT application_id FROM application_event WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| not_found("event"))?;

        if let Some(t) = &input.event_type {
            let event_type = self.resolve_event_type(t).await?;
            set_event_col(&mut tx, id, "type", event_type.db_key()).await?;
        }
        if let Some(v) = input.occurred_at {
            set_event_col(&mut tx, id, "occurred_at", ts(&v)).await?;
        }
        if let Some(v) = input.deadline {
            set_event_nullable_col(&mut tx, id, "deadline", v.map(|d| ts(&d))).await?;
        }
        if let Some(v) = input.result {
            set_event_nullable_col(
                &mut tx,
                id,
                "result",
                v.map(|result| result.as_str().to_string()),
            )
            .await?;
        }
        if let Some(v) = input.note {
            set_event_nullable_col(&mut tx, id, "note", v).await?;
        }
        recompute_status(&mut tx, &app_id).await?;
        tx.commit().await?;
        self.get_event(id).await
    }

    pub async fn delete_event(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let app_id: Option<String> =
            sqlx::query_scalar("SELECT application_id FROM application_event WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let app_id = app_id.ok_or_else(|| not_found("event"))?;
        sqlx::query("DELETE FROM application_event WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        recompute_status(&mut tx, &app_id).await?;
        tx.commit().await?;
        Ok(())
    }

    async fn get_event(&self, id: &str) -> Result<ApplicationEvent> {
        let row = sqlx::query("SELECT * FROM application_event WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("event"))?;
        Ok(ApplicationEvent::from_row(&row))
    }

    /// 校验事件类型键并带上自定义投影
    async fn resolve_event_type(&self, key: &str) -> Result<EventType> {
        if key.starts_with("custom:") {
            let id = key.strip_prefix("custom:").unwrap();
            let projection: Option<String> = sqlx::query_scalar(
                "SELECT projection FROM custom_event_type WHERE id = ? AND is_active = 1",
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .flatten();
            let projection = projection
                .and_then(|p| ProjectionEffect::parse(&p))
                .ok_or_else(|| Error::Invalid(format!("未知自定义事件类型: {key}")))?;
            Ok(EventType::Custom {
                key: id.to_string(),
                projection,
            })
        } else {
            EventType::parse_db_key(key, None)
                .ok_or_else(|| Error::Invalid(format!("未知事件类型: {key}")))
        }
    }

    // ---------- 面试 ----------

    pub async fn add_interview(&self, input: AddInterviewInput) -> Result<Interview> {
        let mut tx = self.pool.begin().await?;
        ensure_application(&mut tx, &input.application_id).await?;
        // 阶段门禁：终态不可加面试；存在的测评/笔试必须已通过
        let status_now: String = sqlx::query_scalar("SELECT status FROM application WHERE id = ?")
            .bind(&input.application_id)
            .fetch_one(&mut *tx)
            .await?;
        ensure_not_terminal(&status_now)?;
        // 添加面试 = 面试阶段事件：统一顺序门禁（测评/笔试未通过则拦截）
        ensure_stage_rules(&mut tx, &input.application_id, &status_now, "__INTERVIEW__").await?;
        // 逐轮约束：上一轮必须已完结（完成/取消），新轮次必须恰好为最大轮次 + 1
        let (max_round, pending): (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(MAX(round), 0), \
             COALESCE(SUM(CASE WHEN status = 'SCHEDULED' THEN 1 ELSE 0 END), 0) \
             FROM interview WHERE application_id = ?",
        )
        .bind(&input.application_id)
        .fetch_one(&mut *tx)
        .await?;
        if pending > 0 {
            return Err(Error::Invalid(
                "还有已约未进行的面试，请先完成或取消该轮，再添加下一轮".into(),
            ));
        }
        let round = match input.round {
            Some(r) if r == max_round + 1 => r,
            Some(_) => {
                return Err(Error::Invalid(format!(
                    "面试需逐轮添加：当前到第 {max_round} 轮，应添加第 {} 轮",
                    max_round + 1
                )))
            }
            None => max_round + 1,
        };
        let id = new_id();
        let status = input
            .status
            .map(interview_status_str)
            .unwrap_or_else(|| "SCHEDULED".into());
        let outcome = input
            .outcome
            .map(interview_outcome_str)
            .unwrap_or_else(|| "PENDING".into());
        let now = now_ts();
        sqlx::query(
            "INSERT INTO interview (id, application_id, round, round_label, format, scheduled_at, \
             duration_min, location_or_link, interviewer_note, status, outcome, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&input.application_id)
        .bind(round)
        .bind(input.round_label)
        .bind(input.format)
        .bind(input.scheduled_at.map(|d| ts(&d)))
        .bind(input.duration_min)
        .bind(input.location_or_link)
        .bind(input.interviewer_note)
        .bind(status)
        .bind(outcome)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        recompute_status(&mut tx, &input.application_id).await?;
        tx.commit().await?;
        self.get_interview(&id).await
    }

    pub async fn update_interview(
        &self,
        id: &str,
        input: UpdateInterviewInput,
    ) -> Result<Interview> {
        let mut tx = self.pool.begin().await?;
        let current: Option<(String, i64, String, String, Option<String>)> = sqlx::query_as(
            "SELECT application_id, round, status, outcome, scheduled_at FROM interview WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        let (app_id, current_round, current_status, current_outcome, current_scheduled_at) =
            current.ok_or_else(|| not_found("interview"))?;

        if let Some(Some(duration)) = input.duration_min {
            if duration <= 0 {
                return Err(Error::Invalid("面试时长必须大于 0".into()));
            }
        }
        let final_status = input
            .status
            .map(interview_status_str)
            .unwrap_or_else(|| current_status.clone());
        let mut final_outcome = input
            .outcome
            .map(interview_outcome_str)
            .unwrap_or_else(|| current_outcome.clone());
        if final_status != "COMPLETED" {
            final_outcome = "PENDING".into();
        } else if final_outcome == "PENDING" {
            return Err(Error::Invalid(
                "已完成面试需要选择通过、未通过或待定".into(),
            ));
        }
        let final_scheduled_at = input
            .scheduled_at
            .as_ref()
            .map(|value| value.as_ref().map(ts))
            .unwrap_or(current_scheduled_at.clone());
        if final_status == "SCHEDULED" && final_scheduled_at.is_none() {
            return Err(Error::Invalid("已约面试必须填写时间".into()));
        }

        if let Some(v) = input.round {
            if v < 1 {
                return Err(Error::Invalid("轮次必须 ≥ 1".into()));
            }
            if v != current_round {
                let conflict: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM interview WHERE application_id = ? AND round = ? AND id != ?",
                )
                .bind(&app_id)
                .bind(v)
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
                if conflict > 0 {
                    return Err(Error::Invalid(format!("第 {v} 轮已经存在")));
                }
            }
            set_iv_col(&mut tx, id, "round", v.to_string()).await?;
        }
        if let Some(v) = input.round_label {
            set_iv_nullable_col(&mut tx, id, "round_label", v).await?;
        }
        if let Some(v) = input.format {
            set_iv_nullable_col(&mut tx, id, "format", v).await?;
        }
        if let Some(v) = input.scheduled_at {
            set_iv_nullable_col(&mut tx, id, "scheduled_at", v.map(|d| ts(&d))).await?;
        }
        if let Some(v) = input.duration_min {
            set_iv_nullable_col(&mut tx, id, "duration_min", v.map(|n| n.to_string())).await?;
        }
        if let Some(v) = input.location_or_link {
            set_iv_nullable_col(&mut tx, id, "location_or_link", v).await?;
        }
        if let Some(v) = input.interviewer_note {
            set_iv_nullable_col(&mut tx, id, "interviewer_note", v).await?;
        }
        if input.status.is_some() {
            set_iv_col(&mut tx, id, "status", final_status).await?;
        }
        if input.outcome.is_some() || input.status.is_some() {
            set_iv_col(&mut tx, id, "outcome", final_outcome).await?;
        }
        if let Some(v) = input.self_rating {
            if let Some(rating) = v {
                if !(1..=5).contains(&rating) {
                    return Err(Error::Invalid("自评范围 1–5".into()));
                }
                set_iv_nullable_col(&mut tx, id, "self_rating", Some(rating.to_string())).await?;
            } else {
                set_iv_nullable_col(&mut tx, id, "self_rating", None).await?;
            }
        }
        if let Some(v) = input.overall_reflection {
            set_iv_nullable_col(&mut tx, id, "overall_reflection", v).await?;
        }
        recompute_status(&mut tx, &app_id).await?;
        tx.commit().await?;
        self.get_interview(id).await
    }

    pub async fn delete_interview(&self, id: &str) -> Result<Vec<String>> {
        let mut tx = self.pool.begin().await?;
        let app_id: Option<String> =
            sqlx::query_scalar("SELECT application_id FROM interview WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let app_id = app_id.ok_or_else(|| not_found("interview"))?;
        let paths: Vec<String> = sqlx::query_scalar(
            "SELECT file_path FROM attachment WHERE parent_type = 'INTERVIEW' AND parent_id = ?",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM attachment WHERE parent_type = 'INTERVIEW' AND parent_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM interview WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        recompute_status(&mut tx, &app_id).await?;
        tx.commit().await?;
        Ok(paths)
    }

    async fn get_interview(&self, id: &str) -> Result<Interview> {
        let row = sqlx::query(
            "SELECT iv.*, (SELECT COUNT(*) FROM interview_question q WHERE q.interview_id = iv.id) AS question_count \
             FROM interview iv WHERE iv.id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| not_found("interview"))?;
        Ok(Interview::from_row(&row))
    }

    // ---------- 面试题 ----------

    pub async fn add_question(&self, input: AddQuestionInput) -> Result<InterviewQuestion> {
        if input.question.trim().is_empty() {
            return Err(Error::Invalid("题目不能为空".into()));
        }
        let quality = input
            .quality
            .as_deref()
            .and_then(crate::entities::QuestionQuality::parse)
            .ok_or_else(|| Error::Invalid(format!("未知表现: {:?}", input.quality)))?;
        let mut tx = self.pool.begin().await?;
        ensure_interview(&mut tx, &input.interview_id).await?;
        let id = new_id();
        let ordinal: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM interview_question WHERE interview_id = ?",
        )
        .bind(&input.interview_id)
        .fetch_one(&mut *tx)
        .await?;
        let now = now_ts();
        sqlx::query(
            "INSERT INTO interview_question (id, interview_id, ordinal, question, my_answer, quality, reflection, tags, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&input.interview_id)
        .bind(ordinal)
        .bind(input.question.trim())
        .bind(input.my_answer)
        .bind(quality.as_str())
        .bind(input.reflection)
        .bind(serde_json::to_string(&input.tags).unwrap_or_else(|_| "[]".into()))
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get_question(&id).await
    }

    pub async fn update_question(
        &self,
        id: &str,
        input: UpdateQuestionInput,
    ) -> Result<InterviewQuestion> {
        let mut tx = self.pool.begin().await?;
        ensure_question(&mut tx, id).await?;
        if let Some(v) = input.question {
            set_q_col(&mut tx, id, "question", v.trim().to_string()).await?;
        }
        if let Some(v) = input.my_answer {
            set_q_nullable_col(&mut tx, id, "my_answer", v).await?;
        }
        if let Some(v) = input.quality {
            let q = crate::entities::QuestionQuality::parse(&v)
                .ok_or_else(|| Error::Invalid(format!("未知表现: {v}")))?;
            set_q_col(&mut tx, id, "quality", q.as_str().to_string()).await?;
        }
        if let Some(v) = input.reflection {
            set_q_nullable_col(&mut tx, id, "reflection", v).await?;
        }
        if let Some(v) = input.tags {
            set_q_col(
                &mut tx,
                id,
                "tags",
                serde_json::to_string(&v).unwrap_or_else(|_| "[]".into()),
            )
            .await?;
        }
        tx.commit().await?;
        self.get_question(id).await
    }

    pub async fn delete_question(&self, id: &str) -> Result<()> {
        let n = sqlx::query("DELETE FROM interview_question WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(not_found("question"));
        }
        Ok(())
    }

    /// 按给定顺序重排（拖拽排序）
    pub async fn reorder_questions(&self, ordered_ids: &[String]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        for (i, id) in ordered_ids.iter().enumerate() {
            sqlx::query("UPDATE interview_question SET ordinal = ?, updated_at = ? WHERE id = ?")
                .bind((i + 1) as i64)
                .bind(now_ts())
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn get_question(&self, id: &str) -> Result<InterviewQuestion> {
        let row = sqlx::query("SELECT * FROM interview_question WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("question"))?;
        Ok(InterviewQuestion::from_row(&row))
    }

    // ---------- 简历版本 ----------

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_resume(
        &self,
        name: &str,
        target_role: Option<&str>,
        file_name: &str,
        file_path: &str,
        file_size: Option<i64>,
        notes: Option<&str>,
    ) -> Result<ResumeVersion> {
        if name.trim().is_empty() {
            return Err(Error::Invalid("简历版本名不能为空".into()));
        }
        let id = new_id();
        let now = now_ts();
        sqlx::query(
            "INSERT INTO resume_version (id, name, target_role, file_name, file_path, file_size, notes, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name.trim())
        .bind(target_role)
        .bind(file_name)
        .bind(file_path)
        .bind(file_size)
        .bind(notes)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        self.get_resume(&id).await
    }

    pub async fn get_resume(&self, id: &str) -> Result<ResumeVersion> {
        let row = sqlx::query(&resume_sql("WHERE rv.id = ?"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("resume"))?;
        Ok(resume_from_row(&row))
    }

    pub async fn list_resumes(&self) -> Result<Vec<ResumeVersion>> {
        let rows = sqlx::query(&resume_sql("ORDER BY rv.created_at DESC"))
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(resume_from_row).collect())
    }

    pub async fn set_default_resume(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE resume_version SET is_default = 0, updated_at = ?")
            .bind(now_ts())
            .execute(&mut *tx)
            .await?;
        let n =
            sqlx::query("UPDATE resume_version SET is_default = 1, updated_at = ? WHERE id = ?")
                .bind(now_ts())
                .bind(id)
                .execute(&mut *tx)
                .await?
                .rows_affected();
        if n == 0 {
            return Err(not_found("resume"));
        }
        tx.commit().await?;
        Ok(())
    }

    /// 删除简历版本；引用它的投递 resume_version_id 置空（FK ON DELETE SET NULL）
    pub async fn delete_resume(&self, id: &str) -> Result<()> {
        let n = sqlx::query("DELETE FROM resume_version WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(not_found("resume"));
        }
        Ok(())
    }

    // ---------- 字典 / 自定义事件类型 / 设置 ----------

    pub async fn list_dictionary(&self, category: &str) -> Result<Vec<DictionaryItem>> {
        let rows = sqlx::query(
            "SELECT id, category, key, label, sort, is_active, is_system FROM dictionary \
             WHERE category = ? ORDER BY sort",
        )
        .bind(category)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| DictionaryItem {
                id: r.try_get("id").unwrap_or_default(),
                category: r.try_get("category").unwrap_or_default(),
                key: r.try_get("key").unwrap_or_default(),
                label: r.try_get("label").unwrap_or_default(),
                sort: r.try_get("sort").unwrap_or(0),
                is_active: r
                    .try_get::<i64, _>("is_active")
                    .map(|v| v != 0)
                    .unwrap_or(true),
                is_system: r
                    .try_get::<i64, _>("is_system")
                    .map(|v| v != 0)
                    .unwrap_or(false),
            })
            .collect())
    }

    pub async fn list_custom_event_types(&self) -> Result<Vec<CustomEventType>> {
        let rows = sqlx::query("SELECT * FROM custom_event_type ORDER BY sort, id")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .iter()
            .map(|r| CustomEventType {
                id: r.try_get("id").unwrap_or_default(),
                label: r.try_get("label").unwrap_or_default(),
                projection: r.try_get("projection").unwrap_or_default(),
                deadline_required: r
                    .try_get::<i64, _>("deadline_required")
                    .map(|v| v != 0)
                    .unwrap_or(false),
                result_required: r
                    .try_get::<i64, _>("result_required")
                    .map(|v| v != 0)
                    .unwrap_or(false),
                sort: r.try_get("sort").unwrap_or(0),
                is_active: r
                    .try_get::<i64, _>("is_active")
                    .map(|v| v != 0)
                    .unwrap_or(true),
            })
            .collect())
    }

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        Ok(
            sqlx::query_scalar("SELECT value_json FROM setting WHERE key = ?")
                .bind(key)
                .fetch_optional(&self.pool)
                .await?
                .flatten(),
        )
    }

    pub async fn set_setting(&self, key: &str, value_json: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO setting (key, value_json, updated_at) VALUES (?, ?, ?) \
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value_json)
        .bind(now_ts())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_setting(&self, key: &str) -> Result<()> {
        sqlx::query("DELETE FROM setting WHERE key = ?")
            .bind(key)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

// ==================== 内部辅助 ====================

async fn ensure_application(tx: &mut sqlx::SqliteConnection, id: &str) -> Result<()> {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM application WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    exists.map(|_| ()).ok_or_else(|| not_found("application"))
}

async fn ensure_interview(tx: &mut sqlx::SqliteConnection, id: &str) -> Result<()> {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM interview WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    exists.map(|_| ()).ok_or_else(|| not_found("interview"))
}

async fn ensure_question(tx: &mut sqlx::SqliteConnection, id: &str) -> Result<()> {
    let exists: Option<String> =
        sqlx::query_scalar("SELECT id FROM interview_question WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    exists.map(|_| ()).ok_or_else(|| not_found("question"))
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn canonical_job_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(mut url) = url::Url::parse(raw) {
        url.set_fragment(None);
        let normalized = url.to_string();
        return Some(normalized.trim_end_matches('/').to_lowercase());
    }
    Some(raw.trim_end_matches('/').to_lowercase())
}

fn normalized_text(value: &str) -> String {
    value.trim().to_lowercase()
}

fn metadata_fingerprint(
    company_name: &str,
    position_title: &str,
    department: Option<&str>,
    batch: &str,
    applied_date: Option<&str>,
) -> String {
    let date = applied_date
        .and_then(|value| value.get(..10))
        .unwrap_or_default();
    format!(
        "{}|{}|{}|{}|{}",
        normalized_text(company_name),
        normalized_text(position_title),
        department.map(normalized_text).unwrap_or_default(),
        normalized_text(batch),
        date,
    )
}

fn fingerprint_for_input(input: &CreateApplicationInput) -> String {
    let applied_date = input.applied_date.as_ref().map(ts);
    metadata_fingerprint(
        &input.company_name,
        &input.position_title,
        input.department.as_deref(),
        input.batch.as_deref().unwrap_or("FORMAL"),
        applied_date.as_deref(),
    )
}

async fn insert_application_tx(
    tx: &mut sqlx::SqliteConnection,
    input: CreateApplicationInput,
) -> Result<String> {
    let channel = input.channel.as_deref().unwrap_or("COMPANY_SITE");
    let batch = input.batch.as_deref().unwrap_or("FORMAL");
    let priority = input.priority.as_deref().unwrap_or("MEDIUM");
    let company_id = upsert_company_tx(
        tx,
        input.company_name.trim(),
        input.company_website.as_deref(),
        input.company_careers_url.as_deref(),
    )
    .await?;
    let id = new_id();
    let jd_snapshot_at = input.jd_text.as_ref().map(|_| now_ts());
    sqlx::query(
        "INSERT INTO application (id, company_id, position_title, department, work_location, \
         channel, batch, priority, status, job_url, jd_text, jd_snapshot_at, salary_range, tags, \
         resume_version_id, notes, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SAVED', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&company_id)
    .bind(input.position_title.trim())
    .bind(input.department)
    .bind(input.work_location)
    .bind(channel)
    .bind(batch)
    .bind(priority)
    .bind(input.job_url)
    .bind(input.jd_text)
    .bind(jd_snapshot_at)
    .bind(input.salary_range)
    .bind(serde_json::to_string(&input.tags).unwrap_or_else(|_| "[]".into()))
    .bind(input.resume_version_id)
    .bind(input.notes)
    .bind(now_ts())
    .bind(now_ts())
    .execute(&mut *tx)
    .await?;

    if input.applied.unwrap_or(false) {
        let occurred = input.applied_date.unwrap_or_else(Utc::now);
        sqlx::query(
            "INSERT INTO application_event (id, application_id, type, occurred_at, source, created_at) \
             VALUES (?, ?, 'APPLIED', ?, 'MANUAL', ?)",
        )
        .bind(new_id())
        .bind(&id)
        .bind(ts(&occurred))
        .bind(now_ts())
        .execute(&mut *tx)
        .await?;
        recompute_status(tx, &id).await?;
    }
    Ok(id)
}

async fn upsert_company_tx(
    tx: &mut sqlx::SqliteConnection,
    name: &str,
    website: Option<&str>,
    careers_url: Option<&str>,
) -> Result<String> {
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM company WHERE name = ?")
        .bind(name)
        .fetch_optional(&mut *tx)
        .await?;
    if let Some(id) = existing {
        if website.is_some() || careers_url.is_some() {
            sqlx::query(
                "UPDATE company SET website = COALESCE(?, website), \
                 careers_url = COALESCE(?, careers_url), updated_at = ? WHERE id = ?",
            )
            .bind(website)
            .bind(careers_url)
            .bind(now_ts())
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        }
        return Ok(id);
    }
    let id = new_id();
    sqlx::query(
        "INSERT INTO company (id, name, website, careers_url, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(website)
    .bind(careers_url)
    .bind(now_ts())
    .bind(now_ts())
    .execute(&mut *tx)
    .await?;
    Ok(id)
}

async fn set_col(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    col: &str,
    value: String,
    now: &str,
) -> Result<()> {
    let sql = format!("UPDATE application SET {col} = ?, updated_at = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn set_nullable_col(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    col: &str,
    value: Option<String>,
    now: &str,
) -> Result<()> {
    let sql = format!("UPDATE application SET {col} = ?, updated_at = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn set_event_col(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    col: &str,
    value: String,
) -> Result<()> {
    let sql = format!("UPDATE application_event SET {col} = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn set_event_nullable_col(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    col: &str,
    value: Option<String>,
) -> Result<()> {
    let sql = format!("UPDATE application_event SET {col} = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn set_iv_col(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    col: &str,
    value: String,
) -> Result<()> {
    let sql = format!("UPDATE interview SET {col} = ?, updated_at = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(now_ts())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn set_iv_nullable_col(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    col: &str,
    value: Option<String>,
) -> Result<()> {
    let sql = format!("UPDATE interview SET {col} = ?, updated_at = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(now_ts())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn set_q_col(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    col: &str,
    value: String,
) -> Result<()> {
    let sql = format!("UPDATE interview_question SET {col} = ?, updated_at = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(now_ts())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn set_q_nullable_col(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    col: &str,
    value: Option<String>,
) -> Result<()> {
    let sql = format!("UPDATE interview_question SET {col} = ?, updated_at = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(now_ts())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

fn interview_status_str(s: InterviewStatus) -> String {
    match s {
        InterviewStatus::Scheduled => "SCHEDULED".into(),
        InterviewStatus::Completed => "COMPLETED".into(),
        InterviewStatus::Cancelled => "CANCELLED".into(),
    }
}

fn interview_outcome_str(o: InterviewOutcome) -> String {
    match o {
        InterviewOutcome::Pending => "PENDING".into(),
        InterviewOutcome::Pass => "PASS".into(),
        InterviewOutcome::Fail => "FAIL".into(),
        InterviewOutcome::Unknown => "UNKNOWN".into(),
    }
}

fn resume_sql(suffix: &str) -> String {
    format!(
        "SELECT rv.id, rv.name, rv.target_role, rv.file_name, rv.file_path, rv.file_size, rv.notes, \
         rv.is_default, rv.created_at, rv.updated_at, \
         (SELECT COUNT(*) FROM application a WHERE a.resume_version_id = rv.id) AS usage_count \
         FROM resume_version rv {suffix}"
    )
}

fn resume_from_row(row: &SqliteRow) -> ResumeVersion {
    ResumeVersion {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        target_role: row.try_get("target_role").ok().flatten(),
        file_name: row.try_get("file_name").unwrap_or_default(),
        file_path: row.try_get("file_path").unwrap_or_default(),
        file_size: row.try_get("file_size").ok().flatten(),
        notes: row.try_get("notes").ok().flatten(),
        is_default: row
            .try_get::<i64, _>("is_default")
            .map(|v| v != 0)
            .unwrap_or(false),
        created_at: row.try_get("created_at").unwrap_or_default(),
        updated_at: row.try_get("updated_at").unwrap_or_default(),
        usage_count: row.try_get("usage_count").unwrap_or(0),
    }
}

/// 状态重算：加载该投递全部事件+面试 → derive_status → 回写。
/// 列名拼接只来自受控代码路径，无用户输入。
pub async fn recompute_status(tx: &mut sqlx::SqliteConnection, app_id: &str) -> Result<()> {
    let customs: Vec<(String, String)> =
        sqlx::query_as("SELECT id, projection FROM custom_event_type")
            .fetch_all(&mut *tx)
            .await?;
    let custom_map: HashMap<String, ProjectionEffect> = customs
        .into_iter()
        .filter_map(|(id, p)| ProjectionEffect::parse(&p).map(|pe| (id, pe)))
        .collect();

    let event_rows: Vec<(String, Option<String>, String)> = sqlx::query_as(
        "SELECT type, result, occurred_at FROM application_event \
         WHERE application_id = ? ORDER BY occurred_at, created_at",
    )
    .bind(app_id)
    .fetch_all(&mut *tx)
    .await?;

    let iv_rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT status, outcome, scheduled_at, created_at FROM interview WHERE application_id = ?",
    )
    .bind(app_id)
    .fetch_all(&mut *tx)
    .await?;

    let mut items: Vec<TimelineItem> = Vec::new();
    for (type_key, result, occurred_at) in event_rows {
        let occurred = crate::entities::parse_ts(&occurred_at).unwrap_or_default();
        let custom_projection = type_key
            .strip_prefix("custom:")
            .and_then(|id| custom_map.get(id).copied());
        let event_type = EventType::parse_db_key(&type_key, custom_projection)
            .ok_or_else(|| Error::Invalid(format!("数据库中存在无法解析的事件类型: {type_key}")))?;
        items.push(TimelineItem {
            kind: TimelineKind::Event {
                event_type,
                result: result.as_deref().and_then(EventResult::parse),
            },
            occurred_at: occurred,
        });
    }
    for (status, outcome, scheduled_at, created_at) in iv_rows {
        let occurred = scheduled_at
            .as_deref()
            .and_then(crate::entities::parse_ts)
            .or_else(|| crate::entities::parse_ts(&created_at))
            .unwrap_or_default();
        let st = match status.as_str() {
            "COMPLETED" => InterviewStatus::Completed,
            "CANCELLED" => InterviewStatus::Cancelled,
            _ => InterviewStatus::Scheduled,
        };
        let ot = match outcome.as_str() {
            "PASS" => InterviewOutcome::Pass,
            "FAIL" => InterviewOutcome::Fail,
            "UNKNOWN" => InterviewOutcome::Unknown,
            _ => InterviewOutcome::Pending,
        };
        items.push(TimelineItem {
            kind: TimelineKind::Interview {
                status: st,
                outcome: ot,
            },
            occurred_at: occurred,
        });
    }

    let derived = state_machine::derive_status(&items);
    sqlx::query("UPDATE application SET status = ?, applied_date = ?, updated_at = ? WHERE id = ?")
        .bind(derived.status.as_str())
        .bind(derived.applied_date.map(|d| ts(&d)))
        .bind(now_ts())
        .bind(app_id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}
