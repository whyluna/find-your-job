/** offer 对比器：OC 及之后的投递并排对比，五维加权评分（分数存本地设置） */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDate } from "@/lib/format";
import { type Status } from "@shared";
import { Button, PageHeader, StatusBadge, TextInput } from "@/components/ui";
import { cn } from "@/lib/utils";

const DIMENSIONS = [
  { key: "pay", label: "薪资", defaultWeight: 1.3 },
  { key: "growth", label: "成长性", defaultWeight: 1.2 },
  { key: "city", label: "城市", defaultWeight: 1.0 },
  { key: "wlb", label: "工作生活平衡", defaultWeight: 1.0 },
  { key: "stability", label: "稳定性", defaultWeight: 0.8 },
] as const;

type Scores = Record<string, Record<string, number>>;
type Weights = Record<string, number>;

export default function OffersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [scores, setScores] = useState<Scores>({});
  const [weights, setWeights] = useState<Weights>({});
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");

  const { data: apps } = useQuery({
    queryKey: ["offer-apps"],
    queryFn: () => api.listApplications({}),
  });
  const offers = (apps ?? []).filter((a) =>
    ["OC", "INTENT", "OFFER", "SIGNED"].includes(a.status),
  );

  useEffect(() => {
    (async () => {
      const s = await api.getSetting("offer_scores").catch(() => null);
      const w = await api.getSetting("offer_weights").catch(() => null);
      if (s) setScores(JSON.parse(s));
      if (w) setWeights(JSON.parse(w));
    })();
  }, []);

  const save = useMutation({
    mutationFn: async () => {
      await api.setSetting("offer_scores", JSON.stringify(scores));
      await api.setSetting("offer_weights", JSON.stringify(weights));
    },
    onSuccess: () => {
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
      queryClient.invalidateQueries({ queryKey: ["offer-apps"] });
    },
  });

  const setScore = (appId: string, dim: string, v: number) => {
    setScores((s) => ({ ...s, [appId]: { ...(s[appId] ?? {}), [dim]: v } }));
    setDirty(true);
  };
  const setWeight = (dim: string, v: number) => {
    setWeights((w) => ({ ...w, [dim]: v }));
    setDirty(true);
  };
  const weightOf = (dim: string) => weights[dim] ?? DIMENSIONS.find((d) => d.key === dim)!.defaultWeight;

  const total = (appId: string) => {
    const s = scores[appId] ?? {};
    let sum = 0;
    let wsum = 0;
    for (const d of DIMENSIONS) {
      const w = weightOf(d.key);
      sum += (s[d.key] ?? 0) * w;
      wsum += w;
    }
    return wsum ? +(sum / wsum).toFixed(1) : 0;
  };

  const ranked = [...offers].sort((a, b) => total(b.id) - total(a.id));

  return (
    <div className="px-6 pb-10 pt-0">
      <PageHeader
        title={<span className="flex items-center gap-2"><Scale className="size-4" />offer 对比</span>}
        subtitle="五维加权评分，数据只保存在本机"
        actions={
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存{savedAt && !dirty ? `（${savedAt}）` : ""}
          </Button>
        }
      />

      {/* 权重 */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 px-4 py-3 dark:border-slate-800/80">
        <span className="text-[13px] font-medium text-slate-500">权重</span>
        {DIMENSIONS.map((d) => (
          <label key={d.key} className="flex items-center gap-1.5 text-[13px] text-slate-500">
            {d.label}
            <input
              type="number"
              step="0.1"
              min="0"
              value={weightOf(d.key)}
              onChange={(e) => setWeight(d.key, +e.target.value || 0)}
              className="w-14 rounded border border-slate-200/80 px-1.5 py-0.5 text-[13px] dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
        ))}
      </div>

      {offers.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 py-14 text-center text-sm text-slate-400 dark:border-slate-700">
          还没有进入 OC / offer 阶段的投递。先在时间线记录好消息
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800/80">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[13px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/50">
                <th className="px-4 py-2.5 font-medium">公司 · 岗位</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">薪资结构（点击编辑）</th>
                {DIMENSIONS.map((d) => (
                  <th key={d.key} className="px-3 py-2.5 font-medium">{d.label}</th>
                ))}
                <th className="px-4 py-2.5 font-medium">加权总分</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((a, idx) => (
                <OfferRow
                  key={a.id}
                  rank={idx}
                  app={a}
                  scores={scores[a.id] ?? {}}
                  onScore={(dim, v) => setScore(a.id, dim, v)}
                  total={total(a.id)}
                  onOpen={() => navigate(`/applications/${a.id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OfferRow({
  rank,
  app,
  scores,
  onScore,
  total,
  onOpen,
}: {
  rank: number;
  app: { id: string; companyName: string; positionTitle: string; department?: string | null; workLocation?: string | null; status: Status; salaryRange?: string | null; appliedDate?: string | null };
  scores: Record<string, number>;
  onScore: (dim: string, v: number) => void;
  total: number;
  onOpen: () => void;
}) {
  const [salary, setSalary] = useState(app.salaryRange ?? "");
  const [salarySaved, setSalarySaved] = useState(false);

  const saveSalary = async () => {
    await api.updateApplication(app.id, { salaryRange: salary.trim() || null });
    setSalarySaved(true);
    setTimeout(() => setSalarySaved(false), 1500);
  };

  return (
    <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
      <td className="px-4 py-3">
        <button onClick={onOpen} className="text-left hover:underline">
          <div className="font-medium">
            {rank === 0 && total > 0 && <span className="mr-1 text-xs text-slate-400">最优</span>}
            {app.companyName}
            {app.department && <span className="font-normal"> · {app.department}</span>}
          </div>
          <div className="text-[13px] text-slate-400">{app.positionTitle}{app.workLocation ? ` · ${app.workLocation}` : ""}</div>
        </button>
        <div className="mt-0.5 text-xs text-slate-400">投递 {fmtDate(app.appliedDate)}</div>
      </td>
      <td className="px-4 py-3"><StatusBadge status={app.status} /></td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <TextInput
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            placeholder="25k×15+签字费"
            className="w-40 text-[13px]"
          />
          <button
            onClick={saveSalary}
            className={cn("text-xs", salarySaved ? "text-emerald-500" : "text-indigo-500 hover:underline")}
          >
            {salarySaved ? "已存" : "存"}
          </button>
        </div>
      </td>
      {DIMENSIONS.map((d) => (
        <td key={d.key} className="px-3 py-3">
          <input
            type="number"
            min="1"
            max="10"
            value={scores[d.key] ?? 0}
            onChange={(e) => onScore(d.key, Math.min(10, Math.max(0, +e.target.value || 0)))}
            className={cn(
              "w-14 rounded border px-1.5 py-1 text-center text-[13px] dark:bg-slate-800",
              (scores[d.key] ?? 0) >= 8
                ? "border-emerald-300 text-emerald-600 dark:border-emerald-700"
                : (scores[d.key] ?? 0) > 0 && (scores[d.key] ?? 0) <= 4
                  ? "border-red-300 text-red-500 dark:border-red-800"
                  : "border-slate-200 dark:border-slate-700",
            )}
          />
        </td>
      ))}
      <td className="px-4 py-3">
        <span className="text-base font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
          {total || "—"}
        </span>
      </td>
    </tr>
  );
}
