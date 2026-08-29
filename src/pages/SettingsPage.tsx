/** 设置页：数据导出/导入、扩展接入、数据目录、关于 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { save, open } from "@tauri-apps/plugin-dialog";
import { Database, Download, FolderOpen, Loader2, Puzzle, Upload } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { Button } from "@/components/ui";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: apiStatus, error: statusError } = useQuery({
    queryKey: ["local-api"],
    queryFn: api.localApiStatus,
  });

  const toggleApi = useMutation({
    mutationFn: (enabled: boolean) => api.localApiSetEnabled(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["local-api"] }),
  });

  const resetToken = useMutation({
    mutationFn: () => api.localApiResetToken(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["local-api"] }),
  });

  const doExport = async () => {
    setMsg(null);
    const path = await save({
      title: "导出全部数据",
      defaultPath: `findyourjob-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    setBusy(true);
    try {
      const n = await api.exportJson(path);
      setMsg({ kind: "ok", text: `已导出 ${n} 行数据 → ${path}` });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setMsg(null);
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
      setMsg({
        kind: "ok",
        text: `已恢复 ${summary.total} 行数据（投递 ${summary.counts["application"] ?? 0} 条）`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">设置</h1>

      {/* 数据 */}
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
        {msg && (
          <div
            className={
              msg.kind === "ok"
                ? "mt-3 break-all rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                : "mt-3 break-all rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300"
            }
          >
            {msg.text}
          </div>
        )}
      </section>

      {/* 浏览器扩展接入 */}
      <section className="mt-4 max-w-2xl rounded-xl border border-slate-200 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Puzzle className="size-4" /> 浏览器扩展接入
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          开启后应用在本机监听 127.0.0.1:{apiStatus?.port ?? 37321}
          ，配合浏览器扩展可在招聘网站一键剪藏岗位，剪藏落为「已保存」状态。
        </p>
        {statusError && <div className="mt-2 text-xs text-red-500">{String(statusError)}</div>}
        {apiStatus && (
          <div className="mt-4 space-y-3">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-indigo-600"
                checked={apiStatus.enabled}
                disabled={toggleApi.isPending}
                onChange={(e) => toggleApi.mutate(e.target.checked)}
              />
              <span>
                {apiStatus.enabled ? "已开启" : "已关闭"}
                {apiStatus.running && (
                  <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    服务运行中
                  </span>
                )}
              </span>
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {apiStatus.token}
              </code>
              <Button size="sm" onClick={() => navigator.clipboard?.writeText(apiStatus.token)}>
                复制
              </Button>
              <Button size="sm" variant="ghost" disabled={resetToken.isPending} onClick={() => resetToken.mutate()}>
                重置
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* 关于 */}
      <section className="mt-4 max-w-2xl rounded-xl border border-slate-200 p-5 dark:border-slate-800">
        <h2 className="text-sm font-semibold">关于</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          FindYourJob v0.1.0 · 状态由事件时间线推导的本地求职记录工具。
          <br />
          更多设置（提醒、邮件解析）将在后续版本提供。
        </p>
      </section>
    </div>
  );
}
