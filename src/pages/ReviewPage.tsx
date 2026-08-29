/** 面经知识库：全部面试题检索、知识点标签聚合、错题本（答得差 + 高频） */
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { QUESTION_QUALITY_LABELS } from "@shared";
import { TextInput } from "@/components/ui";
import { cn } from "@/lib/utils";

export default function ReviewPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [onlyBad, setOnlyBad] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["question-bank", search],
    queryFn: () => api.listAllQuestions(search.trim() || null),
  });

  const items = useMemo(() => {
    let list = data ?? [];
    if (tag) list = list.filter((q) => q.tags.includes(tag));
    if (onlyBad) list = list.filter((q) => q.quality === "BAD");
    return list;
  }, [data, tag, onlyBad]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of data ?? []) {
      for (const t of q.tags) map.set(t, (map.get(t) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  }, [data]);

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">面经知识库</h1>
      <p className="mt-0.5 text-xs text-slate-500">
        全部面试题 {data?.length ?? 0} 道 · 复盘是涨薪最快的路径
      </p>

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

          <div className="mt-4 space-y-2.5">
            {isLoading && <div className="py-10 text-center text-sm text-slate-400">加载中…</div>}
            {!isLoading && items.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400 dark:border-slate-700">
                {data?.length ? "没有匹配的题目" : "面试后回到详情页逐题记录，这里会自动沉淀"}
              </div>
            )}
            {items.map((q) => (
              <div
                key={q.questionId}
                className="cursor-pointer rounded-xl border border-slate-200 p-4 transition-colors hover:border-indigo-200 dark:border-slate-800 dark:hover:border-indigo-700"
                onClick={() => navigate(`/applications/${q.applicationId}`)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium leading-relaxed">{q.question}</div>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
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
                </div>
                {q.reflection && (
                  <div className="mt-2 rounded bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                    复盘：{q.reflection}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span className="font-medium text-slate-500">{q.companyName}</span>
                  <span>· {q.positionTitle}</span>
                  <span>· 第 {q.round} 轮{q.roundLabel ? `（${q.roundLabel}）` : ""}</span>
                  {q.tags.map((t) => (
                    <button
                      key={t}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTag(t);
                      }}
                      className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 标签聚合 */}
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
    </div>
  );
}
