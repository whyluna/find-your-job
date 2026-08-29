/** 邮件解析审核面板：.eml 导入 + 待审核列表（确认导入/忽略 + 关联投递） */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FileInput, Inbox, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { fmtDateTime } from "@/lib/format";
import { EVENT_TYPE_DEFS, type EventType } from "@shared";
import { Button, Select } from "@/components/ui";

export function MailReviewPanel() {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const { data: pending, isLoading } = useQuery({
    queryKey: ["mail-pending"],
    queryFn: () => api.listMailLogs("PENDING"),
  });
  const { data: imported } = useQuery({
    queryKey: ["mail-imported"],
    queryFn: () => api.listMailLogs("IMPORTED"),
  });

  const importEml = async () => {
    setMsg("");
    const path = await open({
      multiple: true,
      filters: [{ name: "邮件", extensions: ["eml"] }],
    });
    if (!path) return;
    const paths = Array.isArray(path) ? path : [path];
    let ok = 0;
    for (const p of paths) {
      const r = await api.importEmlFile(p).catch(() => null);
      if (r) ok++;
    }
    setMsg(`导入 ${ok}/${paths.length} 封（重复的自动跳过），在下方审核`);
    queryClient.invalidateQueries({ queryKey: ["mail-pending"] });
  };

  const decide = useMutation({
    mutationFn: async ({ id, action, appId }: { id: string; action: "import" | "ignore"; appId: string }) => {
      await api.decideMail(id, action, appId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mail-pending"] });
      queryClient.invalidateQueries({ queryKey: ["mail-imported"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  return (
    <section className="mt-4 max-w-2xl rounded-xl border border-slate-200 p-5 dark:border-slate-800">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Inbox className="size-4" /> 邮件解析（规则引擎，无 AI）
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
        支持导入 .eml 邮件文件：识别测评/笔试/面试/意向书/offer/感谢信，提取截止时间并匹配公司库，
        一律经人工确认后写入时间线。IMAP 自动同步在后续版本提供。
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={importEml}>
          <FileInput className="size-3.5" /> 导入 .eml
        </Button>
        {msg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{msg}</span>}
        {imported && imported.length > 0 && (
          <span className="text-xs text-slate-400">已导入 {imported.length} 封</span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {isLoading && <div className="text-xs text-slate-400">加载中…</div>}
        {!isLoading && (pending ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400 dark:border-slate-700">
            没有待审核邮件
          </div>
        )}
        {(pending ?? []).map((m) => (
          <MailRow
            key={m.id}
            mail={m}
            selection={selection[m.id] ?? ""}
            onSelect={(appId) => setSelection((s) => ({ ...s, [m.id]: appId }))}
            onDecide={(action) =>
              decide.mutate({ id: m.id, action, appId: selection[m.id] ?? "" })
            }
            pending={decide.isPending}
          />
        ))}
      </div>
    </section>
  );
}

function MailRow({
  mail,
  selection,
  onSelect,
  onDecide,
  pending,
}: {
  mail: {
    id: string;
    receivedAt: string;
    fromAddress: string;
    fromName?: string | null;
    subject: string;
    suggestedEventType?: string | null;
    suggestedDeadline?: string | null;
    matchReason?: string | null;
  };
  selection: string;
  onSelect: (appId: string) => void;
  onDecide: (action: "import" | "ignore") => void;
  pending: boolean;
}) {
  const { data: candidates } = useQuery({
    queryKey: ["mail-candidates", mail.fromAddress],
    queryFn: () => api.candidateApplications(mail.subject.slice(0, 12)),
    enabled: !!mail.suggestedEventType,
  });

  const suggestLabel = mail.suggestedEventType
    ? (EVENT_TYPE_DEFS[mail.suggestedEventType as EventType]?.label ?? mail.suggestedEventType)
    : "（无匹配规则）";

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-sm font-medium">{mail.subject}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">
        {mail.fromName ? `${mail.fromName} · ` : ""}
        {mail.fromAddress} · {fmtDateTime(mail.receivedAt)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={
            mail.suggestedEventType
              ? "rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300"
              : "rounded bg-slate-100 px-1.5 py-0.5 text-slate-400 dark:bg-slate-800"
          }
        >
          建议：{suggestLabel}
          {mail.suggestedDeadline ? `（截止 ${mail.suggestedDeadline}）` : ""}
        </span>
        {mail.matchReason && <span className="text-[11px] text-slate-400">{mail.matchReason}</span>}
      </div>
      {mail.suggestedEventType && (
        <div className="mt-2 flex items-center gap-2">
          <Select
            value={selection}
            onChange={(e) => onSelect(e.target.value)}
            className="flex-1 text-xs"
          >
            <option value="">选择关联的投递…</option>
            {(candidates ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName} · {c.positionTitle}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={!selection || pending}
            onClick={() => onDecide("import")}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            确认导入
          </Button>
        </div>
      )}
      <div className="mt-1.5 text-right">
        <button
          onClick={() => onDecide("ignore")}
          disabled={pending}
          className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          忽略
        </button>
      </div>
    </div>
  );
}
