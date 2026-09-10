use chrono::{Duration, Timelike, Utc};
use fyj_core::{csv_progress::ProgressSnapshot, db::init_pool, models::*, services::*};
use serde_json::json;

async fn setup() -> (tempfile::TempDir, Services) {
    let dir = tempfile::tempdir().unwrap();
    let pool = init_pool(&dir.path().join("test.db")).await.unwrap();
    (dir, Services::new(pool))
}
fn input(url: &str) -> CreateApplicationInput {
    serde_json::from_value(
        json!({"companyName":"流程测试公司","positionTitle":"工程师","applied":false,"jobUrl":url}),
    )
    .unwrap()
}
fn import_row(value: serde_json::Value) -> ApplicationImportRow {
    serde_json::from_value(value).unwrap()
}
fn t() -> chrono::DateTime<Utc> {
    Utc::now().with_nanosecond(0).unwrap()
}

#[tokio::test]
async fn url_dedupe_preserves_case_sensitive_paths_queries_and_slashes() {
    let (_dir, s) = setup().await;
    s.create_application(input("https://example.com/#/Jobs/A"))
        .await
        .unwrap();
    assert!(s
        .find_duplicate_application(&input("https://example.com/#/Jobs/B"))
        .await
        .unwrap()
        .is_none());
    s.create_application(input("https://EXAMPLE.com/Jobs/AbC?token=XyZ#description"))
        .await
        .unwrap();
    assert!(s
        .find_duplicate_application(&input("HTTPS://example.COM:443/Jobs/AbC?token=XyZ#apply"))
        .await
        .unwrap()
        .is_some());
    for url in [
        "https://example.com/jobs/AbC?token=XyZ",
        "https://example.com/Jobs/abc?token=XyZ",
        "https://example.com/Jobs/AbC?token=xyz",
        "https://example.com/Jobs/AbC/?token=XyZ",
    ] {
        assert!(
            s.find_duplicate_application(&input(url))
                .await
                .unwrap()
                .is_none(),
            "{url}"
        );
    }
    let mut row = import_row(
        json!({"rowNumber":2,"companyName":"流程测试公司","positionTitle":"工程师","jobUrl":"https://example.com/Jobs/AbC?token=xyz"}),
    );
    assert_eq!(
        s.preview_application_import(std::slice::from_ref(&row))
            .await
            .unwrap()
            .ready,
        1
    );
    row.input.job_url = Some("https://example.com/Jobs/AbC?token=XyZ".into());
    assert_eq!(
        s.preview_application_import(&[row])
            .await
            .unwrap()
            .duplicates,
        1
    );
}

#[tokio::test]
async fn plans_validate_partial_updates_clear_and_stop_after_submission() {
    let (_dir, s) = setup().await;
    let now = t();
    let mut i = input("https://example.com/plan");
    i.planned_apply_at = Some(now - Duration::hours(1));
    i.application_deadline = Some(now + Duration::hours(2));
    let app = s.create_application(i).await.unwrap();
    let upcoming = s.get_upcoming(3, 7).await.unwrap();
    assert_eq!(upcoming.len(), 2);
    assert_eq!(upcoming[0].kind, "planned_apply");
    let calendar = s
        .get_calendar_items(now - Duration::days(1), now + Duration::days(1))
        .await
        .unwrap();
    assert_eq!(calendar.len(), 2);
    assert!(s
        .update_application(
            &app.id,
            UpdateApplicationInput {
                planned_apply_at: Some(Some(now + Duration::days(2))),
                ..Default::default()
            }
        )
        .await
        .is_err());
    assert_eq!(
        s.get_application(&app.id).await.unwrap().planned_apply_at,
        app.planned_apply_at
    );
    s.set_archived(&app.id, true).await.unwrap();
    assert!(s.get_upcoming(3, 7).await.unwrap().is_empty());
    s.set_archived(&app.id, false).await.unwrap();
    s.confirm_application(
        &app.id,
        ConfirmApplicationInput {
            applied_at: now,
            channel: "BOSS".into(),
            batch: "FORMAL".into(),
            resume_version_id: None,
            note: None,
        },
    )
    .await
    .unwrap();
    assert!(s.get_upcoming(3, 7).await.unwrap().is_empty());
    assert!(s
        .get_calendar_items(now - Duration::days(1), now + Duration::days(1))
        .await
        .unwrap()
        .iter()
        .all(|i| i.kind == "applied"));
    let cleared: UpdateApplicationInput =
        serde_json::from_value(json!({"plannedApplyAt":null,"applicationDeadline":null})).unwrap();
    let app = s.update_application(&app.id, cleared).await.unwrap();
    assert_eq!(app.planned_apply_at, None);
    assert_eq!(app.application_deadline, None);
}

