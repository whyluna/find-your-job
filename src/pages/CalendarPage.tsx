/** 日历视图：月历三色点（面试=蓝 / 截止=红 / 投递=灰），点击日查看明细 */
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { EVENT_TYPE_DEFS, type EventType } from "@shared";
import { cn } from "@/lib/utils";
import { Button, PageHeader } from "@/components/ui";

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

  const range = useMemo(
    () => ({
      start: new Date(cursor.y, cursor.m, 1).toISOString(),
      end: new Date(cursor.y, cursor.m + 1, 1).toISOString(),
    }),
    [cursor],
  );
  const { data: calendarItems } = useQuery({
    queryKey: ["calendar-items", range.start, range.end],
    queryFn: () => api.getCalendarItems(range.start, range.end),
    staleTime: 5 * 60 * 1000,
  });
  const all = useMemo<CalendarEntry[]>(() => {
    const list: CalendarEntry[] = [];
    for (const u of calendarItems ?? []) {
      if (!u.at) continue;
      list.push({
        date: fmtDate(u.at),
        kind: u.kind,
        applicationId: u.applicationId,
        companyName: u.companyName,
        positionTitle: u.positionTitle,
        detail: u.detail,
        at: u.at,
      });
    }
    return list;
  }, [calendarItems]);

  useEffect(() => {
    const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-`;
    if (!selected.startsWith(monthPrefix)) setSelected(`${monthPrefix}01`);
  }, [cursor, selected]);
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
  const selectedLabel = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${selected}T00:00:00Z`));

  return (
    <div className="px-6 pb-10 pt-0">
      <PageHeader
        title="日历"
        subtitle="面试、截止日期与投递记录"
        actions={
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label="上个月"
              onClick={() =>
                setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
              }
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const n = new Date();
                setCursor({ y: n.getFullYear(), m: n.getMonth() });
                setSelected(todayStr);
              }}
            >
              今天
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="下个月"
              onClick={() =>
                setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))
              }
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <div className="mx-auto mt-5 grid max-w-[1120px] grid-cols-[minmax(520px,1fr)_290px] gap-4">
        {/* 月历 */}
        <div className="native-panel p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
              {cursor.y} 年 {cursor.m + 1} 月
            </h2>
            <div className="flex gap-3 text-[11px] text-[var(--fyj-tertiary)]">
              <Legend color="bg-blue-500" label="面试" />
              <Legend color="bg-red-500" label="截止" />
              <Legend color="bg-slate-400" label="投递" />
            </div>
          </div>
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-[var(--fyj-tertiary)]">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1.5">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
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
                    "group flex h-[68px] flex-col items-center rounded-[8px] pt-2 transition-colors",
                    selected === date
                      ? "bg-[var(--fyj-accent-soft)]"
                      : "hover:bg-black/[0.035] dark:hover:bg-white/[0.055]",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[12px] tabular-nums text-[var(--fyj-secondary)]",
                      isToday && "bg-[var(--fyj-accent)] font-semibold text-white",
                      selected === date && !isToday && "font-semibold text-[var(--fyj-accent)]",
                    )}
                  >
                    {+date.slice(8)}
                  </span>
                  <span className="mt-1.5 flex gap-1">
                    {hasInterview && <span className="size-1.5 rounded-full bg-blue-500" title="面试" />}
                    {hasDeadline && <span className="size-1.5 rounded-full bg-red-500" title="截止" />}
                    {hasApplied && <span className="size-1.5 rounded-full bg-slate-400" title="投递" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 当日明细 */}
        <div className="native-panel min-h-[460px] overflow-hidden">
          <div className="border-b border-[var(--fyj-separator)] px-4 py-3.5">
            <h2 className="text-[14px] font-semibold">{selectedLabel}</h2>
            <p className="mt-0.5 text-[11px] tabular-nums text-[var(--fyj-tertiary)]">{selected}</p>
          </div>
          {selectedEntries.length === 0 ? (
            <div className="flex min-h-[330px] flex-col items-center justify-center px-6 text-center">
              <CalendarDays className="size-8 text-[var(--fyj-tertiary)] opacity-45" strokeWidth={1.4} />
              <div className="mt-3 text-[13px] font-medium text-[var(--fyj-secondary)]">当天没有安排</div>
              <div className="mt-1 text-[11px] leading-relaxed text-[var(--fyj-tertiary)]">
                投递、面试和流程截止日期会自动出现在这里
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--fyj-separator)] px-2 py-1.5">
              {selectedEntries.map((e, i) => (
                <button
                  key={i}
                  onClick={() => navigate(`/applications/${e.applicationId}`)}
                  className="group relative w-full rounded-[7px] px-3 py-3 text-left transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.055]"
                >
                  <span className={cn(
                    "absolute bottom-3 left-0 top-3 w-0.5 rounded-full",
                    e.kind === "deadline" ? "bg-red-500" : e.kind === "interview" ? "bg-blue-500" : "bg-slate-400",
                  )} />
                  <div className="truncate text-[13px] font-medium">
                    {e.companyName} · {e.positionTitle}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--fyj-tertiary)]">
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

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}
