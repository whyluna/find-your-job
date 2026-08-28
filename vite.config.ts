import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

// 前端服务配置：Tauri dev 固定端口；构建目标对齐 WKWebView (macOS)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@shared": path.resolve(root, "packages/shared/src"),
    },
  },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "safari15", minify: "esbuild", sourcemap: false },
});
