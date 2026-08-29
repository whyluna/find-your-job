//! 服务层集成测试：临时 SQLite 上走完整业务流，重点验证
//! "写入 + 事务内状态重算" 的正确性（P0-3 验收）。

use chrono::{TimeZone, Utc};
use fyj_core::db::init_pool;
use fyj_core::models::{EventResult, InterviewOutcome, InterviewStatus, Status};
use fyj_core::services::*;

async fn setup() -> (tempfile::TempDir, Services) {
    let dir = tempfile::tempdir().unwrap();
    let pool = init_pool(&dir.path().join("test.db")).await.unwrap();
    (dir, Services::new(pool))
}

fn dt(day: u32, hour: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, day, hour, 0, 0).unwrap()
}

fn create_input(company: &str, title: &str) -> CreateApplicationInput {
    CreateApplicationInput {
        company_name: company.into(),
        company_website: None,
        company_careers_url: None,
        position_title: title.into(),
        department: None,
        work_location: Some("北京".into()),
        channel: Some("COMPANY_SITE".into()),
        batch: Some("EARLY".into()),
        priority: Some("HIGH".into()),
        applied: Some(true),
        applied_date: Some(dt(1, 9)),
        job_url: None,
        jd_text: Some("负责推荐算法".into()),
        salary_range: None,
        tags: vec!["想去的".into()],
        resume_version_id: None,
        notes: None,
    }
}

#[tokio::test]
async fn create_with_applied_sets_status_and_date() {
    let (_dir, s) = setup().await;
    let app = s.create_application(create_input("美团", "运筹优化工程师")).await.unwrap();
    assert_eq!(app.status, Status::Applied);
    assert_eq!(app.applied_date, Some(dt(1, 9)));
    assert_eq!(app.company_name, "美团");
    assert_eq!(app.batch, "EARLY");
    assert!(app.jd_snapshot_at.is_some(), "写入 JD 时应记录快照时间");
}

#[tokio::test]
async fn create_without_applied_stays_saved() {
    let (_dir, s) = setup().await;
    let mut input = create_input("阿里", "算法工程师");
    input.applied = Some(false);
    let app = s.create_application(input).await.unwrap();
    assert_eq!(app.status, Status::Saved);
    assert_eq!(app.applied_date, None);
}

#[tokio::test]
async fn same_company_second_application_reuses_company() {
    let (_dir, s) = setup().await;
    s.create_application(create_input("美团", "岗位A")).await.unwrap();
    s.create_application(create_input("美团", "岗位B")).await.unwrap();
    let companies = s.search_companies("美团", 10).await.unwrap();
    assert_eq!(companies.len(), 1, "同名公司应复用而非重复创建");
}

#[tokio::test]
async fn full_journey_events_derive_status() {
    let (_dir, s) = setup().await;
    let app = s.create_application(create_input("腾讯", "后端开发")).await.unwrap();
    let id = &app.id;

    s.add_event(AddEventInput {
        application_id: id.clone(),
        event_type: "ASSESSMENT_INVITED".into(),
        occurred_at: Some(dt(2, 10)),
        deadline: Some(dt(4, 23)),
        result: None,
        note: Some("测评链接".into()),
        source: None,
    }).await.unwrap();
    assert_eq!(s.get_application(id).await.unwrap().status, Status::Assessment);

    s.add_event(AddEventInput {
        application_id: id.clone(),
        event_type: "ASSESSMENT_DONE".into(),
        occurred_at: Some(dt(3, 20)),
        deadline: None,
        result: Some(EventResult::Pass),
        note: None,
        source: None,
    }).await.unwrap();

    s.add_event(AddEventInput {
        application_id: id.clone(),
        event_type: "WRITTEN_INVITED".into(),
        occurred_at: Some(dt(4, 9)),
        deadline: Some(dt(6, 23)),
        result: None,
        note: None,
        source: None,
    }).await.unwrap();
    assert_eq!(s.get_application(id).await.unwrap().status, Status::Written);

    s.add_event(AddEventInput {
        application_id: id.clone(),
        event_type: "OC".into(),
        occurred_at: Some(dt(10, 11)),
        deadline: None,
        result: None,
        note: Some("口头 offer".into()),
        source: None,
    }).await.unwrap();
    assert_eq!(s.get_application(id).await.unwrap().status, Status::Oc);

    s.add_event(AddEventInput {
        application_id: id.clone(),
        event_type: "SIGNED".into(),
        occurred_at: Some(dt(20, 15)),
        deadline: None,
        result: None,
        note: None,
        source: None,
    }).await.unwrap();
    assert_eq!(s.get_application(id).await.unwrap().status, Status::Signed);
}

