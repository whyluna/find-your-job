/** 投递列表：看板（拖拽→事件确认）+ 表格（行可拖动排序）双视图 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { KanbanSquare, Table2, GripVertical, Plus, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDate, deadlineLabel, isUrgent } from "@/lib/format";
import { BATCH_LABELS, CHANNEL_LABELS, STATUS_LABELS, STATUS_LIST, type Status } from "@shared";
import type { ApplicationListItem } from "@shared";
import { Button, StatusBadge, TextInput, Select } from "@/components/ui";
import { CreateApplicationDialog } from "@/components/CreateApplicationDialog";
import { KanbanView } from "@/components/KanbanView";
import { cn } from "@/lib/utils";

export default function ApplicationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"board" | "table">(
    () => (localStorage.getItem("fyj-view") as "board" | "table") || "board",
  );
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

  function switchView(v: "board" | "table") {
    setView(v);
    localStorage.setItem("fyj-view", v);
  }

  const items = useMemo(() => data ?? [], [data]);
  const missingResume = items.filter((i) => !i.resumeVersionId);
  const showYellowBar = !noResumeDismissed && missingResume.length > 0;

  // 行拖动排序：仅在未筛选/未搜索（完整列表）时可用
  const canReorder = search.trim() === "" && status === "ALL";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragActive, setDragActive] = useState(false);

  // 拖动全程锁定 grabbing 光标：防止快速移动时扫过其他行导致光标在握拳/手指间闪烁
  useEffect(() => {
    if (!dragActive) return;
    const style = document.createElement("style");
    style.textContent = "* { cursor: grabbing !important; }";
    document.head.appendChild(style);
    document.body.style.userSelect = "none";
    return () => {
      style.remove();
      document.body.style.userSelect = "";
    };
  }, [dragActive]);

  function handleDragEnd(e: DragEndEvent) {
    setDragActive(false);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(items, oldIdx, newIdx);
    // 乐观更新 + 持久化
    queryClient.setQueryData(["applications", search, status], next);
    api
      .reorderApplications(next.map((i) => i.id))
      .then(() => queryClient.invalidateQueries({ queryKey: ["applications"] }))
      .catch(() => queryClient.invalidateQueries({ queryKey: ["applications"] }));
  }

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
        <div className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <button
            onClick={() => switchView("board")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
              view === "board"
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800",
            )}
          >
            <KanbanSquare className="size-3.5" /> 看板
          </button>
          <button
            onClick={() => switchView("table")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
              view === "table"
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800",
            )}
          >
            <Table2 className="size-3.5" /> 表格
          </button>
        </div>
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

      {view === "board" ? (
        <div className="mt-4">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-slate-400">加载中…</div>
          ) : (
            <KanbanView items={items} />
          )}
        </div>
      ) : (
        <>
          {showYellowBar && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            有 {missingResume.length} 条投递未标注简历版本
            {missingResume.length <= 3 && (
              <span className="ml-1 text-amber-600/80">
                （{missingResume.map((m) => (m.department ? `${m.companyName}·${m.department}` : m.companyName)).join("、")}）
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

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <th className="w-8 px-2 py-2.5" />
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">公司</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">部门</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">岗位</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">状态</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">批次</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">渠道</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Base</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">投递日</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">简历版本</th>
            </tr>
          </thead>
          <tbody>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={() => setDragActive(true)}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setDragActive(false)}
            >
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                {isLoading && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                      加载中…
                    </td>
                  </tr>
                )}
                {!isLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                      还没有投递记录，点右上角「新建投递」开始
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    canReorder={canReorder}
                    onClick={() => navigate(`/applications/${item.id}`)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </tbody>
        </table>
      </div>
        </>
      )}

      <CreateApplicationDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        defaultBatch="FORMAL"
      />
    </div>
  );
}

function Row({
  item,
  onClick,
  canReorder,
}: {
  item: ApplicationListItem;
  onClick: () => void;
  canReorder: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canReorder,
  });
  const style = {
    transform: transform
      ? `translate3d(0, ${transform.y}px, 0)`
      : undefined,
    transition,
  };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      tabIndex={0}
      className={cn(
        "border-b border-slate-100 transition-colors last:border-0 outline-none focus-visible:bg-indigo-50 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40 dark:focus-visible:bg-indigo-900/20",
        canReorder && !isDragging && "cursor-pointer",
        isDragging && "relative z-10 bg-indigo-50/70 opacity-90 shadow-lg dark:bg-indigo-900/20",
      )}
    >
      <td className="w-8 px-2 py-2.5 text-center align-middle">
        <span
          {...(canReorder ? { ...attributes, ...listeners } : {})}
          onClick={(e) => e.stopPropagation()}
          title={canReorder ? "拖动调整顺序" : "筛选/搜索时不可拖动"}
          className={cn(
            "inline-flex",
            canReorder
              ? "cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
              : "text-slate-200 dark:text-slate-800",
          )}
        >
          <GripVertical className="size-3.5" />
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.companyName}</span>
          {isUrgent(item.nextDeadline) && (
            <span
              title={deadlineLabel(item.nextDeadline)}
              className="size-2 shrink-0 rounded-full bg-red-500"
            />
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
        {item.department ?? "—"}
      </td>
      <td className="max-w-44 truncate px-3 py-2.5">{item.positionTitle}</td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
          <StatusBadge status={item.status} />
          {item.status === "INTERVIEWING" && item.interviewCount > 0 && (
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              第 {item.interviewCount} 轮
            </span>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
        {BATCH_LABELS[item.batch as keyof typeof BATCH_LABELS] ?? item.batch}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
        {CHANNEL_LABELS[item.channel as keyof typeof CHANNEL_LABELS] ?? item.channel}
      </td>
      <td
          className="max-w-40 break-words px-3 py-2.5 text-slate-500"
          title={item.workLocation ?? undefined}
        >
          {item.workLocation ?? "—"}
        </td>
      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-500">{fmtDate(item.appliedDate)}</td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {item.resumeVersionName ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {item.resumeVersionName}
          </span>
        ) : (
          <span className={cn("text-xs text-amber-500")}>未标注</span>
        )}
      </td>
    </tr>
  );
}
