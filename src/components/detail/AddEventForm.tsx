/** 时间线统一"添加事件"表单：事件菜单含「面试」（轮次自动推断），类型切换动态出字段 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import {
  EVENT_RESULT_LABELS,
  INTERVIEW_FORMAT_LABELS,
  ROUND_LABEL_PRESETS,
  type EventResult,
  type EventType,
} from "@shared";
import type { CustomEventType } from "@shared";
import { Button, Select, TextInput } from "@/components/ui";
import { DateTimePicker } from "@/components/DateTimePicker";

/** 事件菜单（收敛后的心智模型）：面试作为事件，轮次自动推断 */
const GROUPS: { name: string; items: { type: EventType | "INTERVIEW"; label: string }[] }[] = [
  { name: "投递", items: [{ type: "APPLIED", label: "已投递" }] },
  {
    name: "阶段",
    items: [
      { type: "ASSESSMENT_INVITED", label: "测评" },
      { type: "WRITTEN_INVITED", label: "笔试" },
      { type: "INTERVIEW", label: "面试" },
    ],
  },
  // 旧版完成/挂事件保留在菜单外（历史数据兼容显示，新记录用条目上的结果标记）
  {
    name: "沟通",
    items: [
      { type: "HR_CONTACT", label: "HR 沟通/约面" },
      { type: "RESUME_PASS", label: "简历过筛" },
      { type: "RESUME_FAIL", label: "简历挂" },
    ],
  },
  {
    name: "Offer 阶段",
    items: [
      { type: "OC", label: "口头 offer" },
      { type: "INTENT_LETTER", label: "意向书" },
      { type: "OFFER", label: "正式 offer" },
      { type: "DUAL_AGREEMENT", label: "两方协议" },
      { type: "TRIPLICATE", label: "三方协议" },
      { type: "SIGNED", label: "已签约" },
    ],
  },
  {
    name: "终态 / 其他",
    items: [
      { type: "REJECTED", label: "已挂（通用）" },
      { type: "WITHDRAWN", label: "主动放弃" },
      { type: "NOTE", label: "备注事件" },
    ],
  },
];