#[tokio::test]
async fn interview_lifecycle_recompute() {
    let (_dir, s) = setup().await;
    let app = s.create_application(create_input("字节", "客户端开发")).await.unwrap();
    let id = &app.id;

    let iv1 = s.add_interview(AddInterviewInput {
        application_id: id.clone(),
        round: None, // 自动第 1 轮
        round_label: Some("一面".into()),
        format: Some("VIDEO".into()),
        scheduled_at: Some(dt(5, 14)),
        duration_min: Some(60),
        location_or_link: None,
        interviewer_note: None,
        status: None,
        outcome: None,
    }).await.unwrap();
    assert_eq!(iv1.round, 1);
    assert_eq!(s.get_application(id).await.unwrap().status, Status::Interviewing);

    // 面试挂 → REJECTED
    s.update_interview(&iv1.id, UpdateInterviewInput {
        status: Some(InterviewStatus::Completed),
        outcome: Some(InterviewOutcome::Fail),
        ..Default::default()
    }).await.unwrap();
    assert_eq!(s.get_application(id).await.unwrap().status, Status::Rejected);

    // 删除该面试 → 回到 APPLIED（事件重算回退）
    s.delete_interview(&iv1.id).await.unwrap();
    assert_eq!(s.get_application(id).await.unwrap().status, Status::Applied);
}

#[tokio::test]
async fn interview_rounds_are_sequential_and_pending_blocks() {
    let (_dir, s) = setup().await;
    let app = s.create_application(create_input("网易", "游戏客户端")).await.unwrap();

    // 跳轮被拒：直接加第 3 轮
    let skip = s.add_interview(AddInterviewInput {
        application_id: app.id.clone(),
        round: Some(3),
        round_label: None, format: None, scheduled_at: Some(dt(7, 10)),
        duration_min: None, location_or_link: None, interviewer_note: None,
        status: None, outcome: None,
    }).await;
    assert!(skip.is_err());

    // 第 1 轮待进行时，禁止加第 2 轮
    s.add_interview(AddInterviewInput {
        application_id: app.id.clone(),
        round: Some(1),
        round_label: Some("一面".into()), format: None, scheduled_at: Some(dt(7, 10)),
        duration_min: None, location_or_link: None, interviewer_note: None,
        status: None, outcome: None,
    }).await.unwrap();
    let blocked = s.add_interview(AddInterviewInput {
        application_id: app.id.clone(),
        round: Some(2),
        round_label: None, format: None, scheduled_at: Some(dt(9, 10)),
        duration_min: None, location_or_link: None, interviewer_note: None,
        status: None, outcome: None,
    }).await;
    assert!(blocked.is_err(), "上一轮未完成时不应允许加下一轮");

    // 完成第 1 轮后，第 2 轮放行
    let ivs = s.get_application_detail(&app.id).await.unwrap().interviews;
    let iv1 = &ivs[0];
    s.update_interview(&iv1.interview.id, UpdateInterviewInput {
        status: Some(InterviewStatus::Completed),
        outcome: Some(InterviewOutcome::Pass),
        ..Default::default()
    }).await.unwrap();
    s.add_interview(AddInterviewInput {
        application_id: app.id.clone(),
        round: Some(2),
        round_label: Some("二面".into()), format: None, scheduled_at: Some(dt(9, 10)),
        duration_min: None, location_or_link: None, interviewer_note: None,
        status: None, outcome: None,
    }).await.unwrap();
    let detail = s.get_application_detail(&app.id).await.unwrap();
    assert_eq!(detail.interviews.len(), 2);
}

