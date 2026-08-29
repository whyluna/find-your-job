/** 面试卡片：状态快捷操作 + 整体复盘 + 逐题编辑（题/答/表现/复盘/标签 + 排序） */
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
  type QuestionQuality,
} from "@shared";
import { Button, Select } from "@/components/ui";
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

  const outcomeColor =
    interview.outcome === "PASS"
      ? "text-emerald-600 dark:text-emerald-400"
      : interview.outcome === "FAIL"
        ? "text-red-500"
        : "text-slate-400";

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
      {/* 头部：左区负责展开，快捷操作区在语义上独立，避免误触 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <div
          role="button"
          tabIndex={0}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-x-3 gap-y-1 outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
          }}
        >
        <ChevronDown
          className={cn("size-4 shrink-0 text-slate-400 transition-transform", !open && "-rotate-90")}
        />
        <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
          第 {interview.round} 轮{interview.roundLabel ? `（${interview.roundLabel}）` : ""}
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
              if (confirm("删除这轮面试及其全部题目？投递状态会自动重算。")) delInterview.mutate();
            }}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
            title="删除面试"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          {(interview.locationOrLink || interview.interviewerNote || interview.durationMin) && (
            <div className="mb-3 space-y-0.5 text-xs text-slate-500">
              {interview.locationOrLink && <div>📍 {interview.locationOrLink}</div>}
              {interview.durationMin && <div>⏱ {interview.durationMin} 分钟</div>}
              {interview.interviewerNote && <div>👤 {interview.interviewerNote}</div>}
            </div>
          )}

          {/* 题目列表 */}
          <div className="space-y-2">
            {interview.questions.map((q, idx) => (
              <QuestionItem
                key={q.id}
                question={q}
                applicationId={applicationId}
                isFirst={idx === 0}
                isLast={idx === interview.questions.length - 1}
              />
            ))}
          </div>
          <AddQuestionRow interviewId={interview.id} applicationId={applicationId} />

          {/* 整体复盘 */}
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
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
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
    </div>
  );
}

function QuestionItem({
  question,
  applicationId,
  isFirst,
  isLast,
}: {
  question: InterviewQuestion;
  applicationId: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(question.question);
  const [myAnswer, setMyAnswer] = useState(question.myAnswer ?? "");
  const [reflection, setReflection] = useState(question.reflection ?? "");
  const [quality, setQuality] = useState<QuestionQuality>(question.quality);
  const [tags, setTags] = useState(question.tags.join(", "));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["application-detail", applicationId] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.updateQuestion(question.id, {
        question: text.trim() || undefined,
        myAnswer: myAnswer.trim() || null,
        reflection: reflection.trim() || null,
        quality,
        tags: tags
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteQuestion(question.id),
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: async (dir: "up" | "down") => {
      // 与相邻题交换：重排序交给后端按新顺序写 ordinal
      // 这里简单请求交换（由父级列表顺序决定）——直接用当前列表顺序交换后调用
      const ids = (queryClient.getQueryData([
        "application-detail",
        applicationId,
      ]) as { interviews: { questions: { id: string }[] }[] })?.interviews
        ?.flatMap((iv) => iv.questions)
        .map((q) => q.id);
      if (!ids) return;
      const i = ids.indexOf(question.id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return api.reorderQuestions(ids);
    },
    onSuccess: invalidate,
  });

  const qualityColor =
    quality === "GOOD"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : quality === "BAD"
        ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
        : quality === "OK"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          : "bg-slate-100 text-slate-400 dark:bg-slate-800";

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            placeholder="面试问题"
          />
          <textarea
            value={myAnswer}
            onChange={(e) => setMyAnswer(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            placeholder="我的回答（摘要）"
          />
          <div className="flex gap-2">
            <Select value={quality} onChange={(e) => setQuality(e.target.value as QuestionQuality)} className="w-28 text-xs">
              {Object.entries(QUESTION_QUALITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="知识点标签，逗号分隔"
              className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            placeholder="复盘 / 更优答案"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>取消</Button>
            <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />}保存
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium leading-relaxed">{question.question}</div>
              {question.myAnswer && (
                <div className="mt-1 text-[11px] text-slate-500">答：{question.myAnswer}</div>
              )}
              {question.reflection && (
                <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  复盘：{question.reflection}
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
              {QUESTION_QUALITY_LABELS[quality]}
            </span>
          </div>
          <div className="mt-1.5 flex justify-end gap-0.5">
            <button
              disabled={isFirst}
              onClick={() => move.mutate("up")}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-700"
              title="上移"
            >
              <ArrowUp className="size-3" />
            </button>
            <button
              disabled={isLast}
              onClick={() => move.mutate("down")}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-700"
              title="下移"
            >
              <ArrowDown className="size-3" />
            </button>
            <button
              onClick={() => setEditing(true)}
              className="rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
            >
              编辑
            </button>
            <button
              onClick={() => del.mutate()}
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
              title="删除"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddQuestionRow({
  interviewId,
  applicationId,
}: {
  interviewId: string;
  applicationId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [quality, setQuality] = useState<QuestionQuality>("UNKNOWN");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api.addQuestion({
        interviewId,
        question: question.trim(),
        quality,
        tags: tags
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-detail", applicationId] });
      setQuestion("");
      setTags("");
      setError("");
      setOpen(false);
    },
    onError: (e) => setError(String(e)),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] text-slate-400 hover:border-indigo-400 hover:text-indigo-500 dark:border-slate-600"
      >
        <Plus className="size-3" /> 记一道题
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2.5 dark:border-indigo-800 dark:bg-indigo-900/15">
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        autoFocus
        placeholder="刚被问到什么？"
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
      />
      <div className="mt-2 flex gap-2">
        <Select value={quality} onChange={(e) => setQuality(e.target.value as QuestionQuality)} className="w-24 text-xs">
          {Object.entries(QUESTION_QUALITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="知识点标签，如：操作系统, LRU"
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
        />
      </div>
      {error && <div className="mt-1.5 text-[11px] text-red-500">{error}</div>}
      <div className="mt-2 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>收起</Button>
        <Button
          size="sm"
          variant="primary"
          disabled={add.isPending || !question.trim()}
          onClick={() => {
            setError("");
            if (!question.trim()) return setError("题目不能为空");
            add.mutate();
          }}
        >
          {add.isPending && <Loader2 className="size-3.5 animate-spin" />}添加
        </Button>
      </div>
    </div>
  );
}
