import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "FindYourJob 剪藏",
    description:
      "在招聘网站一键剪藏岗位到本地 FindYourJob 应用（需在应用设置中开启「浏览器扩展接入」）",
    version: "0.1.0",
    permissions: ["activeTab", "scripting", "storage", "contextMenus"],
    action: {
      default_title: "剪藏到 FindYourJob",
      default_popup: "popup.html",
    },
  },
});
