/** 看板视图：纵向泳道——每个状态一行（自上而下即流程顺序），卡片行内横排可换行；
/** 行内拖动实时重排（动画过渡+松手持久化），跨行拖动改变流程（事件确认/面试弹窗） */
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type KeyboardCoordinateGetter,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

  // 指针命中检测：指针在行内任意位置（含前半段）都能命中该行；悬停卡片时优先命中卡片
  const allRows = useMemo(() => {
    const base = boardColumns ?? (Object.keys(STATUS_LABELS) as Status[]);
    const present = new Set(items.map((i) => i.status));
    const extra = (Object.keys(STATUS_LABELS) as Status[]).filter(
      (s) => !base.includes(s) && present.has(s),
    );
    return [...base, ...extra];
  }, [boardColumns, items]);

  // 同一行左右键排序；上下键直接跨到相邻流程行，键盘与鼠标获得同样的目标反馈。
  const keyboardCoordinates = useMemo<KeyboardCoordinateGetter>(() => {
    return (event, args) => {
      if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        event.preventDefault();
        const overId = args.context.over?.id ? String(args.context.over.id) : null;
        const overItem = overId ? items.find((item) => item.id === overId) : null;
        const activeStatus = args.context.active?.data.current?.status as Status | undefined;
        const currentStatus = overId && allRows.includes(overId as Status)
          ? (overId as Status)
          : overItem?.status ?? activeStatus;
        const currentIndex = currentStatus ? allRows.indexOf(currentStatus) : -1;
        const step = event.code === "ArrowUp" ? -1 : 1;
        const targetStatus = allRows[currentIndex + step];
        const targetRect = targetStatus ? args.context.droppableRects.get(targetStatus) : null;
        const collisionRect = args.context.collisionRect;
        if (targetRect && collisionRect) {
          return {
            x: targetRect.left + Math.max(0, (targetRect.width - collisionRect.width) / 2),
            y: targetRect.top + Math.max(0, (targetRect.height - collisionRect.height) / 2),
          };
        }
      }
      return sortableKeyboardCoordinates(event, args);
    };
  }, [allRows, items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  const rows = showAllRows
    ? allRows
    : allRows.filter((c) => items.filter((i) => i.status === c).length > 0);
  const visible = rows.length > 0 ? rows : allRows;

  const byStatus = new Map<Status, ApplicationListItem[]>();
  for (const row of allRows) byStatus.set(row, []);
  for (const item of items) byStatus.get(item.status)?.push(item);

  // 指针命中检测：指针在行内任意位置（含前半段）都能命中该行；悬停卡片时优先命中卡片
  const collisionDetection = useMemo<CollisionDetection>(() => {
    return (args) => {
      const pointerCollisions = pointerWithin(args);
      if (pointerCollisions.length > 0) {
        const cardHit = pointerCollisions.find((c) =>
          !(allRows as string[]).includes(String(c.id)),
        );
        if (cardHit) return [cardHit];
        const rowHit = pointerCollisions.find((c) =>
          (allRows as string[]).includes(String(c.id)),
        );
        return rowHit ? [rowHit] : pointerCollisions;
      }
      return closestCenter(args);
    };
  }, [allRows]);

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
    if (!over || !canReorder) {
      setOverStatus(null);
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeItem = items.find((i) => i.id === activeId);
    if (!activeItem) {
      setOverStatus(null);
      return;
    }

    const overIsRow = (allRows as string[]).includes(overId);
    const overItem = items.find((i) => i.id === overId);

    // 记录悬停目标行（用于行高亮与松手判定）
    setOverStatus(overIsRow ? (overId as Status) : (overItem?.status ?? null));
    if (activeId === overId) return;

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
    setOverStatus(null);
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
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          {showAllRows ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          {showAllRows ? "隐藏空状态" : `显示全部状态（${allRows.length}）`}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
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
          {visible.map((row) => {
            const isCrossRowTarget = !!activeItem && overStatus === row && activeItem.status !== row;
            const acceptsDrop = row === "INTERVIEWING" || columnToEventType(row) !== null;
            return (
              <SwimLane
                key={row}
                status={row}
                colItems={byStatus.get(row) ?? []}
                canReorder={canReorder}
                highlighted={isCrossRowTarget && acceptsDrop}
                blocked={isCrossRowTarget && !acceptsDrop}
                onOpen={(id) => navigate(`/applications/${id}`)}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>{activeItem && <Card item={activeItem} dragging />}</DragOverlay>
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
        nextRound={(interviewTarget?.maxInterviewRound ?? 0) + 1}
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
  blocked,
  onOpen,
}: {
  status: Status;
  colItems: ApplicationListItem[];
  canReorder: boolean;
  highlighted: boolean;
  blocked: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isTerminal = status === "REJECTED" || status === "WITHDRAWN";

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-[background,border-color,box-shadow] duration-150",
        highlighted
          ? "border-blue-400 bg-blue-50/90 shadow-[0_0_0_3px_rgba(10,118,232,0.13)] dark:border-blue-400/80 dark:bg-blue-900/25"
          : blocked
            ? "border-slate-400 bg-slate-100/90 shadow-[0_0_0_3px_rgba(100,100,105,0.1)] dark:border-slate-500 dark:bg-slate-800/80"
            : isOver
              ? "border-blue-300 bg-blue-50/45 dark:border-blue-500/60 dark:bg-blue-900/15"
          : "border-slate-200/70 bg-slate-50/60 dark:border-slate-800/70 dark:bg-slate-900/40",
        isTerminal && !highlighted && !blocked && !isOver && "bg-slate-50/40 dark:bg-slate-950/30",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "text-sm font-semibold",
            highlighted
              ? "text-blue-700 dark:text-blue-300"
              : blocked
                ? "text-slate-600 dark:text-slate-300"
                : isTerminal
                  ? "text-slate-400 dark:text-slate-500"
                  : "text-slate-500 dark:text-slate-400",
          )}
        >
          {STATUS_LABELS[status]}
        </span>
        <span className="text-[13px] tabular-nums text-slate-400 dark:text-slate-500">
          {colItems.length}
        </span>
        <div className={cn(
          "h-px flex-1",
          highlighted ? "bg-blue-300/80 dark:bg-blue-500/50" : "bg-slate-200/70 dark:bg-slate-800/70",
        )} />
        {(highlighted || blocked) && (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              highlighted
                ? "bg-blue-500 text-white"
                : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200",
            )}
          >
            <span className={cn("size-1.5 rounded-full", highlighted ? "bg-white animate-pulse" : "bg-slate-400")} />
            {highlighted ? "松开以变更状态" : "该状态不能拖入"}
          </span>
        )}
      </div>
      <SortableContext items={colItems.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
        <div className="flex flex-wrap gap-2">
          {colItems.length === 0 && (
            <div className="min-h-[68px] w-full" aria-hidden="true" />
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
    data: { status: item.status },
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
      <Card item={item} onOpen={onOpen} />
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
          <div className="truncate text-sm font-semibold leading-snug">
            {item.companyName}
            {item.department && <span className="font-normal"> · {item.department}</span>}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-slate-500 dark:text-slate-400">
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
        {item.hasOverdueInterview ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/40 dark:text-red-300">
            待补结果 · 第 {item.activeInterviewRound ?? item.maxInterviewRound} 轮
          </span>
        ) : item.status === "INTERVIEWING" && item.maxInterviewRound > 0 ? (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            第 {item.activeInterviewRound ?? item.maxInterviewRound} 轮
          </span>
        ) : item.interviewCount > 0 ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {item.interviewCount} 轮面试
          </span>
        ) : null}
        {item.batch && item.batch !== "OTHER" && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            {BATCH_LABELS[item.batch as keyof typeof BATCH_LABELS] ?? item.batch}
          </span>
        )}
      </div>
    </div>
  );
}
