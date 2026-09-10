//! CSV 中的版本化流程快照；只迁移招聘流程，不读取或恢复本机文件路径。
use crate::{
    entities::*,
    error::{Error, Result},
    models::*,
    state_machine::{derive_status, TimelineItem, TimelineKind},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSnapshot {
    pub version: u32,
    pub status: Status,
    pub applied_date: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub is_archived: bool,
    pub events: Vec<ApplicationEvent>,
    pub interviews: Vec<InterviewDetail>,
    pub custom_types: Vec<CustomEventType>,
}

pub(crate) struct PreparedImport {
    pub input: crate::services::CreateApplicationInput,
    pub snapshot: Option<ProgressSnapshot>,
    pub status: Option<Status>,
    pub at: DateTime<Utc>,
    pub rounds: i64,
    pub message: Option<String>,
}

pub fn parse_status_label(raw: &str) -> Result<Status> {
    if let Some(status) = Status::parse(&raw.trim().to_uppercase()) {
        return Ok(status);
    }
    match raw.trim() {
        "意向岗位" | "已保存" => Ok(Status::Saved),
        "已投递" => Ok(Status::Applied),
        "测评中" => Ok(Status::Assessment),
        "笔试中" => Ok(Status::Written),
        "面试中" => Ok(Status::Interviewing),
        "已OC" => Ok(Status::Oc),
        "意向书" => Ok(Status::Intent),
        "已签约" => Ok(Status::Signed),
        "已挂" => Ok(Status::Rejected),
        "已放弃" => Ok(Status::Withdrawn),
        _ => Err(invalid("无法识别当前状态")),
    }
}

fn invalid(message: &str) -> Error {
    Error::Invalid(format!("CSV 流程数据：{message}"))
}

impl ProgressSnapshot {
    pub fn parse(raw: &str) -> Result<Self> {
        if raw.len() > 10 * 1024 * 1024 {
            return Err(invalid("单行流程数据超过 10 MB"));
        }
        let snapshot: Self =
            serde_json::from_str(raw).map_err(|_| invalid("内容损坏或格式不正确，请重新导出"))?;
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub fn validate(&self) -> Result<()> {
        if self.version != 1 {
            return Err(invalid("不支持的流程数据版本"));
        }
        if self.events.len() > 10000 || self.interviews.len() > 1000 {
            return Err(invalid("记录数量超出限制"));
        }
        let mut customs = HashMap::new();
        for c in &self.custom_types {
            let projection = ProjectionEffect::parse(&c.projection)
                .ok_or_else(|| invalid("未知自定义事件投影"))?;
            if customs.insert(c.id.as_str(), projection).is_some() {
                return Err(invalid("自定义事件 ID 重复"));
            }
        }
        let mut timeline = Vec::new();
        let mut events = self.events.iter().collect::<Vec<_>>();
        events.sort_by_key(|e| (e.occurred_at, e.created_at));
        for e in events {
            let projection = e
                .event_type
                .strip_prefix("custom:")
                .and_then(|id| customs.get(id).copied());
            let event_type = EventType::parse_db_key(&e.event_type, projection)
                .ok_or_else(|| invalid("未知事件类型"))?;
            timeline.push(TimelineItem {
                kind: TimelineKind::Event {
                    event_type,
                    result: e.result,
                },
                occurred_at: e.occurred_at,
            });
        }
        let mut rounds = HashSet::new();
        for d in &self.interviews {
            let i = &d.interview;
            if i.round < 1
                || !rounds.insert(i.round)
                || i.duration_min.is_some_and(|d| d <= 0)
                || i.self_rating.is_some_and(|r| !(1..=5).contains(&r))
                || d.questions.len() > 10000
            {
                return Err(invalid("面试轮次、时长、评分或题目数量无效"));
            }
            if d.questions
                .iter()
                .any(|q| q.question.trim().is_empty() || q.ordinal < 0)
            {
                return Err(invalid("面试题目不能为空，排序不能为负数"));
            }
            timeline.push(TimelineItem {
                kind: TimelineKind::Interview {
                    status: i.status,
                    outcome: i.outcome,
                },
                occurred_at: i.scheduled_at.unwrap_or(i.created_at),
            });
        }
        let derived = derive_status(&timeline);
        if derived.status != self.status || derived.applied_date != self.applied_date {
            return Err(invalid("状态或投递日期与历史记录不一致"));
        }
        Ok(())
    }

    pub async fn capture(tx: &mut SqliteConnection, id: &str) -> Result<Self> {
        let row = sqlx::query(
            "SELECT status, applied_date, created_at, is_archived FROM application WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        let status: String = row.try_get("status")?;
        let events = sqlx::query("SELECT * FROM application_event WHERE application_id = ? ORDER BY occurred_at, created_at")
            .bind(id).fetch_all(&mut *tx).await?.iter().map(ApplicationEvent::from_row).collect::<Vec<_>>();
        let mut interviews = Vec::new();
        for row in sqlx::query("SELECT * FROM interview WHERE application_id = ? ORDER BY rowid")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?
        {
            let interview = Interview::from_row(&row);
            let questions = sqlx::query("SELECT * FROM interview_question WHERE interview_id = ? ORDER BY ordinal, created_at")
                .bind(&interview.id).fetch_all(&mut *tx).await?.iter().map(InterviewQuestion::from_row).collect();
            interviews.push(InterviewDetail {
                interview,
                questions,
            });
        }
        let custom_rows = sqlx::query("SELECT * FROM custom_event_type WHERE id IN (SELECT substr(type, 8) FROM application_event WHERE application_id = ? AND type LIKE 'custom:%')")
            .bind(id).fetch_all(&mut *tx).await?;
        let custom_types = custom_rows
            .iter()
            .map(|r| CustomEventType {
                id: r.get("id"),
                label: r.get("label"),
                projection: r.get("projection"),
                deadline_required: r.get("deadline_required"),
                result_required: r.get("result_required"),
                sort: r.get("sort"),
                is_active: r.get("is_active"),
            })
            .collect();
        let snapshot = Self {
            version: 1,
            status: Status::parse(&status).ok_or_else(|| invalid("未知状态"))?,
            applied_date: row.try_get("applied_date")?,
            created_at: row.try_get("created_at")?,
            is_archived: row.try_get("is_archived")?,
            events,
            interviews,
            custom_types,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub async fn restore(&self, tx: &mut SqliteConnection, id: &str) -> Result<()> {
        self.validate()?;
        let mut custom_ids = HashMap::new();
        for old in &self.custom_types {
            let mut c = old.clone();
            c.id = Uuid::new_v4().to_string();
            insert_typed(tx, "custom_event_type", &c, &[]).await?;
            custom_ids.insert(format!("custom:{}", old.id), format!("custom:{}", c.id));
        }
        for old in &self.events {
            let mut event = old.clone();
            event.id = Uuid::new_v4().to_string();
            event.application_id = id.into();
            if let Some(key) = custom_ids.get(&event.event_type) {
                event.event_type = key.clone();
            }
            insert_typed(tx, "application_event", &event, &[]).await?;
        }
        for old in &self.interviews {
            let mut i = old.interview.clone();
            i.id = Uuid::new_v4().to_string();
            i.application_id = id.into();
            insert_typed(tx, "interview", &i, &["questionCount"]).await?;
            for old in &old.questions {
                let mut q = old.clone();
                q.id = Uuid::new_v4().to_string();
                q.interview_id = i.id.clone();
                insert_typed(tx, "interview_question", &q, &[]).await?;
            }
        }
        crate::services::recompute_status(tx, id).await?;
        sqlx::query("UPDATE application SET created_at = ?, is_archived = ? WHERE id = ?")
            .bind(ts(&self.created_at))
            .bind(self.is_archived)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        Ok(())
    }
}

/// 列名仅来自上面的具体 Rust DTO，禁止传递外部 JSON 对象或任意表名。
async fn insert_typed<T: Serialize>(
    tx: &mut SqliteConnection,
    table: &str,
    value: &T,
    skip: &[&str],
) -> Result<()> {
    let value = serde_json::to_value(value).map_err(|e| invalid(&e.to_string()))?;
    let obj = value
        .as_object()
        .ok_or_else(|| invalid("内部对象格式错误"))?;
    let fields = obj
        .iter()
        .filter(|(k, _)| !skip.contains(&k.as_str()))
        .collect::<Vec<_>>();
    let columns = fields
        .iter()
        .map(|(key, _)| {
            key.chars()
                .flat_map(|c| {
                    if c.is_ascii_uppercase() {
                        vec!['_', c.to_ascii_lowercase()]
                    } else {
                        vec![c]
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>();
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        columns.join(","),
        vec!["?"; fields.len()].join(",")
    );
    let mut query = sqlx::query(&sql);
    for (key, value) in fields {
        query = match value {
            serde_json::Value::Null => query.bind(None::<String>),
            serde_json::Value::String(s) if key.ends_with("At") || key == "deadline" => {
                query.bind(ts(&DateTime::parse_from_rfc3339(s)
                    .map_err(|_| invalid("日期格式无效"))?
                    .with_timezone(&Utc)))
            }
            serde_json::Value::String(s) => query.bind(s),
            serde_json::Value::Bool(b) => query.bind(*b),
            serde_json::Value::Number(n) => {
                query.bind(n.as_i64().ok_or_else(|| invalid("非法整数"))?)
            }
            _ => query.bind(value.to_string()),
        };
    }
    query.execute(&mut *tx).await?;
    Ok(())
}

/// 普通表格只能迁移当前状态：补录节点带明确标记，缺失的历史题目不虚构。
pub async fn restore_status(
    tx: &mut SqliteConnection,
    id: &str,
    status: Status,
    at: DateTime<Utc>,
    rounds: i64,
) -> Result<()> {
    if rounds > 0 {
        for round in 1..=rounds {
            sqlx::query("INSERT INTO interview (id, application_id, round, round_label, status, outcome, created_at, updated_at) VALUES (?, ?, ?, 'CSV 迁移：详细信息待补', ?, 'UNKNOWN', ?, ?)")
                .bind(Uuid::new_v4().to_string()).bind(id).bind(round)
                .bind(if status == Status::Interviewing && round == rounds { "SCHEDULED" } else { "COMPLETED" })
                .bind(ts(&if status == Status::Interviewing { at } else { at - chrono::Duration::microseconds(1) })).bind(now_ts()).execute(&mut *tx).await?;
        }
    }
    let event_type = match status {
        Status::Saved | Status::Applied | Status::Interviewing => None,
        Status::Assessment => Some("ASSESSMENT_INVITED"),
        Status::Written => Some("WRITTEN_INVITED"),
        Status::Oc => Some("OC"),
        Status::Intent => Some("INTENT_LETTER"),
        Status::Offer => Some("OFFER"),
        Status::Signed => Some("SIGNED"),
        Status::Rejected => Some("REJECTED"),
        Status::Withdrawn => Some("WITHDRAWN"),
    };
    // 即使没有阶段变化，也留下迁移范围说明，避免把导入时间误认为真实招聘时间。
    sqlx::query("INSERT INTO application_event (id, application_id, type, occurred_at, note, source, created_at) VALUES (?, ?, ?, ?, 'CSV 状态迁移：仅还原当前阶段；缺失的历史日期、面试结果与题目需要补充。', 'MANUAL', ?)")
        .bind(Uuid::new_v4().to_string()).bind(id).bind(event_type.unwrap_or("NOTE")).bind(ts(&at)).bind(now_ts()).execute(&mut *tx).await?;
    crate::services::recompute_status(tx, id).await?;
    Ok(())
}
