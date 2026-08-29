/** 展示格式化：日期、紧急度 */

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/** 距截止不足 hours 小时视为紧急 */
export function isUrgent(iso?: string | null, hours = 72): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const diff = t - Date.now();
  return diff > 0 && diff < hours * 3600 * 1000;
}

export function deadlineLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // 按日历日差计算（"今天/明天"是日历语义，不是 24 小时语义）
  const day0 = new Date();
  day0.setHours(0, 0, 0, 0);
  const day1 = new Date(d);
  day1.setHours(0, 0, 0, 0);
  const diffDays = Math.round((day1.getTime() - day0.getTime()) / 86400000);
  if (d.getTime() < Date.now()) return "已过期";
  if (diffDays === 0) return "今天截止";
  if (diffDays === 1) return "明天截止";
  return `${fmtDate(iso)} 截止`;
}
