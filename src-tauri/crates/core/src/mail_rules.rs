//! 邮件解析规则引擎（P2-c，纯规则无 LLM）：
//! 输入邮件元数据（发件域名/主题/正文片段/接收时间），产出事件建议；
//! 一切建议都要经人工审核 UI 确认后才会写入时间线（service 层 source=EMAIL）。

use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailInput {
    pub message_id: String,
    pub from_address: String,
    pub from_name: Option<String>,
    pub subject: String,
    pub body_snippet: String,
    pub received_at: DateTime<Utc>,
    /// .eml 原文落盘路径（调试与重新解析）
    pub raw_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub event_type: String,
    pub reason: String,
    pub deadline_hint: Option<String>,
    /// 命中的公司名（用于关联投递）
    pub company_hint: Option<String>,
}

/// 分类规则：主题+正文关键词 → 事件类型（顺序敏感，先匹配先赢）
const RULES: &[(&str, &[&str], &str)] = &[
    (
        "ASSESSMENT_INVITED",
        &["测评", "评价邀请", "职业性格", "ai 测评", "talent"],
        "测评/性格测试关键词",
    ),
    (
        "WRITTEN_INVITED",
        &["笔试", "在线考试", "考试邀请", "编程题", "行测"],
        "笔试/在线考试关键词",
    ),
    (
        "INTERVIEW_NOTE",
        &["面试邀请", "面试通知", "面试安排", "视频面试"],
        "面试通知关键词",
    ),
    ("INTENT_LETTER", &["意向书", "录用意向"], "意向书关键词"),
    (
        "OFFER",
        &["offer", "录用通知", "聘用通知", "入职通知"],
        "offer 关键词",
    ),
    (
        "RESUME_FAIL",
        &["简历未通过", "很遗憾", "未能通过筛选", "不匹配"],
        "拒绝/筛选未过关键词",
    ),
    ("SIGNED", &["三方协议", "两方协议", "签约"], "协议关键词"),
];

/// 中文日期提取：X月X日(/号)（含"截止/之前/前完成"语境）
fn extract_deadline_hint(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    for i in 0..chars.len() {
        if chars[i] == '月' && i > 0 && i + 2 < chars.len() {
            let month: String = chars[..i]
                .iter()
                .rev()
                .take_while(|c| c.is_ascii_digit())
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            if month.is_empty() {
                continue;
            }
            let rest: String = chars[i + 1..].iter().collect::<String>();
            let day: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if day.is_empty() {
                continue;
            }
            // 语境检查：截止词
            let has_deadline_ctx = ["截止", "之前", "前完成", "有效期"]
                .iter()
                .any(|k| text.contains(k));
            if has_deadline_ctx {
                let now = Utc::now();
                let m: u32 = month.parse().ok()?;
                let d: u32 = day.parse().ok()?;
                if (1..=12).contains(&m) && (1..=31).contains(&d) {
                    let mut year = now.year();
                    if m < now.month() {
                        year += 1;
                    } // 已过月份视为明年
                    return chrono::NaiveDate::from_ymd_opt(year, m, d)
                        .map(|d| d.format("%Y-%m-%d").to_string());
                }
            }
        }
    }
    None
}

pub fn extract_domain(address: &str) -> String {
    address
        .split('@')
        .nth(1)
        .unwrap_or("")
        .trim_end_matches('>')
        .to_lowercase()
}

