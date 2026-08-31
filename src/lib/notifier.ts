/** 应用运行期间的系统通知调度器。权限只在用户从设置页显式开启时申请。 */
import { api } from "./ipc";

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
      if (item.kind === "overdue_interview") continue;
      const at = new Date(item.at).getTime();
      if (Number.isNaN(at) || at < now) continue;
      const hoursLeft = (at - now) / 3600000;
      const threshold = item.kind === "deadline" ? deadlineHours : interviewHours;
      if (hoursLeft > threshold) continue;
      const key = `${item.kind}:${item.applicationId}:${item.at}:${threshold}`;
      if (notified.has(key)) continue;
      const label =
        item.kind === "deadline"
          ? `${Math.max(1, Math.ceil(hoursLeft))} 小时内截止`
          : item.detail
            ? `第 ${item.detail} 轮面试即将开始`
            : "面试即将开始";
      await sendNotification({
        title: `${item.companyName} · ${label}`,
        body: item.positionTitle,
      });
      notified.add(key);
    }
    saveNotified(notified);
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
    await tick();
    intervalId = window.setInterval(() => void tick(), INTERVAL_MS);
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
