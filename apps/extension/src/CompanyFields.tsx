import { useEffect, useState } from "react";
import type { Company, FollowCompanyInput } from "../../../packages/shared/src/ipc-types";
import { RECRUITMENT_SEASON_LABELS, RECRUITMENT_STATUS_LABELS } from "../../../packages/shared/src/company-watch";
import { nextCompanyCheck, type CompanyPatch } from "./company-draft";

function dateValue(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function CompanyFields({ company, disabled, onEdit, onSearch }: {
  company: FollowCompanyInput; disabled: boolean; onEdit: (patch: CompanyPatch) => void; onSearch: (query: string) => Promise<Company[]>;
}) {
  const [suggestions, setSuggestions] = useState<Company[]>([]);
  const [searchError, setSearchError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSuggestions([]); setSearchError(false);
    if (!company.companyName.trim() || company.companyId) return;
    const timer = setTimeout(() => { void onSearch(company.companyName.trim()).then(list => {
      if (!cancelled) setSuggestions(list);
    }, () => { if (!cancelled) setSearchError(true); }); }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [company.companyName, company.companyId, onSearch]);
  const interval = company.intervalDays === null ? company.nextCheckAt ? "once" : "off" : [3, 7, 14].includes(company.intervalDays) ? String(company.intervalDays) : "custom";
  return <fieldset disabled={disabled}>
    <label>公司名称 *<input value={company.companyName} onChange={e => onEdit({ companyName: e.target.value, companyId: "" })} /></label>
    {company.companyId && <small>已关联已有公司资料</small>}
    {suggestions.length > 0 && <section className="company-suggestions"><small>复用已有公司</small>{suggestions.map(c => <button key={c.id} type="button" onClick={() => onEdit({ companyName: c.name, companyId: c.id, website: company.website || c.website || "", careersUrl: company.careersUrl || c.careersUrl || "" })}>{c.name}</button>)}</section>}
    {searchError && <small>未能查询已有公司，保存时会再次检查重复。</small>}
    <label>公司官网<input value={company.website ?? ""} onChange={e => onEdit({ website: e.target.value })} placeholder="https://…" /></label>
    <label>招聘网站<input value={company.careersUrl ?? ""} onChange={e => onEdit({ careersUrl: e.target.value })} placeholder="https://…" /></label>
    <div className="row"><label>毕业届次<input type="number" min={2000} max={2200} value={company.year || ""} onChange={e => onEdit({ year: e.target.value })} /></label>
      <label>招聘季<select value={company.season} onChange={e => onEdit({ season: e.target.value })}>{Object.entries(RECRUITMENT_SEASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <label>招聘状态<select value={company.status} onChange={e => onEdit({ status: e.target.value })}>{Object.entries(RECRUITMENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>查看提醒<select value={interval} onChange={e => {
      const v = e.target.value;
      const days = v === "custom" ? 10 : Number(v);
      onEdit(v === "off" ? { intervalDays: "", nextCheckAt: "" } : v === "once" ? { intervalDays: "", nextCheckAt: company.nextCheckAt || nextCompanyCheck(7) } : { intervalDays: String(days), nextCheckAt: nextCompanyCheck(days) });
    }}><option value="7">每周</option><option value="3">每 3 天</option><option value="14">每两周</option><option value="custom">自定义天数</option><option value="once">只提醒下一次</option><option value="off">不提醒</option></select></label>
    {interval === "custom" && <label>间隔天数<input type="number" min={1} max={365} value={company.intervalDays ?? ""} onChange={e => onEdit({ intervalDays: e.target.value })} /></label>}
    {interval !== "off" && <label>下次查看<input type="date" value={dateValue(company.nextCheckAt)} onChange={e => onEdit({ nextCheckAt: e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : "" })} /></label>}
    <details><summary>目标方向与其他资料</summary>
      <label>本届校招专题 / 公告<input value={company.recruitmentUrl ?? ""} onChange={e => onEdit({ recruitmentUrl: e.target.value })} /></label>
      <label>目标方向<input value={company.targetRole ?? ""} onChange={e => onEdit({ targetRole: e.target.value })} /></label>
      <label>目标城市<input value={company.targetLocation ?? ""} onChange={e => onEdit({ targetLocation: e.target.value })} /></label>
      <label>备注<textarea value={company.notes ?? ""} onChange={e => onEdit({ notes: e.target.value })} /></label>
    </details>
  </fieldset>;
}
