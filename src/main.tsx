import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
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
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.state.data === undefined) showToast({ kind: "error", message: String(error) });
    },
  }),
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
