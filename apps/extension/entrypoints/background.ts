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
