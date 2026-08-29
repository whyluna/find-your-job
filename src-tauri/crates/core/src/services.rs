//! 服务层：所有写操作在事务内完成"写入 + 状态重算"，读操作聚合联查。
//! Tauri command（P0-4）与 P1 axum 都只调这里。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::collections::HashMap;
use uuid::Uuid;

use crate::entities::{
    now_ts, ts, Application, ApplicationDetail, ApplicationEvent, ApplicationListItem, Attachment,
    Company, CustomEventType, DictionaryItem, Interview, InterviewQuestion, InterviewDetail,
    ResumeVersion, BATCH_KEYS, CHANNEL_KEYS, PRIORITY_KEYS, is_open_enum_key,
};
use crate::error::{Error, Result};
use crate::models::{EventResult, EventType, InterviewOutcome, InterviewStatus, ProjectionEffect};
use crate::state_machine::{self, TimelineItem, TimelineKind};

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

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub struct UpdateApplicationInput {
    pub company_name: Option<String>,
    pub position_title: Option<String>,
    pub department: Option<String>,
    pub work_location: Option<String>,
    pub channel: Option<String>,
    pub batch: Option<String>,
    pub priority: Option<String>,
    pub job_url: Option<String>,
    pub jd_text: Option<String>,
    pub salary_range: Option<String>,
    pub tags: Option<Vec<String>>,
    pub resume_version_id: Option<String>,
    pub notes: Option<String>,
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
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEventInput {
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub occurred_at: Option<DateTime<Utc>>,
    pub deadline: Option<DateTime<Utc>>,
    pub result: Option<EventResult>,
    pub note: Option<String>,
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
    pub round_label: Option<String>,
    pub format: Option<String>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub duration_min: Option<i64>,
    pub location_or_link: Option<String>,
    pub interviewer_note: Option<String>,
    pub status: Option<InterviewStatus>,
    pub outcome: Option<InterviewOutcome>,
    pub self_rating: Option<i64>,
    pub overall_reflection: Option<String>,
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
    pub my_answer: Option<String>,
    pub quality: Option<String>,
    pub reflection: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingItem {
    pub kind: String,
    pub application_id: String,
    pub company_name: String,
    pub position_title: String,
    pub detail: Option<String>,
    pub at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CountRow {
    pub key: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ResumeFunnelRow {
    pub resume_name: String,
    pub total: i64,
    pub interviewed: i64,
    pub offered: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsDto {
    pub status_counts: Vec<CountRow>,
    pub channel_counts: Vec<CountRow>,
    pub batch_counts: Vec<CountRow>,
    pub daily_applied: Vec<CountRow>,
    pub silent: Vec<Application>,
    pub resume_funnel: Vec<ResumeFunnelRow>,
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
        let existing: Option<String> =
            sqlx::query_scalar("SELECT id FROM company WHERE name = ?")
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

    pub async fn create_application(&self, input: CreateApplicationInput) -> Result<Application> {
        if input.company_name.trim().is_empty() {
            return Err(Error::Invalid("公司名不能为空".into()));
        }
        if input.position_title.trim().is_empty() {
            return Err(Error::Invalid("岗位名不能为空".into()));
        }
        let channel = input.channel.unwrap_or_else(|| "COMPANY_SITE".into());
        let batch = input.batch.unwrap_or_else(|| "FORMAL".into());
        let priority = input.priority.unwrap_or_else(|| "MEDIUM".into());
        if !is_open_enum_key(CHANNEL_KEYS, &channel) {
            return Err(Error::Invalid(format!("未知渠道: {channel}")));
        }
        if !is_open_enum_key(BATCH_KEYS, &batch) {
            return Err(Error::Invalid(format!("未知批次: {batch}")));
        }
        if !PRIORITY_KEYS.contains(&priority.as_str()) {
            return Err(Error::Invalid(format!("未知优先级: {priority}")));
        }

        let mut tx = self.pool.begin().await?;
        let company_id = upsert_company_tx(
            &mut tx,
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
        .bind(&channel)
        .bind(&batch)
        .bind(&priority)
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
            recompute_status(&mut *tx, &id).await?;
        }
        tx.commit().await?;
        self.get_application(&id).await
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
                let company_id = upsert_company_tx(&mut *tx, company_name.trim(), None, None).await?;
                sqlx::query("UPDATE application SET company_id = ?, updated_at = ? WHERE id = ?")
                    .bind(company_id)
                    .bind(&now)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        if let Some(v) = input.position_title {
            set_col(&mut *tx, id, "position_title", v.trim().to_string(), &now).await?;
        }
        if let Some(v) = input.department {
            set_col(&mut *tx, id, "department", v, &now).await?;
        }
        if let Some(v) = input.work_location {
            set_col(&mut *tx, id, "work_location", v, &now).await?;
        }
        if let Some(v) = input.channel {
            if !is_open_enum_key(CHANNEL_KEYS, &v) {
                return Err(Error::Invalid(format!("未知渠道: {v}")));
            }
            set_col(&mut *tx, id, "channel", v, &now).await?;
        }
        if let Some(v) = input.batch {
            if !is_open_enum_key(BATCH_KEYS, &v) {
                return Err(Error::Invalid(format!("未知批次: {v}")));
            }
            set_col(&mut *tx, id, "batch", v, &now).await?;
        }
        if let Some(v) = input.priority {
            if !PRIORITY_KEYS.contains(&v.as_str()) {
                return Err(Error::Invalid(format!("未知优先级: {v}")));
            }
            set_col(&mut *tx, id, "priority", v, &now).await?;
        }
        if let Some(v) = input.job_url {
            set_col(&mut *tx, id, "job_url", v, &now).await?;
        }
        if let Some(v) = input.salary_range {
            set_col(&mut *tx, id, "salary_range", v, &now).await?;
        }
        if let Some(v) = input.notes {
            set_col(&mut *tx, id, "notes", v, &now).await?;
        }
        if let Some(v) = input.resume_version_id {
            set_col(&mut *tx, id, "resume_version_id", v, &now).await?;
        }
        if let Some(v) = input.tags {
            let json = serde_json::to_string(&v).unwrap_or_else(|_| "[]".into());
            set_col(&mut *tx, id, "tags", json, &now).await?;
        }
        if let Some(v) = input.jd_text {
            sqlx::query(
                "UPDATE application SET jd_text = ?, jd_snapshot_at = ?, updated_at = ? WHERE id = ?",
            )
            .bind(v)
            .bind(&now)
            .bind(&now)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.get_application(id).await
    }

    pub async fn delete_application(&self, id: &str) -> Result<()> {
        let n = sqlx::query("DELETE FROM application WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(not_found("application"));
        }
        Ok(())
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
        qb.push(" ORDER BY a.updated_at DESC LIMIT 500");

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

    /// 未来 days 天内的截止事件 + scheduled 天内面试
    pub async fn get_upcoming(&self, deadline_days: i64, interview_days: i64) -> Result<Vec<UpcomingItem>> {
        let now = now_ts();
        let dl_end = ts(&(Utc::now() + chrono::Duration::days(deadline_days)));
        let iv_end = ts(&(Utc::now() + chrono::Duration::days(interview_days)));
        let rows = sqlx::query(
            "SELECT 'deadline' AS kind, a.id AS application_id, c.name AS company_name, \
             a.position_title, e.type AS detail, e.deadline AS at \
             FROM application_event e \
             JOIN application a ON a.id = e.application_id \
             JOIN company c ON c.id = a.company_id \
             WHERE e.deadline >= ? AND e.deadline <= ? AND a.is_archived = 0 \
             UNION ALL \
             SELECT 'interview' AS kind, a.id AS application_id, c.name AS company_name, \
             a.position_title, iv.round_label AS detail, iv.scheduled_at AS at \
             FROM interview iv \
             JOIN application a ON a.id = iv.application_id \
             JOIN company c ON c.id = a.company_id \
             WHERE iv.scheduled_at >= ? AND iv.scheduled_at <= ? \
               AND iv.status = 'SCHEDULED' AND a.is_archived = 0 \
             ORDER BY at ASC",
        )
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

    // ---------- 统计（P1-c） ----------

    pub async fn get_stats(&self) -> Result<StatsDto> {
        let group = |col: &str| {
            format!(
                "SELECT {col} AS key, COUNT(*) AS count FROM application \
                 WHERE is_archived = 0 GROUP BY {col} ORDER BY count DESC"
            )
        };
        let to_rows = |rows: Vec<SqliteRow>| -> Vec<CountRow> {
            rows.iter()
                .map(|r| CountRow {
                    key: r.try_get("key").unwrap_or_default(),
                    count: r.try_get("count").unwrap_or(0),
                })
                .collect()
        };
        let status_counts = to_rows(
            sqlx::query(&group("status")).fetch_all(&self.pool).await?,
        );
        let channel_counts = to_rows(
            sqlx::query(&group("channel")).fetch_all(&self.pool).await?,
        );
        let batch_counts = to_rows(sqlx::query(&group("batch")).fetch_all(&self.pool).await?);

        let daily_rows = sqlx::query(
            "SELECT substr(applied_date, 1, 10) AS key, COUNT(*) AS count \
             FROM application WHERE applied_date IS NOT NULL GROUP BY key ORDER BY key",
        )
        .fetch_all(&self.pool)
        .await?;
        let daily_applied = to_rows(daily_rows);

        let silent_rows = sqlx::query(&format!(
            "{APP_SELECT} WHERE a.is_archived = 0 \
             AND a.status NOT IN ('REJECTED','WITHDRAWN','SIGNED') \
             AND a.updated_at <= ? ORDER BY a.updated_at ASC LIMIT 50",
        ))
        .bind(ts(&(Utc::now() - chrono::Duration::days(14))))
        .fetch_all(&self.pool)
        .await?;
        let silent = silent_rows.iter().map(Application::from_row).collect();

        let funnel_rows = sqlx::query(
            "SELECT rv.name AS key, COUNT(a.id) AS count, \
             SUM(CASE WHEN a.status IN ('INTERVIEWING','OC','INTENT','OFFER','SIGNED') THEN 1 ELSE 0 END) AS interviewed, \
             SUM(CASE WHEN a.status IN ('OC','INTENT','OFFER','SIGNED') THEN 1 ELSE 0 END) AS offered \
             FROM resume_version rv LEFT JOIN application a ON a.resume_version_id = rv.id \
             GROUP BY rv.id ORDER BY rv.created_at",
        )
        .fetch_all(&self.pool)
        .await?;
        let resume_funnel = funnel_rows
            .iter()
            .map(|r| ResumeFunnelRow {
                resume_name: r.try_get("key").unwrap_or_default(),
                total: r.try_get("count").unwrap_or(0),
                interviewed: r.try_get("interviewed").unwrap_or(0),
                offered: r.try_get("offered").unwrap_or(0),
            })
            .collect();

        Ok(StatsDto {
            status_counts,
            channel_counts,
            batch_counts,
            daily_applied,
            silent,
            resume_funnel,
        })
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
        ensure_application(&mut *tx, &input.application_id).await?;
        let id = new_id();
        let occurred = input.occurred_at.unwrap_or_else(Utc::now);
        sqlx::query(
            "INSERT INTO application_event (id, application_id, type, occurred_at, deadline, result, note, source, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?)",
        )
        .bind(&id)
        .bind(&input.application_id)
        .bind(event_type.db_key())
        .bind(ts(&occurred))
        .bind(input.deadline.map(|d| ts(&d)))
        .bind(input.result.map(|r| r.as_str().to_string()))
        .bind(input.note)
        .bind(now_ts())
        .execute(&mut *tx)
        .await?;
        recompute_status(&mut *tx, &input.application_id).await?;
        tx.commit().await?;
        Ok(self.get_event(&id).await?)
    }

    pub async fn update_event(&self, id: &str, input: UpdateEventInput) -> Result<ApplicationEvent> {
        let mut tx = self.pool.begin().await?;
        let app_id: String = sqlx::query_scalar(
            "SELECT application_id FROM application_event WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| not_found("event"))?;

        if let Some(t) = &input.event_type {
            let event_type = self.resolve_event_type(t).await?;
            set_event_col(&mut *tx, id, "type", event_type.db_key()).await?;
        }
        if let Some(v) = input.occurred_at {
            set_event_col(&mut *tx, id, "occurred_at", ts(&v)).await?;
        }
        if let Some(v) = input.deadline {
            set_event_col(&mut *tx, id, "deadline", ts(&v)).await?;
        }
        if let Some(v) = input.result {
            set_event_col(&mut *tx, id, "result", v.as_str().to_string()).await?;
        }
        if let Some(v) = input.note {
            set_event_col(&mut *tx, id, "note", v).await?;
        }
        recompute_status(&mut *tx, &app_id).await?;
        tx.commit().await?;
        self.get_event(id).await
    }

    pub async fn delete_event(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let app_id: Option<String> = sqlx::query_scalar(
            "SELECT application_id FROM application_event WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        let app_id = app_id.ok_or_else(|| not_found("event"))?;
        sqlx::query("DELETE FROM application_event WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        recompute_status(&mut *tx, &app_id).await?;
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
            let projection: Option<String> =
                sqlx::query_scalar("SELECT projection FROM custom_event_type WHERE id = ? AND is_active = 1")
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
        ensure_application(&mut *tx, &input.application_id).await?;
        let round = match input.round {
            Some(r) if r >= 1 => r,
            Some(_) => return Err(Error::Invalid("轮次必须 ≥ 1".into())),
            // 未指定轮次时接在最大轮次之后
            None => {
                let max: Option<i64> =
                    sqlx::query_scalar("SELECT MAX(round) FROM interview WHERE application_id = ?")
                        .bind(&input.application_id)
                        .fetch_one(&mut *tx)
                        .await?;
                max.unwrap_or(0) + 1
            }
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
        recompute_status(&mut *tx, &input.application_id).await?;
        tx.commit().await?;
        self.get_interview(&id).await
    }

    pub async fn update_interview(
        &self,
        id: &str,
        input: UpdateInterviewInput,
    ) -> Result<Interview> {
        let mut tx = self.pool.begin().await?;
        let app_id: String =
            sqlx::query_scalar("SELECT application_id FROM interview WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| not_found("interview"))?;
        if let Some(v) = input.round {
            if v < 1 {
                return Err(Error::Invalid("轮次必须 ≥ 1".into()));
            }
            set_iv_col(&mut *tx, id, "round", v.to_string()).await?;
        }
        if let Some(v) = input.round_label {
            set_iv_col(&mut *tx, id, "round_label", v).await?;
        }
        if let Some(v) = input.format {
            set_iv_col(&mut *tx, id, "format", v).await?;
        }
        if let Some(v) = input.scheduled_at {
            set_iv_col(&mut *tx, id, "scheduled_at", ts(&v)).await?;
        }
        if let Some(v) = input.duration_min {
            set_iv_col(&mut *tx, id, "duration_min", v.to_string()).await?;
        }
        if let Some(v) = input.location_or_link {
            set_iv_col(&mut *tx, id, "location_or_link", v).await?;
        }
        if let Some(v) = input.interviewer_note {
            set_iv_col(&mut *tx, id, "interviewer_note", v).await?;
        }
        if let Some(v) = input.status {
            set_iv_col(&mut *tx, id, "status", interview_status_str(v)).await?;
        }
        if let Some(v) = input.outcome {
            set_iv_col(&mut *tx, id, "outcome", interview_outcome_str(v)).await?;
        }
        if let Some(v) = input.self_rating {
            if !(1..=5).contains(&v) {
                return Err(Error::Invalid("自评范围 1–5".into()));
            }
            set_iv_col(&mut *tx, id, "self_rating", v.to_string()).await?;
        }
        if let Some(v) = input.overall_reflection {
            set_iv_col(&mut *tx, id, "overall_reflection", v).await?;
        }
        recompute_status(&mut *tx, &app_id).await?;
        tx.commit().await?;
        self.get_interview(id).await
    }

    pub async fn delete_interview(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let app_id: Option<String> =
            sqlx::query_scalar("SELECT application_id FROM interview WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let app_id = app_id.ok_or_else(|| not_found("interview"))?;
        sqlx::query("DELETE FROM interview WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        recompute_status(&mut *tx, &app_id).await?;
        tx.commit().await?;
        Ok(())
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
        ensure_interview(&mut *tx, &input.interview_id).await?;
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
        ensure_question(&mut *tx, id).await?;
        if let Some(v) = input.question {
            set_q_col(&mut *tx, id, "question", v.trim().to_string()).await?;
        }
        if let Some(v) = input.my_answer {
            set_q_col(&mut *tx, id, "my_answer", v).await?;
        }
        if let Some(v) = input.quality {
            let q = crate::entities::QuestionQuality::parse(&v)
                .ok_or_else(|| Error::Invalid(format!("未知表现: {v}")))?;
            set_q_col(&mut *tx, id, "quality", q.as_str().to_string()).await?;
        }
        if let Some(v) = input.reflection {
            set_q_col(&mut *tx, id, "reflection", v).await?;
        }
        if let Some(v) = input.tags {
            set_q_col(&mut *tx, id, "tags", serde_json::to_string(&v).unwrap_or_else(|_| "[]".into()))
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
        let n = sqlx::query("UPDATE resume_version SET is_default = 1, updated_at = ? WHERE id = ?")
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
        let rows =
            sqlx::query("SELECT * FROM custom_event_type ORDER BY sort, created_at").fetch_all(&self.pool).await?;
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
        Ok(sqlx::query_scalar("SELECT value_json FROM setting WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?
            .flatten())
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

async fn set_event_col(tx: &mut sqlx::SqliteConnection, id: &str, col: &str, value: String) -> Result<()> {
    let sql = format!("UPDATE application_event SET {col} = ? WHERE id = ?");
    sqlx::query(&sql).bind(value).bind(id).execute(&mut *tx).await?;
    Ok(())
}

async fn set_iv_col(tx: &mut sqlx::SqliteConnection, id: &str, col: &str, value: String) -> Result<()> {
    let sql = format!("UPDATE interview SET {col} = ?, updated_at = ? WHERE id = ?");
    sqlx::query(&sql)
        .bind(value)
        .bind(now_ts())
        .bind(id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

async fn set_q_col(tx: &mut sqlx::SqliteConnection, id: &str, col: &str, value: String) -> Result<()> {
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
        let event_type =
            EventType::parse_db_key(&type_key, custom_projection).ok_or_else(|| {
                Error::Invalid(format!("数据库中存在无法解析的事件类型: {type_key}"))
            })?;
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
            kind: TimelineKind::Interview { status: st, outcome: ot },
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
