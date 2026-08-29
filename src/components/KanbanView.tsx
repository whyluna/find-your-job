/** 看板视图：纵向泳道——每个状态一行（自上而下即流程顺序），卡片行内横排可换行；
/** 行内拖动实时重排（动画过渡+松手持久化），跨行拖动改变流程（事件确认/面试弹窗） */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { deadlineLabel, isUrgent } from "@/lib/format";
import { BATCH_LABELS, STATUS_LABELS, type Status } from "@shared";
import type { ApplicationListItem } from "@shared";
import { AddInterviewDialog } from "@/components/AddInterviewDialog";
import { EventConfirmDialog, columnToEventType } from "@/components/EventConfirmDialog";
import { cn } from "@/lib/utils";

export function KanbanView({ items, canReorder }: { items: ApplicationListItem[]; canReorder: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<ApplicationListItem | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [overStatus, setOverStatus] = useState<Status | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    app: ApplicationListItem;
    eventType: NonNullable<ReturnType<typeof columnToEventType>>;
    note?: string;
  } | null>(null);
  const [interviewTarget, setInterviewTarget] = useState<ApplicationListItem | null>(null);
  const [showAllRows, setShowAllRows] = useState(
    () => localStorage.getItem("fyj-show-all-rows") === "1",
  );

  const { data: boardColumns } = useQuery({
    queryKey: ["board-columns"],
    queryFn: async () => {
      const raw = await api.getSetting("board_columns");
      try {
        const parsed = JSON.parse(raw ?? "[]") as Status[];
        return parsed.length ? parsed : null;
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const base = boardColumns ?? (Object.keys(STATUS_LABELS) as Status[]);
  const present = new Set(items.map((i) => i.status));
  const extra = (Object.keys(STATUS_LABELS) as Status[]).filter(
    (s) => !base.includes(s) && present.has(s),
  );
  const allRows = [...base, ...extra];

  const rows = showAllRows
    ? allRows
    : allRows.filter((c) => items.filter((i) => i.status === c).length > 0);
  const visible = rows.length > 0 ? rows : allRows;

  const byStatus = new Map<Status, ApplicationListItem[]>();
  for (const row of allRows) byStatus.set(row, []);
  for (const item of items) byStatus.get(item.status)?.push(item);

  // 拖动全程锁定 grabbing 光标
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

  function reorderCacheInner(
    cache: ApplicationListItem[],
    activeId: string,
    overId: string,
    status: Status,
  ): ApplicationListItem[] {
    const pos = cache
      .map((it, i) => ({ it, i }))
      .filter((x) => x.it.status === status);
    const from = pos.findIndex((x) => x.it.id === activeId);
    const to = pos.findIndex((x) => x.it.id === overId);
    if (from < 0 || to < 0 || from === to) return cache;
    const moved = arrayMove(pos, from, to);
    const result = [...cache];
    moved.forEach((x, j) => {
      result[pos[j].i] = x.it;
    });
    return result;
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || !canReorder) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeItem = items.find((i) => i.id === activeId);
    if (!activeItem || activeId === overId) return;

    const overIsRow = (allRows as string[]).includes(overId);
    const overItem = items.find((i) => i.id === overId);

    // 记录悬停目标行（用于行高亮与松手判定）
    setOverStatus(overIsRow ? (overId as Status) : (overItem?.status ?? null));

    // 同状态行内：实时重排缓存 → 兄弟卡片带过渡滑动
    if (!overIsRow && overItem && overItem.status === activeItem.status) {
      queryClient.setQueriesData(
        { queryKey: ["applications"] },
        (cache: ApplicationListItem[] | undefined) =>
          cache ? reorderCacheInner(cache, activeId, overId, activeItem.status) : cache,
      );
    }
  }

  function handleDragStart(e: DragStartEvent) {
    setDragActive(true);
    setActiveItem(items.find((i) => i.id === e.active.id) ?? null);
  }

  function triggerStatusChange(app: ApplicationListItem, target: Status) {
    if (target === "SAVED" || target === app.status) return;
    if (target === "INTERVIEWING") {
      setInterviewTarget(app);
      return;
    }
    const et = columnToEventType(target);
    if (et) {
      setConfirmTarget({
        app,
        eventType: et,
        note: target === "REJECTED" ? "拖拽标记" : undefined,
      });
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragActive(false);
    const { active, over } = e;
    const activeItem = items.find((i) => i.id === String(active.id));
    if (!activeItem) {
      setActiveItem(null);
      setOverStatus(null);
      return;
    }

    // ① 持久化当前可见顺序（拖动中 onDragOver 已实时重排缓存）
    const cache = queryClient.getQueryData([
      "applications",
      "",
      "ALL",
    ]) as ApplicationListItem[] | undefined;
    if (cache) {
      void api.reorderApplications(cache.map((i) => i.id));
    }

    // ② 跨行判定：优先用拖动过程中持续追踪的悬停行
    let target: Status | null = overStatus;
    if (!target && over) {
      const overId = String(over.id);
      if (allRows.includes(overId as Status)) target = overId as Status;
      else target = items.find((i) => i.id === overId)?.status ?? null;
    }
    setActiveItem(null);
    setOverStatus(null);

    if (target && target !== activeItem.status) {
      triggerStatusChange(activeItem, target);
    }
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          onClick={() => {
            const next = !showAllRows;
            setShowAllRows(next);
            localStorage.setItem("fyj-show-all-rows", next ? "1" : "0");
          }}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          {showAllRows ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          {showAllRows ? "隐藏空状态" : `显示全部状态（${allRows.length}）`}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDragActive(false);
          setActiveItem(null);
          setOverStatus(null);
          queryClient.invalidateQueries({ queryKey: ["applications"] });
        }}
      >
        <div className="space-y-2.5">
          {visible.map((row) => (
            <SwimLane
              key={row}
              status={row}
              colItems={byStatus.get(row) ?? []}
              canReorder={canReorder}
              highlighted={!!activeItem && overStatus === row && activeItem.status !== row}
              onOpen={(id) => navigate(`/applications/${id}`)}
            />
          ))}
        </div>
        <DragOverlay>{activeItem && <Card item={activeItem} dragging />}</DragOverlay>
      </DndContext>

      {confirmTarget && (
        <EventConfirmDialog
          key={confirmTarget.app.id + confirmTarget.eventType}
          open
          application={confirmTarget.app}
          eventType={confirmTarget.eventType}
          presetNote={confirmTarget.note}
          onClose={() => setConfirmTarget(null)}
        />
      )}
      <AddInterviewDialog
        open={!!interviewTarget}
        applicationId={interviewTarget?.id ?? null}
        nextRound={(interviewTarget?.interviewCount ?? 0) + 1}
        onClose={() => setInterviewTarget(null)}
      />
    </div>
  );
}

function SwimLane({
  status,
  colItems,
  canReorder,
  highlighted,
  onOpen,
}: {
  status: Status;
  colItems: ApplicationListItem[];
  canReorder: boolean;
  highlighted: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isTerminal = status === "REJECTED" || status === "WITHDRAWN";

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors",
        highlighted || isOver
          ? "border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/70 dark:bg-indigo-900/20"
          : "border-slate-200/70 bg-slate-50/60 dark:border-slate-800/70 dark:bg-slate-900/40",
        isTerminal && !highlighted && !isOver && "bg-slate-50/40 dark:bg-slate-950/30",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "text-xs font-semibold",
            isTerminal ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400",
          )}
        >
          {STATUS_LABELS[status]}
        </span>
        <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
          {colItems.length}
        </span>
        <div className="h-px flex-1 bg-slate-200/70 dark:bg-slate-800/70" />
      </div>
      <SortableContext items={colItems.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
        <div className="flex flex-wrap gap-2">
          {colItems.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 px-6 py-2.5 text-[11px] text-slate-300 dark:border-slate-700/60 dark:text-slate-600">
              拖到这里
            </div>
          )}
          {colItems.map((item) => (
            <SortableCard key={item.id} item={item} canReorder={canReorder} onOpen={onOpen} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({
  item,
  canReorder,
  onOpen,
}: {
  item: ApplicationListItem;
  canReorder: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canReorder,
  });
  // 被拖卡片由 DragOverlay 渲染；占位本体只保留过渡动画（兄弟卡片滑动让位）
  return (
    <div
      ref={setNodeRef}
      style={{ transition }}
      {...attributes}
      {...listeners}
      className={cn("touch-none", isDragging && "opacity-30")}
    >
      <Card item={item} onOpen={canReorder ? onOpen : undefined} />
    </div>
  );
}

function Card({
  item,
  onOpen,
  dragging,
}: {
  item: ApplicationListItem;
  onOpen?: (id: string) => void;
  dragging?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(item.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen?.(item.id);
      }}
      className={cn(
        "w-52 cursor-grab rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-colors hover:border-slate-300/80 focus-visible:ring-2 focus-visible:ring-indigo-300 dark:border-slate-700/80 dark:bg-slate-800/80 dark:hover:border-slate-600",
        dragging && "rotate-1 shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight">
            {item.companyName}
            {item.department && <span className="font-normal"> · {item.department}</span>}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {item.positionTitle}
          </div>
        </div>
        {isUrgent(item.nextDeadline) && (
          <span
            title={deadlineLabel(item.nextDeadline)}
            className="mt-1 size-2 shrink-0 rounded-full bg-red-500"
          />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {item.status === "INTERVIEWING" && item.interviewCount > 0 ? (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            第 {item.interviewCount} 轮
          </span>
        ) : item.interviewCount > 0 ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {item.interviewCount} 轮面试
          </span>
        ) : null}
        {item.batch && item.batch !== "OTHER" && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            {BATCH_LABELS[item.batch as keyof typeof BATCH_LABELS] ?? item.batch}
          </span>
        )}
      </div>
    </div>
  );
}
