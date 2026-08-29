/** 投递详情页：时间线（行内加事件）/ 面试（逐题）/ JD / 材料占位 / 编辑与删除 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Briefcase,
  FileText,
  FolderSearch,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "@/lib/ipc";
import { fmtDate, fmtDateTime } from "@/lib/format";
import {
  BATCH_LABELS,
  CHANNEL_LABELS,
  PRIORITY_LABELS,
} from "@shared";
import { Button, StatusBadge } from "@/components/ui";
import { AddEventForm } from "@/components/detail/AddEventForm";
import { EventItem } from "@/components/detail/EventItem";
import { InterviewCard } from "@/components/detail/InterviewCard";
import { EditApplicationDialog } from "@/components/detail/EditApplicationDialog";
import { AddInterviewDialog } from "@/components/AddInterviewDialog";
import { cn } from "@/lib/utils";

type Tab = "timeline" | "interviews" | "jd" | "materials";

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("timeline");
  const [showEdit, setShowEdit] = useState(false);
  const [showAddInterview, setShowAddInterview] = useState(false);
  const [jdEditing, setJdEditing] = useState(false);
  const [jdDraft, setJdDraft] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["application-detail", id],
    queryFn: () => api.getApplicationDetail(id!),
    enabled: !!id,
  });

  const delApp = useMutation({
    mutationFn: () => api.deleteApplication(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      navigate("/applications");
    },
  });

  const archiveApp = useMutation({
    mutationFn: (archived: boolean) => api.setApplicationArchived(id!, archived),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["application-detail", id] });
    },
  });

  const saveJd = useMutation({
    mutationFn: () => api.updateApplication(id!, { jdText: jdDraft.trim() || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-detail", id] });
      setJdEditing(false);
    },
  });

  if (isLoading) return <div className="p-8 text-slate-400">加载中…</div>;
  if (isError)
    return (
      <div className="p-8">
        <div className="text-red-500">加载失败：{String(error)}</div>
        <Link to="/applications" className="mt-2 inline-block text-sm text-indigo-500">
          返回列表
        </Link>
      </div>
    );

  const app = data!;
  const nextRound = app.interviews.reduce((max, iv) => Math.max(max, iv.round), 0) + 1;

  return (
    <div className="p-8">
      <Link
        to="/applications"
        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
      >
        <ArrowLeft className="size-3.5" /> 返回投递列表
      </Link>

      {/* 头部 */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-xl font-semibold">
              {app.companyName} · {app.positionTitle}
            </h1>
            <StatusBadge status={app.status} />
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {BATCH_LABELS[app.batch as keyof typeof BATCH_LABELS] ?? app.batch}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {CHANNEL_LABELS[app.channel as keyof typeof CHANNEL_LABELS] ?? app.channel}
            </span>
            {app.isArchived && (
              <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-700">
                已归档
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>投递日 {fmtDate(app.appliedDate)}</span>
            {app.department && <span>{app.department}</span>}
            {app.workLocation && <span>Base {app.workLocation}</span>}
            <span>优先级 {PRIORITY_LABELS[app.priority]}</span>
            <span>
              简历版本：
              {app.resumeVersionName ?? <span className="text-amber-500">未标注</span>}
            </span>
            {app.salaryRange && <span>薪资 {app.salaryRange}</span>}
            {app.tags.map((t) => (
              <span key={t} className="text-indigo-500">#{t}</span>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => setShowEdit(true)}>
            <Pencil className="size-3.5" /> 编辑
          </Button>
          <Button size="sm" onClick={() => archiveApp.mutate(!app.isArchived)}>
            {app.isArchived ? (
              <>
                <ArchiveRestore className="size-3.5" /> 取消归档
              </>
            ) : (
              <>
                <Archive className="size-3.5" /> 归档
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm(`确定删除「${app.companyName} · ${app.positionTitle}」？事件、面试与题目将一并删除。`))
                delApp.mutate();
            }}
          >
            <Trash2 className="size-3.5" /> 删除
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(
          [
            ["timeline", "时间线", app.events.length],
            ["interviews", "面试记录", app.interviews.length],
            ["jd", "JD 快照", null],
            ["materials", "材料", app.attachments.length],
          ] as [Tab, string, number | null][]
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm transition-colors",
              tab === key
                ? "border-indigo-500 font-medium text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300",
            )}
          >
            {key === "timeline" && <FileText className="size-3.5" />}
            {key === "interviews" && <Briefcase className="size-3.5" />}
            {label}
            {count !== null && count > 0 && (
              <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500 dark:bg-slate-800">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 时间线 */}
      {tab === "timeline" && (
        <div className="mt-5 grid grid-cols-[1fr_320px] gap-6">
          <div className="space-y-3">
            <AddEventForm applicationId={app.id} />
            {app.events.map((e) => (
              <div key={e.id} className="flex gap-3">
                <div className="mt-2 size-[9px] shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                <div className="min-w-0 flex-1">
                  <EventItem event={e} applicationId={app.id} />
                </div>
              </div>
            ))}
            {app.events.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                还没有事件，用上方表单记录第一笔
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800">
            <div className="mb-2 font-medium text-slate-600 dark:text-slate-300">面试速览</div>
            {app.interviews.length === 0 ? (
              <div className="mb-3">暂无面试</div>
            ) : (
              <div className="mb-3 space-y-1">
                {app.interviews.map((iv) => (
                  <div key={iv.id} className="flex justify-between">
                    <span>
                      第 {iv.round} 轮{iv.roundLabel ? `（${iv.roundLabel}）` : ""}
                    </span>
                    <span className="text-slate-400">{fmtDate(iv.scheduledAt)}</span>
                  </div>
                ))}
              </div>
            )}
            <Button size="sm" className="w-full" onClick={() => setShowAddInterview(true)}>
              <Plus className="size-3.5" /> 添加面试
            </Button>
          </div>
        </div>
      )}

      {/* 面试 */}
      {tab === "interviews" && (
        <div className="mt-5 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="primary" onClick={() => setShowAddInterview(true)}>
              <Plus className="size-3.5" /> 添加第 {nextRound} 轮面试
            </Button>
          </div>
          {app.interviews.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
              面试后回来逐题记录，是本应用最核心的价值
            </div>
          )}
          {app.interviews.map((iv) => (
            <InterviewCard key={iv.id} interview={iv} applicationId={app.id} />
          ))}
        </div>
      )}

      {/* JD */}
      {tab === "jd" && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs text-slate-400">
              {app.jdSnapshotAt ? `快照保存于 ${fmtDateTime(app.jdSnapshotAt)}` : "未保存快照"}
              {app.jobUrl && (
                <a
                  href={app.jobUrl}
                  onClick={(e) => {
                    e.preventDefault();
                    import("@tauri-apps/plugin-opener").then((m) => m.openUrl(app.jobUrl!));
                  }}
                  className="ml-2 text-indigo-500 hover:underline"
                >
                  打开原链接 ↗
                </a>
              )}
            </div>
            {jdEditing ? (
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setJdEditing(false)}>取消</Button>
                <Button size="sm" variant="primary" disabled={saveJd.isPending} onClick={() => saveJd.mutate()}>
                  {saveJd.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  保存快照
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setJdDraft(app.jdText ?? "");
                  setJdEditing(true);
                }}
              >
                <Pencil className="size-3.5" /> {app.jdText ? "编辑" : "粘贴 JD"}
              </Button>
            )}
          </div>
          {jdEditing ? (
            <textarea
              value={jdDraft}
              onChange={(e) => setJdDraft(e.target.value)}
              rows={18}
              placeholder="粘贴 JD 全文，保存后将记录快照时间…"
              className="w-full rounded-xl border border-slate-200 bg-white p-4 font-mono text-xs leading-relaxed focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
          ) : app.jdText ? (
            <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-300">
              {app.jdText}
            </pre>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400 dark:border-slate-700">
              招聘链接几乎都会过期——把 JD 原文贴进来，复盘时才知道当时岗位要求了什么
            </div>
          )}
        </div>
      )}

      {/* 材料 */}
      {tab === "materials" && (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-slate-500">笔试截图、offer 扫描件、三方协议等（存于本机应用数据目录）</p>
            <Button
              size="sm"
              onClick={async () => {
                const picked = await openFileDialog({
                  multiple: false,
                  filters: [{ name: "文件", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "heic", "doc", "docx"] }],
                });
                if (!picked) return;
                try {
                  await api.uploadAttachment("APPLICATION", app.id, picked);
                  queryClient.invalidateQueries({ queryKey: ["application-detail", id] });
                } catch (e) {
                  alert(String(e));
                }
              }}
            >
              <Upload className="size-3.5" /> 上传文件
            </Button>
          </div>
          {app.attachments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-400 dark:border-slate-700">
              暂无材料
            </div>
          ) : (
            <div className="space-y-1.5">
              {app.attachments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-2.5 dark:border-slate-800"
                >
                  <Paperclip className="size-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-sm">{a.fileName}</span>
                  {a.size && (
                    <span className="text-xs text-slate-400">
                      {a.size > 1048576 ? `${(a.size / 1048576).toFixed(1)}MB` : `${Math.round(a.size / 1024)}KB`}
                    </span>
                  )}
                  <button
                    onClick={() => openPath(a.filePath).catch((e) => alert(String(e)))}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                    title="打开"
                  >
                    <FileText className="size-3.5" />
                  </button>
                  <button
                    onClick={() => revealItemInDir(a.filePath).catch(() => undefined)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                    title="在 Finder 中显示"
                  >
                    <FolderSearch className="size-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`删除附件「${a.fileName}」？`)) return;
                      await api.deleteAttachment(a.id).catch((e) => alert(String(e)));
                      queryClient.invalidateQueries({ queryKey: ["application-detail", id] });
                    }}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                    title="删除"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <EditApplicationDialog open={showEdit} application={app} onClose={() => setShowEdit(false)} />
      <AddInterviewDialog
        open={showAddInterview}
        applicationId={app.id}
        nextRound={nextRound}
        onClose={() => setShowAddInterview(false)}
      />
    </div>
  );
}