#[tokio::test]
async fn delete_event_recomputes_backward() {
    let (_dir, s) = setup().await;
    let app = s.create_application(create_input("百度", "搜索算法")).await.unwrap();
    let ev = s.add_event(AddEventInput {
        application_id: app.id.clone(),
        event_type: "ASSESSMENT_FAILED".into(),
        occurred_at: Some(dt(3, 10)),
        deadline: None,
        result: None,
        note: None,
        source: None,
    }).await.unwrap();
    assert_eq!(s.get_application(&app.id).await.unwrap().status, Status::Rejected);
    s.delete_event(&ev.id).await.unwrap();
    assert_eq!(s.get_application(&app.id).await.unwrap().status, Status::Applied);
}

#[tokio::test]
async fn backfill_earlier_applied_updates_applied_date() {
    let (_dir, s) = setup().await;
    let app = s.create_application(create_input("快手", "推荐算法")).await.unwrap();
    assert_eq!(app.applied_date, Some(dt(1, 9)));
    // 补录更早的投递时间
    s.add_event(AddEventInput {
        application_id: app.id.clone(),
        event_type: "APPLIED".into(),
        occurred_at: Some(dt(1, 3)),
        deadline: None,
        result: None,
        note: Some("补录官网投递时间".into()),
        source: None,
    }).await.unwrap();
    let updated = s.get_application(&app.id).await.unwrap();
    assert_eq!(updated.applied_date, Some(dt(1, 3)));
    assert_eq!(updated.status, Status::Applied, "两条 APPLIED 不应改变状态");
}

#[tokio::test]
async fn custom_event_type_uses_dictionary_projection() {
    let (_dir, s) = setup().await;
    // 直接插入字典：自定义"背调"事件（不改变状态）
    sqlx::query("INSERT INTO custom_event_type (id, label, projection) VALUES ('bg1', '背调', 'NO_CHANGE')")
        .execute(&s.pool).await.unwrap();
    let app = s.create_application(create_input("网易", "游戏策划")).await.unwrap();
    s.add_event(AddEventInput {
        application_id: app.id.clone(),
        event_type: "custom:bg1".into(),
        occurred_at: Some(dt(8, 10)),
        deadline: None,
        result: None,
        note: None,
        source: None,
    }).await.unwrap();
    assert_eq!(s.get_application(&app.id).await.unwrap().status, Status::Applied);

    // 自定义"复活评审"事件映射到面试中
    sqlx::query("INSERT INTO custom_event_type (id, label, projection) VALUES ('rv1', '复活评审', 'INTERVIEWING')")
        .execute(&s.pool).await.unwrap();
    s.add_event(AddEventInput {
        application_id: app.id.clone(),
        event_type: "custom:rv1".into(),
        occurred_at: Some(dt(9, 10)),
        deadline: None,
        result: None,
        note: None,
        source: None,
    }).await.unwrap();
    assert_eq!(s.get_application(&app.id).await.unwrap().status, Status::Interviewing);

    // 未登记的自定义类型应被拒绝
    let bad = s.add_event(AddEventInput {
        application_id: app.id.clone(),
        event_type: "custom:not-exist".into(),
        occurred_at: None,
        deadline: None,
        result: None,
        note: None,
        source: None,
    }).await;
    assert!(bad.is_err());
}

