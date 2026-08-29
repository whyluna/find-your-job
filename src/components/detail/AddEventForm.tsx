/** 时间线行内"添加事件"表单：类型切换动态出字段（邀请→deadline，完成→result） */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import {
  EVENT_RESULT_LABELS,
  EVENT_TYPE_DEFS,
  type EventResult,
  type EventType,
} from "@shared";
import type { CustomEventType } from "@shared";
import { Button, Select } from "@/components/ui";
import { DateTimePicker } from "@/components/DateTimePicker";
import { cn } from "@/lib/utils";

/** 事件类型分组，让菜单一目了然 */
const GROUPS: { name: string; types: EventType[] }[] = [
  { name: "投递", types: ["APPLIED"] },
  {
    name: "测评 / 笔试",
    types: [
      "ASSESSMENT_INVITED",
      "ASSESSMENT_DONE",
      "ASSESSMENT_FAILED",
      "WRITTEN_INVITED",
      "WRITTEN_DONE",
      "WRITTEN_FAILED",
    ],
  },
  { name: "简历 / 沟通", types: ["RESUME_PASS", "RESUME_FAIL", "HR_CONTACT"] },
  {
    name: "Offer 阶段",
    types: ["OC", "INTENT_LETTER", "OFFER", "DUAL_AGREEMENT", "TRIPLICATE", "SIGNED"],
  },
  { name: "终态 / 其他", types: ["REJECTED", "WITHDRAWN", "NOTE"] },
];

export function AddEventForm({
  applicationId,
  onDone,
}: {
  applicationId: string;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<EventType | string>("HR_CONTACT");
  const [occurredAt, setOccurredAt] = useState<string>(new Date().toISOString());
  const [deadline, setDeadline] = useState<string | null>(null);
  const [result, setResult] = useState<EventResult>("UNKNOWN");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const { data: customTypes } = useQuery({
    queryKey: ["custom-event-types"],
    queryFn: api.listCustomEventTypes,
  });

  const isCustom = type.startsWith("custom:");
  const customDef: CustomEventType | undefined = customTypes?.find(
    (c: CustomEventType) => `custom:${c.id}` === type,
  );
  const needsDeadline = isCustom
    ? customDef?.deadlineRequired
    : EVENT_TYPE_DEFS[type as EventType]?.needsDeadline;
  const needsResult = isCustom
    ? customDef?.resultRequired
    : EVENT_TYPE_DEFS[type as EventType]?.needsResult;

  const add = useMutation({
    mutationFn: () =>
      api.addEvent({
        applicationId,
        type,
        occurredAt,
        deadline: needsDeadline ? deadline : null,
        result: needsResult ? result : null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["application-detail", applicationId] });
      queryClient.invalidateQueries({ queryKey: ["db-ready"] });
      setNote("");
      setDeadline(null);
      setError("");
      setOpen(false);
      onDone?.();
    },
    onError: (e) => setError(String(e)),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2.5 text-xs text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-500 dark:border-slate-600 dark:text-slate-400"
      >
        <Plus className="size-3.5" /> 添加事件
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-800 dark:bg-indigo-900/15">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <div className="mb-1.5 text-xs font-medium text-slate-500">事件类型</div>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {GROUPS.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.types.map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_DEFS[t].label}
                  </option>
                ))}
              </optgroup>
            ))}
            {(customTypes ?? [])
              .filter((c: CustomEventType) => c.isActive)
              .length > 0 && (
              <optgroup label="自定义">
                {(customTypes ?? [])
                  .filter((c: CustomEventType) => c.isActive)
                  .map((c: CustomEventType) => (
                    <option key={c.id} value={`custom:${c.id}`}>
                      {c.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </Select>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-500">发生时间</div>
          <DateTimePicker
            value={occurredAt}
            onChange={(iso) => setOccurredAt(iso ?? new Date().toISOString())}
            withTime
          />
        </div>
        {needsDeadline && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-500">截止时间 *</div>
            <DateTimePicker value={deadline} onChange={setDeadline} withTime />
          </div>
        )}
        {needsResult && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-500">结果</div>
            <Select value={result} onChange={(e) => setResult(e.target.value as EventResult)}>
              {Object.entries(EVENT_RESULT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className={cn("col-span-2")}>
          <div className="mb-1.5 text-xs font-medium text-slate-500">备注</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="链接 / 细节…"
            className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          收起
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={add.isPending}
          onClick={() => {
            setError("");
            if (needsDeadline && !deadline) {
              setError("该事件需要填写截止时间");
              return;
            }
            add.mutate();
          }}
        >
          {add.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          写入时间线
        </Button>
      </div>
    </div>
  );
}