#[tokio::test]
async fn migration_preserves_legacy_rows_and_can_run_twice() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old.db");
    let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0001_init.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO company (id, name) VALUES ('old','旧公司')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO application (id,company_id,position_title) VALUES ('old','old','旧岗位')",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;
    for _ in 0..2 {
        let pool = init_pool(&path).await.unwrap();
        let app = Services::new(pool.clone())
            .get_application("old")
            .await
            .unwrap();
        assert_eq!(app.position_title, "旧岗位");
        assert_eq!(app.planned_apply_at, None);
        pool.close().await;
    }
}

#[tokio::test]
async fn native_csv_roundtrip_restores_full_interviews_questions_customs_and_plans() {
    let (dir, s) = setup().await;
    let now = t();
    let mut i = input("https://example.com/roundtrip");
    i.applied = Some(true);
    i.applied_date = Some(now - Duration::days(3));
    i.planned_apply_at = Some(now - Duration::days(4));
    i.application_deadline = Some(now + Duration::days(1));
    i.jd_text = Some("第一行,含\"引号\"\n第二行".into());
    let app = s.create_application(i).await.unwrap();
    let iv = s.add_interview(serde_json::from_value(json!({"applicationId":app.id,"round":1,"scheduledAt":now-Duration::days(2),"status":"COMPLETED","outcome":"PASS","roundLabel":"技术面"})).unwrap()).await.unwrap();
    s.add_question(serde_json::from_value(json!({"interviewId":iv.id,"question":"注意力,如何计算？\n$QK^T$","myAnswer":"回答","quality":"GOOD","reflection":"理想回答","tags":["算法"]})).unwrap()).await.unwrap();
    s.add_interview(serde_json::from_value(json!({"applicationId":app.id,"round":2,"scheduledAt":now+Duration::days(1),"roundLabel":"终面"})).unwrap()).await.unwrap();
    sqlx::query("INSERT INTO custom_event_type (id,label,projection) VALUES ('custom-note','自定义备注','NO_CHANGE')").execute(&s.pool).await.unwrap();
    s.add_event(serde_json::from_value(json!({"applicationId":app.id,"type":"custom:custom-note","occurredAt":now,"note":"备注"})).unwrap()).await.unwrap();
    s.set_archived(&app.id, true).await.unwrap();
    let path = dir.path().join("roundtrip.csv");
    s.export_csv(path.to_str().unwrap()).await.unwrap();
    let mut reader = csv::Reader::from_path(&path).unwrap();
    let headers = reader.headers().unwrap().clone();
    let record = reader.records().next().unwrap().unwrap();
    let get = |name: &str| {
        record
            .get(headers.iter().position(|h| h == name).unwrap())
            .unwrap()
    };
    let row = import_row(
        json!({"rowNumber":2,"companyName":get("公司"),"positionTitle":get("岗位"),"jobUrl":get("岗位链接"),"jdText":get("JD文本"),"progressData":get("流程数据"),"importStatus":get("当前状态"),"appliedDate":get("投递日期"),"plannedApplyAt":get("计划投递时间"),"applicationDeadline":get("网申截止时间")}),
    );
    let (_newdir, target) = setup().await;
    assert_eq!(
        target
            .preview_application_import(std::slice::from_ref(&row))
            .await
            .unwrap()
            .ready,
        1
    );
    target
        .import_application_rows(vec![row], true)
        .await
        .unwrap();
    let restored = target
        .list_applications(&ListFilter {
            include_archived: Some(true),
            ..Default::default()
        })
        .await
        .unwrap()
        .remove(0);
    let detail = target
        .get_application_detail(&restored.application.id)
        .await
        .unwrap();
    assert_eq!(detail.application.status, Status::Interviewing);
    assert!(detail.application.is_archived);
    assert_eq!(detail.application.planned_apply_at, app.planned_apply_at);
    assert_eq!(
        detail.application.jd_text.as_deref(),
        Some("第一行,含\"引号\"\n第二行")
    );
    assert_eq!(detail.interviews.len(), 2);
    let first = detail
        .interviews
        .iter()
        .find(|i| i.interview.round == 1)
        .unwrap();
    assert_eq!(first.interview.outcome, InterviewOutcome::Pass);
    assert_eq!(first.questions[0].question, "注意力,如何计算？\n$QK^T$");
    assert_eq!(first.questions[0].reflection.as_deref(), Some("理想回答"));
    assert_eq!(detail.events.len(), 2);
    assert!(detail
        .events
        .iter()
        .any(|e| e.event_type.starts_with("custom:") && e.event_type != "custom:custom-note"));
}

