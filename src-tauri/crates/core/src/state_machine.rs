//! 状态机（设计文档 §3.4）——整个产品的正确性核心。
//!
//! `derive_status` 是纯函数：输入一条投递的全部时间线条目（事件 + 面试），
//! 按 occurred_at 升序重放折叠，输出最终状态、投递日期、挂掉时的最远阶段。
//! 服务层在任何增删改后调用它并回写 application 表（事务内）。

use chrono::{DateTime, Utc};

use crate::models::{
    EventResult, EventType, InterviewOutcome, InterviewStatus, ProjectionEffect, Status,
};

/// 时间线条目：事件或面试的统一抽象（排序键由服务层解析为单一时间）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimelineKind {
    Event {
        event_type: EventType,
        result: Option<EventResult>,
    },
    Interview {
        status: InterviewStatus,
        outcome: InterviewOutcome,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimelineItem {
    pub kind: TimelineKind,
    pub occurred_at: DateTime<Utc>,
}

/// 重放产物
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedState {
    pub status: Status,
    /// 最早一次 APPLIED 事件的时间
    pub applied_date: Option<DateTime<Utc>>,
    /// 最终状态为 REJECTED 时：挂掉前到达的最远正向阶段；其余情况为 None
    pub rejected_stage: Option<Status>,
}

/// 内置事件类型 → 状态投影（设计文档 §3.4 投影规则表）
fn projection_of(event_type: &EventType, result: Option<EventResult>) -> ProjectionEffect {
    use EventType as E;
    use ProjectionEffect as P;
    match event_type {
        E::Applied => P::Applied,
        // 邀请类事件带 FAIL 结果 = 该阶段未通过 → 挂（新模型：阶段结果驱动状态）
        E::AssessmentInvited => {
            if result == Some(EventResult::Fail) {
                P::Rejected
            } else {
                P::Assessment
            }
        }
        E::WrittenInvited => {
            if result == Some(EventResult::Fail) {
                P::Rejected
            } else {
                P::Written
            }
        }
        // 完成类事件若结果为 FAIL 视同挂掉（与 ASSESSMENT_FAILED 等价）
        E::AssessmentDone | E::WrittenDone => {
            if result == Some(EventResult::Fail) {
                P::Rejected
            } else {
                match event_type {
                    E::AssessmentDone => P::Assessment,
                    _ => P::Written,
                }
            }
        }
        E::AssessmentFailed | E::WrittenFailed | E::ResumeFail | E::Rejected => P::Rejected,
        E::ResumePass | E::HrContact | E::Note => P::NoChange,
        E::Oc => P::Oc,
        E::IntentLetter => P::Intent,
        E::Offer | E::DualAgreement | E::Tripartite => P::Offer,
        E::Signed => P::Signed,
        E::Withdrawn => P::Withdrawn,
        E::Custom { projection, .. } => *projection,
    }
}

/// 全量重放：条目按时间升序稳定排序后折叠，后者覆盖前者；
/// 乱序补录天然支持；失败后再次前进也允许（如补录/复活场景）。
pub fn derive_status(items: &[TimelineItem]) -> DerivedState {
    let mut sorted: Vec<&TimelineItem> = items.iter().collect();
    sorted.sort_by_key(|it| it.occurred_at);

    let mut status = Status::Saved;
    let mut applied_date: Option<DateTime<Utc>> = None;
    let mut max_positive: Status = Status::Saved;

    for it in sorted {
        let effect = match &it.kind {
            TimelineKind::Event { event_type, result } => {
                if *event_type == EventType::Applied {
                    applied_date = Some(match applied_date {
                        Some(d) if d <= it.occurred_at => d,
                        _ => it.occurred_at,
                    });
                }
                projection_of(event_type, *result)
            }
            TimelineKind::Interview { status: s, outcome } => match (s, outcome) {
                (InterviewStatus::Cancelled, _) => ProjectionEffect::NoChange,
                (InterviewStatus::Scheduled, _) => ProjectionEffect::Interviewing,
                (InterviewStatus::Completed, InterviewOutcome::Fail) => ProjectionEffect::Rejected,
                (InterviewStatus::Completed, _) => ProjectionEffect::Interviewing,
            },
        };
        if let Some(next) = effect.to_status() {
            status = next;
        }
        if status.positive_rank() > max_positive.positive_rank() {
            max_positive = status;
        }
    }

    let rejected_stage = if status == Status::Rejected {
        Some(max_positive)
    } else {
        None
    };

    DerivedState {
        status,
        applied_date,
        rejected_stage,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(minute: u32) -> DateTime<Utc> {
        let base = Utc.with_ymd_and_hms(2026, 8, 29, 10, 0, 0).unwrap();
        base + chrono::Duration::minutes(minute as i64)
    }

    fn ev(minute: u32, event_type: EventType) -> TimelineItem {
        TimelineItem {
            kind: TimelineKind::Event {
                event_type,
                result: None,
            },
            occurred_at: t(minute),
        }
    }

    fn ev_r(minute: u32, event_type: EventType, result: EventResult) -> TimelineItem {
        TimelineItem {
            kind: TimelineKind::Event {
                event_type,
                result: Some(result),
            },
            occurred_at: t(minute),
        }
    }

    fn iv(minute: u32, status: InterviewStatus, outcome: InterviewOutcome) -> TimelineItem {
        TimelineItem {
            kind: TimelineKind::Interview { status, outcome },
            occurred_at: t(minute),
        }
    }

    use EventType as E;
    use InterviewOutcome as IO;
    use InterviewStatus as IS;

    // ---------- 基础投影：单事件 ----------

    #[test]
    fn empty_is_saved() {
        let d = derive_status(&[]);
        assert_eq!(d.status, Status::Saved);
        assert_eq!(d.applied_date, None);
        assert_eq!(d.rejected_stage, None);
    }

    #[test]
    fn applied_sets_status_and_date() {
        let d = derive_status(&[ev(0, E::Applied)]);
        assert_eq!(d.status, Status::Applied);
        assert_eq!(d.applied_date, Some(t(0)));
    }

    #[test]
    fn invite_events_move_to_assessment_and_written() {
        assert_eq!(
            derive_status(&[ev(0, E::Applied), ev(5, E::AssessmentInvited)]).status,
            Status::Assessment
        );
        assert_eq!(
            derive_status(&[ev(0, E::Applied), ev(5, E::WrittenInvited)]).status,
            Status::Written
        );
    }

    #[test]
    fn done_events_keep_stage_unless_fail() {
        assert_eq!(
            derive_status(&[
                ev(0, E::Applied),
                ev(5, E::AssessmentInvited),
                ev_r(9, E::AssessmentDone, EventResult::Pending)
            ])
            .status,
            Status::Assessment
        );
        assert_eq!(
            derive_status(&[
                ev(0, E::Applied),
                ev(5, E::WrittenInvited),
                ev_r(9, E::WrittenDone, EventResult::Pass)
            ])
            .status,
            Status::Written
        );
        // 完成但结果为 FAIL → 视同挂掉
        assert_eq!(
            derive_status(&[
                ev(0, E::Applied),
                ev(5, E::WrittenInvited),
                ev_r(9, E::WrittenDone, EventResult::Fail)
            ])
            .status,
            Status::Rejected
        );
    }

    #[test]
    fn fail_events_reject_with_stage() {
        let d = derive_status(&[
            ev(0, E::Applied),
            ev(5, E::AssessmentInvited),
            ev_r(9, E::AssessmentDone, EventResult::Pass),
            ev(20, E::AssessmentFailed),
        ]);
        assert_eq!(d.status, Status::Rejected);
        assert_eq!(d.rejected_stage, Some(Status::Assessment));
    }

    #[test]
    fn resume_fail_rejects_at_applied() {
        let d = derive_status(&[ev(0, E::Applied), ev(30, E::ResumeFail)]);
        assert_eq!(d.status, Status::Rejected);
        assert_eq!(d.rejected_stage, Some(Status::Applied));
    }

    #[test]
    fn no_change_events_do_not_move_status() {
        for et in [E::ResumePass, E::HrContact, E::Note] {
            assert_eq!(
                derive_status(&[ev(0, E::Applied), ev(3, et.clone())]).status,
                Status::Applied,
                "{et:?} 不应改变状态"
            );
        }
    }

    #[test]
    fn invited_with_fail_result_rejects() {
        // 新模型：测评邀请 + 未过结果 → 已挂（阶段结果驱动）
        let d = derive_status(&[
            ev(0, E::Applied),
            ev_r(5, E::AssessmentInvited, EventResult::Fail),
        ]);
        assert_eq!(d.status, Status::Rejected);
        assert_eq!(d.rejected_stage, Some(Status::Applied));
        let d2 = derive_status(&[
            ev(0, E::Applied),
            ev_r(5, E::WrittenInvited, EventResult::Fail),
        ]);
        assert_eq!(d2.status, Status::Rejected);
    }

    #[test]
    fn offer_chain_statuses() {
        assert_eq!(
            derive_status(&[ev(0, E::Applied), ev(9, E::Oc)]).status,
            Status::Oc
        );
        assert_eq!(
            derive_status(&[ev(0, E::Applied), ev(9, E::Oc), ev(19, E::IntentLetter)]).status,
            Status::Intent
        );
        for et in [E::Offer, E::DualAgreement, E::Tripartite] {
            assert_eq!(
                derive_status(&[
                    ev(0, E::Applied),
                    ev(9, E::Offer.clone()),
                    ev(19, et.clone())
                ])
                .status,
                Status::Offer,
                "{et:?} 应停在 OFFER"
            );
        }
        assert_eq!(
            derive_status(&[
                ev(0, E::Applied),
                ev(9, E::Offer),
                ev(19, E::Tripartite),
                ev(29, E::Signed)
            ])
            .status,
            Status::Signed
        );
    }

    #[test]
    fn withdrawn_is_terminal_side_state() {
        let d = derive_status(&[ev(0, E::Applied), ev(2, E::Withdrawn)]);
        assert_eq!(d.status, Status::Withdrawn);
        assert_eq!(d.rejected_stage, None);
    }

    // ---------- 面试 ----------

    #[test]
    fn interview_scheduled_moves_to_interviewing() {
        assert_eq!(
            derive_status(&[ev(0, E::Applied), iv(5, IS::Scheduled, IO::Pending)]).status,
            Status::Interviewing
        );
    }

    #[test]
    fn interview_completed_pass_stays_interviewing() {
        assert_eq!(
            derive_status(&[
                ev(0, E::Applied),
                iv(5, IS::Scheduled, IO::Pending),
                iv(9, IS::Completed, IO::Pass)
            ])
            .status,
            Status::Interviewing
        );
    }

    #[test]
    fn interview_completed_fail_rejects_at_interviewing() {
        let d = derive_status(&[
            ev(0, E::Applied),
            iv(5, IS::Scheduled, IO::Pending),
            iv(9, IS::Completed, IO::Fail),
        ]);
        assert_eq!(d.status, Status::Rejected);
        assert_eq!(d.rejected_stage, Some(Status::Interviewing));
    }

    #[test]
    fn cancelled_interview_changes_nothing() {
        assert_eq!(
            derive_status(&[ev(0, E::Applied), iv(5, IS::Cancelled, IO::Unknown)]).status,
            Status::Applied
        );
    }

    #[test]
    fn fail_then_reschedule_returns_to_interviewing() {
        let d = derive_status(&[
            ev(0, E::Applied),
            iv(5, IS::Scheduled, IO::Pending),
            iv(9, IS::Completed, IO::Fail),
            iv(30, IS::Scheduled, IO::Pending), // 复活/再约
        ]);
        assert_eq!(d.status, Status::Interviewing);
    }

    // ---------- 乱序补录与覆盖语义 ----------

    #[test]
    fn out_of_order_input_is_sorted_before_folding() {
        // 传入顺序故意打乱：APPLIED 晚于 OFFER 发生（补录投递日期在先）
        let d = derive_status(&[ev(60, E::Signed), ev(10, E::Applied), ev(30, E::Offer)]);
        assert_eq!(d.status, Status::Signed);
        assert_eq!(d.applied_date, Some(t(10)));
    }

    #[test]
    fn later_event_wins_on_conflict() {
        // 挂掉后又收到笔试邀请（补录/复活）：后者覆盖
        let d = derive_status(&[
            ev(0, E::Applied),
            ev(5, E::AssessmentInvited),
            ev(9, E::AssessmentFailed),
            ev(40, E::WrittenInvited),
        ]);
        assert_eq!(d.status, Status::Written);
        assert_eq!(d.rejected_stage, None);
    }

    #[test]
    fn applied_date_is_earliest_of_applied_events() {
        let d = derive_status(&[ev(100, E::Applied), ev(20, E::Applied), ev(50, E::Offer)]);
        assert_eq!(d.applied_date, Some(t(20)));
    }

    // ---------- 自定义事件类型 ----------

    #[test]
    fn custom_event_uses_configured_projection() {
        let bg = TimelineItem {
            kind: TimelineKind::Event {
                event_type: EventType::Custom {
                    key: "bg-check".into(),
                    projection: ProjectionEffect::NoChange,
                },
                result: None,
            },
            occurred_at: t(5),
        };
        assert_eq!(
            derive_status(&[ev(0, E::Offer), bg]).status,
            Status::Offer,
            "背调类（NO_CHANGE）不应影响状态"
        );

        let revive = TimelineItem {
            kind: TimelineKind::Event {
                event_type: EventType::Custom {
                    key: "re-review".into(),
                    projection: ProjectionEffect::Interviewing,
                },
                result: None,
            },
            occurred_at: t(50),
        };
        assert_eq!(
            derive_status(&[ev(0, E::Applied), ev(5, E::ResumeFail), revive]).status,
            Status::Interviewing
        );
    }

    // ---------- rejected_stage 边界 ----------

    #[test]
    fn rejected_stage_none_when_not_rejected() {
        let d = derive_status(&[
            ev(0, E::Applied),
            iv(5, IS::Completed, IO::Fail),
            ev(99, E::Withdrawn),
        ]);
        assert_eq!(d.status, Status::Withdrawn);
        assert_eq!(d.rejected_stage, None, "WITHDRAWN 不算挂");
    }

    #[test]
    fn reject_from_saved_records_saved_stage() {
        let d = derive_status(&[ev(0, E::Rejected)]);
        assert_eq!(d.status, Status::Rejected);
        assert_eq!(d.rejected_stage, Some(Status::Saved));
    }

    #[test]
    fn full_campus_journey() {
        let items = vec![
            ev(0, E::Applied),
            ev(10, E::AssessmentInvited),
            ev_r(15, E::AssessmentDone, EventResult::Pass),
            ev(30, E::WrittenInvited),
            ev_r(40, E::WrittenDone, EventResult::Pass),
            iv(60, IS::Scheduled, IO::Pending),
            iv(61, IS::Completed, IO::Pass),
            iv(80, IS::Scheduled, IO::Pending),
            iv(81, IS::Completed, IO::Pass),
            iv(100, IS::Scheduled, IO::Pending),
            iv(101, IS::Completed, IO::Pass),
            ev(120, E::Oc),
            ev(140, E::IntentLetter),
            ev(170, E::Offer),
            ev(200, E::Tripartite),
            ev(230, E::Signed),
        ];
        let d = derive_status(&items);
        assert_eq!(d.status, Status::Signed);
        assert_eq!(d.applied_date, Some(t(0)));
        assert_eq!(d.rejected_stage, None);
    }
}
