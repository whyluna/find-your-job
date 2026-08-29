//! Tauri command 层：Services 的薄封装，无业务逻辑。
//! 参数名沿用 camelCase（Tauri 自动映射 snake_case）。

use tauri::Manager;

use fyj_core::entities::{Application, ApplicationListItem, Company, CustomEventType, DictionaryItem, Interview, InterviewQuestion, ResumeVersion};
use fyj_core::services::{
    AddEventInput, AddInterviewInput, AddQuestionInput, CreateApplicationInput, ListFilter,
    Services, UpdateApplicationInput, UpdateEventInput, UpdateInterviewInput, UpdateQuestionInput,
};
use fyj_core::entities::{ApplicationDetail, ApplicationEvent};

pub struct AppState(pub Services);

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
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            std::fs::create_dir_all(&dir).expect("无法创建应用数据目录");
            let db_path = dir.join("findyourjob.db");
            let pool = tauri::async_runtime::block_on(fyj_core::db::init_pool(&db_path))
                .expect("数据库初始化失败");
            app.manage(AppState(Services::new(pool)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_ready,
            search_companies,
            upsert_company,
            list_applications,
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
            list_dictionary,
            list_custom_event_types,
            get_setting,
            set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("FindYourJob 运行异常");
}
