import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import App from "./App";
import "./styles/globals.css";

// 深色模式跟随系统
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () =>
  document.documentElement.classList.toggle("dark", colorScheme.matches);
applyTheme();
colorScheme.addEventListener("change", applyTheme);

const queryClient = new QueryClient({
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
