/** 简历版本库：上传（复制进应用目录）/ 设默认 / 打开 / 删除；显示被投递引用数 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileText, FolderSearch, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { Button, Field, Modal, Select, TextInput } from "@/components/ui";
import { cn } from "@/lib/utils";

const TARGET_ROLES = ["", "算法", "后端", "前端", "客户端", "测试", "数据", "产品", "其他"];

export default function ResumeLibraryPage() {
  const queryClient = useQueryClient();
  const [uploadModal, setUploadModal] = useState<{ sourcePath: string; fileName: string } | null>(null);
  const [name, setName] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const { data: resumes, isLoading } = useQuery({
    queryKey: ["resumes"],
    queryFn: api.listResumes,
  });

  const pickFile = async () => {
    setError("");
    const picked = await open({
      multiple: false,
      filters: [{ name: "简历文档", extensions: ["pdf", "doc", "docx", "md", "txt"] }],
    });
    if (!picked) return;
    const fileName = picked.split("/").pop() ?? "简历";
    setName(fileName.replace(/\.[^.]+$/, "") + " 版");
    setUploadModal({ sourcePath: picked, fileName });
  };

  const upload = useMutation({
    mutationFn: () =>
      api.uploadResume(name.trim(), targetRole || null, uploadModal!.sourcePath, notes.trim() || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resumes"] });
      setUploadModal(null);
      setNotes("");
    },
    onError: (e) => setError(String(e)),
  });

  const markDefault = useMutation({
    mutationFn: (id: string) => api.setDefaultResume(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["resumes"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteResumeFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resumes"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  function fmtSize(bytes?: number | null): string {
    if (!bytes) return "";
    if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">简历库</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            不同方向用不同版本；每条投递都会记录所用版本，P1 可统计各版本过筛率
          </p>
        </div>
        <Button variant="primary" onClick={pickFile}>
          <Plus className="size-4" /> 上传简历
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {isLoading && <div className="col-span-3 py-10 text-center text-sm text-slate-400">加载中…</div>}
        {!isLoading && (resumes ?? []).length === 0 && (
          <div className="col-span-3 rounded-xl border border-dashed border-slate-300 py-14 text-center text-sm text-slate-400 dark:border-slate-700">
            还没有简历版本。上传后，新建投递时会自动关联默认版本
          </div>
        )}
        {(resumes ?? []).map((r) => (
          <div
            key={r.id}
            className={cn(
              "rounded-xl border bg-white p-4 transition-shadow hover:shadow-md dark:bg-slate-900",
              r.isDefault ? "border-amber-300 dark:border-amber-700" : "border-slate-200 dark:border-slate-800/80",
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 text-white">
                  <FileText className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    {r.name}
                    {r.isDefault && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        默认
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {r.targetRole ? `${r.targetRole} · ` : ""}
                    {r.fileName} {r.fileSize ? `· ${fmtSize(r.fileSize)}` : ""}
                  </div>
                </div>
              </div>
            </div>
            {r.notes && <div className="mt-2 text-[13px] text-slate-500">{r.notes}</div>}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-slate-400">被 {r.usageCount} 条投递引用</span>
              <div className="flex gap-0.5">
                <button
                  title="打开文件"
                  onClick={() => openPath(r.filePath).catch((e) => alert(String(e)))}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                >
                  <ExternalLink className="size-3.5" />
                </button>
                <button
                  title="在 Finder 中显示"
                  onClick={() => revealItemInDir(r.filePath).catch(() => undefined)}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                >
                  <FolderSearch className="size-3.5" />
                </button>
                <button
                  title={r.isDefault ? "已是默认" : "设为默认"}
                  disabled={r.isDefault}
                  onClick={() => markDefault.mutate(r.id)}
                  className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-500 disabled:opacity-40 dark:hover:bg-amber-900/30"
                >
                  <Star className={cn("size-3.5", r.isDefault && "fill-amber-400 text-amber-400")} />
                </button>
                <button
                  title="删除"
                  onClick={() => {
                    if (
                      confirm(
                        r.usageCount > 0
                          ? `该版本被 ${r.usageCount} 条投递引用，删除后投递将变为“未标注”。确认删除？`
                          : "确认删除该简历版本？",
                      )
                    )
                      remove.mutate(r.id);
                  }}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 上传信息弹窗 */}
      <Modal open={!!uploadModal} onClose={() => setUploadModal(null)} title="登记简历版本">
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-500 dark:bg-slate-800">
            文件：{uploadModal?.fileName}（将复制到应用数据目录，原文件不动）
          </div>
          <Field label="版本名称 *">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="如：算法岗版 v3" />
          </Field>
          <Field label="适用方向">
            <Select value={targetRole} onChange={(e) => setTargetRole(e.target.value)}>
              {TARGET_ROLES.map((r) => (
                <option key={r} value={r}>{r || "（不区分）"}</option>
              ))}
            </Select>
          </Field>
          <Field label="备注">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="如：突出论文和大厂实习" />
          </Field>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setUploadModal(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={upload.isPending || !name.trim()}
              onClick={() => {
                setError("");
                if (!name.trim()) return setError("请填写版本名称");
                upload.mutate();
              }}
            >
              {upload.isPending && <Loader2 className="size-4 animate-spin" />}上传
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
