use chrono::{Duration, Utc};
use fyj_core::{
    backup,
    company_watch::*,
    db::init_pool,
    services::{ListFilter, Services},
};
use serde_json::{json, Value};

async fn setup() -> (tempfile::TempDir, Services) {
    let dir = tempfile::tempdir().unwrap();
    let pool = init_pool(&dir.path().join("watch.db")).await.unwrap();
    (dir, Services::new(pool))
}
fn follow(name: &str) -> FollowCompanyInput {
    serde_json::from_value(json!({"companyName":name,"year":2027,"season":"AUTUMN","status":"UNKNOWN","intervalDays":7,"nextCheckAt": (Utc::now()-Duration::days(1)).to_rfc3339(),"careersUrl":"https://careers.example.com/","targetRole":"研发","notes":"等待本届公告"})).unwrap()
}
fn action(kind: &str, status: Option<&str>) -> WatchActionInput {
    WatchActionInput {
        action: kind.into(),
        status: status.map(str::to_owned),
        days: Some(3),
        note: Some("人工确认".into()),
        evidence_url: Some("https://example.com/campus/2027".into()),
    }
}
fn config(w: &CompanyWatch) -> WatchConfig {
    serde_json::from_value(serde_json::to_value(w).unwrap()).unwrap()
}

#[tokio::test]
async fn standalone_follow_deduplicates_without_touching_jobs_or_progress() {
    let (_dir, s) = setup().await;
    let first = s.follow_company(follow("测试研发公司")).await.unwrap();
    assert!(first.created);
    assert!(first.watch.last_checked_at.is_none());
    assert_eq!(
        s.list_applications(&ListFilter::default())
            .await
            .unwrap()
            .len(),
        0
    );
    assert_eq!(s.get_stats().await.unwrap().wishlist_count, 0);
    let mut duplicate = follow("测试研发公司");
    duplicate.config.status = "OPEN".into();
    duplicate.careers_url = Some("https://wrong.example.com".into());
    let second = s.follow_company(duplicate).await.unwrap();
    assert!(!second.created);
    assert_eq!(first.watch.id, second.watch.id);
    assert_eq!(second.watch.status, "UNKNOWN");
    assert_eq!(second.watch.next_check_at, first.watch.next_check_at);
    assert_eq!(second.watch.careers_url, first.watch.careers_url);
    assert_eq!(
        s.list_company_watch_checks(&first.watch.id)
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn company_alias_links_future_jobs_but_shared_domains_do_not_merge_companies() {
    let (_dir, s) = setup().await;
    let company = s
        .upsert_company(
            "示例科技股份有限公司",
            Some("https://www.example.com"),
            None,
        )
        .await
        .unwrap();
    sqlx::query("UPDATE company SET aliases='[\"示例科技\"]',notes='保留公司资料' WHERE id=?")
        .bind(&company.id)
        .execute(&s.pool)
        .await
        .unwrap();
    let w = s.follow_company(follow("示例科技")).await.unwrap().watch;
    assert_eq!(w.company_id, company.id);
    assert_eq!(w.company_name, company.name);
    let app = s
        .create_application(
            serde_json::from_value(
                json!({"companyName":"示例科技","positionTitle":"软件工程师","applied":false}),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(app.company_id, company.id);
    let other = s.follow_company(follow("另一家公司")).await.unwrap().watch;
    assert_ne!(other.company_id, w.company_id);
    assert_eq!(other.careers_url, w.careers_url);
    let jobs = s
        .list_applications(&ListFilter {
            company_id: Some(w.company_id.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].application.id, app.id);
    assert_eq!(
        s.get_company(&company.id).await.unwrap().notes.as_deref(),
        Some("保留公司资料")
    );
}

#[tokio::test]
async fn ambiguous_alias_requires_explicit_company_and_invalid_input_is_atomic() {
    let (_dir, s) = setup().await;
    let a = s.upsert_company("甲公司", None, None).await.unwrap();
    let b = s.upsert_company("乙公司", None, None).await.unwrap();
    for id in [&a.id, &b.id] {
        sqlx::query("UPDATE company SET aliases='[\"共同简称\"]' WHERE id=?")
            .bind(id)
            .execute(&s.pool)
            .await
            .unwrap();
    }
    assert!(s.follow_company(follow("共同简称")).await.is_err());
    let mut chosen = follow("共同简称");
    chosen.company_id = Some(a.id.clone());
    assert_eq!(
        s.follow_company(chosen).await.unwrap().watch.company_id,
        a.id
    );
    for field in [
        "status",
        "year",
        "intervalDays",
        "careersUrl",
        "nextCheckAt",
    ] {
        let mut value = serde_json::to_value(follow_config_value()).unwrap();
        value["companyName"] = json!("不应创建");
        value[field] = match field {
            "year" => json!(9999),
            "intervalDays" => json!(0),
            "careersUrl" => json!("javascript:alert(1)"),
            _ => json!("INVALID"),
        };
        let input: FollowCompanyInput = serde_json::from_value(value).unwrap();
        assert!(s.follow_company(input).await.is_err(), "{field}");
    }
    assert_eq!(s.list_companies().await.unwrap().len(), 2);
}
fn follow_config_value() -> Value {
    json!({"companyName":"示例","year":2027,"season":"AUTUMN","status":"UNKNOWN","intervalDays":7})
}

#[tokio::test]
async fn seasons_are_independent_and_cannot_overwrite_prior_cycle() {
    let (_dir, s) = setup().await;
    let old = s.follow_company(follow("跨届公司")).await.unwrap().watch;
    s.act_on_company_watch(&old.id, action("CHECK", Some("CLOSED")))
        .await
        .unwrap();
    let mut next = follow("跨届公司");
    next.config.year = 2028;
    let new = s.follow_company(next).await.unwrap().watch;
    assert_ne!(new.id, old.id);
    assert_eq!(new.status, "UNKNOWN");
    assert_eq!(s.get_company_watch(&old.id).await.unwrap().status, "CLOSED");
    let mut illegal = config(&old);
    illegal.year = 2029;
    assert!(s.update_company_watch(&old.id, illegal).await.is_err());
}

#[tokio::test]
async fn check_snooze_pause_resume_and_close_have_distinct_effects() {
    let (_dir, s) = setup().await;
    let w = s
        .follow_company(follow("流程测试公司"))
        .await
        .unwrap()
        .watch;
    assert!(s
        .get_company_watch(&w.id)
        .await
        .unwrap()
        .last_checked_at
        .is_none());
    let checked = s
        .act_on_company_watch(&w.id, action("CHECK", Some("NOT_OPEN")))
        .await
        .unwrap();
    assert!(checked.last_checked_at.is_some());
    assert!(
        checked.next_check_at.as_deref().unwrap() > checked.last_checked_at.as_deref().unwrap()
    );
    let snoozed = s
        .act_on_company_watch(&w.id, action("SNOOZE", None))
        .await
        .unwrap();
    assert_eq!(snoozed.last_checked_at, checked.last_checked_at);
    assert!(snoozed.next_check_at < checked.next_check_at);
    let paused = s
        .act_on_company_watch(&w.id, action("PAUSE", None))
        .await
        .unwrap();
    assert!(paused.paused && paused.next_check_at.is_none());
    assert!(s
        .act_on_company_watch(&w.id, action("CHECK", Some("OPEN")))
        .await
        .is_err());
    let resumed = s
        .act_on_company_watch(&w.id, action("RESUME", None))
        .await
        .unwrap();
    assert!(!resumed.paused && resumed.next_check_at.is_some());
    assert_eq!(resumed.last_checked_at, checked.last_checked_at);
    let closed = s
        .act_on_company_watch(&w.id, action("CHECK", Some("CLOSED")))
        .await
        .unwrap();
    assert!(closed.next_check_at.is_none());
    assert!(s
        .act_on_company_watch(&w.id, action("SNOOZE", None))
        .await
        .is_err());
    let history = s.list_company_watch_checks(&w.id).await.unwrap();
    assert_eq!(history.len(), 6);
    assert_eq!(
        history[0].evidence_url.as_deref(),
        Some("https://example.com/campus/2027")
    );
}

#[tokio::test]
async fn one_time_and_disabled_reminders_do_not_restart_themselves() {
    let (_dir, s) = setup().await;
    let mut input = follow("一次提醒公司");
    input.config.interval_days = None;
    let w = s.follow_company(input).await.unwrap().watch;
    let checked = s
        .act_on_company_watch(&w.id, action("CHECK", Some("OPEN")))
        .await
        .unwrap();
    assert!(checked.next_check_at.is_none());
    let mut edit = config(&checked);
    edit.next_check_at = None;
    edit.interval_days = None;
    assert!(s
        .update_company_watch(&w.id, edit)
        .await
        .unwrap()
        .next_check_at
        .is_none());
    assert!(s
        .act_on_company_watch(&w.id, action("SNOOZE", None))
        .await
        .unwrap()
        .next_check_at
        .is_some());
}

#[tokio::test]
async fn concurrent_follow_creates_exactly_one_company_cycle() {
    let (_dir, s) = setup().await;
    let (a, b) = tokio::join!(
        s.follow_company(follow("并发公司")),
        s.follow_company(follow("并发公司"))
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.watch.id, b.watch.id);
    assert_ne!(a.created, b.created);
    assert_eq!(s.list_companies().await.unwrap().len(), 1);
}

#[tokio::test]
async fn backup_v3_roundtrip_and_v2_import_are_safe() {
    let (dir, s) = setup().await;
    let w = s.follow_company(follow("备份公司")).await.unwrap().watch;
    s.act_on_company_watch(&w.id, action("CHECK", Some("NOT_OPEN")))
        .await
        .unwrap();
    let path = dir.path().join("backup.json");
    backup::export_to_json(&s.pool, &path).await.unwrap();
    let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["version"], 3);
    s.delete_company_watch(&w.id).await.unwrap();
    backup::import_from_json(&s.pool, &path, dir.path())
        .await
        .unwrap();
    assert_eq!(s.get_company_watch(&w.id).await.unwrap().status, "NOT_OPEN");
    assert_eq!(s.list_company_watch_checks(&w.id).await.unwrap().len(), 2);
    let mut broken = value.clone();
    broken["tables"]
        .as_object_mut()
        .unwrap()
        .remove("company_watch");
    std::fs::write(&path, serde_json::to_vec(&broken).unwrap()).unwrap();
    assert!(backup::import_from_json(&s.pool, &path, dir.path())
        .await
        .is_err());
    assert_eq!(s.list_company_watches().await.unwrap().len(), 1);
    let mut legacy = value;
    legacy["version"] = json!(2);
    for table in ["company_watch", "company_watch_check"] {
        legacy["tables"].as_object_mut().unwrap().remove(table);
    }
    std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    backup::import_from_json(&s.pool, &path, dir.path())
        .await
        .unwrap();
    assert!(s.list_company_watches().await.unwrap().is_empty());
    assert_eq!(s.list_companies().await.unwrap().len(), 1);
}

#[tokio::test]
async fn migration_is_repeatable_and_watch_deletion_preserves_company_and_jobs() {
    let (dir, s) = setup().await;
    let company = s.upsert_company("迁移公司", None, None).await.unwrap();
    sqlx::raw_sql("DROP TABLE company_watch_check; DROP TABLE company_watch;")
        .execute(&s.pool)
        .await
        .unwrap();
    s.pool.close().await;
    let pool = init_pool(&dir.path().join("watch.db")).await.unwrap();
    pool.close().await;
    let s = Services::new(init_pool(&dir.path().join("watch.db")).await.unwrap());
    let w = s.follow_company(follow("迁移公司")).await.unwrap().watch;
    assert_eq!(w.company_id, company.id);
    let app = s
        .create_application(
            serde_json::from_value(json!({"companyName":"迁移公司","positionTitle":"研发工程师"}))
                .unwrap(),
        )
        .await
        .unwrap();
    s.delete_company_watch(&w.id).await.unwrap();
    assert_eq!(
        s.get_application(&app.id).await.unwrap().company_id,
        company.id
    );
    assert!(s.list_company_watch_checks(&w.id).await.is_err());
    assert!(s.delete_company(&company.id).await.is_err());
}
