/**
 * 自研日期时间选择器（WKWebView 原生 datetime 输入体验差，见设计 §5.1）。
 * 值为 ISO 字符串；withTime=false 时只选日期（时间为 00:00）。
 */
import { useMemo } from "react";
import { Select } from "@/components/ui";

interface Props {
  value: string | null;
  onChange: (iso: string | null) => void;
  withTime?: boolean;
  allowEmpty?: boolean;
}

function parse(value: string | null): { y: number; m: number; d: number; hh: number; mm: number } | null {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return {
    y: dt.getFullYear(),
    m: dt.getMonth() + 1,
    d: dt.getDate(),
    hh: dt.getHours(),
    mm: dt.getMinutes(),
  };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function DateTimePicker({ value, onChange, withTime = false, allowEmpty = true }: Props) {
  const cur = parse(value) ?? (() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(), hh: n.getHours(), mm: 0 };
  })();

  const years = useMemo(() => {
    const y0 = new Date().getFullYear();
    return Array.from({ length: 5 }, (_, i) => y0 - 1 + i);
  }, []);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: daysInMonth(cur.y, cur.m) }, (_, i) => i + 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  function emit(next: Partial<typeof cur>) {
    const merged = { ...cur, ...next };
    const d = new Date(merged.y, merged.m - 1, Math.min(merged.d, daysInMonth(merged.y, merged.m)), merged.hh, merged.mm);
    onChange(d.toISOString());
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        className="w-[86px]"
        value={allowEmpty && !value ? "" : String(cur.y)}
        onChange={(e) => (e.target.value ? emit({ y: +e.target.value }) : onChange(null))}
      >
        {allowEmpty && <option value="">—</option>}
        {years.map((y) => (
          <option key={y} value={y}>{y}年</option>
        ))}
      </Select>
      <Select
        className="w-[70px]"
        value={allowEmpty && !value ? "" : String(cur.m)}
        onChange={(e) => (e.target.value ? emit({ m: +e.target.value }) : onChange(null))}
      >
        {allowEmpty && <option value="">—</option>}
        {months.map((m) => (
          <option key={m} value={m}>{m}月</option>
        ))}
      </Select>
      <Select
        className="w-[70px]"
        value={allowEmpty && !value ? "" : String(cur.d)}
        onChange={(e) => (e.target.value ? emit({ d: +e.target.value }) : onChange(null))}
      >
        {allowEmpty && <option value="">—</option>}
        {days.map((d) => (
          <option key={d} value={d}>{d}日</option>
        ))}
      </Select>
      {withTime && (
        <>
          <Select className="w-[64px]" value={pad(cur.hh)} onChange={(e) => emit({ hh: +e.target.value })}>
            {hours.map((h) => (
              <option key={h} value={pad(h)}>{pad(h)}时</option>
            ))}
          </Select>
          <Select className="w-[64px]" value={pad(cur.mm)} onChange={(e) => emit({ mm: +e.target.value })}>
            {minutes.map((m) => (
              <option key={m} value={pad(m)}>{pad(m)}分</option>
            ))}
          </Select>
        </>
      )}
      <div className="flex gap-1">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[11px] text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
          onClick={() => onChange(new Date().toISOString())}
        >
          现在
        </button>
      </div>
    </div>
  );
}
