//! 实体 DTO（数据库行 ↔ IPC JSON 的统一形状，serde camelCase）与开放枚举校验。
//! 时间戳：全库统一 `to_rfc3339_opts(Micros, true)` 格式，字符串比较即时间比较。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::models::{EventResult, InterviewOutcome, InterviewStatus, Status};

/// 统一时间戳格式（微秒 + Z 后缀，定长），写入数据库一律经过它
pub fn ts(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}

pub fn now_ts() -> String {
    ts(&Utc::now())
}

pub fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// 解析 YYYY-MM-DD（本地日终语义：当天 00:00 本地 → UTC）
pub fn parse_date(s: &str) -> Option<DateTime<Utc>> {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()?
        .and_hms_opt(0, 0, 0)?
        .and_local_timezone(chrono::Local)
        .single()
        .map(|d| d.with_timezone(&Utc))
}

// ---------- 开放枚举校验（内置键 + custom:% 前缀） ----------

pub const CHANNEL_KEYS: &[&str] = &[
    "COMPANY_SITE",
    "BOSS",
    "NOWCODER",
    "SHIXISENG",
    "LIEPIN",
    "REFERRAL",
    "EMAIL",
    "JOBFAIR",
    "OTHER",
];
pub const BATCH_KEYS: &[&str] = &[
    "EARLY",
    "FORMAL",
    "SPRING",
    "SUPPLEMENT",
    "DAILY_INTERN",
    "VACATION_INTERN",
    "OTHER",
];
pub const PRIORITY_KEYS: &[&str] = &["HIGH", "MEDIUM", "LOW"];

pub fn is_open_enum_key(keys: &[&str], s: &str) -> bool {
    keys.contains(&s) || s.starts_with("custom:")
}

// ---------- 封闭小枚举（列有 CHECK，直接信任数据库） ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Priority {
    High,
    Medium,
    Low,
}

