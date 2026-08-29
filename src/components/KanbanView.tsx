/** 看板视图：默认隐藏空列（可切换显示全部），拖拽改状态 = 快捷创建事件（§5.4） */
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
import { EyeOff, Eye } from "lucide-react";
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
  const [showAllColumns, setShowAllColumns] = useState(
    () => localStorage.getItem("fyj-show-all-columns") === "1",
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const base = boardColumns ?? (Object.keys(STATUS_LABELS) as Status[]);
  const present = new Set(items.map((i) => i.status));
  const extra = (Object.keys(STATUS_LABELS) as Status[]).filter(
    (s) => !base.includes(s) && present.has(s),
  );
  const allColumns = [...base, ...extra];

  // 默认隐藏空列：早期投递少时看板不再是一排"拖到这里"
  const columns = showAllColumns
    ? allColumns
    : allColumns.filter((c) => items.filter((i) => i.status === c).length > 0);
  const visible = columns.length > 0 ? columns : allColumns;

  const byStatus = new Map<Status, ApplicationListItem[]>();
  for (const col of allColumns) byStatus.set(col, []);
  for (const item of items) byStatus.get(item.status)?.push(item);

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
      <div className="mb-2 flex justify-end">
        <button
          onClick={() => {
            const next = !showAllColumns;
            setShowAllColumns(next);
            localStorage.setItem("fyj-show-all-columns", next ? "1" : "0");
          }}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          {showAllColumns ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          {showAllColumns ? "隐藏空列" : `显示全部列（${allColumns.length}）`}
        </button>
      </div>
      <DndContext
        sensors={sensors}
        modifiers={[restrictToWindowEdges]}
        onDragStart={(e: DragStartEvent) =>
          setDragging(items.find((i) => i.id === e.active.id) ?? null)
        }
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-3">
          {visible.map((col) => (
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
        "flex w-60 shrink-0 flex-col rounded-xl border bg-slate-100/70 transition-colors dark:bg-slate-900/60",
        isOver
          ? "border-indigo-400 bg-indigo-50/70 dark:border-indigo-500 dark:bg-indigo-900/20"
          : "border-slate-200 dark:border-slate-800",
        isTerminal && "bg-slate-50/80 dark:bg-slate-950/40",
      )}
    >
      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {STATUS_LABELS[status]}
        </span>
        <span className="rounded-full bg-slate-200 px-1.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {items.length}
        </span>
      </div>
      <div className="flex max-h-[calc(100vh-300px)] flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {items.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 py-3 text-center text-[11px] text-slate-400 dark:border-slate-700">
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
        "cursor-pointer rounded-lg border border-slate-200 bg-white p-2 shadow-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-indigo-300 dark:border-slate-700 dark:bg-slate-800",
        !dragging && "hover:shadow-md",
        dragging && "rotate-1 shadow-xl",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight">{item.companyName}</div>
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
        {item.department && (
          <span className="truncate text-[10px] text-slate-400">{item.department}</span>
        )}
      </div>
    </div>
  );
}
