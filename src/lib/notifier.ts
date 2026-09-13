/** 应用运行期间的系统通知调度器。权限只在用户从设置页显式开启时申请。 */
import { api } from "./ipc";
import { reminderFor } from "./schedule";
import { localDay, pendingCompanyChecks } from "./company-watch";

const INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "fyj-notified";
let intervalId: number | null = null;
let ticking = false;

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

async function readHours(key: string, fallback: number): Promise<number> {
  const raw = await api.getSetting(key).catch(() => null);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const [{ sendNotification }, deadlineHours, interviewHours] = await Promise.all([
      import("@tauri-apps/plugin-notification"),
      readHours("deadline_reminder_hours", 24),
      readHours("interview_reminder_hours", 2),
    ]);
    const days = Math.max(1, Math.ceil(Math.max(deadlineHours, interviewHours) / 24));
    const items = await api.getUpcoming(days, days).catch(() => [] as UpcomingItem[]);
    const now = Date.now();
    const notified = loadNotified();
    for (const item of items as UpcomingItem[]) {
      const reminder = reminderFor(item, now, deadlineHours, interviewHours);
      if (!reminder || notified.has(reminder.key)) continue;
      await sendNotification({ title: reminder.title, body: reminder.body });
      notified.add(reminder.key);
    }
    saveNotified(notified);
    // 公司查看提醒按到期日期去重，且一天至多一条汇总；旧到期项不会每五分钟催促。
    const watches = await api.listCompanyWatches().catch(() => null);
    if (!watches) return;
    let delivered: Record<string, string> = {};
    try { delivered = JSON.parse(localStorage.getItem("fyj-company-check-notified") ?? "{}"); } catch { /* 使用空记录 */ }
    if (!delivered || typeof delivered !== "object" || Array.isArray(delivered)) delivered = {};
    const pending = pendingCompanyChecks(watches, delivered, now);
    const day = localDay(new Date(now));
    if (pending.length && localStorage.getItem("fyj-company-check-notice-day") !== day) {
      const names = [...new Set(pending.map(w => w.companyName))].slice(0, 3).join("、");
      await sendNotification({ title: `${pending.length} 项公司招聘动态待查看`, body: `${names}。打开 FindYourJob → 公司 → 待查看，确认本届招聘进展。` });
      for (const watch of pending) delivered[watch.id] = watch.nextCheckAt!;
      localStorage.setItem("fyj-company-check-notice-day", day);
    }
    const existing = new Set(watches.map(w => w.id));
    localStorage.setItem("fyj-company-check-notified", JSON.stringify(Object.fromEntries(Object.entries(delivered).filter(([id]) => existing.has(id)))));
  } finally {
    ticking = false;
  }
}

export async function startNotifier() {
  if (intervalId !== null) return;
  try {
    const enabled = (await api.getSetting("notifications_enabled")) === "true";
    if (!enabled) return;
    const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
    if (!(await isPermissionGranted())) return;
    await tick().catch(() => undefined);
    intervalId = window.setInterval(() => void tick().catch(() => undefined), INTERVAL_MS);
  } catch {
    // 通知不可用时不影响主流程；设置页会给出显式反馈。
  }
}

export async function setNotificationsEnabled(enabled: boolean) {
  if (!enabled) {
    await api.setSetting("notifications_enabled", "false");
    if (intervalId !== null) window.clearInterval(intervalId);
    intervalId = null;
    return;
  }
  const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
  const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
  if (!granted) throw new Error("系统通知权限未开启，请在 macOS 系统设置中允许 FindYourJob 发送通知");
  await api.setSetting("notifications_enabled", "true");
  await startNotifier();
}

export async function refreshNotifierSchedule() {
  if (intervalId !== null) window.clearInterval(intervalId);
  intervalId = null;
  await startNotifier();
}
