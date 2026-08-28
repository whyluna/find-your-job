//! 领域模型：与状态机相关的枚举。
//! 数据库列存 SCREAMING_SNAKE_CASE 字符串，serde rename 与之对齐。
//! 渠道/批次等其余枚举在 P0-3 仓储层引入。

use serde::{Deserialize, Serialize};

/// 投递状态（看板列序即声明序）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Status {
    Saved,
    Applied,
    Assessment,
    Written,
    Interviewing,
    Oc,
    Intent,
    Offer,
    Signed,
    Rejected,
    Withdrawn,
}

impl Status {
    pub const ALL: [Status; 11] = [
        Status::Saved,
        Status::Applied,
        Status::Assessment,
        Status::Written,
        Status::Interviewing,
        Status::Oc,
        Status::Intent,
        Status::Offer,
        Status::Signed,
        Status::Rejected,
        Status::Withdrawn,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            Status::Saved => "SAVED",
            Status::Applied => "APPLIED",
            Status::Assessment => "ASSESSMENT",
            Status::Written => "WRITTEN",
            Status::Interviewing => "INTERVIEWING",
            Status::Oc => "OC",
            Status::Intent => "INTENT",
            Status::Offer => "OFFER",
            Status::Signed => "SIGNED",
            Status::Rejected => "REJECTED",
            Status::Withdrawn => "WITHDRAWN",
        }
    }

    pub fn parse(s: &str) -> Option<Status> {
        Status::ALL.into_iter().find(|st| st.as_str() == s)
    }

    /// 正向流程阶段序（用于 rejected_stage 与统计漏斗）；终态旁路返回 0
    pub fn positive_rank(&self) -> u8 {
        match self {
            Status::Saved => 1,
            Status::Applied => 2,
            Status::Assessment => 3,
            Status::Written => 4,
            Status::Interviewing => 5,
            Status::Oc => 6,
            Status::Intent => 7,
            Status::Offer => 8,
            Status::Signed => 9,
            Status::Rejected | Status::Withdrawn => 0,
        }
    }

    pub fn is_terminal_bad(&self) -> bool {
        matches!(self, Status::Rejected | Status::Withdrawn)
    }
}

/// 完成类事件的结果
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventResult {
    Pending,
    Pass,
    Fail,
    Unknown,
}

impl EventResult {
    pub fn as_str(&self) -> &'static str {
        match self {
            EventResult::Pending => "PENDING",
            EventResult::Pass => "PASS",
            EventResult::Fail => "FAIL",
            EventResult::Unknown => "UNKNOWN",
        }
    }

    pub fn parse(s: &str) -> Option<EventResult> {
        match s {
            "PENDING" => Some(EventResult::Pending),
            "PASS" => Some(EventResult::Pass),
            "FAIL" => Some(EventResult::Fail),
            "UNKNOWN" => Some(EventResult::Unknown),
            _ => None,
        }
    }
}

/// 面试状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InterviewStatus {
    Scheduled,
    Completed,
    Cancelled,
}

/// 面试结果
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InterviewOutcome {
    Pending,
    Pass,
    Fail,
    Unknown,
}

/// 事件类型（19 个内置 + 用户自定义）。
/// 自定义类型自带投影（custom_event_type.projection），随事件一并传入，
/// derive_status 无需查库。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventType {
    Applied,
    AssessmentInvited,
    AssessmentDone,
    AssessmentFailed,
    WrittenInvited,
    WrittenDone,
    WrittenFailed,
    ResumePass,
    ResumeFail,
    HrContact,
    Oc,
    IntentLetter,
    Offer,
    DualAgreement,
    Tripartite,
    Signed,
    Rejected,
    Withdrawn,
    Note,
    /// key 为字典值（custom_event_type.id）；projection 为配置的状态投影
    Custom { key: String, projection: ProjectionEffect },
}

/// 状态投影效果：内置类型由 state_machine::projection_of 推导，
/// 自定义类型由字典配置解析，两者共用此枚举。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectionEffect {
    NoChange,
    Applied,
    Assessment,
    Written,
    Interviewing,
    Oc,
    Intent,
    Offer,
    Signed,
    Rejected,
    Withdrawn,
}

