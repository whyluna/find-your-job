/** 面经：按岗位→轮次两级分组，顶部横排知识点筛选，添加/编辑统一 QuestionModal */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { QUESTION_QUALITY_LABELS } from "@shared";
import { Button, PageHeader, TextInput } from "@/components/ui";
import { QuestionModal } from "@/components/QuestionModal";
import { LatexText } from "@/components/LatexText";
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<BankItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["question-bank", search],
    queryFn: () => api.listAllQuestions(search.trim() || null),
  });

  const items = useMemo(() => {
    let list: BankItem[] = data ?? [];
    if (tag) list = list.filter((q) => q.tags.includes(tag));
    return list;
  }, [data, tag]);

  const groups = useMemo(() => {
    const byApp = new Map<
      string,
      {
        companyName: string;
        positionTitle: string;
        department?: string | null;
        applicationId: string;
        rounds: Map<string, BankItem[]>;
      }
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
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [data]);

  const delQuestion = useMutation({
    mutationFn: (id: string) => api.deleteQuestion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-bank"] });
      queryClient.invalidateQueries({ queryKey: ["application-detail"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  return (
    <div className="px-6 py-5">
      <PageHeader
        title="面经"
        subtitle={`${data?.length ?? 0} 道面试题 · 按岗位与轮次整理`}
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> 添加面经
          </Button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2 size-3.5 text-slate-400" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索题目 / 回答 / 公司…"
            className="pl-8"
          />
        </div>
        {tagCounts.map(([t, n]) => (
          <button
            key={t}
            onClick={() => setTag(t === tag ? null : t)}
            className={cn(
              "h-8 rounded-lg border px-2.5 text-[13px] transition-colors",
              t === tag
                ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-600 dark:border-indigo-500/60 dark:bg-indigo-900/30 dark:text-indigo-300"
                : n >= 3
                  ? "border-red-200/70 bg-red-50/60 text-red-500 hover:bg-red-50 dark:border-red-800/60 dark:bg-red-900/15 dark:text-red-300"
                  : "border-slate-200/90 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/80",
            )}
            title={n >= 3 ? `被问过 ${n} 次 · 高频考点` : `被问过 ${n} 次`}
          >
            {t} <span className="opacity-50">{n}</span>
          </button>
        ))}
      </div>

      {isLoading && <div className="mt-8 py-10 text-center text-sm text-slate-400">加载中…</div>}
      {!isLoading && groups.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-200 py-16 text-center text-[13px] text-slate-400 dark:border-slate-700/70">
          {data?.length ? "没有匹配的题目" : "还没有面经——点右上角「添加面经」，选择岗位和轮次即可开始记录"}
        </div>
      )}

      <div className="mt-4 space-y-4">
        {groups.map((g) => (
          <section
            key={g.applicationId}
            className="overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-slate-800/80 dark:bg-slate-900/60"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800/80">
              <button
                onClick={() => navigate(`/applications/${g.applicationId}`)}
                className="min-w-0 text-left"
              >
                <div className="truncate text-sm font-semibold tracking-tight">
                  {g.companyName}
                  {g.department && <span className="font-normal text-slate-500"> · {g.department}</span>}
                  <span> · {g.positionTitle}</span>
                </div>
              </button>
              <button
                onClick={() => navigate(`/applications/${g.applicationId}`)}
                className="shrink-0 text-xs text-slate-400 hover:text-indigo-500"
              >
                {[...g.rounds.values()].flat().length} 道题 · 查看投递 →
              </button>
            </div>

            {[...g.rounds.entries()]
              .sort((a, b) => +b[0] - +a[0])
              .map(([roundKey, qs]) => (
                <div key={roundKey} className="border-b border-slate-100/90 last:border-0 dark:border-slate-800/70">
                  <div className="px-4 pb-1 pt-2.5 text-[13px] font-medium text-slate-400 dark:text-slate-500">
                    第 {roundKey} 轮{qs[0]?.roundLabel ? ` · ${qs[0].roundLabel}` : ""}
                  </div>
                  <div className="divide-y divide-slate-100/80 dark:divide-slate-800/60">
                    {qs.map((q) => (
                      <div key={q.questionId} className="group px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-medium leading-relaxed"><LatexText>{q.question}</LatexText></div>
                            {(q.myAnswer || q.reflection) && (
                              <div className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3 dark:border-slate-700/70">
                                {q.myAnswer && (
                                  <div className="text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
                                    <span className="mr-1.5 select-none text-xs font-medium text-slate-400 dark:text-slate-500">我的回答</span>
                                    <LatexText>{q.myAnswer}</LatexText>
                                  </div>
                                )}
                                {q.reflection && (
                                  <div className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                                    <span className="mr-1.5 select-none text-xs font-medium text-amber-600 dark:text-amber-400">理想回答</span>
                                    <LatexText>{q.reflection}</LatexText>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span
                              className={cn(
                                "rounded-md px-2 py-0.5 text-xs font-medium",
                                q.quality === "GOOD"
                                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  : q.quality === "BAD"
                                    ? "bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-300"
                                    : q.quality === "OK"
                                      ? "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300"
                                      : "bg-slate-100 text-slate-400 dark:bg-slate-800",
                              )}
                            >
                              {QUESTION_QUALITY_LABELS[q.quality]}
                            </span>
                            <button
                              onClick={() => setEditing(q)}
                              className="rounded-md p-1 text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                              title="编辑"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm("删除这道面经？")) delQuestion.mutate(q.questionId);
                              }}
                              className="rounded-md p-1 text-slate-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/30"
                              title="删除"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                        {q.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {q.tags.map((t) => (
                              <button
                                key={t}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTag(t === tag ? null : t);
                                }}
                                className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </section>
        ))}
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
