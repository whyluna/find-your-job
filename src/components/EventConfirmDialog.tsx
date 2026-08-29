/**
 * 拖拽改状态 → 事件确认弹窗（设计 §5.4）：
 * 拖到目标列不是直接改状态，而是快捷创建对应事件，状态由事件推导。
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { EVENT_TYPE_DEFS, type EventType, type Status } from "@shared";
import type { ApplicationListItem } from "@shared";
import { Button, Field, Modal, Select } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { EVENT_RESULT_LABELS } from "@shared";

/** 目标列 → 预填事件类型（面试列由调用方特殊处理，不进本弹窗） */
export function columnToEventType(target: Status): EventType | null {
  switch (target) {
    case "APPLIED": return "APPLIED";
    case "ASSESSMENT": return "ASSESSMENT_INVITED";
    case "WRITTEN": return "WRITTEN_INVITED";
    case "OC": return "OC";
    case "INTENT": return "INTENT_LETTER";
    case "OFFER": return "OFFER";
    case "SIGNED": return "SIGNED";
    case "REJECTED": return "REJECTED";
    case "WITHDRAWN": return "WITHDRAWN";
    default: return null; // SAVED / INTERVIEWING 不走本弹窗
  }
}

export function EventConfirmDialog({
  open,
  application,
  eventType,
  presetNote,
  onClose,
}: {
  open: boolean;
  application: ApplicationListItem | null;
  eventType: EventType;
  presetNote?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [occurredAt, setOccurredAt] = useState<string>(new Date().toISOString());
  const [deadline, setDeadline] = useState<string | null>(null);
  const [result, setResult] = useState<string>("UNKNOWN");
  const [note, setNote] = useState(presetNote ?? "");
  const [error, setError] = useState("");

  const def = EVENT_TYPE_DEFS[eventType];

  const submit = useMutation({
    mutationFn: async () => {
      if (!application) throw new Error("无投递上下文");
      return api.addEvent({
        applicationId: application.id,
        type: eventType,
        occurredAt,
        deadline: def.needsDeadline ? deadline : null,
        result: def.needsResult ? (result as "PENDING") : null,
        note: note.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["application-detail"] });
      queryClient.invalidateQueries({ queryKey: ["db-ready"] });
      onClose();
    },
    onError: (e) => setError(String(e)),
  });

  function handleSubmit() {
    setError("");
    if (def.needsDeadline && !deadline) {
      setError("该事件需要填写截止时间（测评/笔试链接通常有有效期）");
      return;
    }
    submit.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={application ? `${application.companyName} · 添加事件` : "添加事件"}
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
          「{def.label}」将写入时间线，投递状态随后自动更新
        </div>
        <Field label="发生时间">
          <DatePicker value={occurredAt} onChange={(iso) => setOccurredAt(iso ?? new Date().toISOString())} withTime />
        </Field>
        {def.needsDeadline && (
          <Field label="截止时间 *（测评/笔试链接有效期）">
            <DatePicker value={deadline} onChange={setDeadline} withTime minIso={occurredAt} />
          </Field>
        )}
        {def.needsResult && (
          <Field label="结果">
            <Select value={result} onChange={(e) => setResult(e.target.value)}>
              {Object.entries(EVENT_RESULT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="备注">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={eventType === "REJECTED" ? "挂在哪个环节？（可选）" : "链接、细节…（可选）"}
            className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
          />
        </Field>
        {error && <div className="text-sm text-red-500">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submit.isPending}>
            {submit.isPending && <Loader2 className="size-4 animate-spin" />}
            确认写入
          </Button>
        </div>
      </div>
    </Modal>
  );
}