export function AddEventForm({
  applicationId,
  nextRound,
  hasScheduled,
  onDone,
}: {
  applicationId: string;
  nextRound: number;
  hasScheduled?: boolean;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<EventType | "INTERVIEW" | string>("HR_CONTACT");
  const [occurredAt, setOccurredAt] = useState<string>(new Date().toISOString());
  const [deadline, setDeadline] = useState<string | null>(null);
  const [result, setResult] = useState<EventResult>("UNKNOWN");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  // 面试字段
  const [roundLabel, setRoundLabel] = useState<string>("一面");
  const [format, setFormat] = useState("VIDEO");
  const [durationMin, setDurationMin] = useState("");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [interviewerNote, setInterviewerNote] = useState("");

  const { data: customTypes } = useQuery({
    queryKey: ["custom-event-types"],
    queryFn: api.listCustomEventTypes,
  });

  const isInterview = type === "INTERVIEW";
  const customDef: CustomEventType | undefined = customTypes?.find(
    (c: CustomEventType) => `custom:${c.id}` === type,
  );
  const needsDeadline =
    type === "ASSESSMENT_INVITED" || type === "WRITTEN_INVITED" || !!customDef?.deadlineRequired;
  const needsResult = !!customDef?.resultRequired;

  useEffect(() => {
    if (isInterview) setRoundLabel(ROUND_LABEL_PRESETS[Math.min(nextRound - 1, ROUND_LABEL_PRESETS.length - 1)]);
  }, [isInterview, nextRound]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["applications"] });
    queryClient.invalidateQueries({ queryKey: ["application-detail", applicationId] });
    queryClient.invalidateQueries({ queryKey: ["db-ready"] });
  };

  const addEvent = useMutation({
    mutationFn: () =>
      api.addEvent({
        applicationId,
        type: type as string,
        occurredAt,
        deadline: needsDeadline ? deadline : null,
        result: needsResult ? result : null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      invalidate();
      setNote("");
      setDeadline(null);
      setError("");
      setOpen(false);
      onDone?.();
    },
    onError: (e) => setError(String(e)),
  });

  const addInterview = useMutation({
    mutationFn: () =>
      api.addInterview({
        applicationId,
        round: nextRound,
        roundLabel: roundLabel || null,
        format,
        scheduledAt: occurredAt,
        durationMin: durationMin ? +durationMin : null,
        locationOrLink: locationOrLink.trim() || null,
        interviewerNote: interviewerNote.trim() || null,
      }),
    onSuccess: () => {
      invalidate();
      setLocationOrLink("");
      setInterviewerNote("");
      setDurationMin("");
      setError("");
      setOpen(false);
      onDone?.();
    },
    onError: (e) => setError(String(e)),
  });

  const busy = addEvent.isPending || addInterview.isPending;

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

  function submit() {
    setError("");
    if (needsDeadline && !deadline) {
      setError("该事件需要填写截止时间");
      return;
    }
    if (isInterview) {
      addInterview.mutate();
    } else {
      addEvent.mutate();
    }
  }

  const menuValue = String(type);

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-800 dark:bg-indigo-900/15">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <div className="mb-1.5 text-xs font-medium text-slate-500">事件类型</div>
          <Select
            value={menuValue}
            onChange={(e) => {
              const v = e.target.value;
              setType(v);
              if (v === "INTERVIEW") setOccurredAt(new Date().toISOString());
            }}
          >
            {GROUPS.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.items.map((it) => (
                  <option
                    key={it.type}
                    value={it.type}
                    disabled={it.type === "INTERVIEW" && hasScheduled}
                  >
                    {it.type === "INTERVIEW"
                      ? hasScheduled
                        ? "面试（需先完成/取消已约轮次）"
                        : `面试（第 ${nextRound} 轮）`
                      : it.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {(customTypes ?? []).filter((c: CustomEventType) => c.isActive).length > 0 && (
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
          {isInterview && (
            <div className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/80">
              将创建<b>第 {nextRound} 轮</b>面试（逐轮添加，需上一轮完成或取消）；记录后可在时间线该条目上标记结果
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-500">
            {isInterview ? "面试时间" : "发生时间"}
          </div>
          <DateTimePicker
            value={occurredAt}
            onChange={(iso) => setOccurredAt(iso ?? new Date().toISOString())}
            withTime
          />
        </div>

        {isInterview ? (
          <>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-500">轮次标签</div>
              <Select value={roundLabel} onChange={(e) => setRoundLabel(e.target.value)}>
                <option value="">（无）</option>
                {ROUND_LABEL_PRESETS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-500">形式</div>
              <Select value={format} onChange={(e) => setFormat(e.target.value)}>
                {Object.entries(INTERVIEW_FORMAT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-500">时长（分钟）</div>
              <TextInput
                type="number"
                value={durationMin}
                placeholder="60"
                onChange={(e) => setDurationMin(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <div className="mb-1.5 text-xs font-medium text-slate-500">地点 / 会议链接</div>
              <TextInput
                value={locationOrLink}
                placeholder="如：望京 / 腾讯会议 123-456"
                onChange={(e) => setLocationOrLink(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <div className="mb-1.5 text-xs font-medium text-slate-500">面试官印象（可选）</div>
              <TextInput
                value={interviewerNote}
                placeholder="如：部门主管，关注系统设计"
                onChange={(e) => setInterviewerNote(e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
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
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </div>
            )}
          </>
        )}

        {!isInterview && (
          <div className="col-span-2">
            <div className="mb-1.5 text-xs font-medium text-slate-500">备注</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="链接 / 细节…"
              className="w-full rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        )}
      </div>

      {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          收起
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={submit}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          写入时间线
        </Button>
      </div>
    </div>
  );
}
