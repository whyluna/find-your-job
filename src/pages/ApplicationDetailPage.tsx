/** 投递详情页（P0-4 骨架：头部 + 时间线只读；P0-6 补行内编辑与面试逐题） */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText } from "lucide-react";
import { Link, useParams } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDate, fmtDateTime, deadlineLabel, isUrgent } from "@/lib/format";
import {
  BATCH_LABELS,
  CHANNEL_LABELS,
  EVENT_RESULT_LABELS,
  EVENT_TYPE_DEFS,
  INTERVIEW_OUTCOME_LABELS,
  INTERVIEW_STATUS_LABELS,
  PRIORITY_LABELS,
  type EventResult,
  type InterviewOutcome,
  type InterviewStatus,
} from "@shared";
import { StatusBadge } from "@/components/ui";

function eventLabel(type: string): string {
  return EVENT_TYPE_DEFS[type as keyof typeof EVENT_TYPE_DEFS]?.label ?? type;
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["application-detail", id],
    queryFn: () => api.getApplicationDetail(id!),
    enabled: !!id,
  });

  if (isLoading) return <div className="p-8 text-slate-400">加载中…</div>;
  if (isError)
    return (
      <div className="p-8">
        <div className="text-red-500">加载失败：{String(error)}</div>
        <Link to="/applications" className="mt-2 inline-block text-sm text-indigo-500">
          返回列表
        </Link>
      </div>
    );

  const app = data!;
  // 时间线 = 事件 + 面试合并（面试渲染为特殊条目）
  const timeline = [
    ...app.events.map((e) => ({
      kind: "event" as const,
      at: e.occurredAt,
      data: e,
    })),
    ...app.interviews.map((iv) => ({
      kind: "interview" as const,
      at: iv.scheduledAt ?? iv.createdAt,
      data: iv,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div className="p-8">
      <Link
        to="/applications"
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
      >
        <ArrowLeft className="size-3.5" /> 返回投递列表
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold">
          {app.companyName} · {app.positionTitle}
        </h1>
        <StatusBadge status={app.status} />
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {BATCH_LABELS[app.batch as keyof typeof BATCH_LABELS] ?? app.batch}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {CHANNEL_LABELS[app.channel as keyof typeof CHANNEL_LABELS] ?? app.channel}
        </span>
        <span className="text-xs text-slate-400">
          优先级{PRIORITY_LABELS[app.priority]}
          {app.workLocation ? ` · ${app.workLocation}` : ""}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>投递日：{fmtDate(app.appliedDate)}</span>
        <span>
          简历版本：
          {app.resumeVersionName ?? <span className="text-amber-500">未标注</span>}
        </span>
        {app.tags.map((t) => (
          <span key={t} className="text-indigo-500">
            #{t}
          </span>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-[1fr_320px] gap-6">
        {/* 时间线 */}
        <div className="rounded-xl border border-slate-200 p-5 dark:border-slate-800">
          <h2 className="mb-4 text-sm font-semibold">时间线（编辑功能下一步加入）</h2>
          <div className="space-y-0">
            {timeline.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">暂无事件</div>
            )}
            {timeline.map((t, i) => (
              <div key={i} className="relative flex gap-3 pb-5 last:pb-0">
                {i < timeline.length - 1 && (
                  <div className="absolute left-[5px] top-4 h-full w-px bg-slate-200 dark:bg-slate-700" />
                )}
                <div
                  className={
                    t.kind === "interview"
                      ? "mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-indigo-400 bg-white dark:bg-slate-900"
                      : "mt-1.5 size-[11px] shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
                  }
                />
                <div className="min-w-0 flex-1">
                  {t.kind === "event" ? (
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{eventLabel(t.data.type)}</span>
                        {t.data.result && (
                          <span
                            className={
                              t.data.result === "PASS"
                                ? "text-xs text-emerald-600"
                                : t.data.result === "FAIL"
                                  ? "text-xs text-red-500"
                                  : "text-xs text-slate-400"
                            }
                          >
                            {EVENT_RESULT_LABELS[t.data.result as EventResult]}
                          </span>
                        )}
                        {isUrgent(t.data.deadline ?? null) && (
                          <span className="text-xs text-red-500">
                            {deadlineLabel(t.data.deadline)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {fmtDateTime(t.data.occurredAt)}
                        {t.data.deadline && !isUrgent(t.data.deadline) && (
                          <span className="ml-2">截止 {fmtDateTime(t.data.deadline)}</span>
                        )}
                      </div>
                      {t.data.note && (
                        <div className="mt-1 whitespace-pre-wrap text-xs text-slate-500">
                          {t.data.note}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-indigo-600 dark:text-indigo-400">
                          第 {t.data.round} 轮面试
                          {t.data.roundLabel ? `（${t.data.roundLabel}）` : ""}
                        </span>
                        <span className="text-xs text-slate-400">
                          {INTERVIEW_STATUS_LABELS[t.data.status as InterviewStatus]}
                          {t.data.status === "COMPLETED" &&
                            ` · ${INTERVIEW_OUTCOME_LABELS[t.data.outcome as InterviewOutcome]}`}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {fmtDateTime(t.data.scheduledAt)}
                        {t.data.questionCount > 0 && (
                          <span className="ml-2">{t.data.questionCount} 道题</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：JD 快照 */}
        <div className="rounded-xl border border-slate-200 p-5 dark:border-slate-800">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <FileText className="size-4" /> JD 快照
          </h2>
          {app.jdText ? (
            <>
              <div className="mb-2 text-[11px] text-slate-400">
                保存于 {fmtDateTime(app.jdSnapshotAt)}
              </div>
              <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {app.jdText}
              </pre>
            </>
          ) : (
            <div className="py-6 text-center text-xs text-slate-400">
              未保存 JD（编辑功能下一步加入）
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
