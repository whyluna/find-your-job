/**
 * 通知调度器：每 5 分钟轮询今日待办，临近截止/面试发系统通知（去重）。
 * 轮询而非常驻后台任务——应用打开时生效，符合"人在用时提醒"的定位。
 */
import { api } from "./ipc";

const INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "fyj-notified";

interface UpcomingItem {
  kind: string;
  applicationId: string;
  companyName: string;
  positionTitle: string;
  detail?: string | null;
  at: string;
}

function loadNotified(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveNotified(set: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set].slice(-200)));
}

export async function startNotifier() {
  let granted = false;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    if (!granted) return;

    const tick = async () => {
      const items = await api.getUpcoming(1, 1).catch(() => [] as UpcomingItem[]);
      const now = Date.now();
      const notified = loadNotified();
      for (const item of items as UpcomingItem[]) {
        const at = new Date(item.at).getTime();
        if (Number.isNaN(at) || at < now) continue;
        const hoursLeft = (at - now) / 3600000;
        // 截止：24h 内提醒一次；面试：2h 内提醒一次
        const shouldNotify =
          item.kind === "deadline" ? hoursLeft <= 24 : hoursLeft <= 2;
        if (!shouldNotify) continue;
        const key = `${item.kind}:${item.applicationId}:${item.at}`;
        if (notified.has(key)) continue;
        const label =
          item.kind === "deadline" ? "今天截止" : item.detail ? `即将面试（${item.detail}）` : "即将面试";
        sendNotification({
          title: `${item.companyName} · ${label}`,
          body: item.positionTitle,
        });
        notified.add(key);
      }
      saveNotified(notified);
    };

    await tick();
    setInterval(tick, INTERVAL_MS);
  } catch {
    // 通知不可用时静默降级（不影响主功能）
  }
}