#[tokio::test]
async fn list_filter_and_search() {
    let (_dir, s) = setup().await;
    for (company, title, batch) in [
        ("美团", "运筹优化", "EARLY"),
        ("美团", "后端开发", "FORMAL"),
        ("拼多多", "服务端", "EARLY"),
    ] {
        let mut input = create_input(company, title);
        input.batch = Some(batch.into());
        s.create_application(input).await.unwrap();
    }

    let all = s.list_applications(&ListFilter::default()).await.unwrap();
    assert_eq!(all.len(), 3);
    assert!(all.iter().all(|i| !i.application.is_archived));

    let filtered = s.list_applications(&ListFilter {
        batches: vec!["EARLY".into()],
        ..Default::default()
    }).await.unwrap();
    assert_eq!(filtered.len(), 2);

    let searched = s.list_applications(&ListFilter {
        search: Some("运筹".into()),
        ..Default::default()
    }).await.unwrap();
    assert_eq!(searched.len(), 1);
    assert_eq!(searched[0].application.position_title, "运筹优化");

    // 测评邀请未过期 → next_deadline 出现
    let target = &filtered[0].application;
    s.add_event(AddEventInput {
        application_id: target.id.clone(),
        event_type: "ASSESSMENT_INVITED".into(),
        occurred_at: Some(Utc::now()),
        deadline: Some(Utc::now() + chrono::Duration::days(2)),
        result: None,
        note: None,
        source: None,
    }).await.unwrap();
    let with_deadline = s.list_applications(&ListFilter {
        statuses: vec!["ASSESSMENT".into()],
        ..Default::default()
    }).await.unwrap();
    assert_eq!(with_deadline.len(), 1);
    assert!(with_deadline[0].next_deadline.is_some(), "未过期 deadline 应出现在列表");
    assert_eq!(with_deadline[0].last_event_type.as_deref(), Some("ASSESSMENT_INVITED"));
}

#[tokio::test]
async fn detail_aggregates_everything() {
    let (_dir, s) = setup().await;
    let app = s.create_application(create_input("米哈游", "引擎开发")).await.unwrap();
    let iv = s.add_interview(AddInterviewInput {
        application_id: app.id.clone(),
        round: Some(1),
        round_label: Some("一面".into()),
        format: Some("ONSITE".into()),
        scheduled_at: Some(dt(7, 10)),
        duration_min: None,
        location_or_link: Some("望京".into()),
        interviewer_note: None,
        status: None,
        outcome: None,
    }).await.unwrap();
    for q in ["讲讲 epoll", "手撕 LRU", "C++ 虚函数表"] {
        s.add_question(AddQuestionInput {
            interview_id: iv.id.clone(),
            question: q.into(),
            my_answer: None,
            quality: Some((if q.contains("LRU") { "BAD" } else { "GOOD" }).to_string()),
            reflection: None,
            tags: if q.contains("LRU") { vec!["操作系统".into()] } else { vec!["C++".into()] },
        }).await.unwrap();
    }
    let detail = s.get_application_detail(&app.id).await.unwrap();
    // 面试不是事件：只有创建时的 1 条 APPLIED
    assert_eq!(detail.events.len(), 1);
    assert_eq!(detail.events[0].event_type, "APPLIED");
    assert_eq!(detail.interviews.len(), 1);
    assert_eq!(detail.interviews[0].interview.round, 1);
    assert_eq!(detail.interviews[0].questions.len(), 3);
    assert_eq!(detail.interviews[0].interview.question_count, 3);
    assert_eq!(detail.application.status, Status::Interviewing);
}

