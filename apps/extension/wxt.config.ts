import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "build",
  manifest: {
    name: "FindYourJob 收录",
    description:
      "在招聘网站一键收录岗位到本地 FindYourJob 应用（需在应用设置中开启「浏览器扩展接入」）",
    version: "0.2.0",
    permissions: ["activeTab", "scripting", "storage", "contextMenus"],
    host_permissions: ["http://127.0.0.1:37321/*", "http://localhost:37321/*"],
    action: {
      default_title: "收录到 FindYourJob",
      default_popup: "popup.html",
    },
  },
});
