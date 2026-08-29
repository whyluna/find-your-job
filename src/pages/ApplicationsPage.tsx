/** 投递列表：P0-4 表格视图（搜索/状态筛选/新建）；P0-5 加看板 */
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDate, deadlineLabel, isUrgent } from "@/lib/format";
import { BATCH_LABELS, CHANNEL_LABELS, STATUS_LABELS, STATUS_LIST, EVENT_TYPE_DEFS, type Status } from "@shared";
import type { ApplicationListItem } from "@shared";
import { Button, StatusBadge, TextInput, Select } from "@/components/ui";
import { CreateApplicationDialog } from "@/components/CreateApplicationDialog";
import { cn } from "@/lib/utils";

export default function ApplicationsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ALL" | Status>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [noResumeDismissed, setNoResumeDismissed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["applications", search, status],
    queryFn: () =>
      api.listApplications({
        search: search.trim() || null,
        statuses: status === "ALL" ? [] : [status],
      }),
  });

  const items = useMemo(() => data ?? [], [data]);
  const missingResume = items.filter((i) => !i.resumeVersionId);
  const showYellowBar = !noResumeDismissed && missingResume.length > 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">投递</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            共 {items.length} 条 · 看板视图将在下一步加入
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <Plus className="size-4" /> 新建投递
        </Button>
      </div>

      <div className="mt-4 flex gap-2">
        <div className="relative w-72">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <TextInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索公司 / 岗位 / 备注 / JD…"
            className="pl-9"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | "ALL")}
          className="w-36"
        >
          <option value="ALL">全部状态</option>
          {STATUS_LIST.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {showYellowBar && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            有 {missingResume.length} 条投递未标注简历版本
            {missingResume.length <= 3 && (
              <span className="ml-1 text-amber-600/80">
                （{missingResume.map((m) => m.companyName).join("、")}）
              </span>
            )}
            ，统计各版本过筛率需要它。
          </span>
          <button
            className="ml-auto text-xs text-amber-600/70 hover:underline"
            onClick={() => setNoResumeDismissed(true)}
          >
            知道了
          </button>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <th className="px-4 py-2.5 font-medium">公司</th>
              <th className="px-4 py-2.5 font-medium">岗位</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">批次</th>
              <th className="px-4 py-2.5 font-medium">渠道</th>
              <th className="px-4 py-2.5 font-medium">Base</th>
              <th className="px-4 py-2.5 font-medium">投递日</th>
              <th className="px-4 py-2.5 font-medium">简历版本</th>
              <th className="px-4 py-2.5 font-medium">最近动态</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  加载中…
                </td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                  还没有投递记录，点右上角「新建投递」开始
                </td>
              </tr>
            )}
            {items.map((item) => (
              <Row key={item.id} item={item} onClick={() => navigate(`/applications/${item.id}`)} />
            ))}
          </tbody>
        </table>
      </div>

      <CreateApplicationDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        defaultBatch="FORMAL"
      />
    </div>
  );
}

function Row({ item, onClick }: { item: ApplicationListItem; onClick: () => void }) {
  const lastLabel =
    item.lastEventType &&
    (EVENT_TYPE_DEFS[item.lastEventType as keyof typeof EVENT_TYPE_DEFS]?.label ??
      (item.lastEventType.startsWith("custom:")
        ? "自定义事件"
        : item.lastEventType));
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
    >
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.companyName}</span>
          {isUrgent(item.nextDeadline) && (
            <span
              title={deadlineLabel(item.nextDeadline)}
              className="size-2 shrink-0 rounded-full bg-red-500"
            />
          )}
        </div>
        {item.department && (
          <div className="text-xs text-slate-400">{item.department}</div>
        )}
      </td>
      <td className="max-w-52 truncate px-4 py-2.5">{item.positionTitle}</td>
      <td className="px-4 py-2.5">
        <StatusBadge status={item.status} />
      </td>
      <td className="px-4 py-2.5 text-slate-500">
        {BATCH_LABELS[item.batch as keyof typeof BATCH_LABELS] ?? item.batch}
      </td>
      <td className="px-4 py-2.5 text-slate-500">
        {CHANNEL_LABELS[item.channel as keyof typeof CHANNEL_LABELS] ?? item.channel}
      </td>
      <td className="px-4 py-2.5 text-slate-500">{item.workLocation ?? "—"}</td>
      <td className="px-4 py-2.5 tabular-nums text-slate-500">{fmtDate(item.appliedDate)}</td>
      <td className="px-4 py-2.5">
        {item.resumeVersionName ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {item.resumeVersionName}
          </span>
        ) : (
          <span className={cn("text-xs text-amber-500")}>未标注</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="text-slate-500">{lastLabel ?? "—"}</div>
        {item.interviewCount > 0 && (
          <div className="text-xs text-slate-400">{item.interviewCount} 轮面试</div>
        )}
      </td>
    </tr>
  );
}
