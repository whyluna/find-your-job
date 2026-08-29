/** 统计看板：状态漏斗、渠道/批次分布、近8周投递曲线、沉默投递、简历版本过筛率 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/ipc";
import { fmtDate } from "@/lib/format";
import {
  BATCH_LABELS,
  CHANNEL_LABELS,
  STATUS_LABELS,
  type Status,
} from "@shared";
import { PageHeader } from "@/components/ui";

interface CountRow {
  key: string;
  count: number;
}
interface StatsDto {
  statusCounts: CountRow[];
  channelCounts: CountRow[];
  batchCounts: CountRow[];
  dailyApplied: CountRow[];
  silent: {
    id: string;
    companyName: string;
    positionTitle: string;
    status: Status;
    updatedAt: string;
  }[];
}

/** 漏斗正向阶段顺序（前一阶段包含后一阶段到达数由状态计数近似：以当前状态计数展示层级分布） */
const FUNNEL: Status[] = [
  "APPLIED",
  "ASSESSMENT",
  "WRITTEN",
  "INTERVIEWING",
  "OC",
  "OFFER",
  "SIGNED",
];

export default function StatsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => api.getStats() });

  if (isLoading || !data) return <div className="px-6 pb-10 pt-0"><PageHeader title="统计" /><div className="py-12 text-center text-[13px] text-[var(--fyj-tertiary)]">加载中…</div></div>;
  const s = data as StatsDto;

  const statusMap = new Map(s.statusCounts.map((r) => [r.key, r.count]));
  const totalAll = s.statusCounts.reduce((n, r) => n + r.count, 0);
  const funnelMax = Math.max(1, ...FUNNEL.map((st) => statusMap.get(st) ?? 0));

  // 近 8 周聚合
  const weeks: { week: string; count: number }[] = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 86400000);
    const start = new Date(end.getTime() - 7 * 86400000);
    const count = s.dailyApplied
      .filter((d) => d.key > start.toISOString().slice(0, 10) && d.key <= end.toISOString().slice(0, 10))
      .reduce((n, d) => n + d.count, 0);
    weeks.push({ week: `${start.getMonth() + 1}/${start.getDate()}`, count });
  }

  return (
    <div className="px-6 pb-10 pt-0">
      <PageHeader
        title="统计"
        subtitle={`共 ${totalAll} 条在追踪（不含归档）· 漏斗按当前所处阶段计数`}
      />

      <div className="mx-auto mt-5 grid max-w-[1120px] grid-cols-2 gap-4">
        {/* 漏斗 */}
        <section className="rounded-xl border border-slate-200/80 p-5 dark:border-slate-800/80">
          <h2 className="text-sm font-semibold">阶段漏斗</h2>
          <div className="mt-4 space-y-2.5">
            {FUNNEL.map((st) => {
              const n = statusMap.get(st) ?? 0;
              return (
                <div key={st} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-right text-[13px] text-slate-500">
                    {STATUS_LABELS[st]}
                  </span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded bg-[var(--fyj-accent)]"
                      style={{ width: `${(n / funnelMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-[13px] font-medium tabular-nums">{n}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-right text-[13px] text-red-400">已挂</span>
              <span className="text-[13px] tabular-nums text-red-400">
                {statusMap.get("REJECTED") ?? 0}
              </span>
            </div>
          </div>
        </section>

        {/* 周曲线 */}
        <section className="rounded-xl border border-slate-200/80 p-5 dark:border-slate-800/80">
          <h2 className="text-sm font-semibold">近 8 周投递量</h2>
          <div className="mt-3 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeks} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.2)" />
                <XAxis dataKey="week" fontSize={12} tickLine={false} />
                <YAxis fontSize={12} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 13, borderRadius: 8 }}
                  formatter={(v) => [`${v} 条`, "投递"]}
                />
                <Bar dataKey="count" fill="#0a76e8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* 渠道 & 批次 */}
        {(
          [
            ["渠道分布", s.channelCounts, CHANNEL_LABELS],
            ["批次分布", s.batchCounts, BATCH_LABELS],
          ] as [string, CountRow[], Record<string, string>][]
        ).map(([title, rows, labels]) => {
          const max = Math.max(1, ...rows.map((r) => r.count));
          return (
            <section key={title} className="rounded-xl border border-slate-200/80 p-5 dark:border-slate-800/80">
              <h2 className="text-sm font-semibold">{title}</h2>
              <div className="mt-3 space-y-2">
                {rows.length === 0 && <div className="text-[13px] text-slate-400">暂无数据</div>}
                {rows.slice(0, 7).map((r) => (
                  <div key={r.key} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 truncate text-[13px] text-slate-500">
                      {labels[r.key] ?? r.key}
                    </span>
                    <div className="h-3.5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded bg-[var(--fyj-accent)] opacity-80"
                        style={{ width: `${(r.count / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-[13px] tabular-nums">{r.count}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

      </div>

      {/* 沉默投递 */}
      <section className="mx-auto mt-4 max-w-[1120px] rounded-xl border border-slate-200/80 p-5 dark:border-slate-800/80">
        <h2 className="text-sm font-semibold">
          沉默投递 <span className="text-[13px] font-normal text-slate-400">超过 14 天无动静且未到终态</span>
        </h2>
        {s.silent.length === 0 ? (
          <div className="mt-3 text-[13px] text-slate-400">没有沉默的投递 👍</div>
        ) : (
          <div className="mt-3 space-y-1">
            {s.silent.map((a) => (
              <button
                key={a.id}
                onClick={() => navigate(`/applications/${a.id}`)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <span className="text-sm">{a.companyName} · {a.positionTitle}</span>
                <span className="text-[13px] text-slate-400">{STATUS_LABELS[a.status]}</span>
                <span className="ml-auto text-[13px] text-slate-400">最后动静 {fmtDate(a.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
