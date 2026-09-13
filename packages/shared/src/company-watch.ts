import type { CompanyWatch, CompanyWatchConfig, RecruitmentSeason, RecruitmentStatus } from "./ipc-types";

export const RECRUITMENT_STATUS_LABELS: Record<RecruitmentStatus, string> = {
  UNKNOWN: "待确认", NOT_OPEN: "尚未开启", OPEN: "招聘已启动", CLOSED: "已结束",
};
export const RECRUITMENT_SEASON_LABELS: Record<RecruitmentSeason, string> = {
  AUTUMN: "秋招", SPRING: "春招", INTERNSHIP: "实习招募",
};
export const watchSeasonLabel = (watch: Pick<CompanyWatchConfig, "year" | "season">) =>
  `${watch.year} 届${RECRUITMENT_SEASON_LABELS[watch.season]}`;
export function afterDays(days: number, now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}
export function defaultWatchConfig(now = new Date()): CompanyWatchConfig {
  return {
    year: now.getFullYear() + (now.getMonth() >= 6 ? 1 : 0),
    season: now.getMonth() >= 6 ? "AUTUMN" : "SPRING", status: "UNKNOWN",
    intervalDays: 7, nextCheckAt: afterDays(7, now), paused: false,
  };
}
export function watchIsDue(watch: CompanyWatch, now = Date.now()): boolean {
  return !watch.paused && watch.status !== "CLOSED" && !!watch.nextCheckAt
    && Number.isFinite(Date.parse(watch.nextCheckAt)) && Date.parse(watch.nextCheckAt) <= now;
}
export function pendingCompanyChecks(watches: CompanyWatch[], notified: Record<string, string>, now = Date.now()) {
  return watches.filter(w => watchIsDue(w, now) && notified[w.id] !== w.nextCheckAt);
}
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
export function companyWebsite(raw?: string | null): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
