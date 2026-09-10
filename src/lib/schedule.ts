import { fmtDateTime } from "./format";

export function planningLabel(kind: string, at: string, now = Date.now()): string | null {
  const past = new Date(at).getTime() < now;
  if (kind === "planned_apply") return `${past ? "计划已到期" : "计划投递"} · ${fmtDateTime(at)}`;
  if (kind === "application_deadline") return `${past ? "网申已截止" : "网申截止"} · ${fmtDateTime(at)}`;
  return null;
}

export interface ReminderItem {
  kind: string; applicationId: string; companyName: string; positionTitle: string;
  detail?: string | null; at: string;
}

export function reminderFor(item: ReminderItem, now: number, deadlineHours: number, interviewHours: number) {
  if (item.kind === "overdue_interview") return null;
  const at = new Date(item.at).getTime();
  const planning = item.kind === "planned_apply" || item.kind === "application_deadline";
  if (!Number.isFinite(at) || (!planning && at < now)) return null;
  const hoursLeft = (at - now) / 3600000;
  const threshold = item.kind === "interview" ? interviewHours : deadlineHours;
  if (hoursLeft > threshold) return null;
  const label = planningLabel(item.kind, item.at, now) ?? (item.kind === "deadline"
    ? `${Math.max(1, Math.ceil(hoursLeft))} 小时内截止`
    : `第 ${item.detail ?? "?"} 轮面试即将开始`);
  return {
    key: `${item.kind}:${item.applicationId}:${item.at}:${threshold}`,
    title: `${item.companyName} · ${label}`, body: item.positionTitle,
  };
}
