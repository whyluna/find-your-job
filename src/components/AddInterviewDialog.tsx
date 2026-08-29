/** 添加面试弹窗：轮次锁定为"当前最大轮次+1"（服务端强制逐轮），标签按轮次默认（一面/二面/…） */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import { INTERVIEW_FORMAT_LABELS, ROUND_LABEL_PRESETS } from "@shared";
import { Button, Field, Modal, Select, TextInput } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";

/** 第 N 轮的默认标签 */
function presetFor(round: number): string {
  return ROUND_LABEL_PRESETS[Math.min(round - 1, ROUND_LABEL_PRESETS.length - 1)] ?? "";
}

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
  const [roundLabel, setRoundLabel] = useState<string>("一面");
  const [format, setFormat] = useState("VIDEO");
  const [scheduledAt, setScheduledAt] = useState<string | null>(new Date().toISOString());
  const [durationMin, setDurationMin] = useState("");
  const [locationOrLink, setLocationOrLink] = useState("");
  const [interviewerNote, setInterviewerNote] = useState("");
  const [error, setError] = useState("");

  // 每次打开或轮次变化时重置表单，标签按轮次默认（第2轮→二面）
  useEffect(() => {
    if (open) {
      setRoundLabel(presetFor(nextRound));
      setFormat("VIDEO");
      setScheduledAt(new Date().toISOString());
      setDurationMin("");
      setLocationOrLink("");
      setInterviewerNote("");
      setError("");
    }
  }, [open, nextRound]);

  const create = useMutation({
    mutationFn: () =>
      api.addInterview({
        applicationId: applicationId!,
        round: nextRound,
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
    <Modal open={open} onClose={onClose} title={`添加第 ${nextRound} 轮面试`}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 -mb-1 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800">
          轮次：第 <b>{nextRound}</b> 轮（逐轮添加，需上一轮完成或取消后才能开启）
        </div>
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
        <div className="col-span-2">
          <Field label="时间">
            <DatePicker value={scheduledAt} onChange={setScheduledAt} withTime />
          </Field>
        </div>
        <Field label="时长（分钟）">
          <TextInput
            type="number"
            value={durationMin}
            placeholder="60"
            onChange={(e) => setDurationMin(e.target.value)}
          />
        </Field>
        <Field label="地点 / 会议链接">
          <TextInput
            value={locationOrLink}
            placeholder="如：望京 / 腾讯会议 123-456"
            onChange={(e) => setLocationOrLink(e.target.value)}
          />
        </Field>
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
