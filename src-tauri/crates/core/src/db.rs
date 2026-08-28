use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
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
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}
