import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { startNotifier } from "./lib/notifier";
import "./styles/globals.css";
import { showToast } from "./lib/toast";

// 深色模式跟随系统
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () =>
  document.documentElement.classList.toggle("dark", colorScheme.matches);
applyTheme();
colorScheme.addEventListener("change", applyTheme);

// 系统通知（临近截止/面试；无权限时静默降级）
void startNotifier();

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error) => showToast({ kind: "error", message: String(error) }),
    onSuccess: () => {
      // 事件/岗位增删改会影响多个已缓存页面，返回仪表盘时需看到最新进度。
      refreshJobData();
    },
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.state.data === undefined) showToast({ kind: "error", message: String(error) });
    },
  }),
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function refreshJobData() {
  void queryClient.invalidateQueries({ predicate: (query) => [
    "applications", "application-detail", "db-ready", "stats", "upcoming",
    "calendar-items", "resumes", "companies", "company-watches", "company-watch-checks", "offer-apps", "question-bank", "palette-search",
  ].includes(String(query.queryKey[0])) });
}

// 浏览器扩展通过 HTTP 写入，不经过 React mutation；回到 App 时重新读取。
if ("__TAURI_INTERNALS__" in window) {
  void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    // 正在编辑时保留表单草稿，避免刷新详情后把刚输入的内容重置。
    if (focused && !document.querySelector('[aria-modal="true"]')) refreshJobData();
  }).catch(() => undefined);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
