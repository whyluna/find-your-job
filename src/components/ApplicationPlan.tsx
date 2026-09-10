import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Application } from "@shared";
import { api } from "@/lib/ipc";
import { DatePicker } from "./DatePicker";
import { Button, Field, Modal } from "./ui";
import { showToast } from "@/lib/toast";
import { refreshNotifierSchedule } from "@/lib/notifier";

export function ApplicationPlanFields({ planned, deadline, onPlanned, onDeadline }: {
  planned: string | null; deadline: string | null;
  onPlanned: (value: string | null) => void; onDeadline: (value: string | null) => void;
}) {
  return <div className="space-y-2">
    <div className="grid grid-cols-2 gap-3">
      <Field label="计划投递时间"><DatePicker value={planned} onChange={onPlanned} withTime placeholder="安排投递时间" /></Field>
      <Field label="网申截止时间"><DatePicker value={deadline} onChange={onDeadline} withTime placeholder="填写网申截止时间" /></Field>
    </div>
    <p className="text-[12px] text-[var(--fyj-secondary)]">显示在仪表盘和日历；开启系统提醒后会提前通知。确认投递、放弃或归档后停止提醒。</p>
  </div>;
}

export function EditPlanDialog({ application, onClose }: { application: Application; onClose: () => void }) {
  const client = useQueryClient();
  const [planned, setPlanned] = useState(application.plannedApplyAt ?? null);
  const [deadline, setDeadline] = useState(application.applicationDeadline ?? null);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => api.updateApplication(application.id, { plannedApplyAt: planned, applicationDeadline: deadline }),
    onSuccess: async () => {
      await client.invalidateQueries();
      await refreshNotifierSchedule();
      showToast({ kind: "success", message: "投递计划已更新" });
      onClose();
    },
    onError: (reason) => setError(String(reason)),
  });
  return <Modal open title="投递计划" onClose={() => { if (!save.isPending) onClose(); }}>
    <ApplicationPlanFields planned={planned} deadline={deadline} onPlanned={setPlanned} onDeadline={setDeadline} />
    {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <Button onClick={onClose} disabled={save.isPending}>取消</Button>
      <Button variant="primary" disabled={save.isPending} onClick={() => {
        if (planned && deadline && new Date(planned) > new Date(deadline)) { setError("计划投递时间不能晚于网申截止时间"); return; }
        save.mutate();
      }}>保存计划</Button>
    </div>
  </Modal>;
}
