/** 设置页：数据导出/导入、数据目录、关于 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { save, open } from "@tauri-apps/plugin-dialog";
import { Database, Download, FolderOpen, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { Button } from "@/components/ui";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setStatus(null);
    const path = await save({
      title: "导出全部数据",
      defaultPath: `findyourjob-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    setBusy(true);
    try {
      const n = await api.exportJson(path);
      setStatus({ kind: "ok", msg: `已导出 ${n} 行数据 → ${path}` });
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setStatus(null);
    const path = await open({
      title: "选择要恢复的备份文件",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    if (!confirm("导入为覆盖式恢复：当前全部数据将被备份文件替换。继续？")) return;
    setBusy(true);
    try {
      const summary = await api.importJson(path);
      await queryClient.invalidateQueries();
      setStatus({
        kind: "ok",
        msg: `已恢复 ${summary.total} 行数据（投递 ${summary.counts["application"] ?? 0} 条）`,
      });
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">设置</h1>

      <section className="mt-6 max-w-2xl rounded-xl border border-slate-200 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Database className="size-4" /> 数据
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          所有数据仅存于本机（SQLite + 应用数据目录）。建议在重要节点手动导出 JSON 备份；
          导入为覆盖式恢复。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={doExport} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            导出全部数据
          </Button>
          <Button onClick={doImport} disabled={busy} variant="default">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            从备份恢复
          </Button>
          <Button variant="ghost" onClick={() => api.revealDataDir()}>
            <FolderOpen className="size-4" /> 在 Finder 中打开数据目录
          </Button>
        </div>
        {status && (
          <div
            className={
              status.kind === "ok"
                ? "mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                : "mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300"
            }
          >
            {status.msg}
          </div>
        )}
      </section>

      <section className="mt-4 max-w-2xl rounded-xl border border-slate-200 p-5 dark:border-slate-800">
        <h2 className="text-sm font-semibold">关于</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          FindYourJob v0.1.0 · 状态由事件时间线推导的本地求职记录工具。
          <br />
          更多设置（提醒、浏览器扩展接入、邮件解析）将在 P1/P2 提供。
        </p>
      </section>
    </div>
  );
}