impl ProjectionEffect {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProjectionEffect::NoChange => "NO_CHANGE",
            ProjectionEffect::Applied => "APPLIED",
            ProjectionEffect::Assessment => "ASSESSMENT",
            ProjectionEffect::Written => "WRITTEN",
            ProjectionEffect::Interviewing => "INTERVIEWING",
            ProjectionEffect::Oc => "OC",
            ProjectionEffect::Intent => "INTENT",
            ProjectionEffect::Offer => "OFFER",
            ProjectionEffect::Signed => "SIGNED",
            ProjectionEffect::Rejected => "REJECTED",
            ProjectionEffect::Withdrawn => "WITHDRAWN",
        }
    }

    pub fn parse(s: &str) -> Option<ProjectionEffect> {
        match s {
            "NO_CHANGE" => Some(ProjectionEffect::NoChange),
            "APPLIED" => Some(ProjectionEffect::Applied),
            "ASSESSMENT" => Some(ProjectionEffect::Assessment),
            "WRITTEN" => Some(ProjectionEffect::Written),
            "INTERVIEWING" => Some(ProjectionEffect::Interviewing),
            "OC" => Some(ProjectionEffect::Oc),
            "INTENT" => Some(ProjectionEffect::Intent),
            "OFFER" => Some(ProjectionEffect::Offer),
            "SIGNED" => Some(ProjectionEffect::Signed),
            "REJECTED" => Some(ProjectionEffect::Rejected),
            "WITHDRAWN" => Some(ProjectionEffect::Withdrawn),
            _ => None,
        }
    }

    pub fn to_status(self) -> Option<Status> {
        match self {
            ProjectionEffect::NoChange => None,
            ProjectionEffect::Applied => Some(Status::Applied),
            ProjectionEffect::Assessment => Some(Status::Assessment),
            ProjectionEffect::Written => Some(Status::Written),
            ProjectionEffect::Interviewing => Some(Status::Interviewing),
            ProjectionEffect::Oc => Some(Status::Oc),
            ProjectionEffect::Intent => Some(Status::Intent),
            ProjectionEffect::Offer => Some(Status::Offer),
            ProjectionEffect::Signed => Some(Status::Signed),
            ProjectionEffect::Rejected => Some(Status::Rejected),
            ProjectionEffect::Withdrawn => Some(Status::Withdrawn),
        }
    }
}

impl EventType {
    /// 数据库 type 列的存储键：内置为类型名，自定义为 `custom:<id>`
    pub fn db_key(&self) -> String {
        match self {
            EventType::Custom { key, .. } => format!("custom:{key}"),
            other => {
                let s = serde_json::to_string(other).expect("序列化事件类型失败");
                s.trim_matches('"').to_string()
            }
        }
    }

    /// 从数据库键解析；custom: 前缀必须提供其投影配置
    pub fn parse_db_key(key: &str, custom_projection: Option<ProjectionEffect>) -> Option<EventType> {
        if let Some(id) = key.strip_prefix("custom:") {
            let projection = custom_projection?;
            Some(EventType::Custom {
                key: id.to_string(),
                projection,
            })
        } else {
            match key {
                "APPLIED" => Some(EventType::Applied),
                "ASSESSMENT_INVITED" => Some(EventType::AssessmentInvited),
                "ASSESSMENT_DONE" => Some(EventType::AssessmentDone),
                "ASSESSMENT_FAILED" => Some(EventType::AssessmentFailed),
                "WRITTEN_INVITED" => Some(EventType::WrittenInvited),
                "WRITTEN_DONE" => Some(EventType::WrittenDone),
                "WRITTEN_FAILED" => Some(EventType::WrittenFailed),
                "RESUME_PASS" => Some(EventType::ResumePass),
                "RESUME_FAIL" => Some(EventType::ResumeFail),
                "HR_CONTACT" => Some(EventType::HrContact),
                "OC" => Some(EventType::Oc),
                "INTENT_LETTER" => Some(EventType::IntentLetter),
                "OFFER" => Some(EventType::Offer),
                "DUAL_AGREEMENT" => Some(EventType::DualAgreement),
                "TRIPLICATE" => Some(EventType::Tripartite),
                "SIGNED" => Some(EventType::Signed),
                "REJECTED" => Some(EventType::Rejected),
                "WITHDRAWN" => Some(EventType::Withdrawn),
                "NOTE" => Some(EventType::Note),
                _ => None,
            }
        }
    }

    /// 是否需要在录入表单展示 deadline / result 字段（与前端 EVENT_TYPE_DEFS 对齐）
    pub fn needs_deadline(&self) -> bool {
        matches!(
            self,
            EventType::AssessmentInvited | EventType::WrittenInvited
        )
    }

    pub fn needs_result(&self) -> bool {
        matches!(self, EventType::AssessmentDone | EventType::WrittenDone)
    }
}
