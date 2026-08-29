/**
 * 成熟日期时间选择器：日历面板（任意年份翻页/直接输入年月）、时间选择（时/分下拉）、
 * 快捷今天/清空；minIso 可约束不得早于某时刻（如截止 ≥ 发生）。
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  value: string | null; // ISO
  onChange: (iso: string | null) => void;
  withTime?: boolean;
  /** 可选最早时刻（ISO）；选择早于它时自动钳制到该时刻并提示 */
  minIso?: string | null;
  placeholder?: string;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

// 输出必须带时区（RFC3339），否则 Rust 端 DateTime 反序列化失败
function fmtIso(d: Date): string {
  return d.toISOString();
}

function parseIso(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function DatePicker({ value, onChange, withTime = false, minIso, placeholder = "选择日期" }: Props) {
  const cur = parseIso(value);
  const min = parseIso(minIso ?? null);
  const [open, setOpen] = useState(false);
  // 面板视图月（默认当前值或今天）
  const [viewY, setViewY] = useState(() => (cur ?? new Date()).getFullYear());
  const [viewM, setViewM] = useState(() => (cur ?? new Date()).getMonth());
  const [yearInput, setYearInput] = useState<string>("");
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (open) {
      const base = cur ?? new Date();
      setViewY(base.getFullYear());
      setViewM(base.getMonth());
      setYearInput("");
      setHint("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cur) {
      setViewY(cur.getFullYear());
      setViewM(cur.getMonth());
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const grid = useMemo(() => {
    const first = new Date(viewY, viewM, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewY, viewM, d));
    return cells;
  }, [viewY, viewM]);

  const today = new Date();

  function emit(next: Date) {
    let d = next;
    if (min && d < min) {
      d = new Date(min);
      setHint("不能早于开始时间，已自动调整");
    } else {
      setHint("");
    }
    onChange(fmtIso(d));
  }

  function pickDay(d: Date) {
    const time = cur ?? min ?? new Date();
    d.setHours(withTime ? time.getHours() : 0, withTime ? time.getMinutes() : 0, 0, 0);
    emit(d);
    if (!withTime) setOpen(false);
  }

  const label = useMemo(() => {
    if (!cur) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return withTime
      ? `${cur.getFullYear()}-${p(cur.getMonth() + 1)}-${p(cur.getDate())} ${p(cur.getHours())}:${p(cur.getMinutes())}`
      : `${cur.getFullYear()}-${p(cur.getMonth() + 1)}-${p(cur.getDate())}`;
  }, [cur, withTime]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-lg border border-slate-200/90 bg-white px-2.5 text-left text-sm dark:border-slate-700 dark:bg-slate-800",
          !cur && "text-slate-400",
        )}
      >
        <span>{label || placeholder}</span>
        <span className="text-[11px] text-slate-400">{withTime ? "📅 时间" : "📅"}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-40 w-[264px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            {/* 年月导航 */}
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const d = new Date(viewY, viewM - 1, 1);
                  setViewY(d.getFullYear());
                  setViewM(d.getMonth());
                }}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <ChevronLeft className="size-4" />
              </button>
              <input
                value={yearInput || String(viewY)}
                onChange={(e) => setYearInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onBlur={() => {
                  const y = parseInt(yearInput, 10);
                  if (yearInput && y >= 1900 && y <= 2999) setViewY(y);
                  setYearInput("");
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="w-12 rounded border border-transparent text-center text-sm font-medium hover:border-slate-200 focus:border-indigo-400 focus:outline-none dark:hover:border-slate-600"
              />
              <span className="text-sm font-medium">{viewM + 1} 月</span>
              <button
                type="button"
                onClick={() => {
                  const d = new Date(viewY, viewM + 1, 1);
                  setViewY(d.getFullYear());
                  setViewM(d.getMonth());
                }}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <ChevronRight className="size-4" />
              </button>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const t = new Date();
                    setViewY(t.getFullYear());
                    setViewM(t.getMonth());
                  }}
                  className="rounded-md px-1.5 py-0.5 text-[11px] text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                >
                  今天
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  清空
                </button>
              </div>
            </div>
            {/* 星期头 */}
            <div className="grid grid-cols-7 text-center text-[11px] text-slate-400">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1">{w}</div>
              ))}
            </div>
            {/* 日期网格 */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {grid.map((d, i) =>
                d ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickDay(d)}
                    disabled={!!min && new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59) < min}
                    className={cn(
                      "mx-auto flex size-8 items-center justify-center rounded-lg text-[13px] transition-colors",
                      cur &&
                        d.getFullYear() === cur.getFullYear() &&
                        d.getMonth() === cur.getMonth() &&
                        d.getDate() === cur.getDate()
                        ? "bg-indigo-600 font-semibold text-white"
                        : d.getFullYear() === today.getFullYear() &&
                            d.getMonth() === today.getMonth() &&
                            d.getDate() === today.getDate()
                          ? "text-indigo-600 font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                          : "hover:bg-slate-100 dark:hover:bg-slate-700",
                      !!min && new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59) < min && "text-slate-300 dark:text-slate-600",
                    )}
                  >
                    {d.getDate()}
                  </button>
                ) : (
                  <div key={i} />
                ),
              )}
            </div>
            {/* 时间 */}
            {withTime && cur && (
              <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-700">
                <span className="text-xs text-slate-400">时间</span>
                <select
                  value={String(cur.getHours())}
                  onChange={(e) => emit(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), +e.target.value, cur.getMinutes()))}
                  className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[13px] dark:border-slate-600 dark:bg-slate-800"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")} 时</option>
                  ))}
                </select>
                <select
                  value={String(cur.getMinutes())}
                  onChange={(e) => emit(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours(), +e.target.value))}
                  className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[13px] dark:border-slate-600 dark:bg-slate-800"
                >
                  {Array.from({ length: 60 }, (_, m) => (
                    <option key={m} value={m}>{String(m).padStart(2, "0")} 分</option>
                  ))}
                </select>
              </div>
            )}
            {hint && <div className="mt-1.5 text-[11px] text-amber-500">{hint}</div>}
          </div>
        </>
      )}
    </div>
  );
}
