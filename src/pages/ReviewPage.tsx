/** 面经知识库：按岗位→轮次两级分组，直接添加/编辑面经（统一五字段表单） */
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { QUESTION_QUALITY_LABELS } from "@shared";
import { TextInput } from "@/components/ui";
import { QuestionModal } from "@/components/QuestionModal";
import { cn } from "@/lib/utils";

interface BankItem {
  questionId: string;
  question: string;
  myAnswer?: string | null;
  quality: "GOOD" | "OK" | "BAD" | "UNKNOWN";
  reflection?: string | null;
  tags: string[];
  round: number;
  roundLabel?: string | null;
  applicationId: string;
  companyName: string;
  positionTitle: string;
  department?: string | null;
}

export default function ReviewPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [onlyBad, setOnlyBad] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<BankItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["question-bank", search],
    queryFn: () => api.listAllQuestions(search.trim() || null),
  });

  const items = useMemo(() => {
    let list: BankItem[] = data ?? [];
    if (tag) list = list.filter((q) => q.tags.includes(tag));
    if (onlyBad) list = list.filter((q) => q.quality === "BAD");
    return list;
  }, [data, tag, onlyBad]);

  // 两级分组：投递 → 轮次
  const groups = useMemo(() => {
    const byApp = new Map<
      string,
      { companyName: string; positionTitle: string; department?: string | null; applicationId: string; rounds: Map<string, BankItem[]> }
    >();
    for (const q of items) {
      let app = byApp.get(q.applicationId);
      if (!app) {
        app = {
          companyName: q.companyName,
          positionTitle: q.positionTitle,
          department: q.department,
          applicationId: q.applicationId,
          rounds: new Map(),
        };
        byApp.set(q.applicationId, app);
      }
      const key = `${q.round}`;
      const arr = app.rounds.get(key) ?? [];
      arr.push(q);
      app.rounds.set(key, arr);
    }
    return [...byApp.values()];
  }, [items]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of data ?? []) {
      for (const t of q.tags) map.set(t, (map.get(t) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [data]);

  return (
    <div className="p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">面经</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            按岗位·轮次整理的全部面试题 {data?.length ?? 0} 道 · 可直接添加，不必进投递详情
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Plus className="size-4" /> 添加面经
        </button>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_220px] gap-5">
        <div>
          <div className="flex gap-2">
            <div className="relative w-72">
              <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索题目 / 复盘 / 公司…"
                className="pl-9"
              />
            </div>
            <button
              onClick={() => setOnlyBad((v) => !v)}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                onlyBad
                  ? "border-red-300 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800",
              )}
            >
              错题本（答得差）
            </button>
            {tag && (
              <button
                onClick={() => setTag(null)}
                className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300"
              >
                #{tag} ✕
              </button>
            )}
          </div>

          {isLoading && <div className="mt-6 py-10 text-center text-sm text-slate-400">加载中…</div>}
          {!isLoading && groups.length === 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-slate-300 py-14 text-center text-sm text-slate-400 dark:border-slate-700">
              {data?.length ? "没有匹配的题目" : "还没有面经。点右上角「添加面经」，或在面试记录里逐题记录"}
            </div>
          )}

          <div className="mt-4 space-y-5">
            {groups.map((g) => (
              <section
                key={g.applicationId}
                className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
              >
                <button
                  onClick={() => navigate(`/applications/${g.applicationId}`)}
                  className="flex w-full items-center gap-2.5 border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-left hover:bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800/60"
                >
                  <span className="text-sm font-semibold">
                    {g.companyName}
                    {g.department && <span> · {g.department}</span>} · {g.positionTitle}
                  </span>
                  <span className="ml-auto text-[11px] text-slate-400">
                    {[...g.rounds.values()].flat().length} 道题 · 查看投递 →
                  </span>
                </button>
                {[...g.rounds.entries()]
                  .sort((a, b) => +b[0] - +a[0])
                  .map(([roundKey, qs]) => (
                    <div key={roundKey} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <div className="bg-slate-50/50 px-4 py-1.5 text-xs font-medium text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                        第 {roundKey} 轮
                        {qs[0]?.roundLabel ? `（${qs[0].roundLabel}）` : ""} · {qs.length} 题
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {qs.map((q) => (
                          <div key={q.questionId} className="group px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium leading-relaxed">{q.question}</div>
                                {q.myAnswer && (
                                  <div className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                    <span className="text-slate-400">我的回答：</span>
                                    {q.myAnswer}
                                  </div>
                                )}
                                {q.reflection && (
                                  <div className="mt-1.5 rounded bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                    <span>理想回答：</span>
                                    {q.reflection}
                                  </div>
                                )}
                                {q.tags.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {q.tags.map((t) => (
                                      <button
                                        key={t}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setTag(t === tag ? null : t);
                                        }}
                                        className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300"
                                      >
                                        {t}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1.5">
                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px]",
                                    q.quality === "GOOD"
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                      : q.quality === "BAD"
                                        ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                                        : q.quality === "OK"
                                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                          : "bg-slate-100 text-slate-400 dark:bg-slate-800",
                                  )}
                                >
                                  {QUESTION_QUALITY_LABELS[q.quality]}
                                </span>
                                <button
                                  onClick={() => setEditing(q)}
                                  className="text-[11px] text-slate-400 opacity-0 transition-opacity hover:text-indigo-500 group-hover:opacity-100"
                                >
                                  编辑
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </section>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <BookOpen className="size-3.5" /> 知识点（按频次）
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tagCounts.length === 0 && <span className="text-xs text-slate-400">暂无标签</span>}
            {tagCounts.map(([t, n]) => (
              <button
                key={t}
                onClick={() => setTag(t === tag ? null : t)}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  t === tag
                    ? "bg-indigo-600 text-white"
                    : n >= 3
                      ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300",
                )}
                title={n >= 3 ? "高频考点" : undefined}
              >
                {t} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            红色为被问过 ≥3 次的高频考点；错题本收集所有「答得差」的题。
          </p>
        </div>
      </div>

      <QuestionModal open={addOpen} onClose={() => setAddOpen(false)} />
      <QuestionModal
        open={!!editing}
        onClose={() => setEditing(null)}
        editQuestion={
          editing
            ? ({
                id: editing.questionId,
                interviewId: "",
                ordinal: 0,
                question: editing.question,
                myAnswer: editing.myAnswer,
                quality: editing.quality,
                reflection: editing.reflection,
                tags: editing.tags,
                createdAt: "",
                updatedAt: "",
              } as import("@shared").InterviewQuestion)
            : null
        }
        fixedInterviewLabel={`${editing?.companyName ?? ""} · ${editing?.positionTitle ?? ""} · 第 ${editing?.round ?? ""} 轮`}
      />
    </div>
  );
}