impl Priority {
    pub fn parse(s: &str) -> Option<Priority> {
        match s {
            "HIGH" => Some(Priority::High),
            "MEDIUM" => Some(Priority::Medium),
            "LOW" => Some(Priority::Low),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QuestionQuality {
    Good,
    Ok,
    Bad,
    Unknown,
}

impl QuestionQuality {
    pub fn parse(s: &str) -> Option<QuestionQuality> {
        match s {
            "GOOD" => Some(QuestionQuality::Good),
            "OK" => Some(QuestionQuality::Ok),
            "BAD" => Some(QuestionQuality::Bad),
            "UNKNOWN" => Some(QuestionQuality::Unknown),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            QuestionQuality::Good => "GOOD",
            QuestionQuality::Ok => "OK",
            QuestionQuality::Bad => "BAD",
            QuestionQuality::Unknown => "UNKNOWN",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventSource {
    Manual,
    Extension,
    Email,
}

impl EventSource {
    pub fn parse(s: &str) -> Option<EventSource> {
        match s {
            "MANUAL" => Some(EventSource::Manual),
            "EXTENSION" => Some(EventSource::Extension),
            "EMAIL" => Some(EventSource::Email),
            _ => None,
        }
    }
}

// ---------- JSON 文本列 ----------

pub fn parse_json_strings(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

// ---------- 实体 ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub industry: Option<String>,
    pub nature: Option<String>,
    pub website: Option<String>,
    pub careers_url: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// 在投投递数（列表查询联出，无该列时为 0）
    #[serde(default)]
    pub application_count: i64,
}

impl Company {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> Company {
        Company {
            id: row.try_get("id").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            aliases: row
                .try_get::<String, _>("aliases")
                .map(|s| parse_json_strings(&s))
                .unwrap_or_default(),
            industry: row.try_get("industry").ok().flatten(),
            nature: row.try_get("nature").ok().flatten(),
            website: row.try_get("website").ok().flatten(),
            careers_url: row.try_get("careers_url").ok().flatten(),
            notes: row.try_get("notes").ok().flatten(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
            application_count: row.try_get("application_count").unwrap_or(0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeVersion {
    pub id: String,
    pub name: String,
    pub target_role: Option<String>,
    pub file_name: String,
    /// 应用数据目录内的存储路径（供打开文件/Finder 定位）
    pub file_path: String,
    pub file_size: Option<i64>,
    pub notes: Option<String>,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// 被多少条投递引用（列表查询时联出，无则为 0）
    #[serde(default)]
    pub usage_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    pub id: String,
    pub company_id: String,
    pub company_name: String,
    pub position_title: String,
    pub department: Option<String>,
    pub work_location: Option<String>,
    /// 开放枚举：内置键或 custom:%（前端用字典渲染标签）
    pub channel: String,
    pub batch: String,
    pub priority: Priority,
    pub status: Status,
    pub applied_date: Option<DateTime<Utc>>,
    pub job_url: Option<String>,
    pub jd_text: Option<String>,
    pub jd_snapshot_at: Option<DateTime<Utc>>,
    pub salary_range: Option<String>,
    pub tags: Vec<String>,
    pub resume_version_id: Option<String>,
    pub resume_version_name: Option<String>,
    pub referred_by_id: Option<String>,
    pub notes: Option<String>,
    pub is_archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Application {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> Application {
        Application {
            id: row.try_get("id").unwrap_or_default(),
            company_id: row.try_get("company_id").unwrap_or_default(),
            company_name: row.try_get::<String, _>("company_name").unwrap_or_default(),
            position_title: row.try_get("position_title").unwrap_or_default(),
            department: row.try_get("department").ok().flatten(),
            work_location: row.try_get("work_location").ok().flatten(),
            channel: row.try_get("channel").unwrap_or_default(),
            batch: row.try_get("batch").unwrap_or_default(),
            priority: row
                .try_get::<String, _>("priority")
                .ok()
                .and_then(|s| Priority::parse(&s))
                .unwrap_or(Priority::Medium),
            status: row
                .try_get::<String, _>("status")
                .ok()
                .and_then(|s| Status::parse(&s))
                .unwrap_or(Status::Saved),
            applied_date: row.try_get("applied_date").ok().flatten(),
            job_url: row.try_get("job_url").ok().flatten(),
            jd_text: row.try_get("jd_text").ok().flatten(),
            jd_snapshot_at: row.try_get("jd_snapshot_at").ok().flatten(),
            salary_range: row.try_get("salary_range").ok().flatten(),
            tags: row
                .try_get::<String, _>("tags")
                .map(|s| parse_json_strings(&s))
                .unwrap_or_default(),
            resume_version_id: row.try_get("resume_version_id").ok().flatten(),
            resume_version_name: row.try_get("resume_version_name").ok().flatten(),
            referred_by_id: row.try_get("referred_by_id").ok().flatten(),
            notes: row.try_get("notes").ok().flatten(),
            is_archived: row
                .try_get::<i64, _>("is_archived")
                .map(|v| v != 0)
                .unwrap_or(false),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    }
}

/// 列表行 = Application + 看板/表格附加信息（子查询联出）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationListItem {
    #[serde(flatten)]
    pub application: Application,
    /// 最近一个未过期 deadline（紧急度红点）
    pub next_deadline: Option<DateTime<Utc>>,
    pub interview_count: i64,
    pub last_event_type: Option<String>,
    pub last_event_at: Option<DateTime<Utc>>,
}

impl ApplicationListItem {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> ApplicationListItem {
        ApplicationListItem {
            application: Application::from_row(row),
            next_deadline: row.try_get("next_deadline").ok().flatten(),
            interview_count: row.try_get("interview_count").unwrap_or(0),
            last_event_type: row.try_get("last_event_type").ok().flatten(),
            last_event_at: row.try_get("last_event_at").ok().flatten(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationEvent {
    pub id: String,
    pub application_id: String,
    /// 事件类型键：内置枚举名或 custom:<id>
    #[serde(rename = "type")]
    pub event_type: String,
    pub occurred_at: DateTime<Utc>,
    pub deadline: Option<DateTime<Utc>>,
    pub result: Option<EventResult>,
    pub note: Option<String>,
    pub source: EventSource,
    pub created_at: DateTime<Utc>,
}

impl ApplicationEvent {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> ApplicationEvent {
        ApplicationEvent {
            id: row.try_get("id").unwrap_or_default(),
            application_id: row.try_get("application_id").unwrap_or_default(),
            event_type: row.try_get("type").unwrap_or_default(),
            occurred_at: row.try_get("occurred_at").unwrap_or_default(),
            deadline: row.try_get("deadline").ok().flatten(),
            result: row
                .try_get::<Option<String>, _>("result")
                .ok()
                .flatten()
                .and_then(|s| EventResult::parse(&s)),
            note: row.try_get("note").ok().flatten(),
            source: row
                .try_get::<String, _>("source")
                .ok()
                .and_then(|s| EventSource::parse(&s))
                .unwrap_or(EventSource::Manual),
            created_at: row.try_get("created_at").unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Interview {
    pub id: String,
    pub application_id: String,
    pub round: i64,
    pub round_label: Option<String>,
    /// 开放：PHONE/VIDEO/ONSITE/GROUP/AI 或 custom:%
    pub format: Option<String>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub duration_min: Option<i64>,
    pub location_or_link: Option<String>,
    pub interviewer_note: Option<String>,
    pub status: InterviewStatus,
    pub outcome: InterviewOutcome,
    pub self_rating: Option<i64>,
    pub overall_reflection: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// 该轮题目数（联查时填充，默认 0）
    #[serde(default)]
    pub question_count: i64,
}

impl Interview {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> Interview {
        fn parse_status(s: Option<String>) -> InterviewStatus {
            match s.as_deref() {
                Some("COMPLETED") => InterviewStatus::Completed,
                Some("CANCELLED") => InterviewStatus::Cancelled,
                _ => InterviewStatus::Scheduled,
            }
        }
        fn parse_outcome(s: Option<String>) -> InterviewOutcome {
            match s.as_deref() {
                Some("PASS") => InterviewOutcome::Pass,
                Some("FAIL") => InterviewOutcome::Fail,
                Some("UNKNOWN") => InterviewOutcome::Unknown,
                _ => InterviewOutcome::Pending,
            }
        }
        Interview {
            id: row.try_get("id").unwrap_or_default(),
            application_id: row.try_get("application_id").unwrap_or_default(),
            round: row.try_get("round").unwrap_or(1),
            round_label: row.try_get("round_label").ok().flatten(),
            format: row.try_get("format").ok().flatten(),
            scheduled_at: row.try_get("scheduled_at").ok().flatten(),
            duration_min: row.try_get("duration_min").ok().flatten(),
            location_or_link: row.try_get("location_or_link").ok().flatten(),
            interviewer_note: row.try_get("interviewer_note").ok().flatten(),
            status: parse_status(row.try_get::<String, _>("status").ok()),
            outcome: parse_outcome(row.try_get::<String, _>("outcome").ok()),
            self_rating: row.try_get("self_rating").ok().flatten(),
            overall_reflection: row.try_get("overall_reflection").ok().flatten(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
            question_count: row.try_get("question_count").unwrap_or(0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewQuestion {
    pub id: String,
    pub interview_id: String,
    pub ordinal: i64,
    pub question: String,
    pub my_answer: Option<String>,
    pub quality: QuestionQuality,
    pub reflection: Option<String>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl InterviewQuestion {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> InterviewQuestion {
        InterviewQuestion {
            id: row.try_get("id").unwrap_or_default(),
            interview_id: row.try_get("interview_id").unwrap_or_default(),
            ordinal: row.try_get("ordinal").unwrap_or(0),
            question: row.try_get("question").unwrap_or_default(),
            my_answer: row.try_get("my_answer").ok().flatten(),
            quality: row
                .try_get::<String, _>("quality")
                .ok()
                .and_then(|s| QuestionQuality::parse(&s))
                .unwrap_or(QuestionQuality::Unknown),
            reflection: row.try_get("reflection").ok().flatten(),
            tags: row
                .try_get::<String, _>("tags")
                .map(|s| parse_json_strings(&s))
                .unwrap_or_default(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub parent_type: String,
    pub parent_id: String,
    pub file_name: String,
    pub file_path: String,
    pub mime_type: Option<String>,
    pub size: Option<i64>,
    pub created_at: DateTime<Utc>,
}

impl Attachment {
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> Attachment {
        Attachment {
            id: row.try_get("id").unwrap_or_default(),
            parent_type: row.try_get("parent_type").unwrap_or_default(),
            parent_id: row.try_get("parent_id").unwrap_or_default(),
            file_name: row.try_get("file_name").unwrap_or_default(),
            file_path: row.try_get("file_path").unwrap_or_default(),
            mime_type: row.try_get("mime_type").ok().flatten(),
            size: row.try_get("size").ok().flatten(),
            created_at: row.try_get("created_at").unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomEventType {
    pub id: String,
    pub label: String,
    pub projection: String,
    pub deadline_required: bool,
    pub result_required: bool,
    pub sort: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryItem {
    pub id: String,
    pub category: String,
    pub key: String,
    pub label: String,
    pub sort: i64,
    pub is_active: bool,
    pub is_system: bool,
}

/// 投递详情聚合（详情页一次取全）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationDetail {
    #[serde(flatten)]
    pub application: Application,
    pub events: Vec<ApplicationEvent>,
    /// interviews 按时间倒序，每轮内含题目（按 ordinal）
    pub interviews: Vec<InterviewDetail>,
    /// 挂在投递上的附件（笔试截图 / offer 扫描等）
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewDetail {
    #[serde(flatten)]
    pub interview: Interview,
    pub questions: Vec<InterviewQuestion>,
}
