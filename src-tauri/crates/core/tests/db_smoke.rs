use fyj_core::db::init_pool;

/// 迁移建全 16 张表（含公司关注/查看历史）、字典种子正确、重复初始化幂等。
#[tokio::test]
async fn migrations_create_all_tables_and_seed_dictionaries() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let pool = init_pool(&db_path).await.expect("init pool");

    let tables: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master \
         WHERE type = 'table' AND name NOT IN ('_sqlx_migrations') \
         AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tables, 16, "应有 16 张业务表");
    let watch_tables: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('company_watch','company_watch_check')").fetch_one(&pool).await.unwrap();
    assert_eq!(watch_tables, 2);

    let dict_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dictionary")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(dict_rows, 25, "种子：9 渠道 + 7 批次 + 9 轮次标签");

    let settings: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM setting")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(settings, 3, "onboarded / scenario_template / board_columns");

    // 外键约束应已开启
    let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fk, 1);

    drop(pool);
    // 二次初始化幂等（不重复插入种子、不报错）
    let pool2 = init_pool(&db_path)
        .await
        .expect("re-init should be idempotent");
    let dict2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dictionary")
        .fetch_one(&pool2)
        .await
        .unwrap();
    assert_eq!(dict2, 25);
}
