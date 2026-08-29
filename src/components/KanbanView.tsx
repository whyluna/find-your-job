/** 看板视图：纵向泳道——每个状态一行（自上而下即流程顺序），卡片行内横排可换行；
/** 行内拖动调顺序（sort_order 持久化），跨行拖动改变流程（快捷创建事件/面试） */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
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
  const [dragging, setDragging] = useState<ApplicationListItem | null>(null);
  const [dragActive, setDragActive] = useState(false);
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

  // 默认隐藏空行
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

  /** 行内新顺序 → 全局 sort_order 持久化 */
  function applyColumnOrder(newColItems: ApplicationListItem[], col: Status) {
    const result: ApplicationListItem[] = [];
    let idx = 0;
    for (const it of items) {
      if (it.status === col) result.push(newColItems[idx++]);
      else result.push(it);
    }
    api
      .reorderApplications(result.map((i) => i.id))
      .then(() => queryClient.invalidateQueries({ queryKey: ["applications"] }))
      .catch(() => queryClient.invalidateQueries({ queryKey: ["applications"] }));
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
    setDragging(null);
    const { active, over } = e;
    if (!over || !canReorder) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeItem = items.find((i) => i.id === activeId);
    if (!activeItem) return;

    const overIsRow = allRows.includes(overId as Status);

    if (overIsRow) {
      // 拖到行空白处：跨状态 → 状态确认
      triggerStatusChange(activeItem, overId as Status);
      return;
    }

    const overItem = items.find((i) => i.id === overId);
    if (!overItem) return;

    if (overItem.status === activeItem.status) {
      // 行内重排
      if (activeId === overId) return;
      const colItems = items.filter((i) => i.status === activeItem.status);
      const from = colItems.findIndex((i) => i.id === activeId);
      const to = colItems.findIndex((i) => i.id === overId);
      if (from < 0 || to < 0) return;
      applyColumnOrder(arrayMove(colItems, from, to), activeItem.status);
    } else {
      // 拖到另一状态的卡片上：跨状态 → 状态确认
      triggerStatusChange(activeItem, overItem.status);
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
        onDragStart={(e: DragStartEvent) => {
          setDragActive(true);
          setDragging(items.find((i) => i.id === e.active.id) ?? null);
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDragActive(false);
          setDragging(null);
        }}
      >
        <div className="space-y-2.5">
          {visible.map((row) => (
            <SwimLane
              key={row}
              status={row}
              colItems={byStatus.get(row) ?? []}
              canReorder={canReorder}
              onOpen={(id) => navigate(`/applications/${id}`)}
            />
          ))}
        </div>
        <DragOverlay>
          {dragging && <Card item={dragging} dragging />}
        </DragOverlay>
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
  onOpen,
}: {
  status: Status;
  colItems: ApplicationListItem[];
  canReorder: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isTerminal = status === "REJECTED" || status === "WITHDRAWN";

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors",
        isOver
          ? "border-indigo-300 bg-indigo-50/70 dark:border-indigo-500/70 dark:bg-indigo-900/20"
          : "border-slate-200/70 bg-slate-50/60 dark:border-slate-800/70 dark:bg-slate-900/40",
        isTerminal && !isOver && "bg-slate-50/40 dark:bg-slate-950/30",
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: item.id,
    disabled: !canReorder,
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={cn(isDragging && "opacity-30")}>
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
        "w-52 cursor-pointer rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-all hover:border-slate-300/80 hover:shadow-[0_2px_6px_rgba(0,0,0,0.06)] focus-visible:ring-2 focus-visible:ring-indigo-300 dark:border-slate-700/80 dark:bg-slate-800/80 dark:hover:border-slate-600 dark:hover:shadow-none",
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
