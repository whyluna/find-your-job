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
  const diffDays = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (diffDays < 0) return "已过期";
  if (diffDays === 0) return "今天截止";
  if (diffDays === 1) return "明天截止";
  return `${fmtDate(iso)} 截止`;
}
