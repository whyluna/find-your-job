/** 邮件解析全链路：.eml 导入 → 规则建议 → 人工审核 → 事件写入（P2-c 验收） */
use fyj_core::db::init_pool;
use fyj_core::services::*;

#[tokio::test]
async fn eml_import_review_and_event() {
    let dir = tempfile::tempdir().unwrap();
    let pool = init_pool(&dir.path().join("t.db")).await.unwrap();
    let s = Services::new(pool.clone());

    // 前置：建公司（官网域名匹配用）+ 投递
    let app = s
        .create_application(CreateApplicationInput {
            company_name: "腾讯".into(),
            company_website: Some("careers.qq.com".into()),
            company_careers_url: None,
            position_title: "后端开发".into(),
            department: None,
            work_location: None,
            channel: None,
            batch: None,
            priority: None,
            applied: Some(true),
            applied_date: None,
            job_url: None,
            jd_text: None,
            salary_range: None,
            tags: vec![],
            resume_version_id: None,
            notes: None,
        })
        .await
        .unwrap();

    // 构造 .eml
    let eml_path = dir.path().join("invite.eml");
    std::fs::write(
        &eml_path,
        "Message-ID: <abc-123@careers.qq.com>\r\n\
         From: \"Tencent Campus\" <no-reply@careers.qq.com>\r\n\
         To: me@example.com\r\n\
         Subject: =?UTF-8?B?6K+36LSoMuOAgVRhbGVudOeOsHdlaWNlaW5n?=\r\n\
         Date: Sat, 29 Aug 2026 10:00:00 +0800\r\n\
         Content-Type: text/plain; charset=UTF-8\r\n\
         \r\n\
         您好，请于 9月5日 前完成在线测评，链接 3 天内有效。\r\n",
    )
    .unwrap();

    // 导入（account_id 用固定占位——.eml 手动导入场景）
    let log_id = s.import_eml("manual", eml_path.to_str().unwrap()).await.unwrap();
    assert!(log_id.is_some(), "应产出待审核记录");

    // 去重：再导入同一封 → None
    let dup = s.import_eml("manual", eml_path.to_str().unwrap()).await.unwrap();
    assert!(dup.is_none());

    // 待审核列表：建议 = 测评邀请 + 公司命中
    let pending = s.list_mail_logs(Some("PENDING")).await.unwrap();
    assert_eq!(pending.len(), 1);
    let log = &pending[0];
    assert_eq!(log.suggested_event_type.as_deref(), Some("ASSESSMENT_INVITED"));
    assert!(log.subject.contains("Talent"),"主题应解码: {}", log.subject);
    assert_eq!(log.suggested_deadline.as_deref(), Some("2026-09-05"));
    assert!(log.match_reason.as_deref().unwrap_or("").contains("公司库"));

    // 候选投递（公司名匹配）
    let candidates = s.candidate_applications("腾讯").await.unwrap();
    assert_eq!(candidates.len(), 1);

    // 确认导入 → 事件写入 + 状态流转
    s.decide_mail(log.id.as_str(), "import", &app.id).await.unwrap();
    let after = s.get_application(&app.id).await.unwrap();
    assert_eq!(after.status, fyj_core::models::Status::Assessment);
    let logs = s.list_mail_logs(Some("IMPORTED")).await.unwrap();
    assert_eq!(logs.len(), 1);

    // 事件 source 应为 EMAIL
    let detail = s.get_application_detail(&app.id).await.unwrap();
    let mail_event = detail
        .events
        .iter()
        .find(|e| e.source == fyj_core::entities::EventSource::Email)
        .expect("应有 EMAIL 来源事件");
    assert_eq!(mail_event.event_type, "ASSESSMENT_INVITED");

    // 忽略路径
    let eml2 = dir.path().join("noise.eml");
    std::fs::write(
        &eml2,
        "Message-ID: <x-2@mall.example.com>\r\n\
         From: mall@example.com\r\n\
         Subject: shuangshiyi\r\n\
         Date: Sat, 29 Aug 2026 11:00:00 +0800\r\n\
         \r\n\
         全场五折\r\n",
    )
    .unwrap();
    let noise = s.import_eml("manual", eml2.to_str().unwrap()).await.unwrap();
    // 无规则命中仍入库（PENDING 但无建议）→ 忽略
    let pending2 = s.list_mail_logs(Some("PENDING")).await.unwrap();
    let noise_log = pending2.iter().find(|l| l.subject == "shuangshiyi").unwrap();
    assert!(noise_log.suggested_event_type.is_none());
    s.decide_mail(noise_log.id.as_str(), "ignore", "").await.unwrap();
    let ignored = s.list_mail_logs(Some("IGNORED")).await.unwrap();
    assert_eq!(ignored.len(), 1);
    assert!(noise.is_some());
}
