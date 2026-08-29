/** 时间线事件条目：展示 + 行内编辑 + 删除 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { fmtDateTime, deadlineLabel, isUrgent } from "@/lib/format";
import {
  EVENT_RESULT_LABELS,
  EVENT_TYPE_DEFS,
  type AppEvent,
  type EventResult,
  type EventType,
} from "@shared";
import { Button, Select } from "@/components/ui";
import { DateTimePicker } from "@/components/DateTimePicker";
import { cn } from "@/lib/utils";

export function eventLabel(type: string): string {
  return EVENT_TYPE_DEFS[type as EventType]?.label ?? type;
}

export function EventItem({ event, applicationId }: { event: AppEvent; applicationId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [occurredAt, setOccurredAt] = useState(event.occurredAt);
  const [deadline, setDeadline] = useState<string | null>(event.deadline ?? null);
  const [result, setResult] = useState<EventResult>(event.result ?? "UNKNOWN");
  const [note, setNote] = useState(event.note ?? "");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    queryClient.invalidateQueries({ queryKey: ["application-detail", applicationId] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.updateEvent(event.id, {
        occurredAt,
        deadline,
        result: event.result !== undefined || EVENT_TYPE_DEFS[event.type as EventType]?.needsResult ? result : undefined,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteEvent(event.id),
    onSuccess: invalidate,
  });

  const def = EVENT_TYPE_DEFS[event.type as EventType];
  const isCustom = event.type.startsWith("custom:");

  if (editing) {
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-800 dark:bg-indigo-900/15">
        <div className="grid gap-3">
          <div>
            <div className="mb-1 text-[11px] text-slate-500">发生时间</div>
            <DateTimePicker value={occurredAt} onChange={(iso) => setOccurredAt(iso ?? event.occurredAt)} withTime />
          </div>
          {event.deadline !== null && (
            <div>
              <div className="mb-1 text-[11px] text-slate-500">截止时间</div>
              <DateTimePicker value={deadline} onChange={setDeadline} withTime />
            </div>
          )}
          {def?.needsResult && (
            <div>
              <div className="mb-1 text-[11px] text-slate-500">结果</div>
              <Select value={result} onChange={(e) => setResult(e.target.value as EventResult)} className="w-36">
                {Object.entries(EVENT_RESULT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <div className="mb-1 text-[11px] text-slate-500">备注</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
        </div>
        <div className="mt-2.5 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            <X className="size-3.5" /> 取消
          </Button>
          <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} 保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/event">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("font-medium", isCustom && "text-violet-600 dark:text-violet-400")}>
              {eventLabel(event.type)}
            </span>
            {event.result && (
              <span
                className={
                  event.result === "PASS"
                    ? "text-xs text-emerald-600 dark:text-emerald-400"
                    : event.result === "FAIL"
                      ? "text-xs text-red-500"
                      : "text-xs text-slate-400"
                }
              >
                {EVENT_RESULT_LABELS[event.result]}
              </span>
            )}
            {event.source === "EMAIL" && (
              <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-400 dark:bg-slate-800">
                邮件导入
              </span>
            )}
            {isUrgent(event.deadline) && (
              <span className="text-xs text-red-500">{deadlineLabel(event.deadline)}</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            {fmtDateTime(event.occurredAt)}
            {event.deadline && !isUrgent(event.deadline) && (
              <span className="ml-2">截止 {fmtDateTime(event.deadline)}</span>
            )}
          </div>
          {event.note && (
            <div className="mt-1 whitespace-pre-wrap text-xs text-slate-500 dark:text-slate-400">
              {event.note}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/event:opacity-100">
          <button
            onClick={() => setEditing(true)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
            title="编辑"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={() => {
              if (confirm("删除这条事件？投递状态会自动重算。")) del.mutate();
            }}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
            title="删除"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
