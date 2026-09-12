//! 短请求启动/查询解析任务；结果仅保存在进程内，取消时丢弃，绝不写入用户数据库。
use crate::{err, ExtractInput, HttpState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use fyj_core::llm::ExtractedJob;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::task::AbortHandle;

const TTL: Duration = Duration::from_secs(600);
const CAPACITY: usize = 64;

#[derive(Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum JobStatus {
    Running,
    Done { result: ExtractedJob },
    Failed { error: String },
    Cancelled,
}

struct Entry {
    state: JobStatus,
    created: Instant,
    abort: Option<AbortHandle>,
}
#[derive(Default)]
pub struct JobStore {
    entries: Mutex<HashMap<String, Entry>>,
}

impl JobStore {
    fn prune(entries: &mut HashMap<String, Entry>) {
        entries.retain(|_, entry| {
            let keep = entry.created.elapsed() < TTL;
            if !keep {
                if let Some(abort) = &entry.abort {
                    abort.abort();
                }
            }
            keep
        });
    }

    fn start<F>(self: &Arc<Self>, id: String, work: F) -> Result<JobStatus, ()>
    where
        F: std::future::Future<Output = Result<ExtractedJob, String>> + Send + 'static,
    {
        let mut entries = self.entries.lock().unwrap();
        Self::prune(&mut entries);
        if let Some(entry) = entries.get(&id) {
            return Ok(entry.state.clone());
        }
        if entries.len() >= CAPACITY {
            return Err(());
        }
        let store = self.clone();
        let job_id = id.clone();
        // 先占位再启动，取消和完成均持同一把锁；取消后晚到的结果不能复活任务。
        entries.insert(
            id.clone(),
            Entry {
                state: JobStatus::Running,
                created: Instant::now(),
                abort: None,
            },
        );
        let task = tokio::spawn(async move {
            let result = tokio::time::timeout(Duration::from_secs(90), work).await;
            let state = match result {
                Ok(Ok(result)) => JobStatus::Done { result },
                Ok(Err(error)) => JobStatus::Failed { error },
                Err(_) => JobStatus::Failed {
                    error: "AI 解析超时，请重试".into(),
                },
            };
            let mut entries = store.entries.lock().unwrap();
            if let Some(entry) = entries.get_mut(&job_id) {
                if matches!(entry.state, JobStatus::Running) {
                    entry.state = state;
                    entry.abort = None;
                }
            }
        });
        entries.get_mut(&id).unwrap().abort = Some(task.abort_handle());
        Ok(JobStatus::Running)
    }

    fn get(&self, id: &str) -> Option<JobStatus> {
        let mut entries = self.entries.lock().unwrap();
        Self::prune(&mut entries);
        entries.get(id).map(|entry| entry.state.clone())
    }

    fn cancel(&self, id: &str) {
        let mut entries = self.entries.lock().unwrap();
        Self::prune(&mut entries);
        if let Some(entry) = entries.get_mut(id) {
            if let Some(abort) = entry.abort.take() {
                abort.abort();
            }
            entry.state = JobStatus::Cancelled;
        } else if entries.len() < CAPACITY {
            // 删除先于启动抵达时保留不含页面内容的墓碑，防止网络乱序复活。
            entries.insert(
                id.into(),
                Entry {
                    state: JobStatus::Cancelled,
                    created: Instant::now(),
                    abort: None,
                },
            );
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInput {
    request_id: String,
    #[serde(flatten)]
    page: ExtractInput,
}

fn valid_id(id: &str) -> bool {
    id.len() >= 16 && id.len() <= 80 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

pub async fn start(
    State(state): State<Arc<HttpState>>,
    Extension(jobs): Extension<Arc<JobStore>>,
    Json(input): Json<StartInput>,
) -> Response {
    if !valid_id(&input.request_id) {
        return err(StatusCode::BAD_REQUEST, "无效的解析任务编号");
    }
    if let Some(status) = jobs.get(&input.request_id) {
        return Json(status).into_response();
    }
    if input.page.text.len() > 100_000
        || input.page.url.len() > 8192
        || input.page.title.len() > 2048
    {
        return err(StatusCode::BAD_REQUEST, "页面内容过长");
    }
    let key = state.llm_api_key.read().ok().and_then(|v| v.clone());
    let Some(cfg) = fyj_core::llm::config_from_settings(&state.services, key).await else {
        return err(
            StatusCode::BAD_REQUEST,
            "应用未配置智能识别，请在 FindYourJob 设置中配置 LLM",
        );
    };
    let page = input.page;
    match jobs.start(input.request_id, async move {
        fyj_core::llm::extract(&cfg, &page.title, &page.url, &page.text)
            .await
            .map_err(|e| e.to_string())
    }) {
        Ok(status) => (StatusCode::ACCEPTED, Json(status)).into_response(),
        Err(()) => err(StatusCode::TOO_MANY_REQUESTS, "解析任务过多，请稍后再试"),
    }
}

pub async fn get(Extension(jobs): Extension<Arc<JobStore>>, Path(id): Path<String>) -> Response {
    match jobs.get(&id) {
        Some(status) => Json(status).into_response(),
        None => err(StatusCode::NOT_FOUND, "解析任务已失效，请重新识别"),
    }
}

pub async fn cancel(Extension(jobs): Extension<Arc<JobStore>>, Path(id): Path<String>) -> Response {
    if !valid_id(&id) {
        return err(StatusCode::BAD_REQUEST, "无效的解析任务编号");
    }
    jobs.cancel(&id);
    StatusCode::NO_CONTENT.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn job_survives_client_leaving_and_can_be_read_again() {
        let store = Arc::new(JobStore::default());
        let (tx, rx) = tokio::sync::oneshot::channel();
        store
            .start("test".into(), async move {
                rx.await.unwrap();
                Ok(ExtractedJob::default())
            })
            .unwrap();
        assert!(matches!(store.get("test"), Some(JobStatus::Running)));
        tx.send(()).unwrap();
        for _ in 0..20 {
            tokio::task::yield_now().await;
            if matches!(store.get("test"), Some(JobStatus::Done { .. })) {
                return;
            }
        }
        panic!("任务未完成");
    }
    #[tokio::test]
    async fn cancellation_before_or_during_work_never_returns_old_result() {
        let store = Arc::new(JobStore::default());
        store.cancel("before");
        let state = store
            .start("before".into(), async {
                panic!("不应启动已取消任务")
            })
            .unwrap();
        assert!(matches!(state, JobStatus::Cancelled));
        store
            .start("during".into(), async { std::future::pending().await })
            .unwrap();
        store.cancel("during");
        tokio::task::yield_now().await;
        assert!(matches!(store.get("during"), Some(JobStatus::Cancelled)));
    }
}