#[tokio::test]
async fn invalid_snapshot_is_reported_before_any_import_and_unknown_version_rejected() {
    let (_dir, s) = setup().await;
    let valid = import_row(json!({"rowNumber":2,"companyName":"有效","positionTitle":"岗位"}));
    let broken = import_row(
        json!({"rowNumber":3,"companyName":"损坏","positionTitle":"岗位","progressData":"{broken"}),
    );
    assert_eq!(
        s.preview_application_import(&[valid.clone(), broken.clone()])
            .await
            .unwrap()
            .invalid,
        1
    );
    assert!(s
        .import_application_rows(vec![valid, broken], true)
        .await
        .is_err());
    assert!(s
        .list_applications(&Default::default())
        .await
        .unwrap()
        .is_empty());
    let app = s
        .create_application(input("https://example.com/snapshot"))
        .await
        .unwrap();
    let mut tx = s.pool.begin().await.unwrap();
    let mut snapshot = ProgressSnapshot::capture(&mut tx, &app.id).await.unwrap();
    snapshot.version = 999;
    assert!(ProgressSnapshot::parse(&serde_json::to_string(&snapshot).unwrap()).is_err());
    snapshot.version = 1;
    snapshot.status = Status::Offer;
    assert!(snapshot.validate().is_err());
}

#[tokio::test]
async fn legacy_csv_migrates_all_states_and_keeps_missing_history_explicit() {
    let (_dir, s) = setup().await;
    let now = t();
    for (n, status) in [
        "SAVED",
        "APPLIED",
        "ASSESSMENT",
        "WRITTEN",
        "INTERVIEWING",
        "OC",
        "INTENT",
        "OFFER",
        "SIGNED",
        "REJECTED",
        "WITHDRAWN",
    ]
    .iter()
    .enumerate()
    {
        let row = import_row(
            json!({"rowNumber":n+2,"companyName":"状态迁移","positionTitle":status,"importStatus":status,"appliedDate":if *status=="SAVED"{None}else{Some(now-Duration::days(1))},"stageAt":now,"interviewRounds":if *status=="INTERVIEWING"{2}else{0}}),
        );
        assert_eq!(
            s.preview_application_import(std::slice::from_ref(&row))
                .await
                .unwrap()
                .ready,
            1,
            "{status}"
        );
        s.import_application_rows(vec![row], true).await.unwrap();
        let app = s
            .list_applications(&ListFilter {
                search: Some(status.to_string()),
                ..Default::default()
            })
            .await
            .unwrap()
            .remove(0);
        assert_eq!(app.application.status, Status::parse(status).unwrap());
        if *status == "INTERVIEWING" {
            assert_eq!(app.max_interview_round, 2);
        }
    }
}
