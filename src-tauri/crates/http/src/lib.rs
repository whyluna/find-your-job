//! 本地 HTTP API（设计 §4.2）：仅绑定 127.0.0.1，全部路由要求 Bearer token。
//! 只是 core Services 的薄封装，与 Tauri IPC 复用同一套业务逻辑。

use axum::extract::{Query, State};
use axum::http::{header, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use fyj_core::company_watch::FollowCompanyInput;
use fyj_core::entities::Application;
use fyj_core::services::{CreateApplicationInput, Services};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
mod extraction_jobs;

pub const DEFAULT_PORT: u16 = 37321;

pub struct HttpState {
    pub services: Services,
    pub token: String,
    /// 由正式 App 显式注入；测试默认 None，绝不读取真实系统凭据。
    pub llm_api_key: Arc<std::sync::RwLock<Option<String>>>,
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
    #[serde(default)]
    pub allow_duplicate: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipResponse {
    pub application: Application,
    pub created: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    error: String,
}

fn err(status: StatusCode, msg: &str) -> Response {
    (
        status,
        Json(ErrorBody {
            error: msg.to_string(),
        }),
    )
        .into_response()
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

#[derive(Deserialize)]
struct CompanySearch {
    #[serde(default)]
    q: String,
}

async fn company_search(
    State(state): State<Arc<HttpState>>,
    Query(input): Query<CompanySearch>,
) -> Response {
    if input.q.chars().count() > 200 {
        return err(StatusCode::BAD_REQUEST, "公司名称过长");
    }
    match state.services.search_companies(input.q.trim(), 8).await {
        Ok(companies) => Json(companies).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error.to_string()),
    }
}

async fn company_follow(
    State(state): State<Arc<HttpState>>,
    Json(input): Json<FollowCompanyInput>,
) -> Response {
    match state.services.follow_company(input).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => err(StatusCode::BAD_REQUEST, &error.to_string()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractInput {
    pub title: String,
    pub url: String,
    pub text: String,
}

/// 智能识别：页面原文 → 应用内 LLM → 结构化字段（未配置 LLM 时返回 400 提示）
async fn extract(State(state): State<Arc<HttpState>>, Json(input): Json<ExtractInput>) -> Response {
    let injected_key = state
        .llm_api_key
        .read()
        .ok()
        .and_then(|value| value.clone());
    let Some(cfg) = fyj_core::llm::config_from_settings(&state.services, injected_key).await else {
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

async fn clip(State(state): State<Arc<HttpState>>, Json(input): Json<ClipInput>) -> Response {
    let create_input = CreateApplicationInput {
        company_name: input.company_name,
        company_website: None,
        company_careers_url: None,
        position_title: input.position_title,
        department: input.department,
        work_location: input.work_location,
        channel: input.channel,
        batch: input.batch,
        priority: None,
        applied: Some(false), // 收录到意向岗位，正式投递后再确认 APPLIED 事件
        applied_date: None,
        planned_apply_at: None,
        application_deadline: None,
        job_url: input.job_url,
        jd_text: input.jd_text,
        salary_range: None,
        tags: vec!["收录".into()],
        resume_version_id: None,
        notes: None,
    };
    if !input.allow_duplicate {
        match state
            .services
            .find_duplicate_application(&create_input)
            .await
        {
            Ok(Some(application)) => {
                return (
                    StatusCode::OK,
                    Json(ClipResponse {
                        application,
                        created: false,
                    }),
                )
                    .into_response();
            }
            Ok(None) => {}
            Err(e) => return err(StatusCode::BAD_REQUEST, &e.to_string()),
        }
    }
    let app: Result<Application, _> = state.services.create_application(create_input).await;
    match app {
        Ok(application) => (
            StatusCode::CREATED,
            Json(ClipResponse {
                application,
                created: true,
            }),
        )
            .into_response(),
        Err(e) => err(StatusCode::BAD_REQUEST, &e.to_string()),
    }
}

pub fn router(state: Arc<HttpState>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/ext/clip", post(clip))
        .route("/api/ext/companies", get(company_search))
        .route("/api/ext/company-watch", post(company_follow))
        .route("/api/ext/extract", post(extract))
        .route("/api/ext/extract/jobs", post(extraction_jobs::start))
        .route(
            "/api/ext/extract/jobs/{id}",
            get(extraction_jobs::get).delete(extraction_jobs::cancel),
        )
        .layer(axum::Extension(Arc::new(
            extraction_jobs::JobStore::default(),
        )))
        .layer(middleware::from_fn_with_state(state.clone(), auth))
        .with_state(state)
}

/// 在 127.0.0.1:port 上运行服务。
///
/// 调用方必须持有并等待这个 Future；取消调用方任务会直接关闭 listener。
/// 不在这里再次 spawn，避免真实服务句柄丢失。
pub async fn serve(port: u16, state: Arc<HttpState>) -> std::io::Result<()> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    serve_with_listener(listener, state).await
}

pub async fn serve_with_listener(
    listener: tokio::net::TcpListener,
    state: Arc<HttpState>,
) -> std::io::Result<()> {
    axum::serve(listener, router(state)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn setup() -> (Arc<HttpState>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let pool = fyj_core::db::init_pool(&dir.path().join("t.db"))
            .await
            .unwrap();
        (
            Arc::new(HttpState {
                services: Services::new(pool),
                token: "test-token".into(),
                llm_api_key: Arc::new(std::sync::RwLock::new(None)),
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
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn company_follow_requires_token_reuses_records_and_never_creates_a_job() {
        let (state, _dir) = setup().await;
        let app = router(state.clone());
        for (method, uri) in [
            ("GET", "/api/ext/companies?q=test"),
            ("POST", "/api/ext/company-watch"),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(uri)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
        let body = serde_json::json!({"companyName":"插件关注示例公司","year":2027,"season":"AUTUMN","status":"UNKNOWN","intervalDays":7,"careersUrl":"https://example.com/careers"}).to_string();
        let mut id = String::new();
        for expected in [true, false] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/ext/company-watch")
                        .header("authorization", "Bearer test-token")
                        .header("content-type", "application/json")
                        .body(Body::from(body.clone()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            let result: fyj_core::company_watch::FollowCompanyResult =
                serde_json::from_slice(&bytes).unwrap();
            assert_eq!(result.created, expected);
            if expected {
                id = result.watch.company_id;
            } else {
                assert_eq!(id, result.watch.company_id);
            }
        }
        assert!(state
            .services
            .list_applications(&Default::default())
            .await
            .unwrap()
            .is_empty());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/ext/companies?q=")
                    .header("authorization", "Bearer test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let companies: Vec<fyj_core::entities::Company> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(companies.len(), 1);
        assert_eq!(companies[0].id, id);
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
        let created: ClipResponse = serde_json::from_slice(&bytes).unwrap();
        assert!(created.created);
        assert_eq!(created.application.company_name, "剪藏科技");
        assert_eq!(created.application.status, fyj_core::models::Status::Saved);
        assert_eq!(created.application.tags, vec!["收录".to_string()]);

        let list = state
            .services
            .list_applications(&Default::default())
            .await
            .unwrap();
        assert_eq!(list.len(), 1);
    }

    #[tokio::test]
    async fn repeated_clip_returns_existing_unless_explicitly_forced() {
        let (state, _d) = setup().await;
        let app = router(state.clone());
        let request = || {
            Request::builder()
                .method("POST")
                .uri("/api/ext/clip")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(clip_body()))
                .unwrap()
        };
        assert_eq!(
            app.clone().oneshot(request()).await.unwrap().status(),
            StatusCode::CREATED
        );
        let duplicate = app.clone().oneshot(request()).await.unwrap();
        assert_eq!(duplicate.status(), StatusCode::OK);
        let bytes = duplicate.into_body().collect().await.unwrap().to_bytes();
        let body: ClipResponse = serde_json::from_slice(&bytes).unwrap();
        assert!(!body.created);
        assert_eq!(
            state
                .services
                .list_applications(&Default::default())
                .await
                .unwrap()
                .len(),
            1
        );

        let forced = serde_json::json!({
            "companyName": "剪藏科技",
            "positionTitle": "前端工程师",
            "channel": "BOSS",
            "jobUrl": "https://example.com/job/1",
            "allowDuplicate": true
        })
        .to_string();
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/ext/clip")
                    .header("authorization", "Bearer test-token")
                    .header("content-type", "application/json")
                    .body(Body::from(forced))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(
            state
                .services
                .list_applications(&Default::default())
                .await
                .unwrap()
                .len(),
            2
        );
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
                        serde_json::json!({"title":"t","url":"https://x","text":"正文"})
                            .to_string(),
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

    #[tokio::test]
    async fn serving_task_owns_listener_and_abort_releases_port() {
        let (state, _d) = setup().await;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(serve_with_listener(listener, state));
        let stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        drop(stream);

        task.abort();
        let _ = task.await;
        let rebound = tokio::net::TcpListener::bind(addr).await.unwrap();
        drop(rebound);
    }

    #[tokio::test]
    async fn extraction_jobs_require_auth_and_honor_cancel_before_start() {
        let (state, _d) = setup().await;
        let app = router(state);
        let id = "fixture-cancel-before-start";
        let uri = format!("/api/ext/extract/jobs/{id}");
        let unauthorized = app
            .clone()
            .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
        let deleted = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(&uri)
                    .header("authorization", "Bearer test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
        let started = app.clone().oneshot(Request::builder().method("POST").uri("/api/ext/extract/jobs")
            .header("authorization", "Bearer test-token").header("content-type", "application/json")
            .body(Body::from(serde_json::json!({"requestId":id,"title":"fixture","url":"https://example.com","text":"fixture"}).to_string())).unwrap()).await.unwrap();
        assert_eq!(started.status(), StatusCode::OK);
        let value: serde_json::Value =
            serde_json::from_slice(&started.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(value["status"], "cancelled");
    }

    #[tokio::test]
    async fn asynchronous_extraction_finishes_after_start_request_has_returned() {
        let (state, _d) = setup().await;
        let release = Arc::new(tokio::sync::Semaphore::new(0));
        let gate = release.clone();
        let mock = Router::new().route("/chat/completions", post(move || {
            let gate = gate.clone();
            async move {
                gate.acquire().await.unwrap().forget();
                Json(serde_json::json!({"choices":[{"message":{"content":"{\"companyName\":\"测试公司\",\"positionTitle\":\"测试岗位\",\"jdText\":\"岗位要求\"}"}}]}))
            }
        }));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, mock).await.unwrap();
        });
        state
            .services
            .set_setting("llm_base_url", &format!("http://{address}"))
            .await
            .unwrap();
        *state.llm_api_key.write().unwrap() = Some("fixture-key".into());
        let app = router(state);
        let id = "fixture-async-extraction";
        let response = app.clone().oneshot(Request::builder().method("POST").uri("/api/ext/extract/jobs")
            .header("authorization", "Bearer test-token").header("content-type", "application/json")
            .body(Body::from(serde_json::json!({"requestId":id,"title":"fixture","url":"https://example.com","text":"fixture"}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        drop(response);
        release.add_permits(1);
        let result = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .uri(format!("/api/ext/extract/jobs/{id}"))
                            .header("authorization", "Bearer test-token")
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                let value: serde_json::Value = serde_json::from_slice(
                    &response.into_body().collect().await.unwrap().to_bytes(),
                )
                .unwrap();
                if value["status"] != "running" {
                    break value;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(result["status"], "done", "{result}");
        assert_eq!(result["result"]["companyName"], "测试公司");
        server.abort();
    }
}
