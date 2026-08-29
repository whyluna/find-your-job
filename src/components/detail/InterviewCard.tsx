/** 面试卡片：状态快捷操作 + 题目列表（记题/编辑统一走 QuestionModal 五字段表单）+ 整体复盘 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { fmtDateTime } from "@/lib/format";
import {
  INTERVIEW_FORMAT_LABELS,
  INTERVIEW_OUTCOME_LABELS,
  INTERVIEW_STATUS_LABELS,
  QUESTION_QUALITY_LABELS,
  type InterviewDetail,
  type InterviewQuestion,
} from "@shared";
import { Button } from "@/components/ui";
import { QuestionModal } from "@/components/QuestionModal";
import { cn } from "@/lib/utils";

export function InterviewCard({
  interview,
  applicationId,
}: {
  interview: InterviewDetail;
  applicationId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reflection, setReflection] = useState(interview.overallReflection ?? "");
  const [rating, setRating] = useState(interview.selfRating ?? 0);
  const [addOpen, setAddOpen] = useState(false);
  const [editQuestion, setEditQuestion] = useState<InterviewQuestion | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    queryClient.invalidateQueries({ queryKey: ["application-detail", applicationId] });
  };

  const setOutcome = useMutation({
    mutationFn: (args: { status?: "SCHEDULED" | "COMPLETED" | "CANCELLED"; outcome?: "PENDING" | "PASS" | "FAIL" | "UNKNOWN" }) =>
      api.updateInterview(interview.id, args),
    onSuccess: invalidate,
  });

  const saveReflection = useMutation({
    mutationFn: () =>
      api.updateInterview(interview.id, {
        overallReflection: reflection.trim() || null,
        selfRating: rating || null,
      }),
    onSuccess: invalidate,
  });

  const delInterview = useMutation({
    mutationFn: () => api.deleteInterview(interview.id),
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: async (args: { q: InterviewQuestion; dir: "up" | "down" }) => {
      const ids = interview.questions.map((x) => x.id);
      const i = ids.indexOf(args.q.id);
      const j = args.dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return api.reorderQuestions(ids);
    },
    onSuccess: invalidate,
  });

  const delQuestion = useMutation({
    mutationFn: (id: string) => api.deleteQuestion(id),
    onSuccess: invalidate,
  });

  const outcomeColor =
    interview.outcome === "PASS"
      ? "text-emerald-600 dark:text-emerald-400"
      : interview.outcome === "FAIL"
        ? "text-red-500"
        : "text-slate-400";

  const roundLabelFull = `第 ${interview.round} 轮${interview.roundLabel ? `（${interview.roundLabel}）` : ""}`;

  return (
    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/80">
      {/* 头部：左区展开，操作区独立（防误触） */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <div
          role="button"
          tabIndex={0}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-x-3 outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
          }}
        >
          <ChevronDown
            className={cn("size-4 shrink-0 text-slate-400 transition-transform", !open && "-rotate-90")}
          />
          <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
            {roundLabelFull}
          </span>
          {interview.format && (
            <span className="text-xs text-slate-400">
              {INTERVIEW_FORMAT_LABELS[interview.format as keyof typeof INTERVIEW_FORMAT_LABELS] ?? interview.format}
            </span>
          )}
          <span className="text-xs text-slate-400">{fmtDateTime(interview.scheduledAt)}</span>
          <span className={cn("text-xs", outcomeColor)}>
            {INTERVIEW_STATUS_LABELS[interview.status]}
            {interview.status === "COMPLETED" && ` · ${INTERVIEW_OUTCOME_LABELS[interview.outcome]}`}
          </span>
          {interview.questionCount > 0 && (
            <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-500 dark:bg-slate-800">
              {interview.questionCount} 题
            </span>
          )}
          {interview.selfRating && (
            <span className="text-xs text-amber-500">{"★".repeat(interview.selfRating)}</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {interview.status === "SCHEDULED" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="text-emerald-600 dark:text-emerald-400"
                onClick={() => setOutcome.mutate({ status: "COMPLETED", outcome: "PASS" })}
              >
                完成·过
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500"
                onClick={() => setOutcome.mutate({ status: "COMPLETED", outcome: "FAIL" })}
              >
                完成·未过
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOutcome.mutate({ status: "CANCELLED" })}
              >
                取消
              </Button>
            </>
          )}
          {interview.status === "COMPLETED" && interview.outcome === "FAIL" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-emerald-600 dark:text-emerald-400"
              onClick={() => setOutcome.mutate({ outcome: "PASS" })}
            >
              改判·过
            </Button>
          )}
          <button
            onClick={() => {
              if (confirm(`删除${roundLabelFull}及其全部题目？投递状态会自动重算。`)) delInterview.mutate();
            }}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
            title="删除面试"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800/80">
          {(interview.locationOrLink || interview.interviewerNote || interview.durationMin) && (
            <div className="mb-3 space-y-0.5 text-xs text-slate-500">
              {interview.locationOrLink && <div>📍 {interview.locationOrLink}</div>}
              {interview.durationMin && <div>⏱ {interview.durationMin} 分钟</div>}
              {interview.interviewerNote && <div>👤 {interview.interviewerNote}</div>}
            </div>
          )}

          <div className="space-y-2">
            {interview.questions.map((q, idx) => (
              <QuestionItem
                key={q.id}
                question={q}
                onEdit={() => setEditQuestion(q)}
                onDelete={() => delQuestion.mutate(q.id)}
                onMove={(dir) => move.mutate({ q, dir })}
                isFirst={idx === 0}
                isLast={idx === interview.questions.length - 1}
              />
            ))}
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] text-slate-400 hover:border-indigo-400 hover:text-indigo-500 dark:border-slate-600"
          >
            <Plus className="size-3" /> 记一道题
          </button>

          <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs font-medium text-slate-500">整体复盘</span>
              <span className="text-xs text-slate-400">自评</span>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRating(n === rating ? 0 : n)}
                    className={cn(
                      "text-sm leading-none",
                      n <= rating ? "text-amber-400" : "text-slate-300 dark:text-slate-600",
                    )}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              rows={2}
              placeholder="表现总结、暴露的弱点、下次改进…"
              className="w-full rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" disabled={saveReflection.isPending} onClick={() => saveReflection.mutate()}>
                {saveReflection.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                保存复盘
              </Button>
            </div>
          </div>
        </div>
      )}

      <QuestionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        fixedInterviewId={interview.id}
        fixedInterviewLabel={`${roundLabelFull} · ${fmtDateTime(interview.scheduledAt)}`}
      />
      <QuestionModal
        open={!!editQuestion}
        onClose={() => setEditQuestion(null)}
        editQuestion={editQuestion}
        fixedInterviewLabel={`${roundLabelFull} · ${fmtDateTime(interview.scheduledAt)}`}
      />
    </div>
  );
}

