/** 编辑投递基本信息（含简历版本、标签、JD） */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/ipc";
import type { Application } from "@shared";
import { BATCH_LABELS, CHANNEL_LABELS, PRIORITY_LABELS } from "@shared";
import { Button, Field, Modal, Select, TextInput } from "@/components/ui";

export function EditApplicationDialog({
  open,
  application,
  onClose,
}: {
  open: boolean;
  application: Application;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState(application.companyName);
  const [positionTitle, setPositionTitle] = useState(application.positionTitle);
  const [department, setDepartment] = useState(application.department ?? "");
  const [workLocation, setWorkLocation] = useState(application.workLocation ?? "");
  const [channel, setChannel] = useState(application.channel);
  const [batch, setBatch] = useState(application.batch);
  const [priority, setPriority] = useState(application.priority);
  const [resumeVersionId, setResumeVersionId] = useState(application.resumeVersionId ?? "");
  const [tags, setTags] = useState(application.tags.join(", "));
  const [salaryRange, setSalaryRange] = useState(application.salaryRange ?? "");
  const [jobUrl, setJobUrl] = useState(application.jobUrl ?? "");
  const [notes, setNotes] = useState(application.notes ?? "");
  const [error, setError] = useState("");

  const { data: resumes } = useQuery({
    queryKey: ["resumes"],
    queryFn: api.listResumes,
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setCompanyName(application.companyName);
      setPositionTitle(application.positionTitle);
      setDepartment(application.department ?? "");
      setWorkLocation(application.workLocation ?? "");
      setChannel(application.channel);
      setBatch(application.batch);
      setPriority(application.priority);
      setResumeVersionId(application.resumeVersionId ?? "");
      setTags(application.tags.join(", "));
      setSalaryRange(application.salaryRange ?? "");
      setJobUrl(application.jobUrl ?? "");
      setNotes(application.notes ?? "");
      setError("");
    }
  }, [open, application]);

  const save = useMutation({
    mutationFn: () =>
      api.updateApplication(application.id, {
        companyName: companyName.trim(),
        positionTitle: positionTitle.trim(),
        department: department.trim() || null,
        workLocation: workLocation.trim() || null,
        channel,
        batch,
        priority,
        resumeVersionId: resumeVersionId || null,
        tags: tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
        salaryRange: salaryRange.trim() || null,
        jobUrl: jobUrl.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["application-detail", application.id] });
      onClose();
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <Modal open={open} onClose={onClose} title="编辑投递信息" wide>
      <div className="grid grid-cols-2 gap-4">
        <Field label="公司">
          <TextInput value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </Field>
        <Field label="岗位">
          <TextInput value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} />
        </Field>
        <Field label="部门/事业部">
          <TextInput value={department} onChange={(e) => setDepartment(e.target.value)} />
        </Field>
        <Field label="Base 城市">
          <TextInput value={workLocation} onChange={(e) => setWorkLocation(e.target.value)} />
        </Field>
        <Field label="渠道">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="批次">
          <Select value={batch} onChange={(e) => setBatch(e.target.value)}>
            {Object.entries(BATCH_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="优先级">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as "HIGH" | "MEDIUM" | "LOW")}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="简历版本">
          <Select value={resumeVersionId} onChange={(e) => setResumeVersionId(e.target.value)}>
            <option value="">（未指定）</option>
            {(resumes ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isDefault ? "（默认）" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="薪资范围（如知道）">
          <TextInput value={salaryRange} onChange={(e) => setSalaryRange(e.target.value)} placeholder="25k×15 + 签字费2w" />
        </Field>
        <Field label="岗位链接">
          <TextInput value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <div className="col-span-2">
          <Field label="标签（逗号分隔）">
            <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="想去的, 保底" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="备注">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
          </Field>
        </div>
      </div>
      {error && <div className="mt-3 text-sm text-red-500">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            setError("");
            if (!companyName.trim() || !positionTitle.trim()) return setError("公司和岗位不能为空");
            save.mutate();
          }}
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" />}保存
        </Button>
      </div>
    </Modal>
  );
}
