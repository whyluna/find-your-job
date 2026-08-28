//! FindYourJob 领域层（core）
//!
//! 不依赖 Tauri：模型、状态机（derive_status）、服务与仓储都在这里，
//! Tauri command 与 P1 的 axum handler 只是薄封装。单测主战场。

pub mod db;
pub mod error;

pub use error::{Error, Result};
