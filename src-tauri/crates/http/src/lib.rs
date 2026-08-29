//! 本地 HTTP API（设计 §4.2）：仅绑定 127.0.0.1，全部路由要求 Bearer token。
//! 只是 core Services 的薄封装，与 Tauri IPC 复用同一套业务逻辑。

use axum::extract::State;
use axum::http::{header, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use fyj_core::entities::Application;
use fyj_core::services::{CreateApplicationInput, Services};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub const DEFAULT_PORT: u16 = 37321;

pub struct HttpState {
    pub services: Services,
    pub token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub struct ClipInput {
    pub company_name: String,
    pub position_title: String,
    pub department: Option<String>,
    pub work_location: Option<String>,
    pub channel: Option<String>,
    pub batch: Option<String>,
    pub job_url: Option<String>,
    pub jd_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    error: String,
}

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(ErrorBody { error: msg.to_string() })).into_response()
}

async fn auth(
    State(state): State<Arc<HttpState>>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let ok = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t == state.token)
        .unwrap_or(false);
    if !ok {
        return err(StatusCode::UNAUTHORIZED, "无效或缺少 Bearer token");
    }
    next.run(req).await
}

async fn health() -> &'static str {
    "ok"
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractInput {
    pub title: String,
    pub url: String,
    pub text: String,
}

/// 智能识别：页面原文 → 应用内 LLM → 结构化字段（未配置 LLM 时返回 400 提示）
async fn extract(
    State(state): State<Arc<HttpState>>,
    Json(input): Json<ExtractInput>,
) -> Response {
    let Some(cfg) = fyj_core::llm::config_from_settings(&state.services).await else {
        return err(
            StatusCode::BAD_REQUEST,
            "应用未配置智能识别 LLM：请打开 FindYourJob → 设置 → 智能识别（LLM），填写 API Key",
        );
    };
    match fyj_core::llm::extract(&cfg, &input.title, &input.url, &input.text).await {
        Ok(job) => (StatusCode::OK, Json(job)).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, &e.to_string()),
    }
}

async fn clip(
    State(state): State<Arc<HttpState>>,
    Json(input): Json<ClipInput>,
) -> Response {
    let app: Result<Application, _> = state
        .services
        .create_application(CreateApplicationInput {
            company_name: input.company_name,
            company_website: None,
            company_careers_url: None,
            position_title: input.position_title,
            department: input.department,
            work_location: input.work_location,
            channel: input.channel,
            batch: input.batch,
            priority: None,
            applied: Some(false), // 剪藏落为"已保存"，确认投递后补 APPLIED 事件
            applied_date: None,
            job_url: input.job_url,
            jd_text: input.jd_text,
            salary_range: None,
            tags: vec!["收录".into()],
            resume_version_id: None,
            notes: None,
        })
        .await;
    match app {
        Ok(a) => (StatusCode::CREATED, Json(a)).into_response(),
        Err(e) => err(StatusCode::BAD_REQUEST, &e.to_string()),
    }
}

pub fn router(state: Arc<HttpState>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/ext/clip", post(clip))
        .route("/api/ext/extract", post(extract))
        .layer(middleware::from_fn_with_state(state.clone(), auth))
        .with_state(state)
}

/// 在 127.0.0.1:port 上启动服务，返回可 abort 的 JoinHandle。
pub fn serve(port: u16, state: Arc<HttpState>) -> tokio::task::JoinHandle<()> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    tokio::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("本地 API 端口绑定失败 {addr}: {e}");
                return;
            }
        };
        let app = router(state);
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("本地 API 退出: {e}");
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn setup() -> (Arc<HttpState>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let pool = fyj_core::db::init_pool(&dir.path().join("t.db")).await.unwrap();
        (
            Arc::new(HttpState {
                services: Services::new(pool),
                token: "test-token".into(),
            }),
            dir,
        )
    }

    fn clip_body() -> String {
        serde_json::json!({
            "companyName": "剪藏科技",
            "positionTitle": "前端工程师",
            "workLocation": "上海",
            "channel": "BOSS",
            "jobUrl": "https://example.com/job/1",
            "jdText": "负责核心产品前端"
        })
        .to_string()
    }

    #[tokio::test]
    async fn health_requires_token() {
        let (state, _d) = setup().await;
        let app = router(state);
        let res = app
            .clone()
            .oneshot(Request::builder().uri("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn clip_creates_saved_application() {
        let (state, _d) = setup().await;
        let app = router(state.clone());
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ext/clip")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(clip_body()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CREATED);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let created: Application = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(created.company_name, "剪藏科技");
        assert_eq!(created.status, fyj_core::models::Status::Saved);
        assert_eq!(created.tags, vec!["收录".to_string()]);

        let list = state
            .services
            .list_applications(&Default::default())
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
    }

    #[tokio::test]
    async fn extract_without_llm_config_returns_400() {
        let (state, _d) = setup().await;
        let app = router(state);
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ext/extract")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"title":"t","url":"https://x","text":"正文"}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(body["error"].as_str().unwrap().contains("未配置"));
    }

    #[tokio::test]
    async fn wrong_token_rejected() {
        let (state, _d) = setup().await;
        let app = router(state);
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ext/clip")
                    .header("authorization", "Bearer wrong")
                    .header("content-type", "application/json")
                    .body(Body::from(clip_body()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}
