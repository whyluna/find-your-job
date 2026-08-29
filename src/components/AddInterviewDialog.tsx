/** 添加面试弹窗：轮次自动递增，轮次标签来自字典预置 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { INTERVIEW_FORMAT_LABELS, ROUND_LABEL_PRESETS } from "@shared";
import { Button, Field, Modal, Select, TextInput } from "@/components/ui";
import { DateTimePicker } from "@/components/DateTimePicker";

export function AddInterviewDialog({
  open,
  applicationId,
  nextRound,
  onClose,
}: {
  open: boolean;
  applicationId: string | null;
  nextRound: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [round, setRound] = useState<number | null>(null);
  const [roundLabel, setRoundLabel] = useState<string>(ROUND_LABEL_PRESETS[0]);
  const [format, setFormat] = useState("VIDEO");
  const [scheduledAt, setScheduledAt] = useState<string | null>(new Date().toISOString());
  const [durationMin, setDurationMin] = useState("");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [interviewerNote, setInterviewerNote] = useState("");
  const [error, setError] = useState("");

  const effectiveRound = round ?? nextRound;

  const create = useMutation({
    mutationFn: () =>
      api.addInterview({
        applicationId: applicationId!,
        round: effectiveRound,
        roundLabel: roundLabel || null,
        format,
        scheduledAt,
        durationMin: durationMin ? +durationMin : null,
        locationOrLink: locationOrLink.trim() || null,
        interviewerNote: interviewerNote.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["application-detail"] });
      onClose();
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <Modal open={open} onClose={onClose} title={`添加第 ${effectiveRound} 轮面试`}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="轮次">
          <TextInput
            type="number"
            min={1}
            value={effectiveRound}
            onChange={(e) => setRound(Math.max(1, +e.target.value || 1))}
          />
        </Field>
        <Field label="轮次标签">
          <Select value={roundLabel} onChange={(e) => setRoundLabel(e.target.value)}>
            <option value="">（无）</option>
            {ROUND_LABEL_PRESETS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="形式">
          <Select value={format} onChange={(e) => setFormat(e.target.value)}>
            {Object.entries(INTERVIEW_FORMAT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="时长（分钟）">
          <TextInput
            type="number"
            value={durationMin}
            placeholder="60"
            onChange={(e) => setDurationMin(e.target.value)}
          />
        </Field>
        <div className="col-span-2">
          <Field label="时间">
            <DateTimePicker value={scheduledAt} onChange={setScheduledAt} withTime />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="地点 / 会议链接">
            <TextInput
              value={locationOrLink}
              placeholder="如：望京 / 腾讯会议 123-456"
              onChange={(e) => setLocationOrLink(e.target.value)}
            />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="面试官印象（可选）">
            <TextInput
              value={interviewerNote}
              placeholder="如：看起来是部门主管，关注系统设计"
              onChange={(e) => setInterviewerNote(e.target.value)}
            />
          </Field>
        </div>
      </div>
      {error && <div className="mt-3 text-sm text-red-500">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          disabled={create.isPending || !scheduledAt}
          onClick={() => {
            setError("");
            if (!scheduledAt) return setError("请选择面试时间");
            create.mutate();
          }}
        >
          {create.isPending && <Loader2 className="size-4 animate-spin" />}
          保存
        </Button>
      </div>
    </Modal>
  );
}
