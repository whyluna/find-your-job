/** CSV 导入向导（飞书/Excel 迁移）：选文件 → 列映射（自动猜测）→ 逐行导入 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { Button, Modal, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  ApplicationImportPreview,
  ApplicationImportResult,
  ApplicationImportRow,
} from "@shared/ipc-types";

/** 完整 CSV 解析（处理引号、转义引号、换行） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (cell !== "" || row.length > 0) {
        row.push(cell.trim());
        rows.push(row);
        row = [];
        cell = "";
      }
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  if (inQuotes) throw new Error("CSV 引号未闭合，请检查文件是否完整");
  return rows;
}

const FIELDS = [
  { key: "progressData", label: "完整流程数据（App 导出）" },
  { key: "importStatus", label: "当前状态" },
  { key: "stageAt", label: "状态发生时间" },
  { key: "interviewRounds", label: "面试轮数" },
  { key: "plannedApplyAt", label: "计划投递时间" },
  { key: "applicationDeadline", label: "网申截止时间" },
  { key: "companyName", label: "公司 *" },
  { key: "positionTitle", label: "岗位 *" },
  { key: "department", label: "部门" },
  { key: "workLocation", label: "Base 城市" },
  { key: "appliedDate", label: "投递日期" },
  { key: "channel", label: "渠道（支持中文或英文键）" },
  { key: "batch", label: "批次（支持中文或英文键）" },
  { key: "priority", label: "优先级" },
  { key: "jobUrl", label: "岗位链接" },
  { key: "jdText", label: "JD 文本" },
  { key: "salaryRange", label: "薪资范围" },
  { key: "tags", label: "标签" },
  { key: "notes", label: "备注" },
] as const;

export function guessField(header: string): string {
  const h = header.toLowerCase();
  if (h === "流程数据" || h === "progressdata") return "progressData";
  if (h.includes("状态发生") || h === "stageat") return "stageAt";
  if (h.includes("状态") || h === "status") return "importStatus";
  if (h.includes("计划投递") || h === "plannedapplyat") return "plannedApplyAt";
  if (h.includes("网申截止") || h === "applicationdeadline") return "applicationDeadline";
  if (h.includes("面试轮") || h === "interviewrounds") return "interviewRounds";
  if (h.includes("公司") || h.includes("企业")) return "companyName";
  // “岗位链接”同时包含“岗位”，必须先识别更具体的链接语义。
  if (h.includes("链接") || h.includes("url")) return "jobUrl";
  if (h.includes("岗位") || h.includes("职位")) return "positionTitle";
  if (h.includes("部门") || h.includes("事业")) return "department";
  if (h.includes("base") || h.includes("城市") || h.includes("地点")) return "workLocation";
  if (h.includes("投递") || h.includes("申请")) return "appliedDate";
  if (h.includes("渠道") || h.includes("来源")) return "channel";
  if (h.includes("批次") || h.includes("批")) return "batch";
  if (h.includes("优先级") || h.includes("priority")) return "priority";
  if (h.includes("jd") || h.includes("描述")) return "jdText";
  if (h.includes("薪资") || h.includes("salary")) return "salaryRange";
  if (h.includes("标签") || h.includes("tag")) return "tags";
  if (h.includes("备注") || h.includes("note")) return "notes";
  return "";
}

function parseDate(s: string): { value: string | null; error?: string } {
  if (!s) return { value: null };
  const d = new Date(s.replace(/\//g, "-"));
  return Number.isNaN(d.getTime())
    ? { value: null, error: `无法识别投递日期「${s}」` }
    : { value: d.toISOString() };
}

function parseTags(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).map((v) => v.trim()).filter(Boolean);
    } catch {
      // 继续按分隔符兼容普通表格内容
    }
  }
  return value.split(/[,，;；]+/).map((v) => v.trim()).filter(Boolean);
}

function normalizePriority(raw: string): { value?: "HIGH" | "MEDIUM" | "LOW"; error?: string } {
  if (!raw.trim()) return {};
  const map: Record<string, "HIGH" | "MEDIUM" | "LOW"> = {
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    LOW: "LOW",
    高: "HIGH",
    中: "MEDIUM",
    低: "LOW",
  };
  const value = map[raw.trim().toUpperCase()] ?? map[raw.trim()];
  return value ? { value } : { error: `未知优先级「${raw}」` };
}

export function buildImportRows(rows: string[][], mapping: Record<number, string>): ApplicationImportRow[] {
    const get = (row: string[], field: string) => {
      const idx = Object.entries(mapping).find(([, mapped]) => mapped === field)?.[0];
      return idx !== undefined ? (row[+idx] ?? "").trim() : "";
    };
    return rows.slice(1).map((row, index) => {
      const errors: string[] = [];
      const appliedDate = parseDate(get(row, "appliedDate"));
      if (appliedDate.error) errors.push(appliedDate.error);
      const priority = normalizePriority(get(row, "priority"));
      if (priority.error) errors.push(priority.error);
      const date = (field: string) => {
        const parsed = parseDate(get(row, field));
        if (parsed.error) errors.push(`${FIELDS.find((f) => f.key === field)?.label}：${parsed.error}`);
        return parsed.value;
      };
      const roundsRaw = get(row, "interviewRounds");
      const rounds = roundsRaw ? Number(roundsRaw) : null;
      if (rounds !== null && (!Number.isInteger(rounds) || rounds < 0 || rounds > 100)) errors.push("面试轮数必须为 0 到 100 的整数");
      const plannedApplyAt = date("plannedApplyAt"), applicationDeadline = date("applicationDeadline"), stageAt = date("stageAt");
      return {
        rowNumber: index + 2,
        validationError: errors.join("；") || null,
        companyName: get(row, "companyName"),
        positionTitle: get(row, "positionTitle"),
        department: get(row, "department") || null,
        workLocation: get(row, "workLocation") || null,
        channel: get(row, "channel") || undefined,
        batch: get(row, "batch") || undefined,
        priority: priority.value,
        applied: !!appliedDate.value,
        appliedDate: appliedDate.value,
        plannedApplyAt, applicationDeadline, stageAt,
        importStatus: get(row, "importStatus") || null,
        progressData: get(row, "progressData") || null,
        interviewRounds: rounds !== null && Number.isInteger(rounds) ? rounds : null,
        jobUrl: get(row, "jobUrl") || null,
        jdText: get(row, "jdText") || null,
        salaryRange: get(row, "salaryRange") || null,
        tags: parseTags(get(row, "tags")),
        notes: get(row, "notes") || null,
      };
    });
}

export function CsvImportWizard({ open: isOpen, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<ApplicationImportPreview | null>(null);
  const [result, setResult] = useState<ApplicationImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [fileError, setFileError] = useState("");
  const buildRows = () => buildImportRows(rows, mapping);

  const pick = async () => {
    setResult(null);
    setPreview(null);
    setFileError("");
    const path = await open({
      multiple: false,
      filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
    });
    if (!path) return;
    let text: string;
    try {
      text = await api.readTextFile(path);
    } catch (e) {
      setFileError(String(e));
      return;
    }
    let parsed: string[][];
    try { parsed = parseCsv(text.replace(/^\uFEFF/, "")); }
    catch (reason) { setFileError(String(reason)); return; }
    if (parsed.length < 2) {
      setFileError("文件里没有数据行");
      return;
    }
    setFileName(path.split("/").pop() ?? path);
    setRows(parsed);
    const guess: Record<number, string> = {};
    parsed[0].forEach((h, i) => {
      guess[i] = guessField(h);
    });
    setMapping(guess);
  };

  const previewRun = useMutation({
    mutationFn: () => {
      const mapped = Object.values(mapping).filter(Boolean);
      if (!mapped.includes("companyName") || !mapped.includes("positionTitle")) {
        throw new Error("必须分别映射「公司」和「岗位」列");
      }
      const repeated = mapped.find((field, index) => mapped.indexOf(field) !== index);
      if (repeated) throw new Error("同一个字段不能映射到多列，请调整列映射");
      return api.previewApplicationImport(buildRows());
    },
    onSuccess: (value) => {
      setPreview(value);
      setResult(null);
      setFileError("");
    },
    onError: (error) => setFileError(String(error)),
  });

  const run = useMutation({
    mutationFn: () => api.importApplicationRows(buildRows(), skipDuplicates),
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["db-ready"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (error) => setFileError(String(error)),
  });

  const resetAndClose = () => {
    if (run.isPending || previewRun.isPending) return;
    setRows([]);
    setMapping({});
    setPreview(null);
    setResult(null);
    setFileName("");
    setFileError("");
    onClose();
  };

  return (
    <Modal open={isOpen} onClose={resetAndClose} title="从 CSV 导入（飞书/Excel）" wide>
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--fyj-secondary)]">新版 App 导出的 CSV 包含完整流程数据，可恢复事件、面试和题目。普通表格仅迁移当前状态与已知轮次，缺失历史需补充。简历和附件文件请使用 JSON 全量备份。</p>
        <div className="flex items-center gap-3">
          <Button onClick={pick} disabled={run.isPending || previewRun.isPending}>
            <Upload className="size-4" /> 选择 CSV 文件
          </Button>
          {fileName && <span className="truncate text-xs text-slate-500">{fileName}（{rows.length - 1} 行）</span>}
        </div>

        {fileError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600 dark:bg-red-900/20 dark:text-red-300">
            {fileError}
          </div>
        )}

        {rows.length > 1 && !result && (
          <>
            <div className="text-xs text-slate-500">列映射（自动猜测，可调整；未映射的列将被忽略）</div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {rows[0].map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 truncate rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                    {h || `第${i + 1}列`}
                  </span>
                  <span className="text-xs text-slate-400">→</span>
                  <Select
                    value={mapping[i] ?? ""}
                    disabled={run.isPending || previewRun.isPending}
                    onChange={(e) => {
                      setMapping((m) => ({ ...m, [i]: e.target.value }));
                      setPreview(null);
                      setFileError("");
                    }}
                    className="flex-1 text-xs"
                  >
                    <option value="">（忽略）</option>
                    {FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </Select>
                  <span className="w-24 shrink-0 truncate text-[11px] text-slate-400">
                    例：{rows[1]?.[i] ?? ""}
                  </span>
                </div>
              ))}
            </div>
            {!preview && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  disabled={previewRun.isPending}
                  onClick={() => previewRun.mutate()}
                >
                  {previewRun.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
                  预检 {rows.length - 1} 行
                </Button>
              </div>
            )}

            {preview && (
              <div className="space-y-3 rounded-xl border border-[var(--fyj-border)] p-3.5">
                <div className="flex flex-wrap items-center gap-3 text-[13px]">
                  <span className="font-medium">预检完成</span>
                  <span className="text-emerald-600">可导入 {preview.ready}</span>
                  <span className="text-amber-600">重复 {preview.duplicates}</span>
                  <span className={preview.invalid ? "text-red-500" : "text-[var(--fyj-tertiary)]"}>
                    无效 {preview.invalid}
                  </span>
                </div>
                {preview.items.length > 0 && (
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-[var(--fyj-surface-muted)] p-2">
                    {preview.items
                      .slice(0, 12)
                      .map((item) => (
                        <div key={item.rowNumber} className="flex items-start gap-2 text-[12px]">
                          <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", item.status === "INVALID" ? "text-red-500" : "text-amber-500")} />
                          <span className="shrink-0">第 {item.rowNumber} 行</span>
                          <span className="min-w-0 truncate text-[var(--fyj-secondary)]">
                            {item.companyName || "未填写公司"} · {item.positionTitle || "未填写岗位"}
                          </span>
                          <span className="ml-auto max-w-[60%] text-[var(--fyj-tertiary)]">{item.message}</span>
                        </div>
                      ))}
                  </div>
                )}
                {preview.duplicates > 0 && (
                  <label className="flex items-center gap-2 text-[13px] text-[var(--fyj-secondary)]">
                    <input
                      type="checkbox"
                      checked={skipDuplicates}
                      onChange={(e) => setSkipDuplicates(e.target.checked)}
                      className="size-4 accent-[var(--fyj-accent)]"
                    />
                    跳过 {preview.duplicates} 条重复记录（推荐）
                  </label>
                )}
                {preview.invalid > 0 && (
                  <div className="text-[12px] text-red-500">无效行不会被部分写入；请返回表格修正日期或列映射后重新预检。</div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPreview(null)}>重新预检</Button>
                  <Button
                    variant="primary"
                    disabled={
                      run.isPending ||
                      preview.invalid > 0 ||
                      preview.ready + (skipDuplicates ? 0 : preview.duplicates) === 0
                    }
                    onClick={() => run.mutate()}
                  >
                    {run.isPending && <Loader2 className="size-4 animate-spin" />}
                    事务导入 {preview.ready + (skipDuplicates ? 0 : preview.duplicates)} 条
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {run.isPending && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> 导入中…
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
              )}
            >
              <CheckCircle2 className="size-4" />
              成功导入 {result.imported} 条
              {result.skippedDuplicates > 0 ? `，跳过重复 ${result.skippedDuplicates} 条` : ""}
            </div>
            <div className="flex justify-end">
              <Button variant="primary" onClick={resetAndClose}>完成</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
