import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarClock } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDateTime, deadlineLabel } from "@/lib/format";
import { EVENT_TYPE_DEFS, type EventType } from "@shared";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data: upcoming, isLoading } = useQuery({
    queryKey: ["upcoming"],
    queryFn: () => api.getUpcoming(3, 7),
    refetchInterval: 5 * 60 * 1000,
  });
  const { data: db } = useQuery({ queryKey: ["db-ready"], queryFn: api.dbReady });

  return (
    <div className="px-6 pb-10 pt-0">
      <PageHeader title="仪表盘" subtitle="最近的截止与面试安排" />

      {/* 今日待办 */}
      <section className="mt-5 max-w-3xl rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900/60">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-[var(--fyj-accent)]" /> 最近待办
          <span className="text-[12px] font-normal text-[var(--fyj-tertiary)]">3 天内截止 · 7 天内面试</span>
        </h2>
        {isLoading && (
          <div className="mt-3 text-sm text-slate-400">加载中…</div>
        )}
        {!isLoading && (!upcoming || upcoming.length === 0) && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400 dark:border-slate-700/70">
            近期没有截止与面试
          </div>
        )}
        <div className="mt-3 space-y-1.5">
          {(upcoming ?? []).map((item, i) => (
            <button
              key={i}
              onClick={() => navigate(`/applications/${item.applicationId}`)}
              className="flex w-full items-center gap-3 rounded-[7px] px-2.5 py-2.5 text-left transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.055]"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-[6px]",
                  item.kind === "deadline"
                    ? "bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-300"
                    : "bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-300",
                )}
              >
                {item.kind === "deadline" ? (
                  <AlertCircle className="size-3.5" />
                ) : (
                  <CalendarClock className="size-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.companyName} · {item.positionTitle}
                </span>
                <span className="block text-[13px] text-slate-400">
                  {item.kind === "deadline"
                    ? `${EVENT_TYPE_DEFS[item.detail as EventType]?.label ?? item.detail} ${deadlineLabel(item.at)}`
                    : item.detail
                      ? `第 ${item.detail} 面试 · ${fmtDateTime(item.at)}`
                      : `面试 · ${fmtDateTime(item.at)}`}
                </span>
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-slate-400">{fmtDateTime(item.at)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 概况 */}
      <section className="mt-4 flex max-w-3xl gap-3">
        <div className="flex-1 rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900/60">
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{db?.applications ?? "—"}</div>
          <div className="mt-0.5 text-[13px] text-slate-400">
            投递总数 ·{" "}
            <Link to="/applications" className="text-[var(--fyj-accent)] hover:underline">
              去列表
            </Link>
          </div>
        </div>
        <div className="flex-1 rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900/60">
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{db?.events ?? "—"}</div>
          <div className="mt-0.5 text-[13px] text-slate-400">时间线事件</div>
        </div>
      </section>
    </div>
  );
}
