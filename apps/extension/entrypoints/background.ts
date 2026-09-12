import { browser } from "wxt/browser";
import { DraftController, FIELDS, stateKey, type Field, type PanelState } from "../src/drafts";
import { platform } from "../src/platform";

export default defineBackground(() => {
  const controller = new DraftController(platform);
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll().then(() => browser.contextMenus.create({ id: "fyj-clip", title: "收录到 FindYourJob", contexts: ["page"] }));
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "fyj-clip" || !tab?.id) return;
    await clipToApp(tab.id).catch(() => flashBadge(tab.id!, "×"));
  });
  browser.action.onClicked.addListener((tab) => {
    // 必须在手势回调中立即打开，不能先 await 存储或网络请求。
    void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    void controller.state(tab.windowId).then(async (state) => {
      if (!state.initialized) await controller.capture(tab.windowId);
    }).catch(async (error) => {
      const state = await platform.load(tab.windowId);
      await platform.save(tab.windowId, { ...state, revision: state.revision + 1, initialized: true, notice: String(error), noticeKind: "error" });
    });
  });

  const invalidateTab = async (tabId: number) => {
    const states = await browser.storage.session.get(null);
    for (const [key, value] of Object.entries(states)) {
      if (key.startsWith("fyj-draft:") && (value as PanelState)?.draft?.source.tabId === tabId) {
        await controller.invalidate(Number(key.slice("fyj-draft:".length)), tabId);
      }
    }
  };
  browser.webNavigation.onBeforeNavigate.addListener((event) => { if (event.frameId === 0) void invalidateTab(event.tabId); });
  browser.webNavigation.onCommitted.addListener((event) => { if (event.frameId === 0) void invalidateTab(event.tabId); });
  // SPA 页面跳转同样失效；普通标签切换不触发清理。
  const verifyTab = async (tabId: number) => {
    const states = await browser.storage.session.get(null);
    for (const [key, value] of Object.entries(states)) {
      if (key.startsWith("fyj-draft:") && (value as PanelState)?.draft?.source.tabId === tabId) await controller.state(Number(key.slice("fyj-draft:".length)));
    }
  };
  browser.webNavigation.onHistoryStateUpdated.addListener((event) => { if (event.frameId === 0) void verifyTab(event.tabId); });
  browser.webNavigation.onReferenceFragmentUpdated.addListener((event) => { if (event.frameId === 0) void verifyTab(event.tabId); });
  browser.tabs.onRemoved.addListener((tabId) => { void invalidateTab(tabId); });
  browser.windows.onRemoved.addListener((windowId) => {
    void controller.state(windowId).then(async (state) => {
      if (state.draft) await controller.discard(windowId, state.draft.id);
      await browser.storage.session.remove(stateKey(windowId));
    });
  });
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL("/sidepanel.html")) || message?.scope !== "fyj-panel") return false;
    const run = async () => {
      const { windowId, draftId, type } = message;
      if (!Number.isInteger(windowId)) throw new Error("无效窗口");
      switch (type) {
        case "state": return controller.state(windowId);
        case "capture": return controller.capture(windowId);
        case "edit":
          if (!FIELDS.includes(message.field) || typeof message.value !== "string" || message.value.length > 100_000) throw new Error("无效字段");
          return controller.edit(windowId, draftId, message.field as Field, message.value);
        case "ai": return controller.startAi(windowId, draftId);
        case "poll": return controller.poll(windowId);
        case "discard": return controller.discard(windowId, draftId);
        case "submit": return controller.submit(windowId, draftId, message.allowDuplicate === true);
        default: throw new Error("未知操作");
      }
    };
    void run().then((state) => respond({ ok: true, state }), (error) => respond({ ok: false, error: String(error) }));
    return true;
  });
});

async function clipToApp(tabId: number) {
  const { extractJobInPage } = await import("../src/extract");
  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: extractJobInPage,
  });
  const clip = res?.result;
  if (!clip) return flashBadge(tabId, "!");
  if (!clip.companyName?.trim() || !clip.positionTitle?.trim()) {
    return flashBadge(tabId, "!");
  }

  const { token = "" } = await browser.storage.local.get("token");
  if (!token) return flashBadge(tabId, "T"); // 未配置 token

  try {
    const r = await fetch("http://127.0.0.1:37321/api/ext/clip", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        companyName: clip.companyName,
        positionTitle: clip.positionTitle,
        department: clip.department || null,
        workLocation: clip.workLocation || null,
        channel: clip.channel,
        jobUrl: clip.jobUrl || null,
        jdText: clip.jdText || null,
      }),
    });
    if (!r.ok) {
      await flashBadge(tabId, "×");
      return;
    }
    const body = (await r.json()) as { created: boolean };
    await flashBadge(tabId, body.created ? "✓" : "=");
  } catch {
    await flashBadge(tabId, "×"); // 应用未开/服务未启动
  }
}

async function flashBadge(tabId: number, text: string) {
  await browser.action.setBadgeText({ text, tabId });
  await browser.action.setBadgeBackgroundColor({
    tabId,
    color: text === "✓" ? "#10b981" : text === "=" ? "#64748b" : "#ef4444",
  });
  setTimeout(() => browser.action.setBadgeText({ text: "", tabId }), 2500);
}
