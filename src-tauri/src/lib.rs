//! Tauri command 层：Services 的薄封装，无业务逻辑。
//! 参数名沿用 camelCase（Tauri 自动映射 snake_case）。

use tauri::Manager;

use fyj_core::backup;
use fyj_http::{self, HttpState};
use fyj_core::entities::{Application, ApplicationListItem, Attachment, Company, CustomEventType, DictionaryItem, Interview, InterviewQuestion, ResumeVersion};
use fyj_core::services::{
    AddEventInput, AddInterviewInput, AddQuestionInput, CreateApplicationInput, ListFilter,
    Services, UpdateApplicationInput, UpdateEventInput, UpdateInterviewInput, UpdateQuestionInput,
};
use fyj_core::entities::{ApplicationDetail, ApplicationEvent};

pub struct AppState(pub Services);

/// 本地 HTTP API 的运行句柄（P1：浏览器扩展剪藏入口）
pub struct LocalApiHandle {
    pub task: tauri::async_runtime::JoinHandle<()>,
    pub running: std::sync::atomic::AtomicBool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalApiStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub token: String,
}

const LOCAL_API_PORT: u16 = fyj_http::DEFAULT_PORT;

async fn read_or_create_token(svc: &Services) -> Result<String, String> {
    if let Some(t) = svc.get_setting("local_api_token").await.map_err(e2s)? {
        if !t.trim_matches('"').is_empty() {
            return Ok(t.trim_matches('"').to_string());
        }
    }
    let token = uuid::Uuid::new_v4().to_string();
    svc.set_setting("local_api_token", &format!("\"{token}\""))
        .await
        .map_err(e2s)?;
    Ok(token)
}

fn spawn_local_api(app: &tauri::AppHandle) -> Result<(), String> {
    let handle_slot: tauri::State<std::sync::Mutex<Option<LocalApiHandle>>> = app.state();
    let mut slot = handle_slot.lock().unwrap();
    if let Some(h) = slot.as_ref() {
        if h.running.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(()); // 已在运行
        }
    }
    let app2 = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let svc = &app2.state::<AppState>().0;
        let Ok(token) = read_or_create_token(svc).await else {
            eprintln!("本地 API：读取 token 失败");
            return;
        };
        let http_state = std::sync::Arc::new(HttpState {
            services: svc.clone(),
            token,
        });
        fyj_http::serve(LOCAL_API_PORT, http_state);
    });
    *slot = Some(LocalApiHandle {
        task,
        running: std::sync::atomic::AtomicBool::new(true),
    });
    Ok(())
}

fn stop_local_api(app: &tauri::AppHandle) {
    let handle_slot: tauri::State<std::sync::Mutex<Option<LocalApiHandle>>> = app.state();
    let mut slot = handle_slot.lock().unwrap();
    if let Some(h) = slot.take() {
        h.running.store(false, std::sync::atomic::Ordering::SeqCst);
        h.task.abort();
    }
}

#[tauri::command]
async fn local_api_status(app: tauri::AppHandle) -> CmdResult<LocalApiStatus> {
    let svc = &app.state::<AppState>().0;
    let enabled = svc
        .get_setting("local_api_enabled")
        .await
        .map_err(e2s)?
        .as_deref()
        .map(|v| v == "true")
        .unwrap_or(false);
    let token = read_or_create_token(svc).await?;
    let running = app
        .state::<std::sync::Mutex<Option<LocalApiHandle>>>()
        .lock()
        .unwrap()
        .as_ref()
        .map(|h| h.running.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false);
    Ok(LocalApiStatus {
        enabled,
        running,
        port: LOCAL_API_PORT,
        token,
    })
}

#[tauri::command]
async fn local_api_set_enabled(app: tauri::AppHandle, enabled: bool) -> CmdResult<()> {
    {
        let svc = &app.state::<AppState>().0;
        svc.set_setting("local_api_enabled", if enabled { "true" } else { "false" })
            .await
            .map_err(e2s)?;
    }
    if enabled {
        spawn_local_api(&app)?;
    } else {
        stop_local_api(&app);
    }
    Ok(())
}

