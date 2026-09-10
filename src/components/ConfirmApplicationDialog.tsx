import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { BATCH_LABELS, CHANNEL_LABELS, type Application } from "@shared";
import { api } from "@/lib/ipc";
import { showToast } from "@/lib/toast";
import { DatePicker } from "./DatePicker";
import { Button, Field, Modal, Select, TextInput } from "./ui";

/** 按需挂载，确保每次打开使用最新的时间与岗位信息。 */
export function ConfirmApplicationDialog({ application, onClose }: {
  application: Application;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [appliedAt, setAppliedAt] = useState<string | null>(() => new Date().toISOString());
  const [channel, setChannel] = useState(application.channel);
  const [batch, setBatch] = useState(application.batch);
  // undefined 表示尚未选择；空字符串是用户明确选择“未指定”，不能被默认值覆盖。
  const [resumeId, setResumeId] = useState<string | undefined>(application.resumeVersionId ?? undefined);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const { data: resumes = [], isPending: loadingResumes, isError: resumesFailed } = useQuery({
    queryKey: ["resumes"], queryFn: api.listResumes,
  });
  const selectedResume = resumeId ?? resumes.find((r) => r.isDefault)?.id ?? "";
  const confirm = useMutation({
    mutationFn: () => api.confirmApplication(application.id, {
      appliedAt: appliedAt!, channel, batch, resumeVersionId: selectedResume || null,
      note: note.trim() || null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      showToast({ kind: "success", message: "已记录正式投递，可继续跟进进度" });
      onClose();
    },
    onError: (reason) => setError(String(reason)),
  });
  function submit() {
    if (!appliedAt || new Date(appliedAt).getTime() > Date.now()) {
      setError("请填写已完成投递的时间，不能晚于现在");
      return;
    }
    setError("");
    confirm.mutate();
  }
  return (
    <Modal open onClose={() => { if (!confirm.isPending) onClose(); }} title="确认已投递">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold">{application.companyName} · {application.positionTitle}</p>
          <p className="mt-1 text-[13px] text-[var(--fyj-secondary)]">在招聘网站完成投递后，在这里记录。岗位将从意向岗位进入已投递。</p>
        </div>
        <Field label="实际投递时间">
          <DatePicker value={appliedAt} onChange={setAppliedAt} withTime />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="投递渠道">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {!Object.hasOwn(CHANNEL_LABELS, channel) && <option value={channel}>{channel}</option>}
              {Object.entries(CHANNEL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </Field>
          <Field label="投递批次">
            <Select value={batch} onChange={(e) => setBatch(e.target.value)}>
              {!Object.hasOwn(BATCH_LABELS, batch) && <option value={batch}>{batch}</option>}
              {Object.entries(BATCH_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="实际使用的简历" hint="可先不指定，之后在岗位详情中补充。">
          <Select value={selectedResume} disabled={loadingResumes || resumesFailed} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">未指定</option>
            {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}{resume.isDefault ? "（默认）" : ""}</option>)}
          </Select>
        </Field>
        {resumesFailed && <p role="alert" className="text-sm text-red-500">简历列表加载失败，请关闭后重试。</p>}
        <Field label="投递备注"><TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：使用内推码、网申已提交" /></Field>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={confirm.isPending}>暂不记录</Button>
          <Button variant="primary" onClick={submit} disabled={confirm.isPending || loadingResumes || resumesFailed}>
            {confirm.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} 确认已投递
          </Button>
        </div>
      </div>
    </Modal>
  );
}