#[tokio::test]
async fn question_crud_and_reorder() {
    let (_dir, s) = setup().await;
    let app = s.create_application(create_input("京东", "测试开发")).await.unwrap();
    let iv = s.add_interview(AddInterviewInput {
        application_id: app.id.clone(),
        round: Some(1),
        round_label: None, format: None, scheduled_at: Some(dt(7, 10)),
        duration_min: None, location_or_link: None, interviewer_note: None,
        status: None, outcome: None,
    }).await.unwrap();

    let q1 = s.add_question(AddQuestionInput {
        interview_id: iv.id.clone(), question: "第一题".into(),
        my_answer: None, quality: Some("UNKNOWN".into()), reflection: None, tags: vec![],
    }).await.unwrap();
    let q2 = s.add_question(AddQuestionInput {
        interview_id: iv.id.clone(), question: "第二题".into(),
        my_answer: None, quality: Some("GOOD".into()), reflection: None, tags: vec!["网络".into()],
    }).await.unwrap();
    assert_eq!((q1.ordinal, q2.ordinal), (1, 2));

    // 拖拽交换顺序
    s.reorder_questions(&[q2.id.clone(), q1.id.clone()]).await.unwrap();
    let detail = s.get_application_detail(&app.id).await.unwrap();
    let qs = &detail.interviews[0].questions;
    assert_eq!(qs[0].question, "第二题");
    assert_eq!(qs[0].ordinal, 1);

    // 更新与删除
    s.update_question(&q1.id, UpdateQuestionInput {
        quality: Some("BAD".into()),
        reflection: Some("没答上来，回去重看".into()),
        ..Default::default()
    }).await.unwrap();
    s.delete_question(&q2.id).await.unwrap();
    let detail2 = s.get_application_detail(&app.id).await.unwrap();
    assert_eq!(detail2.interviews[0].questions.len(), 1);
    assert_eq!(detail2.interviews[0].questions[0].quality, fyj_core::entities::QuestionQuality::Bad);
}

#[tokio::test]
async fn reorder_applications_persists_manual_order() {
    let (_dir, s) = setup().await;
    let a = s.create_application(create_input("公司甲", "岗A")).await.unwrap();
    let b = s.create_application(create_input("公司乙", "岗B")).await.unwrap();
    let c = s.create_application(create_input("公司丙", "岗C")).await.unwrap();

    // 默认：最新在前
    let list = s.list_applications(&Default::default()).await.unwrap();
    let names: Vec<String> = list.iter().map(|i| i.application.company_name.clone()).collect();
    assert_eq!(names, vec!["公司丙", "公司乙", "公司甲"]);

    // 手动拖成 乙→甲→丙
    s.reorder_applications(&[b.id.clone(), a.id.clone(), c.id.clone()]).await.unwrap();
    let list = s.list_applications(&Default::default()).await.unwrap();
    let names: Vec<String> = list.iter().map(|i| i.application.company_name.clone()).collect();
    assert_eq!(names, vec!["公司乙", "公司甲", "公司丙"]);
}

#[tokio::test]
async fn resume_crud_default_and_usage() {
    let (_dir, s) = setup().await;
    let r1 = s.insert_resume("算法岗版 v3", Some("算法"), "resume-v3.pdf", "/uploads/resumes/a.pdf", Some(1024), None).await.unwrap();
    let r2 = s.insert_resume("后端版 v1", Some("后端"), "resume-b1.pdf", "/uploads/resumes/b.pdf", None, None).await.unwrap();
    assert!(!r1.is_default);
    s.set_default_resume(&r2.id).await.unwrap();
    let list = s.list_resumes().await.unwrap();
    assert!(list.iter().find(|r| r.id == r2.id).unwrap().is_default);

    // 投递关联简历；删除简历后投递关联置空（FK SET NULL）
    let mut input = create_input("小红书", "算法");
    input.resume_version_id = Some(r1.id.clone());
    let app = s.create_application(input).await.unwrap();
    assert_eq!(app.resume_version_name.as_deref(), Some("算法岗版 v3"));
    s.delete_resume(&r1.id).await.unwrap();
    let after = s.get_application(&app.id).await.unwrap();
    assert_eq!(after.resume_version_id, None);
}

#[tokio::test]
async fn invalid_inputs_rejected() {
    let (_dir, s) = setup().await;
    let mut bad_channel = create_input("滴滴", "风控");
    bad_channel.channel = Some("不存在渠道".into());
    assert!(s.create_application(bad_channel).await.is_err());

    let mut empty_title = create_input("滴滴", " ");
    empty_title.position_title = " ".into();
    assert!(s.create_application(empty_title).await.is_err());

    let app = s.create_application(create_input("滴滴", "风控")).await.unwrap();
    let bad_event = s.add_event(AddEventInput {
        application_id: app.id.clone(),
        event_type: "NOT_A_TYPE".into(),
        occurred_at: None, deadline: None, result: None, note: None, source: None,
    }).await;
    assert!(bad_event.is_err());
}