#[tauri::command]
async fn local_api_reset_token(app: tauri::AppHandle) -> CmdResult<()> {
    {
        let svc = &app.state::<AppState>().0;
        let token = uuid::Uuid::new_v4().to_string();
        svc.set_setting("local_api_token", &format!("\"{token}\""))
            .await
            .map_err(e2s)?;
    }
    stop_local_api(&app);
    spawn_local_api(&app)?;
    Ok(())
}

fn e2s(e: fyj_core::Error) -> String {
    e.to_string()
}

type CmdResult<T> = std::result::Result<T, String>;

// ---------- 数据库健康检查 ----------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbReadyInfo {
    pub ok: bool,
    pub db_path: String,
    pub companies: i64,
    pub applications: i64,
    pub events: i64,
}

#[tauri::command]
async fn db_ready(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CmdResult<DbReadyInfo> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = dir.join("findyourjob.db").display().to_string();
    let pool = &state.0.pool;
    let companies: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM company")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    let applications: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM application")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    let events: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM application_event")
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

// ---------- 公司 ----------

#[tauri::command]
async fn search_companies(
    state: tauri::State<'_, AppState>,
    query: String,
    limit: Option<u32>,
) -> CmdResult<Vec<Company>> {
    state
        .0
        .search_companies(&query, limit.unwrap_or(8))
        .await
        .map_err(e2s)
}

