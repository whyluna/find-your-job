use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::str::FromStr;

use crate::Result;

/// 创建连接池并执行全部迁移（幂等）。
///
/// - WAL 提高读写并发；外键约束强制开启（SQLite 默认关闭）
/// - 时间统一存 ISO-8601 UTC 文本（见迁移文件列定义）
pub async fn init_pool(db_path: &Path) -> Result<SqlitePool> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let opts = SqliteConnectOptions::from_str(db_path.to_string_lossy().as_ref())?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await?;
    // 两个迁移均随二进制嵌入，运行时不依赖源码目录。
    // 0001 使用 IF NOT EXISTS / INSERT OR IGNORE，可安全重复执行。
    sqlx::raw_sql(include_str!("../migrations/0001_init.sql"))
        .execute(&pool)
        .await?;
    let columns = sqlx::query("PRAGMA table_info(application)")
        .fetch_all(&pool)
        .await?;
    let has_sort_order = columns.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "sort_order")
            .unwrap_or(false)
    });
    if !has_sort_order {
        sqlx::raw_sql(include_str!(
            "../migrations/0002_application_sort_order.sql"
        ))
        .execute(&pool)
        .await?;
    }
    Ok(pool)
}