function QuestionItem({
  question,
  onEdit,
  onDelete,
  onMove,
  isFirst,
  isLast,
}: {
  question: InterviewQuestion;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const qualityColor =
    question.quality === "GOOD"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : question.quality === "BAD"
        ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
        : question.quality === "OK"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          : "bg-slate-100 text-slate-400 dark:bg-slate-800";

  return (
    <div className="rounded-lg border border-slate-200/80 p-3 dark:border-slate-700">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium leading-relaxed">{question.question}</div>
          {(question.myAnswer || question.reflection) && (
            <div className="mt-1.5 space-y-1 border-l-2 border-slate-200 pl-2.5 dark:border-slate-700/70">
              {question.myAnswer && (
                <div className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
                  <span className="mr-1.5 select-none text-xs font-medium text-slate-400 dark:text-slate-500">我的回答</span>
                  {question.myAnswer}
                </div>
              )}
              {question.reflection && (
                <div className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                  <span className="mr-1.5 select-none text-xs font-medium text-amber-600 dark:text-amber-400">理想回答</span>
                  {question.reflection}
                </div>
              )}
            </div>
          )}
          {question.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {question.tags.map((t) => (
                <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", qualityColor)}>
          {QUESTION_QUALITY_LABELS[question.quality]}
        </span>
      </div>
      <div className="mt-1.5 flex justify-end gap-0.5">
        <button
          disabled={isFirst}
          onClick={() => onMove("up")}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-700"
          title="上移"
        >
          <ArrowUp className="size-3" />
        </button>
        <button
          disabled={isLast}
          onClick={() => onMove("down")}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-700"
          title="下移"
        >
          <ArrowDown className="size-3" />
        </button>
        <button
          onClick={onEdit}
          className="rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
        >
          编辑
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
          title="删除"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}
