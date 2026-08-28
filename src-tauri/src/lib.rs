use std::sync::Arc;

use sqlx::SqlitePool;
use tauri::Manager;

pub struct DbState(pub Arc<SqlitePool>);

#[derive(serde::Serialize)]
pub struct DbReadyInfo {
    pub ok: bool,
    pub db_path: String,
    pub companies: i64,
    pub applications: i64,
    pub events: i64,
}

/// P0-1 脚手架健康检查：验证 IPC → Rust → SQLite 全链路
#[tauri::command]
async fn db_ready(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
) -> Result<DbReadyInfo, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = dir.join("findyourjob.db").display().to_string();
    let pool = &*state.0;
    let companies: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM company")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let applications: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM application")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let events: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM application_event")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(DbReadyInfo {
        ok: true,
        db_path,
        companies,
        applications,
        events,
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            std::fs::create_dir_all(&dir).expect("无法创建应用数据目录");
            let db_path = dir.join("findyourjob.db");
            let pool = tauri::async_runtime::block_on(fyj_core::db::init_pool(&db_path))
                .expect("数据库初始化失败");
            app.manage(DbState(Arc::new(pool)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_ready])
        .run(tauri::generate_context!())
        .expect("FindYourJob 运行异常");
}
