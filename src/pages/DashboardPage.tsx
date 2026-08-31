import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, Clock3, Inbox } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDateTime, deadlineLabel } from "@/lib/format";
import { EVENT_TYPE_DEFS, STATUS_LABELS, type EventType, type Status } from "@shared";
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
  const { data: savedApplications } = useQuery({
    queryKey: ["applications", "dashboard-saved"],
    queryFn: () => api.listApplications({ statuses: ["SAVED"] }),
  });
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: api.getStats });
  const overdue = (upcoming ?? []).filter((item) => item.kind === "overdue_interview");
  const future = (upcoming ?? []).filter((item) => item.kind !== "overdue_interview");

  return (
    <div className="px-6 pb-10 pt-0">
      <PageHeader title="仪表盘" subtitle="最近的截止与面试安排" />

      {/* 今日待办 */}
      <section className="mt-5 max-w-5xl rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-800/80 dark:bg-slate-900/60">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-[var(--fyj-accent)]" /> 最近待办
          <span className="text-[12px] font-normal text-[var(--fyj-tertiary)]">3 天内截止 · 7 天内面试</span>
        </h2>
        {isLoading && (
          <div className="mt-3 text-sm text-slate-400">加载中…</div>
        )}
        {!isLoading && overdue.length === 0 && future.length === 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400 dark:border-slate-700/70">
            近期没有截止与面试
          </div>
        )}
        {overdue.length > 0 && (
          <div className="mt-3 rounded-[9px] border border-red-200/80 bg-red-50/70 p-2 dark:border-red-900/60 dark:bg-red-900/15">
            <div className="px-2 pb-1 text-[12px] font-semibold text-red-600 dark:text-red-300">
              待补面试结果 · {overdue.length}
            </div>
            {overdue.map((item, i) => (
              <button
                key={`overdue-${item.applicationId}-${item.at}-${i}`}
                onClick={() => navigate(`/applications/${item.applicationId}`)}
                className="flex w-full items-center gap-3 rounded-[7px] px-2.5 py-2 text-left transition-colors hover:bg-red-100/60 dark:hover:bg-red-900/25"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-red-100 text-red-500 dark:bg-red-900/40 dark:text-red-300">
                  <AlertCircle className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.companyName} · {item.positionTitle}</span>
                  <span className="block text-[13px] text-red-500/80 dark:text-red-300/80">
                    第 {item.detail ?? "?"} 轮 · 原定 {fmtDateTime(item.at)}，请补充通过、未通过、取消或改期
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 space-y-1.5">
          {future.map((item, i) => (
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
      <section className="mt-4 flex max-w-5xl gap-3">
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

      <div className="mt-4 grid max-w-5xl grid-cols-2 gap-4">
        <section className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900/60">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Inbox className="size-4 text-[var(--fyj-accent)]" /> 已收录，待确认投递
          </h2>
          {(savedApplications ?? []).length === 0 ? (
            <div className="mt-3 text-[13px] text-[var(--fyj-tertiary)]">没有待确认的收录岗位</div>
          ) : (
            <div className="mt-2 space-y-1">
              {(savedApplications ?? []).slice(0, 5).map((application) => (
                <button
                  key={application.id}
                  onClick={() => navigate(`/applications/${application.id}`)}
                  className="flex w-full items-center justify-between rounded-[7px] px-2.5 py-2 text-left hover:bg-black/[0.035] dark:hover:bg-white/[0.055]"
                >
                  <span className="min-w-0 truncate text-[13px] font-medium">
                    {application.companyName} · {application.positionTitle}
                  </span>
                  <span className="ml-3 shrink-0 text-[12px] text-[var(--fyj-accent)]">去确认 →</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200/80 bg-white p-4 dark:border-slate-800/80 dark:bg-slate-900/60">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Clock3 className="size-4 text-amber-500" /> 等待过久
          </h2>
          {(stats?.silent ?? []).length === 0 ? (
            <div className="mt-3 text-[13px] text-[var(--fyj-tertiary)]">没有超过 14 天未推进的投递</div>
          ) : (
            <div className="mt-2 space-y-1">
              {(stats?.silent ?? []).slice(0, 5).map((application) => (
                <button
                  key={application.id}
                  onClick={() => navigate(`/applications/${application.id}`)}
                  className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left hover:bg-black/[0.035] dark:hover:bg-white/[0.055]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {application.companyName} · {application.positionTitle}
                  </span>
                  <span className="shrink-0 text-[12px] text-[var(--fyj-tertiary)]">
                    {STATUS_LABELS[application.status as Status]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
