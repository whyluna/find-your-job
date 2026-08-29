/** CSV 导入向导（飞书/Excel 迁移）：选文件 → 列映射（自动猜测）→ 逐行导入 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/ipc";
import { Button, Modal, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

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
    } else if (c === "," || c === "，") {
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
  return rows;
}

const FIELDS = [
  { key: "companyName", label: "公司 *" },
  { key: "positionTitle", label: "岗位 *" },
  { key: "department", label: "部门" },
  { key: "workLocation", label: "Base 城市" },
  { key: "appliedDate", label: "投递日期" },
  { key: "channel", label: "渠道（值需为内置英文键，否则记为其他）" },
  { key: "batch", label: "批次（同上）" },
  { key: "jobUrl", label: "岗位链接" },
  { key: "jdText", label: "JD 文本" },
  { key: "notes", label: "备注" },
] as const;

function guessField(header: string): string {
  const h = header.toLowerCase();
  if (h.includes("公司") || h.includes("企业")) return "companyName";
  if (h.includes("岗位") || h.includes("职位")) return "positionTitle";
  if (h.includes("部门") || h.includes("事业")) return "department";
  if (h.includes("base") || h.includes("城市") || h.includes("地点")) return "workLocation";
  if (h.includes("投递") || h.includes("申请")) return "appliedDate";
  if (h.includes("渠道") || h.includes("来源")) return "channel";
  if (h.includes("批次") || h.includes("批")) return "batch";
  if (h.includes("链接") || h.includes("url")) return "jobUrl";
  if (h.includes("jd") || h.includes("描述")) return "jdText";
  if (h.includes("备注") || h.includes("note")) return "notes";
  return "";
}

function parseDate(s: string): string | null {
  if (!s) return null;
  const d = new Date(s.replace(/\//g, "-"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function CsvImportWizard({ open: isOpen, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{ ok: number; fail: number; errors: string[] } | null>(null);
  const [fileName, setFileName] = useState("");

  const pick = async () => {
    setResult(null);
    const path = await open({
      multiple: false,
      filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
    });
    if (!path) return;
    const text = await api.readTextFile(path);
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setResult({ ok: 0, fail: 0, errors: ["文件里没有数据行"] });
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

  const run = useMutation({
    mutationFn: async () => {
      const dataRows = rows.slice(1);
      let ok = 0;
      let fail = 0;
      const errors: string[] = [];
      for (const r of dataRows) {
        const get = (field: string) => {
          const idx = Object.entries(mapping).find(([, f]) => f === field)?.[0];
          return idx !== undefined ? (r[+idx] ?? "") : "";
        };
        const companyName = get("companyName");
        const positionTitle = get("positionTitle");
        if (!companyName || !positionTitle) {
          fail++;
          if (errors.length < 3) errors.push(`缺少公司或岗位：${r.slice(0, 3).join(" | ")}`);
          continue;
        }
        const appliedDate = parseDate(get("appliedDate"));
        try {
          await api.createApplication({
            companyName,
            positionTitle,
            department: get("department") || null,
            workLocation: get("workLocation") || null,
            channel: get("channel") || undefined,
            batch: get("batch") || undefined,
            applied: !!appliedDate,
            appliedDate,
            jobUrl: get("jobUrl") || null,
            jdText: get("jdText") || null,
          });
          ok++;
        } catch (e) {
          fail++;
          if (errors.length < 3) errors.push(`${companyName}: ${String(e)}`);
        }
      }
      return { ok, fail, errors };
    },
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["db-ready"] });
    },
  });

  return (
    <Modal open={isOpen} onClose={onClose} title="从 CSV 导入（飞书/Excel）" wide>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button onClick={pick} disabled={run.isPending}>
            <Upload className="size-4" /> 选择 CSV 文件
          </Button>
          {fileName && <span className="truncate text-xs text-slate-500">{fileName}（{rows.length - 1} 行）</span>}
        </div>

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
                    onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value }))}
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
            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={run.isPending}
                onClick={() => run.mutate()}
              >
                {run.isPending && <Loader2 className="size-4 animate-spin" />}
                导入 {rows.length - 1} 行
              </Button>
            </div>
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
                result.fail === 0
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
              )}
            >
              <CheckCircle2 className="size-4" />
              成功导入 {result.ok} 条{result.fail > 0 ? `，失败 ${result.fail} 条` : ""}
            </div>
            {result.errors.map((e, i) => (
              <div key={i} className="text-xs text-red-500">{e}</div>
            ))}
            <div className="flex justify-end">
              <Button variant="primary" onClick={onClose}>完成</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
