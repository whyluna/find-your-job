/** 设置页：数据导出/导入、扩展接入、数据目录、关于 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { save, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Database, Download, Eye, EyeOff, FolderOpen, Loader2, Puzzle, Upload } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { Button, PageHeader } from "@/components/ui";
import { CsvImportWizard } from "@/components/CsvImportWizard";
import { LlmSettingsCard } from "@/components/LlmSettingsCard";
import { showToast } from "@/lib/toast";
import { NotificationSettingsCard } from "@/components/NotificationSettingsCard";
import { fmtDate } from "@/lib/format";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);

  const { data: appVersion } = useQuery({
    queryKey: ["app-version"],
    queryFn: getVersion,
    staleTime: Infinity,
  });

  const { data: apiStatus, error: statusError } = useQuery({
    queryKey: ["local-api"],
    queryFn: api.localApiStatus,
  });

  const toggleApi = useMutation({
    mutationFn: (enabled: boolean) => api.localApiSetEnabled(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["local-api"] }),
    onError: (e) => setMsg({ kind: "err", text: String(e) }),
  });

  const resetToken = useMutation({
    mutationFn: () => api.localApiResetToken(),
    onSuccess: () => {
      setShowApiToken(false);
      showToast({ kind: "success", message: "扩展 Token 已重置，请在浏览器扩展中同步更新" });
      queryClient.invalidateQueries({ queryKey: ["local-api"] });
    },
    onError: (e) => setMsg({ kind: "err", text: String(e) }),
  });

  const doExport = async () => {
    setMsg(null);
    const path = await save({
      title: "导出全部数据",
      defaultPath: `findyourjob-backup-${fmtDate(new Date().toISOString())}.json`,
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

  const doExportCsv = async () => {
    setMsg(null);
    const path = await save({
      title: "导出 CSV（飞书表格兼容）",
      defaultPath: `findyourjob-${fmtDate(new Date().toISOString())}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    try {
      const n = await api.exportCsv(path);
      setMsg({ kind: "ok", text: `已导出 ${n} 条投递 → ${path}` });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
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
    <div className="px-6 pb-10 pt-0">
      <PageHeader title="设置" subtitle="数据、浏览器扩展与智能识别" />

      {/* 数据 */}
      <section className="mt-5 max-w-2xl rounded-xl border border-slate-200/80 p-5 dark:border-slate-800/80">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Database className="size-4" /> 数据
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          所有数据仅存于本机（SQLite + 应用数据目录）。JSON 备份会一并打包简历和附件，但不会包含
          LLM API Key 或浏览器扩展 Token；恢复后扩展 Token 会自动更新。导入为覆盖式恢复，建议在重要节点手动导出。
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
          <Button onClick={doExportCsv} disabled={busy}>
            <Download className="size-4" /> 导出 CSV
          </Button>
          <Button onClick={() => setShowCsvImport(true)} disabled={busy}>
            <Upload className="size-4" /> 从 CSV 导入
          </Button>
          <Button variant="ghost" onClick={() => api.revealDataDir().catch((reason) => showToast({ kind: "error", message: String(reason) }))}>
            <FolderOpen className="size-4" /> 在 Finder 中打开数据目录
          </Button>
        </div>
        {msg && (
          <div
            className={
              msg.kind === "ok"
                ? "mt-3 break-all rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                : "mt-3 break-all rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600 dark:bg-red-900/20 dark:text-red-300"
            }
          >
            {msg.text}
          </div>
        )}
      </section>

      {/* 浏览器扩展接入 */}
      <section className="mt-4 max-w-2xl rounded-xl border border-slate-200/80 p-5 dark:border-slate-800/80">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Puzzle className="size-4" /> 浏览器扩展接入
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          开启后应用在本机监听 127.0.0.1:{apiStatus?.port ?? 37321}
          ，配合浏览器扩展可在招聘网站一键收录岗位（配置下方「智能识别」后可自动识别公司/岗位/城市并清洗 JD）。
        </p>
        {statusError && <div className="mt-2 text-[13px] text-red-500">{String(statusError)}</div>}
        {apiStatus && (
          <div className="mt-4 space-y-3">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--fyj-accent)]"
                checked={apiStatus.enabled}
                disabled={toggleApi.isPending}
                onChange={(e) => toggleApi.mutate(e.target.checked)}
              />
              <span>
                {apiStatus.enabled ? "已开启" : "已关闭"}
                {apiStatus.running && (
                  <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    服务运行中
                  </span>
                )}
              </span>
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {showApiToken ? apiStatus.token : "••••••••-••••-••••-••••-••••••••••••"}
              </code>
              <Button
                size="sm"
                variant="ghost"
                aria-label={showApiToken ? "隐藏 Token" : "显示 Token"}
                onClick={() => setShowApiToken((v) => !v)}
              >
                {showApiToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(apiStatus.token);
                    showToast({ kind: "success", message: "扩展 Token 已复制" });
                  } catch (reason) {
                    showToast({ kind: "error", message: String(reason) });
                  }
                }}
              >
                复制
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={resetToken.isPending}
                onClick={() => {
                  if (confirm("重置后，浏览器扩展中的旧 Token 会立即失效。继续？")) resetToken.mutate();
                }}
              >
                重置
              </Button>
            </div>
          </div>
        )}
      </section>

      <LlmSettingsCard />
      <NotificationSettingsCard />

      {/* 关于 */}
      <section className="mt-4 max-w-2xl rounded-xl border border-slate-200/80 p-5 dark:border-slate-800/80">
        <h2 className="text-sm font-semibold">关于</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          FindYourJob{appVersion ? ` v${appVersion}` : ""} · 状态由事件时间线推导的本地求职记录工具。
          <br />
          系统提醒、浏览器扩展和本地数据备份均可在本页配置。
        </p>
        <Button
          size="sm"
          className="mt-3"
          onClick={() => openUrl("https://github.com/whyluna/find-your-job/releases/latest").catch((reason) => showToast({ kind: "error", message: String(reason) }))}
        >
          查看最新版本
        </Button>
      </section>
      <CsvImportWizard open={showCsvImport} onClose={() => setShowCsvImport(false)} />
    </div>
  );
}
