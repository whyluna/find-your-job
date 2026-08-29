/** 日历视图：月历三色点（面试=蓝 / 截止=红 / 投递=灰），点击日查看明细 */
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { EVENT_TYPE_DEFS, type EventType } from "@shared";
import { cn } from "@/lib/utils";

interface CalendarEntry {
  date: string; // YYYY-MM-DD
  kind: "interview" | "deadline" | "applied";
  applicationId: string;
  companyName: string;
  positionTitle: string;
  detail?: string | null;
  at: string;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export default function CalendarPage() {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selected, setSelected] = useState<string>(fmtDate(new Date().toISOString()));

  const { data: apps } = useQuery({
    queryKey: ["cal-applications"],
    queryFn: () => api.listApplications({ includeArchived: true }),
  });

  const entries = useMemo<CalendarEntry[]>(() => {
    const list: CalendarEntry[] = [];
    for (const a of apps ?? []) {
      if (a.appliedDate)
        list.push({
          date: a.appliedDate.slice(0, 10),
          kind: "applied",
          applicationId: a.id,
          companyName: a.companyName,
          positionTitle: a.positionTitle,
          at: a.appliedDate,
        });
    }
    return list;
  }, [apps]);

  const { data: upcoming } = useQuery({
    queryKey: ["cal-upcoming"],
    queryFn: () => api.getUpcoming(60, 90),
    staleTime: 5 * 60 * 1000,
  });
  const calEvents = useMemo<CalendarEntry[]>(() => {
    const list: CalendarEntry[] = [];
    for (const u of upcoming ?? []) {
      if (!u.at) continue;
      list.push({
        date: u.at.slice(0, 10),
        kind: u.kind === "deadline" ? "deadline" : "interview",
        applicationId: u.applicationId,
        companyName: u.companyName,
        positionTitle: u.positionTitle,
        detail: u.detail,
        at: u.at,
      });
    }
    return list;
  }, [upcoming]);

  const all = useMemo(() => [...entries, ...calEvents], [entries, calEvents]);
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of all) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    return map;
  }, [all]);

  // 月历网格：周一开头
  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startOffset = (first.getDay() + 6) % 7; // 周一=0
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(
        `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      );
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const todayStr = fmtDate(new Date().toISOString());
  const selectedEntries = byDate.get(selected) ?? [];

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[17px] font-semibold tracking-tight">
          {cursor.y} 年 {cursor.m + 1} 月
        </h1>
        <div className="flex items-center gap-1">
          <button
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() =>
              setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
            }
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            className="rounded-lg px-2 py-1 text-[13px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => {
              const n = new Date();
              setCursor({ y: n.getFullYear(), m: n.getMonth() });
              setSelected(todayStr);
            }}
          >
            今天
          </button>
          <button
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() =>
              setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))
            }
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_280px] gap-4">
        {/* 月历 */}
        <div className="rounded-xl border border-slate-200/80 p-3 dark:border-slate-800/80">
          <div className="mb-1 grid grid-cols-7 text-center text-[13px] text-slate-400">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map((date, i) => {
              if (!date) return <div key={i} />;
              const dayEntries = byDate.get(date) ?? [];
              const hasInterview = dayEntries.some((e) => e.kind === "interview");
              const hasDeadline = dayEntries.some((e) => e.kind === "deadline");
              const hasApplied = dayEntries.some((e) => e.kind === "applied");
              const isToday = date === todayStr;
              return (
                <button
                  key={date}
                  onClick={() => setSelected(date)}
                  className={cn(
                    "flex h-16 flex-col items-center rounded-lg border pt-1.5 transition-colors",
                    selected === date
                      ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-500 dark:bg-indigo-900/20"
                      : "border-transparent hover:border-slate-200 dark:hover:border-slate-700",
                    isToday && "ring-1 ring-indigo-300 dark:ring-indigo-600",
                  )}
                >
                  <span
                    className={cn(
                      "text-[13px]",
                      isToday ? "font-bold text-indigo-600 dark:text-indigo-400" : "text-slate-600 dark:text-slate-300",
                    )}
                  >
                    {+date.slice(8)}
                  </span>
                  <span className="mt-1 flex gap-0.5">
                    {hasInterview && <span className="size-1.5 rounded-full bg-indigo-500" title="面试" />}
                    {hasDeadline && <span className="size-1.5 rounded-full bg-red-500" title="截止" />}
                    {hasApplied && <span className="size-1.5 rounded-full bg-slate-400" title="投递" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-indigo-500" />面试</span>
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-red-500" />截止</span>
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-slate-400" />投递</span>
          </div>
        </div>

        {/* 当日明细 */}
        <div className="rounded-xl border border-slate-200/80 p-4 dark:border-slate-800/80">
          <h2 className="text-sm font-semibold">{selected}</h2>
          {selectedEntries.length === 0 ? (
            <div className="mt-4 text-[13px] text-slate-400">当天没有安排</div>
          ) : (
            <div className="mt-3 space-y-2">
              {selectedEntries.map((e, i) => (
                <button
                  key={i}
                  onClick={() => navigate(`/applications/${e.applicationId}`)}
                  className={cn(
                    "w-full rounded-lg border p-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50",
                    e.kind === "deadline"
                      ? "border-red-200 dark:border-red-900/50"
                      : e.kind === "interview"
                        ? "border-indigo-200 dark:border-indigo-900/50"
                        : "border-slate-200 dark:border-slate-700",
                  )}
                >
                  <div className="text-sm font-medium">
                    {e.companyName} · {e.positionTitle}
                  </div>
                  <div className="mt-0.5 text-[13px] text-slate-400">
                    {e.kind === "applied"
                      ? "投递日"
                      : e.kind === "deadline"
                        ? `${EVENT_TYPE_DEFS[e.detail as EventType]?.label ?? e.detail} 截止`
                        : `${e.detail ?? "面试"} · ${fmtDateTime(e.at)}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
