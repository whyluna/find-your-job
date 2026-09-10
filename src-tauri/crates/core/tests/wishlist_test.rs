use chrono::{Duration, Utc};
use fyj_core::{db::init_pool, models::Status, services::*};

async fn setup() -> (tempfile::TempDir, Services) {
    let dir = tempfile::tempdir().unwrap();
    let pool = init_pool(&dir.path().join("wishlist.db")).await.unwrap();
    (dir, Services::new(pool))
}

async fn wishlist(s: &Services) -> fyj_core::entities::Application {
    s.create_application(
        serde_json::from_value(serde_json::json!({
            "companyName": "虚构意向公司", "positionTitle": "工程师", "applied": false,
            "jobUrl": "https://example.com/jobs/42", "jdText": "准备简历", "tags": ["重点关注"]
        }))
        .unwrap(),
    )
    .await
    .unwrap()
}

fn confirmation() -> ConfirmApplicationInput {
    ConfirmApplicationInput {
        applied_at: Utc::now() - Duration::days(1),
        channel: "REFERRAL".into(),
        batch: "EARLY".into(),
        resume_version_id: None,
        note: Some("内推已提交".into()),
    }
}

fn event(id: &str, kind: &str) -> AddEventInput {
    AddEventInput {
        application_id: id.into(),
        event_type: kind.into(),
        occurred_at: Some(Utc::now() - Duration::days(30)),
        deadline: None,
        result: None,
        note: Some("准备事项".into()),
        source: None,
    }
}

#[tokio::test]
async fn wishlist_confirmation_preserves_materials_and_records_one_application() {
    let (dir, s) = setup().await;
    let app = wishlist(&s).await;
    s.add_event(event(&app.id, "NOTE")).await.unwrap();
    let resume = s
        .insert_resume("正式简历", None, "test.pdf", "test.pdf", None, None)
        .await
        .unwrap();
    let mut input = confirmation();
    input.resume_version_id = Some(resume.id.clone());
    let applied_at = input.applied_at;
    let confirmed = s.confirm_application(&app.id, input.clone()).await.unwrap();
    assert_eq!(confirmed.id, app.id);
    assert_eq!(confirmed.status, Status::Applied);
    assert_eq!(confirmed.applied_date, Some(applied_at));
    assert_eq!(confirmed.channel, "REFERRAL");
    assert_eq!(confirmed.batch, "EARLY");
    assert_eq!(confirmed.resume_version_id, Some(resume.id));
    assert_eq!(confirmed.job_url, app.job_url);
    assert_eq!(confirmed.jd_text, app.jd_text);
    assert_eq!(confirmed.tags, app.tags);
    assert!(s.confirm_application(&app.id, input).await.is_err());
    let reopened = Services::new(init_pool(&dir.path().join("wishlist.db")).await.unwrap());
    let detail = reopened.get_application_detail(&app.id).await.unwrap();
    assert_eq!(detail.events.len(), 2);
    let applied = detail
        .events
        .iter()
        .find(|e| e.event_type == "APPLIED")
        .unwrap();
    assert_eq!(applied.note.as_deref(), Some("内推已提交"));
    assert_eq!(detail.application.status, Status::Applied);
    s.delete_event(&applied.id).await.unwrap();
    assert_eq!(
        s.get_application(&app.id).await.unwrap().status,
        Status::Saved
    );
}

#[tokio::test]
async fn wishlist_confirmation_rolls_back_metadata_if_event_write_fails() {
    let (_dir, s) = setup().await;
    let app = wishlist(&s).await;
    sqlx::query("CREATE TRIGGER fail_event BEFORE INSERT ON application_event BEGIN SELECT RAISE(ABORT, 'simulated failure'); END")
        .execute(&s.pool).await.unwrap();
    assert!(s
        .confirm_application(&app.id, confirmation())
        .await
        .is_err());
    let after = s.get_application(&app.id).await.unwrap();
    assert_eq!(after.status, Status::Saved);
    assert_eq!(after.applied_date, None);
    assert_eq!(after.channel, app.channel);
    assert_eq!(after.batch, app.batch);
    assert!(s
        .get_application_detail(&app.id)
        .await
        .unwrap()
        .events
        .is_empty());
}

