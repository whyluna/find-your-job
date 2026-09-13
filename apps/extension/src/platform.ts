import { browser } from "wxt/browser";
import { extractJobInPage, extractPageContextInPage, extractCompanyInPage, channelFromUrl } from "./extract";
import { API, emptyState, stateKey, type PanelState, type Platform, type Source } from "./drafts";

export function documentUrl(raw: string): string {
  const url = new URL(raw);
  // 页内普通锚点不是换岗位；SPA 路由属于来源地址。
  if (!url.hash.startsWith("#/") && !url.hash.startsWith("#!")) url.hash = "";
  return url.href;
}

export const platform: Platform = {
  async load(windowId) { const key = stateKey(windowId); const value = await browser.storage.session.get(key); return (value[key] as PanelState | undefined) ?? emptyState(); },
  async save(windowId, state) { await browser.storage.session.set({ [stateKey(windowId)]: state }); },
  async current(source: Source) {
    try {
      const frame = await browser.webNavigation.getFrame({ tabId: source.tabId, frameId: 0 });
      return !!frame && frame.documentId === source.documentId && documentUrl(frame.url) === documentUrl(source.url);
    } catch { return false; }
  },
  async capture(windowId) {
    const [tab] = await browser.tabs.query({ active: true, windowId });
    if (!tab?.id) throw new Error("找不到当前页面");
    try {
      const [extraction] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobInPage });
      const [context] = await browser.scripting.executeScript({ target: { tabId: tab.id, documentIds: [extraction.documentId] }, func: extractPageContextInPage });
      const [company] = await browser.scripting.executeScript({ target: { tabId: tab.id, documentIds: [extraction.documentId] }, func: extractCompanyInPage });
      if (!extraction.result || !context.result || extraction.documentId !== context.documentId) throw new Error("页面已变化");
      const clip = extraction.result;
      clip.channel = clip.channel === "OTHER" ? channelFromUrl(clip.jobUrl ?? "") : clip.channel;
      return { source: { tabId: tab.id, windowId, documentId: extraction.documentId, url: context.result.url, title: context.result.title }, clip, company: { ...company.result, companyName: clip.companyName || company.result?.companyName || "" } };
    } catch {
      throw new Error("无法读取当前页面。请在普通招聘网页点击一次工具栏的 FindYourJob 图标授权读取，再点击“收录当前页面”。");
    }
  },
  async page(source) {
    const [result] = await browser.scripting.executeScript({ target: { tabId: source.tabId, documentIds: [source.documentId] }, func: extractPageContextInPage });
    if (!result?.result || documentUrl(result.result.url) !== documentUrl(source.url)) throw new Error("来源页面已变化，请重新收录");
    return result.result;
  },
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { token = "" } = await browser.storage.local.get("token");
    if (!token) throw new Error("请先填写 App 设置中的 Token");
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(token).trim()}` }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    } catch { throw new Error("无法连接 App，请确认 FindYourJob 已打开并开启浏览器扩展接入"); }
    if (response.status === 401) throw new Error("Token 无效，请更新为 App 设置中的 Token");
    if (response.status === 404) throw new Error(path.includes("compan") ? "当前 App 不支持公司关注，请更新 FindYourJob 后重试" : "当前 App 不支持此解析任务，请更新 FindYourJob 或重新识别");
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error ?? `请求失败（${response.status}）`); }
    return response.status === 204 ? undefined as T : await response.json();
  },
};
