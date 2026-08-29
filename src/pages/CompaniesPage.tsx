/** 公司库：投递时沉淀的公司 + 别名/官网/招聘官网维护（官网域名用于邮件解析匹配） */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ExternalLink, Loader2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { api } from "@/lib/ipc";
import type { Company } from "@shared";
import { Button, Field, Modal, Select, TextInput } from "@/components/ui";

const NATURES = ["", "互联网", "国企/央企", "外企", "民企", "银行/金融", "事业单位", "研究所", "其他"];
const INDUSTRIES = ["", "互联网/软件", "硬件/半导体", "金融", "制造", "通信", "新能源", "消费", "教育", "其他"];

export default function CompaniesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const [error, setError] = useState("");

  const { data: companies, isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: api.listCompanies,
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteCompany(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      setError("");
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <div className="px-6 py-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight">公司</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          投递时填写过的公司会自动沉淀到这里；维护「招聘官网」和「别名」可提升邮件解析的公司匹配准确度
        </p>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800/80">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <th className="px-4 py-2.5 font-medium">公司</th>
              <th className="px-4 py-2.5 font-medium">性质 / 行业</th>
              <th className="px-4 py-2.5 font-medium">招聘官网</th>
              <th className="px-4 py-2.5 font-medium">投递数</th>
              <th className="px-4 py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">加载中…</td>
              </tr>
            )}
            {!isLoading && (companies ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                  还没有公司。新建投递时填写的公司会自动出现在这里
                </td>
              </tr>
            )}
            {(companies ?? []).map((c) => (
              <tr
                key={c.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 text-white">
                      <Building2 className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium">{c.name}</div>
                      {c.aliases.length > 0 && (
                        <div className="truncate text-[11px] text-slate-400">
                          别名：{c.aliases.join("、")}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {[c.nature, c.industry].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-4 py-2.5">
                  {c.careersUrl ? (
                    <button
                      className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:underline"
                      onClick={() => openPath(c.careersUrl!).catch(() => undefined)}
                    >
                      打开 <ExternalLink className="size-3" />
                    </button>
                  ) : c.website ? (
                    <span className="text-xs text-slate-400">{c.website}</span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-slate-500">{c.applicationCount}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <button
                      onClick={() => setEditing(c)}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                      title="编辑"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`删除公司「${c.name}」？`)) del.mutate(c.id);
                      }}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                      title="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EditCompanyDialog company={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function EditCompanyDialog({
  company,
  onClose,
}: {
  company: Company | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [nature, setNature] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // 打开时同步表单
  if (company && loadedId !== company.id) {
    setLoadedId(company.id);
    setName(company.name);
    setAliases(company.aliases.join(", "));
    setNature(company.nature ?? "");
    setIndustry(company.industry ?? "");
    setWebsite(company.website ?? "");
    setCareersUrl(company.careersUrl ?? "");
    setNotes(company.notes ?? "");
    setError("");
  }

  const save = useMutation({
    mutationFn: () =>
      api.updateCompany(company!.id, {
        name: name.trim(),
        aliases: aliases.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
        industry: industry || null,
        nature: nature || null,
        website: website.trim() || null,
        careersUrl: careersUrl.trim() || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      onClose();
    },
    onError: (e) => setError(String(e)),
  });

  return (
    <Modal open={!!company} onClose={onClose} title={`编辑公司${company ? ` · ${company.name}` : ""}`}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="公司名 *">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="别名（逗号分隔，用于邮件匹配）">
          <TextInput value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="如：鹅厂, Tencent" />
        </Field>
        <Field label="性质">
          <Select value={nature} onChange={(e) => setNature(e.target.value)}>
            {NATURES.map((n) => (
              <option key={n} value={n}>{n || "（未设置）"}</option>
            ))}
          </Select>
        </Field>
        <Field label="行业">
          <Select value={industry} onChange={(e) => setIndustry(e.target.value)}>
            {INDUSTRIES.map((n) => (
              <option key={n} value={n}>{n || "（未设置）"}</option>
            ))}
          </Select>
        </Field>
        <Field label="官网域名（邮件匹配用）">
          <TextInput value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="如：meituan.com" />
        </Field>
        <Field label="招聘官网（秋招反复回访查进度）">
          <TextInput value={careersUrl} onChange={(e) => setCareersUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <div className="col-span-2">
          <Field label="备注">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="风评、业务线、薪资传闻…" />
          </Field>
        </div>
      </div>
      {error && <div className="mt-3 text-sm text-red-500">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          disabled={save.isPending || !name.trim()}
          onClick={() => {
            setError("");
            if (!name.trim()) return setError("公司名不能为空");
            save.mutate();
          }}
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" />}保存
        </Button>
      </div>
    </Modal>
  );
}