#[tokio::test]
async fn wishlist_confirmation_rejects_future_archived_and_missing_resume() {
    let (_dir, s) = setup().await;
    let app = wishlist(&s).await;
    let mut future = confirmation();
    future.applied_at = Utc::now() + Duration::days(1);
    assert!(s.confirm_application(&app.id, future).await.is_err());
    let mut invalid = confirmation();
    invalid.resume_version_id = Some("missing-resume".into());
    assert!(s.confirm_application(&app.id, invalid).await.is_err());
    s.set_archived(&app.id, true).await.unwrap();
    assert!(s
        .confirm_application(&app.id, confirmation())
        .await
        .is_err());
    assert!(s
        .get_application_detail(&app.id)
        .await
        .unwrap()
        .events
        .is_empty());
    s.set_archived(&app.id, false).await.unwrap();
    assert!(s.confirm_application(&app.id, confirmation()).await.is_ok());
}

#[tokio::test]
async fn wishlist_cannot_skip_submission_via_interview_or_offer() {
    let (_dir, s) = setup().await;
    let app = wishlist(&s).await;
    for kind in [
        "ASSESSMENT_INVITED",
        "WRITTEN_INVITED",
        "OC",
        "OFFER",
        "TRIPLICATE",
    ] {
        assert!(s.add_event(event(&app.id, kind)).await.is_err(), "{kind}");
    }
    let interview: AddInterviewInput =
        serde_json::from_value(serde_json::json!({"applicationId": app.id})).unwrap();
    assert!(s.add_interview(interview).await.is_err());
    assert_eq!(
        s.get_application(&app.id).await.unwrap().status,
        Status::Saved
    );
}

#[tokio::test]
async fn wishlist_and_unsubmitted_withdrawals_do_not_inflate_statistics() {
    let (_dir, s) = setup().await;
    let app = wishlist(&s).await;
    let resume = s
        .insert_resume("准备中的简历", None, "test.pdf", "test.pdf", None, None)
        .await
        .unwrap();
    s.update_application(
        &app.id,
        UpdateApplicationInput {
            resume_version_id: Some(Some(resume.id)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    s.add_event(event(&app.id, "HR_CONTACT")).await.unwrap();
    s.add_event(event(&app.id, "NOTE")).await.unwrap();
    let abandoned = wishlist(&s).await;
    s.add_event(event(&abandoned.id, "WITHDRAWN"))
        .await
        .unwrap();
    let stats = s.get_stats().await.unwrap();
    assert_eq!(stats.wishlist_count, 1);
    assert!(stats.status_counts.is_empty());
    assert!(stats.channel_counts.is_empty());
    assert!(stats.batch_counts.is_empty());
    assert!(stats.silent.is_empty());
    assert!(s
        .list_applications(&ListFilter {
            submitted_only: Some(true),
            ..Default::default()
        })
        .await
        .unwrap()
        .is_empty());
    assert!(stats.daily_applied.is_empty());
    assert!(stats.stage_reached_counts.iter().all(|r| r.count == 0));
    assert_eq!(stats.resume_funnel[0].total, 0);
    s.confirm_application(&app.id, confirmation())
        .await
        .unwrap();
    let stats = s.get_stats().await.unwrap();
    assert_eq!(
        stats
            .stage_reached_counts
            .iter()
            .find(|r| r.key == "APPLIED")
            .unwrap()
            .count,
        1
    );
    assert_eq!(stats.channel_counts[0].key, "REFERRAL");
    assert_eq!(stats.daily_applied.iter().map(|r| r.count).sum::<i64>(), 1);
    assert!(stats.silent.is_empty());
    let submitted = s
        .list_applications(&ListFilter {
            submitted_only: Some(true),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(submitted.len(), 1);
    assert_eq!(submitted[0].application.id, app.id);
}

#[tokio::test]
async fn simultaneous_confirmations_create_only_one_event() {
    let (_dir, s) = setup().await;
    let app = wishlist(&s).await;
    let (first, second) = tokio::join!(
        s.confirm_application(&app.id, confirmation()),
        s.confirm_application(&app.id, confirmation()),
    );
    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    assert_eq!(
        s.get_application_detail(&app.id)
            .await
            .unwrap()
            .events
            .len(),
        1
    );
}