pub fn classify(
    mail: &MailInput,
    known_companies: &[(String, String, Vec<String>)],
) -> Option<Suggestion> {
    let text = format!("{} {}", mail.subject, mail.body_snippet).to_lowercase();
    let from_domain = extract_domain(&mail.from_address);

    // ① 事件类型分类
    let mut event_type: Option<&(&str, &[&str], &str)> = None;
    for rule in RULES {
        if rule.1.iter().any(|k| text.contains(k)) {
            event_type = Some(rule);
            break;
        }
    }
    // 拒绝类：必须更严格（"很遗憾"太泛，需要同时含"简历/应聘/申请"语境）
    if event_type.map(|r| r.0) == Some("RESUME_FAIL") {
        let strict = text.contains("简历") || text.contains("应聘") || text.contains("申请");
        if !strict {
            event_type = None;
        }
    }

    // ② 公司匹配：发件域名 vs 公司官网域名/别名
    let mut company_hint: Option<String> = None;
    let mut reason_domain = false;
    for (name, website, aliases) in known_companies {
        // website 形如 meituan.com 或 https://careers.meituan.com
        let site_domain: Option<String> = website
            .parse::<url::Url>()
            .or_else(|_| format!("https://{website}").parse::<url::Url>())
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_lowercase()));
        if let Some(sd) = &site_domain {
            if !sd.is_empty() && from_domain.contains(sd.trim_start_matches("www.")) {
                company_hint = Some(name.clone());
                reason_domain = true;
                break;
            }
        }
        if aliases.iter().any(|a| {
            !a.is_empty() && (from_domain.contains(a.as_str()) || mail.subject.contains(a.as_str()))
        }) {
            company_hint = Some(name.clone());
            reason_domain = true;
            break;
        }
    }

    let et = event_type?;
    let deadline_hint = if et.0.ends_with("_INVITED") {
        extract_deadline_hint(&text)
    } else {
        None
    };

    Some(Suggestion {
        event_type: et.0.to_string(),
        reason: if reason_domain {
            format!("发件域名匹配公司库 + {}", et.2)
        } else {
            et.2.to_string()
        },
        deadline_hint,
        company_hint,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn mail(subject: &str, from: &str, body: &str) -> MailInput {
        MailInput {
            message_id: format!("<{}@test>", subject.len()),
            from_address: from.to_string(),
            from_name: None,
            subject: subject.to_string(),
            body_snippet: body.to_string(),
            received_at: Utc.with_ymd_and_hms(2026, 9, 1, 10, 0, 0).unwrap(),
            raw_path: None,
        }
    }

    fn companies() -> Vec<(String, String, Vec<String>)> {
        vec![
            (
                "腾讯".into(),
                "careers.qq.com".into(),
                vec!["tencent.com".into()],
            ),
            ("美团".into(), "meituan.com".into(), vec![]),
        ]
    }

    #[test]
    fn assessment_invite_with_deadline() {
        let m = mail(
            "【腾讯】职业测评邀请",
            "no-reply@tencent.com",
            "请于 9月10日 前完成在线测评，链接 3 天内有效。",
        );
        let s = classify(&m, &companies()).unwrap();
        assert_eq!(s.event_type, "ASSESSMENT_INVITED");
        assert_eq!(s.company_hint.as_deref(), Some("腾讯"));
        assert_eq!(s.deadline_hint.as_deref(), Some("2026-09-10"));
    }

    #[test]
    fn written_invite() {
        let m = mail("笔试通知 - 美团", "hr@meituan.com", "邀请您参加在线笔试");
        let s = classify(&m, &companies()).unwrap();
        assert_eq!(s.event_type, "WRITTEN_INVITED");
        assert_eq!(s.company_hint.as_deref(), Some("美团"));
    }

    #[test]
    fn interview_invite() {
        let m = mail(
            "面试安排",
            "campus@nowcoder.com",
            "您已通过简历筛选，请参加视频面试",
        );
        let s = classify(&m, &companies()).unwrap();
        assert_eq!(s.event_type, "INTERVIEW_NOTE");
        assert!(s.company_hint.is_none(), "牛客平台域名不应匹配到公司库");
    }

    #[test]
    fn offer_letter() {
        let m = mail("录用意向书", "offer@tencent.com", "恭喜您获得录用资格");
        let s = classify(&m, &companies()).unwrap();
        assert_eq!(s.event_type, "INTENT_LETTER");
    }

    #[test]
    fn rejection_requires_context() {
        // 只有"很遗憾"没有申请语境 → 不产出（避免误报）
        let m = mail("很遗憾", "news@example.com", "本期活动很遗憾未能中奖");
        assert!(classify(&m, &companies()).is_none());
        let m2 = mail(
            "应聘结果通知",
            "hr@example.com",
            "很遗憾，您的简历未能通过筛选",
        );
        let s = classify(&m2, &companies()).unwrap();
        assert_eq!(s.event_type, "RESUME_FAIL");
    }

    #[test]
    fn irrelevant_mail_skipped() {
        let m = mail("双十一大促", "mall@taobao.com", "全场五折");
        assert!(classify(&m, &companies()).is_none());
    }

    #[test]
    fn domain_extract() {
        assert_eq!(extract_domain("HR <hr@meituan.com>"), "meituan.com");
    }
}
