/** 看板视图：拖拽改状态 = 快捷创建事件（§5.4），拖到"面试中"= 添加面试 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/ipc";
import { deadlineLabel, isUrgent } from "@/lib/format";
import { BATCH_LABELS, STATUS_LABELS, type Status } from "@shared";
import type { ApplicationListItem } from "@shared";
import { AddInterviewDialog } from "@/components/AddInterviewDialog";
import { EventConfirmDialog, columnToEventType } from "@/components/EventConfirmDialog";
import { cn } from "@/lib/utils";

export function KanbanView({ items }: { items: ApplicationListItem[] }) {
  const navigate = useNavigate();
  const [dragging, setDragging] = useState<ApplicationListItem | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    app: ApplicationListItem;
    eventType: NonNullable<ReturnType<typeof columnToEventType>>;
    note?: string;
  } | null>(null);
  const [interviewTarget, setInterviewTarget] = useState<ApplicationListItem | null>(null);

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const base = boardColumns ?? (Object.keys(STATUS_LABELS) as Status[]);
  // 隐藏列中实际存在卡片时补显该列，避免"状态消失"
  const present = new Set(items.map((i) => i.status));
  const extra = (Object.keys(STATUS_LABELS) as Status[]).filter(
    (s) => !base.includes(s) && present.has(s),
  );
  const columns = [...base, ...extra];
  const byStatus = new Map<Status, ApplicationListItem[]>();
  for (const col of columns) byStatus.set(col, []);
  for (const item of items) {
    byStatus.get(item.status)?.push(item);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;
    const app = items.find((i) => i.id === active.id);
    const target = over.id as Status;
    if (!app || app.status === target) return;
    if (target === "SAVED") return; // 状态由事件推导，不能"取消投递"
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

  return (
    <div>
      <DndContext
        sensors={sensors}
        modifiers={[restrictToWindowEdges]}
        onDragStart={(e: DragStartEvent) =>
          setDragging(items.find((i) => i.id === e.active.id) ?? null)
        }
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-3">
          {columns.map((col) => (
            <BoardColumn
              key={col}
              status={col}
              items={byStatus.get(col) ?? []}
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

/** 隐藏列时把卡片归入兜底列（不应发生，防御） */

function BoardColumn({
  status,
  items,
  onOpen,
}: {
  status: Status;
  items: ApplicationListItem[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isTerminal = status === "REJECTED" || status === "WITHDRAWN";

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-xl border bg-slate-100/70 transition-colors dark:bg-slate-900/60",
        isOver
          ? "border-indigo-400 bg-indigo-50/70 dark:border-indigo-500 dark:bg-indigo-900/20"
          : "border-slate-200 dark:border-slate-800",
        isTerminal && "bg-slate-50/80 dark:bg-slate-950/40",
      )}
    >
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {STATUS_LABELS[status]}
        </span>
        <span className="rounded-full bg-slate-200 px-1.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {items.length}
        </span>
      </div>
      <div className="flex max-h-[calc(100vh-260px)] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {items.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 py-4 text-center text-[11px] text-slate-400 dark:border-slate-700">
            拖到这里
          </div>
        )}
        {items.map((item) => (
          <DraggableCard key={item.id} item={item} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({ item, onOpen }: { item: ApplicationListItem; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && "opacity-40")}>
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
        "cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800",
        !dragging && "hover:shadow-md",
        dragging && "rotate-1 shadow-xl",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight">{item.companyName}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
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
      {(item.department || item.batch) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {item.batch && item.batch !== "OTHER" && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-700 dark:text-slate-300">
              {BATCH_LABELS[item.batch as keyof typeof BATCH_LABELS] ?? item.batch}
            </span>
          )}
          {item.department && (
            <span className="truncate text-[10px] text-slate-400">{item.department}</span>
          )}
        </div>
      )}
      {item.interviewCount > 0 && (
        <div className="mt-1.5 flex gap-0.5" title={`${item.interviewCount} 轮面试`}>
          {Array.from({ length: Math.min(item.interviewCount, 5) }).map((_, i) => (
            <span key={i} className="size-1.5 rounded-full bg-indigo-400" />
          ))}
        </div>
      )}
    </div>
  );
}
