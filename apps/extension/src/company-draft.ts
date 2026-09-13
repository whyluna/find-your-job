import type { FollowCompanyInput } from "../../../packages/shared/src/ipc-types";
import { afterDays, defaultWatchConfig } from "../../../packages/shared/src/company-watch";
import type { ExtractResult } from "./extract";

export const COMPANY_FIELDS = ["companyId", "companyName", "website", "careersUrl", "recruitmentUrl", "year", "season", "status", "intervalDays", "nextCheckAt", "targetRole", "targetLocation", "notes"] as const;
export type CompanyField = typeof COMPANY_FIELDS[number];
export type CompanyPatch = Partial<Record<CompanyField, string>>;
export function newCompanyDraft(clip: ExtractResult, captured?: Partial<FollowCompanyInput>): FollowCompanyInput {
  return { ...defaultWatchConfig(), companyName: clip.companyName, ...captured, paused: false };
}
export function patchCompanyDraft(current: FollowCompanyInput, patch: CompanyPatch): FollowCompanyInput {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!COMPANY_FIELDS.includes(key as CompanyField) || typeof value !== "string" || value.length > 8192) throw new Error("无效公司字段");
    if (key === "year") next.year = Number(value);
    else if (key === "intervalDays") next.intervalDays = value === "" ? null : Number(value);
    else if (key === "season") { if (!["AUTUMN", "SPRING", "INTERNSHIP"].includes(value)) throw new Error("无效招聘季"); next.season = value as FollowCompanyInput["season"]; }
    else if (key === "status") { if (!["UNKNOWN", "NOT_OPEN", "OPEN", "CLOSED"].includes(value)) throw new Error("无效招聘状态"); next.status = value as FollowCompanyInput["status"]; }
    else Object.assign(next, { [key]: value || null });
  }
  if (patch.companyName !== undefined && patch.companyId === undefined) next.companyId = null;
  next.companyName = String(next.companyName ?? "");
  return next;
}
export function nextCompanyCheck(days: number) { return afterDays(days); }
