/** 右键菜单"收录到 FindYourJob"：提取 → 直接 POST → badge 反馈 */
export default defineBackground(() => {
  browser.contextMenus.create({
    id: "fyj-clip",
    title: "收录到 FindYourJob",
    contexts: ["page"],
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "fyj-clip" || !tab?.id) return;
    await clipToApp(tab.id);
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
        companyName: clip.companyName || "未知公司",
        positionTitle: clip.positionTitle || "未知岗位",
        department: clip.department || null,
        workLocation: clip.workLocation || null,
        channel: clip.channel,
        jobUrl: clip.jobUrl || null,
        jdText: clip.jdText || null,
      }),
    });
    await flashBadge(tabId, r.ok ? "✓" : "×");
  } catch {
    await flashBadge(tabId, "×"); // 应用未开/服务未启动
  }
}

async function flashBadge(tabId: number, text: string) {
  await browser.action.setBadgeText({ text, tabId });
  await browser.action.setBadgeBackgroundColor({
    tabId,
    color: text === "✓" ? "#10b981" : "#ef4444",
  });
  setTimeout(() => browser.action.setBadgeText({ text: "", tabId }), 2500);
}