#[tauri::command]
async fn list_companies(state: tauri::State<'_, AppState>) -> CmdResult<Vec<Company>> {
    state.0.list_companies().await.map_err(e2s)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn update_company(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    aliases: Option<Vec<String>>,
    industry: Option<String>,
    nature: Option<String>,
    website: Option<String>,
    careers_url: Option<String>,
    notes: Option<String>,
) -> CmdResult<Company> {
    state
        .0
        .update_company(
            &id,
            &name,
            aliases.unwrap_or_default(),
            industry,
            nature,
            website,
            careers_url,
            notes,
        )
        .await
        .map_err(e2s)
}

#[tauri::command]
async fn delete_company(state: tauri::State<'_, AppState>, id: String) -> CmdResult<()> {
    state.0.delete_company(&id).await.map_err(e2s)
}

#[tauri::command]
async fn upsert_company(
    state: tauri::State<'_, AppState>,
    name: String,
    website: Option<String>,
    careers_url: Option<String>,
) -> CmdResult<Company> {
    state
        .0
        .upsert_company(&name, website.as_deref(), careers_url.as_deref())
        .await
        .map_err(e2s)
}

// ---------- 投递 ----------

#[tauri::command]
async fn list_applications(
    state: tauri::State<'_, AppState>,
    filter: Option<ListFilter>,
) -> CmdResult<Vec<ApplicationListItem>> {
    state
        .0
        .list_applications(&filter.unwrap_or_default())
        .await
        .map_err(e2s)
}

#[tauri::command]
async fn reorder_applications(
    state: tauri::State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> CmdResult<()> {
    state.0.reorder_applications(&ordered_ids).await.map_err(e2s)
}

#[tauri::command]
async fn get_application_detail(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CmdResult<ApplicationDetail> {
    state.0.get_application_detail(&id).await.map_err(e2s)
}

#[tauri::command]
async fn create_application(
    state: tauri::State<'_, AppState>,
    input: CreateApplicationInput,
) -> CmdResult<Application> {
    state.0.create_application(input).await.map_err(e2s)
}

#[tauri::command]
async fn update_application(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateApplicationInput,
) -> CmdResult<Application> {
    state.0.update_application(&id, input).await.map_err(e2s)
}

#[tauri::command]
async fn delete_application(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CmdResult<()> {
    state.0.delete_application(&id).await.map_err(e2s)
}

#[tauri::command]
async fn set_application_archived(
    state: tauri::State<'_, AppState>,
    id: String,
    archived: bool,
) -> CmdResult<()> {
    state.0.set_archived(&id, archived).await.map_err(e2s)
}

// ---------- 事件 ----------

#[tauri::command]
async fn add_event(
    state: tauri::State<'_, AppState>,
    input: AddEventInput,
) -> CmdResult<ApplicationEvent> {
    state.0.add_event(input).await.map_err(e2s)
}

#[tauri::command]
async fn update_event(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateEventInput,
) -> CmdResult<ApplicationEvent> {
    state.0.update_event(&id, input).await.map_err(e2s)
}

#[tauri::command]
async fn delete_event(state: tauri::State<'_, AppState>, id: String) -> CmdResult<()> {
    state.0.delete_event(&id).await.map_err(e2s)
}

// ---------- 面试 ----------

#[tauri::command]
async fn add_interview(
    state: tauri::State<'_, AppState>,
    input: AddInterviewInput,
) -> CmdResult<Interview> {
    state.0.add_interview(input).await.map_err(e2s)
}

#[tauri::command]
async fn update_interview(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateInterviewInput,
) -> CmdResult<Interview> {
    state.0.update_interview(&id, input).await.map_err(e2s)
}

#[tauri::command]
async fn delete_interview(state: tauri::State<'_, AppState>, id: String) -> CmdResult<()> {
    state.0.delete_interview(&id).await.map_err(e2s)
}

// ---------- 面试题 ----------

#[tauri::command]
async fn add_question(
    state: tauri::State<'_, AppState>,
    input: AddQuestionInput,
) -> CmdResult<InterviewQuestion> {
    state.0.add_question(input).await.map_err(e2s)
}

#[tauri::command]
async fn update_question(
    state: tauri::State<'_, AppState>,
    id: String,
    input: UpdateQuestionInput,
) -> CmdResult<InterviewQuestion> {
    state.0.update_question(&id, input).await.map_err(e2s)
}

#[tauri::command]
async fn delete_question(state: tauri::State<'_, AppState>, id: String) -> CmdResult<()> {
    state.0.delete_question(&id).await.map_err(e2s)
}

#[tauri::command]
async fn reorder_questions(
    state: tauri::State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> CmdResult<()> {
    state.0.reorder_questions(&ordered_ids).await.map_err(e2s)
}

// ---------- 简历 ----------

#[tauri::command]
async fn list_resumes(state: tauri::State<'_, AppState>) -> CmdResult<Vec<ResumeVersion>> {
    state.0.list_resumes().await.map_err(e2s)
}

/// 上传简历：把用户选择的文件复制进应用数据目录（uuid 文件名防冲突）后登记版本
#[tauri::command]
async fn upload_resume(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
    target_role: Option<String>,
    source_path: String,
    notes: Option<String>,
) -> CmdResult<ResumeVersion> {
    let src = std::path::Path::new(&source_path);
    if !src.is_file() {
        return Err(format!("文件不存在: {source_path}"));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("uploads")
        .join("resumes");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;

    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let stored = dir.join(format!("{}{ext}", uuid::Uuid::new_v4()));
    let size = tokio::fs::copy(src, &stored).await.map_err(|e| e.to_string())?;

    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("resume")
        .to_string();
    state
        .0
        .insert_resume(
            &name,
            target_role.as_deref(),
            &file_name,
            &stored.display().to_string(),
            Some(size as i64),
            notes.as_deref(),
        )
        .await
        .map_err(e2s)
}

#[tauri::command]
async fn set_default_resume(state: tauri::State<'_, AppState>, id: String) -> CmdResult<()> {
    state.0.set_default_resume(&id).await.map_err(e2s)
}

/// 删除简历版本，同时清理应用目录内的文件（投递引用由 FK 置空）
#[tauri::command]
async fn delete_resume_file(state: tauri::State<'_, AppState>, id: String) -> CmdResult<()> {
    let resume = state.0.get_resume(&id).await.map_err(e2s)?;
    state.0.delete_resume(&id).await.map_err(e2s)?;
    let path = std::path::Path::new(&resume.file_path);
    if path.starts_with("/") {
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(())
}

// ---------- 字典 / 设置 ----------

#[tauri::command]
async fn list_dictionary(
    state: tauri::State<'_, AppState>,
    category: String,
) -> CmdResult<Vec<DictionaryItem>> {
    state.0.list_dictionary(&category).await.map_err(e2s)
}

#[tauri::command]
async fn list_custom_event_types(
    state: tauri::State<'_, AppState>,
) -> CmdResult<Vec<CustomEventType>> {
    state.0.list_custom_event_types().await.map_err(e2s)
}

// ---------- 备份 ----------

#[tauri::command]
async fn export_json(app: tauri::AppHandle, state: tauri::State<'_, AppState>, path: String) -> CmdResult<u64> {
    let _ = &app;
    backup::export_to_json(&state.0.pool, std::path::Path::new(&path))
        .await
        .map_err(e2s)
}

#[tauri::command]
async fn import_json(state: tauri::State<'_, AppState>, path: String) -> CmdResult<backup::ImportSummary> {
    backup::import_from_json(&state.0.pool, std::path::Path::new(&path))
        .await
        .map_err(e2s)
}

/// 在 Finder 中打开应用数据目录
#[tauri::command]
async fn reveal_data_dir(app: tauri::AppHandle) -> CmdResult<()> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _ = tokio::fs::read_dir(&dir).await;
    opener_reveal(&dir.display().to_string())
}

fn opener_reveal(path: &str) -> CmdResult<()> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

// ---------- 附件 ----------

#[tauri::command]
async fn upload_attachment(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    parent_type: String,
    parent_id: String,
    source_path: String,
) -> CmdResult<Attachment> {
    let src = std::path::Path::new(&source_path);
    if !src.is_file() {
        return Err(format!("文件不存在: {source_path}"));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("uploads")
        .join("attachments");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let file_name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
    let ext = src.extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    let stored = dir.join(format!("{}{ext}", uuid::Uuid::new_v4()));
    let size = tokio::fs::copy(src, &stored).await.map_err(|e| e.to_string())?;
    let mime = match ext.as_str() {
        ".pdf" => Some("application/pdf"),
        ".png" => Some("image/png"),
        ".jpg" | ".jpeg" => Some("image/jpeg"),
        ".webp" => Some("image/webp"),
        ".heic" => Some("image/heic"),
        ".doc" => Some("application/msword"),
        ".docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        _ => None,
    };
    state
        .0
        .insert_attachment(&parent_type, &parent_id, &file_name, &stored.display().to_string(), mime, Some(size as i64))
        .await
        .map_err(e2s)
}

#[tauri::command]
async fn delete_attachment(state: tauri::State<'_, AppState>, id: String) -> CmdResult<()> {
    let path = state.0.delete_attachment(&id).await.map_err(e2s)?;
    if !path.is_empty() && path.starts_with('/') {
        let _ = tokio::fs::remove_file(&path).await;
    }
    Ok(())
}

// ---------- 智能识别（LLM，可选增强） ----------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

async fn read_setting_str(state: &tauri::State<'_, AppState>, key: &str) -> String {
    state
        .0
        .get_setting(key)
        .await
        .ok()
        .flatten()
        .map(|v| v.trim_matches('"').to_string())
        .unwrap_or_default()
}

#[tauri::command]
async fn llm_get_settings(state: tauri::State<'_, AppState>) -> CmdResult<LlmSettings> {
    let base_url = read_setting_str(&state, "llm_base_url").await;
    let api_key = read_setting_str(&state, "llm_api_key").await;
    let model = read_setting_str(&state, "llm_model").await;
    Ok(LlmSettings {
        base_url,
        api_key,
        model,
    })
}

async fn save_setting_str(
    state: &tauri::State<'_, AppState>,
    key: &str,
    value: &Option<String>,
) -> CmdResult<()> {
    if let Some(v) = value {
        let v = v.trim();
        state
            .0
            .set_setting(key, &format!("\"{v}\""))
            .await
            .map_err(e2s)?;
    }
    Ok(())
}

#[tauri::command]
async fn llm_save_settings(
    state: tauri::State<'_, AppState>,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> CmdResult<()> {
    save_setting_str(&state, "llm_base_url", &base_url).await?;
    save_setting_str(&state, "llm_api_key", &api_key).await?;
    save_setting_str(&state, "llm_model", &model).await?;
    Ok(())
}

#[tauri::command]
async fn llm_test(state: tauri::State<'_, AppState>) -> CmdResult<String> {
    let Some(cfg) = fyj_core::llm::config_from_settings(&state.0).await else {
        return Err("请先填写并保存 API Key".into());
    };
    let reply = fyj_core::llm::ping(&cfg).await.map_err(e2s)?;
    Ok(format!("连接成功，模型 {} 已响应：{reply}", cfg.model))
}

#[tauri::command]
async fn list_all_questions(
    state: tauri::State<'_, AppState>,
    search: Option<String>,
) -> CmdResult<Vec<fyj_core::services::QuestionBankItem>> {
    state
        .0
        .list_all_questions(search.as_deref())
        .await
        .map_err(e2s)
}

#[tauri::command]
async fn export_csv(state: tauri::State<'_, AppState>, path: String) -> CmdResult<u64> {
    state.0.export_csv(&path).await.map_err(e2s)
}

/// 读取文本文件（仅用于 CSV 导入向导，路径来自系统文件对话框）
#[tauri::command]
async fn read_text_file(path: String) -> CmdResult<String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_stats(
    state: tauri::State<'_, AppState>,
) -> CmdResult<fyj_core::services::StatsDto> {
    state.0.get_stats().await.map_err(e2s)
}

#[tauri::command]
async fn get_upcoming(
    state: tauri::State<'_, AppState>,
    deadline_days: Option<i64>,
    interview_days: Option<i64>,
) -> CmdResult<Vec<fyj_core::services::UpcomingItem>> {
    state
        .0
        .get_upcoming(deadline_days.unwrap_or(3), interview_days.unwrap_or(7))
        .await
        .map_err(e2s)
}

#[tauri::command]
async fn get_setting(
    state: tauri::State<'_, AppState>,
    key: String,
) -> CmdResult<Option<String>> {
    state.0.get_setting(&key).await.map_err(e2s)
}

#[tauri::command]
async fn set_setting(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> CmdResult<()> {
    state.0.set_setting(&key, &value).await.map_err(e2s)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            std::fs::create_dir_all(&dir).expect("无法创建应用数据目录");
            let db_path = dir.join("findyourjob.db");
            let pool = tauri::async_runtime::block_on(fyj_core::db::init_pool(&db_path))
                .expect("数据库初始化失败");
            app.manage(AppState(Services::new(pool)));
            app.manage(std::sync::Mutex::<Option<LocalApiHandle>>::new(None));
            // 若设置中已开启扩展接入，自动启动本地 API
            {
                let svc = &app.state::<AppState>().0;
                let enabled = tauri::async_runtime::block_on(svc.get_setting("local_api_enabled"))
                    .ok()
                    .flatten()
                    .map(|v| v == "true")
                    .unwrap_or(false);
                if enabled {
                    let _ = spawn_local_api(app.handle());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_ready,
            llm_get_settings,
            llm_save_settings,
            llm_test,
            list_companies,
            update_company,
            delete_company,
            search_companies,
            upsert_company,
            list_applications,
            reorder_applications,
            get_application_detail,
            create_application,
            update_application,
            delete_application,
            set_application_archived,
            add_event,
            update_event,
            delete_event,
            add_interview,
            update_interview,
            delete_interview,
            add_question,
            update_question,
            delete_question,
            reorder_questions,
            list_resumes,
            upload_resume,
            set_default_resume,
            delete_resume_file,
            list_dictionary,
            list_custom_event_types,
            list_all_questions,
            export_csv,
            read_text_file,
            get_stats,
            get_upcoming,
            local_api_status,
            local_api_set_enabled,
            local_api_reset_token,
            export_json,
            import_json,
            reveal_data_dir,
            upload_attachment,
            delete_attachment,
            get_setting,
            set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("FindYourJob 运行异常");
}
