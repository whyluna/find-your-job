#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("数据库错误: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("迁移错误: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("数据不存在: {0}")]
    NotFound(String),

    #[error("参数不合法: {0}")]
    Invalid(String),

    #[error("{0}")]
    Msg(String),
}

pub type Result<T> = std::result::Result<T, Error>;
