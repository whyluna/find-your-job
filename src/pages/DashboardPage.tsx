/** 仪表盘：今日待办（3天内截止 + 7天内面试）+ 数据概况 */
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, Database, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDateTime, deadlineLabel } from "@/lib/format";
import { EVENT_TYPE_DEFS, type EventType } from "@shared";
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
    <div className="p-8">
      <h1 className="text-xl font-semibold">仪表盘</h1>

      {/* 今日待办 */}
      <section className="mt-4 max-w-2xl rounded-xl border border-slate-200 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4" /> 最近待办
          <span className="text-xs font-normal text-slate-400">3 天内截止 · 7 天内面试</span>
        </h2>
        {isLoading && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="size-4 animate-spin" /> 加载中…
          </div>
        )}
        {!isLoading && (!upcoming || upcoming.length === 0) && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
            近期没有截止与面试，冲！
          </div>
        )}
        <div className="mt-3 space-y-1.5">
          {(upcoming ?? []).map((item, i) => (
            <button
              key={i}
              onClick={() => navigate(`/applications/${item.applicationId}`)}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-slate-800 dark:hover:border-indigo-700 dark:hover:bg-indigo-900/15"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px]",
                  item.kind === "deadline"
                    ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                    : "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300",
                )}
              >
                {item.kind === "deadline" ? <AlertCircle className="size-4" /> : <CalendarClock className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.companyName} · {item.positionTitle}
                </span>
                <span className="block text-xs text-slate-400">
                  {item.kind === "deadline"
                    ? `${EVENT_TYPE_DEFS[item.detail as EventType]?.label ?? item.detail} ${deadlineLabel(item.at)}`
                    : item.detail
                      ? `第 ${item.detail} 面试 · ${fmtDateTime(item.at)}`
                      : `面试 · ${fmtDateTime(item.at)}`}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">{fmtDateTime(item.at)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 概况 */}
      <section className="mt-4 flex max-w-2xl gap-3">
        <div className="flex-1 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="text-2xl font-semibold tabular-nums">{db?.applications ?? "—"}</div>
          <div className="mt-0.5 text-xs text-slate-400">
            投递总数 ·{" "}
            <Link to="/applications" className="text-indigo-500 hover:underline">
              去列表
            </Link>
          </div>
        </div>
        <div className="flex-1 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="text-2xl font-semibold tabular-nums">{db?.events ?? "—"}</div>
          <div className="mt-0.5 text-xs text-slate-400">时间线事件</div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-xs text-slate-400 dark:border-slate-800">
          <Database className="size-3.5 shrink-0 text-emerald-500" />
          {db?.ok ? "本地数据库正常" : "…"}
        </div>
      </section>
    </div>
  );
}
