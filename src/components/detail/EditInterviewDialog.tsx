import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import {
  INTERVIEW_FORMAT_LABELS,
  INTERVIEW_OUTCOME_LABELS,
  INTERVIEW_STATUS_LABELS,
  type InterviewDetail,
  type InterviewOutcome,
  type InterviewStatus,
} from "@shared";
import { Button, Field, Modal, Select, TextInput } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";

export function EditInterviewDialog({
  open,
  interview,
  applicationId,
  onClose,
}: {
  open: boolean;
  interview: InterviewDetail;
  applicationId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [roundLabel, setRoundLabel] = useState("");
  const [format, setFormat] = useState("");
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [durationMin, setDurationMin] = useState("");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [interviewerNote, setInterviewerNote] = useState("");
  const [status, setStatus] = useState<InterviewStatus>("SCHEDULED");
  const [outcome, setOutcome] = useState<InterviewOutcome>("PENDING");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setRoundLabel(interview.roundLabel ?? "");
    setFormat(interview.format ?? "VIDEO");
    setScheduledAt(interview.scheduledAt ?? null);
    setDurationMin(interview.durationMin ? String(interview.durationMin) : "");
    setLocationOrLink(interview.locationOrLink ?? "");
    setInterviewerNote(interview.interviewerNote ?? "");
    setStatus(interview.status);
    setOutcome(interview.outcome);
    setError("");
  }, [open, interview]);

  const save = useMutation({
    mutationFn: () => {
      const normalizedOutcome = status === "COMPLETED" ? outcome : "PENDING";
      return api.updateInterview(interview.id, {
        roundLabel: roundLabel.trim() || null,
        format: format || null,
        scheduledAt,
        durationMin: durationMin ? Number(durationMin) : null,
        locationOrLink: locationOrLink.trim() || null,
        interviewerNote: interviewerNote.trim() || null,
        status,
        outcome: normalizedOutcome,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["applications"] }),
        queryClient.invalidateQueries({ queryKey: ["application-detail", applicationId] }),
        queryClient.invalidateQueries({ queryKey: ["upcoming"] }),
      ]);
      onClose();
    },
    onError: (reason) => setError(String(reason)),
  });

  const submit = () => {
    setError("");
    if (status === "SCHEDULED" && !scheduledAt) {
      setError("已约面试必须填写时间");
      return;
    }
    if (status === "COMPLETED" && outcome === "PENDING") {
      setError("已完成面试需要选择通过、未通过或待定");
      return;
    }
    if (durationMin && (!Number.isFinite(Number(durationMin)) || Number(durationMin) <= 0)) {
      setError("时长必须是大于 0 的分钟数");
      return;
    }
    save.mutate();
  };

  return (
    <Modal open={open} onClose={onClose} title={`编辑第 ${interview.round} 轮面试`} wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label="轮次">
          <div className="flex h-[30px] items-center rounded-[7px] bg-[var(--fyj-surface-muted)] px-2.5 text-[13px] text-[var(--fyj-secondary)]">
            第 {interview.round} 轮（历史序号不变）
          </div>
        </Field>
        <Field label="轮次标签">
          <TextInput value={roundLabel} onChange={(event) => setRoundLabel(event.target.value)} placeholder="如：二面 / HR 面" />
        </Field>
        <Field label="状态">
          <Select
            value={status}
            onChange={(event) => {
              const next = event.target.value as InterviewStatus;
              setStatus(next);
              if (next !== "COMPLETED") setOutcome("PENDING");
            }}
          >
            {Object.entries(INTERVIEW_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="结果">
          <Select
            value={status === "COMPLETED" ? outcome : "PENDING"}
            disabled={status !== "COMPLETED"}
            onChange={(event) => setOutcome(event.target.value as InterviewOutcome)}
          >
            {Object.entries(INTERVIEW_OUTCOME_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="时间">
          <DatePicker value={scheduledAt} onChange={setScheduledAt} withTime />
        </Field>
        <Field label="形式">
          <Select value={format} onChange={(event) => setFormat(event.target.value)}>
            {Object.entries(INTERVIEW_FORMAT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </Field>
        <Field label="时长（分钟）">
          <TextInput type="number" min={1} value={durationMin} onChange={(event) => setDurationMin(event.target.value)} />
        </Field>
        <Field label="地点 / 会议链接">
          <TextInput value={locationOrLink} onChange={(event) => setLocationOrLink(event.target.value)} />
        </Field>
        <div className="col-span-2">
          <Field label="面试官印象">
            <TextInput value={interviewerNote} onChange={(event) => setInterviewerNote(event.target.value)} />
          </Field>
        </div>
      </div>
      {error && <div className="mt-3 text-[13px] text-red-500">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          保存面试
        </Button>
      </div>
    </Modal>
  );
}
