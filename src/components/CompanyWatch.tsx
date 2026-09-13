import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ExternalLink, Plus, Search, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Company, CompanyWatch, CompanyWatchConfig, RecruitmentStatus } from "@shared";
import { api } from "@/lib/ipc";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { afterDays, companyWebsite, defaultWatchConfig, RECRUITMENT_SEASON_LABELS, RECRUITMENT_STATUS_LABELS, watchIsDue, watchSeasonLabel } from "@/lib/company-watch";
import { showToast } from "@/lib/toast";
import { Button, Field, Modal, Select, TextInput } from "./ui";
import { DatePicker } from "./DatePicker";
import { CreateApplicationDialog } from "./CreateApplicationDialog";

function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  return now;
}

export function OpenCompanyWebsite({ url, label = "打开招聘页" }: { url?: string | null; label?: string }) {
  const target = companyWebsite(url);
  return <Button size="sm" disabled={!target} title={!target ? "请先补充有效的网址" : target}
    onClick={() => { if (target) void openUrl(target).catch(e => showToast({ kind: "error", message: String(e) })); }}>
    <ExternalLink className="size-3.5" />{label}
  </Button>;
}

function RecruitmentBadge({ watch }: { watch: CompanyWatch }) {
  return <span className="recruitment-badge" data-recruitment-status={watch.paused ? "PAUSED" : watch.status}>
    {watch.paused ? "已暂停" : RECRUITMENT_STATUS_LABELS[watch.status]}
  </span>;
}

export function CompanyWatchDialog({ company, watch, onClose, onSaved }: {
  company?: Company | null; watch?: CompanyWatch; onClose: () => void; onSaved?: (watch: CompanyWatch) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(watch?.companyName ?? company?.name ?? "");
  const [companyId, setCompanyId] = useState(watch?.companyId ?? company?.id ?? "");
  const [website, setWebsite] = useState(company?.website ?? "");
  const [careersUrl, setCareersUrl] = useState(company?.careersUrl ?? "");
  const [config, setConfig] = useState<CompanyWatchConfig>(() => watch ? { ...watch } : defaultWatchConfig());
  const [error, setError] = useState("");
  const [reminders, setReminders] = useState(!!config.nextCheckAt || config.intervalDays !== null);
  const suggestions = useQuery({ queryKey: ["company-suggestions", name], queryFn: () => api.searchCompanies(name.trim(), 8), enabled: !companyId && !!name.trim() && !watch });
  const patch = (changes: Partial<CompanyWatchConfig>) => setConfig(c => ({ ...c, ...changes }));
  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("请填写公司名称");
      if (reminders && !config.nextCheckAt && !config.paused && config.status !== "CLOSED") throw new Error("请选择下次查看日期");
      const input = { ...config, intervalDays: reminders ? config.intervalDays : null, nextCheckAt: reminders ? config.nextCheckAt : null };
      return watch ? { watch: await api.updateCompanyWatch(watch.id, input), created: true }
        : api.followCompany({ ...input, companyId: companyId || null, companyName: name.trim(), website: website.trim() || null, careersUrl: careersUrl.trim() || null });
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ["company-watches"] });
      void queryClient.invalidateQueries({ queryKey: ["companies"] });
      void queryClient.invalidateQueries({ queryKey: ["company-watch-checks"] });
      showToast({ kind: "success", message: !result.created ? result.watch.paused ? "该公司本届已有暂停记录，可在列表恢复关注" : "该公司本届已有关注记录，原有状态未覆盖" : watch ? "关注设置已保存" : "已关注公司，不会计入投递统计" });
      onSaved?.(result.watch); onClose();
    }, onError: e => setError(String(e)),
  });
  return <Modal open onClose={onClose} title={watch ? `管理关注 · ${watch.companyName}` : "关注公司"} wide>
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Field label="公司名称 *"><TextInput value={name} disabled={!!watch} onChange={e => { setName(e.target.value); setCompanyId(""); }} placeholder="还没有具体岗位，也可以先关注公司" /></Field>
        {!companyId && suggestions.data && suggestions.data.length > 0 && <div className="native-inset mt-2 p-2">
          <div className="mb-1 text-xs text-slate-500">复用已有公司</div>
          {suggestions.data.map(c => <button key={c.id} type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--fyj-accent-soft)]" onClick={() => { setCompanyId(c.id); setName(c.name); setWebsite(c.website ?? ""); setCareersUrl(c.careersUrl ?? ""); }}>{c.name}</button>)}
        </div>}
        {companyId && !watch && <div className="mt-1 text-xs text-slate-500">将复用已有公司资料，新收录地址只补充空字段。</div>}
      </div>
      {!watch && <>
        <Field label="公司官网"><TextInput value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" /></Field>
        <Field label="招聘网站"><TextInput value={careersUrl} onChange={e => setCareersUrl(e.target.value)} placeholder="https://…" /></Field>
      </>}
      <Field label="届次（毕业年份）"><TextInput type="number" min={2000} max={2200} value={config.year} disabled={!!watch} onChange={e => patch({ year: Number(e.target.value) })} /></Field>
      <Field label="招聘季"><Select value={config.season} disabled={!!watch} onChange={e => patch({ season: e.target.value as CompanyWatchConfig["season"] })}>{Object.entries(RECRUITMENT_SEASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      {watch && <p className="col-span-2 text-xs text-slate-500">新的招聘季请另建关注记录，原有查看历史会保留。</p>}
      <Field label="招聘状态"><Select value={config.status} onChange={e => patch({ status: e.target.value as RecruitmentStatus })}>{Object.entries(RECRUITMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="本届校招专题 / 公告链接"><TextInput value={config.recruitmentUrl ?? ""} onChange={e => patch({ recruitmentUrl: e.target.value })} placeholder="可选，不覆盖公司长期招聘网站" /></Field>
      <div className="col-span-2 native-inset p-3">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={reminders} onChange={e => { setReminders(e.target.checked); if (e.target.checked) patch({ intervalDays: config.intervalDays ?? 7, nextCheckAt: config.nextCheckAt ?? afterDays(config.intervalDays ?? 7) }); }} />提醒我查看招聘动态</label>
        {reminders && <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="查看周期"><Select value={config.intervalDays === null ? "once" : [3, 7, 14].includes(config.intervalDays) ? String(config.intervalDays) : "custom"} onChange={e => {
            const days = e.target.value === "once" ? null : e.target.value === "custom" ? 10 : Number(e.target.value);
            patch({ intervalDays: days, nextCheckAt: days ? afterDays(days) : config.nextCheckAt ?? afterDays(7) });
          }}><option value="3">每 3 天</option><option value="7">每周</option><option value="14">每两周</option><option value="custom">自定义天数</option><option value="once">只提醒下一次</option></Select></Field>
          {config.intervalDays !== null && ![3, 7, 14].includes(config.intervalDays) && <Field label="间隔天数"><TextInput type="number" min={1} max={365} value={config.intervalDays} onChange={e => patch({ intervalDays: Number(e.target.value) })} /></Field>}
          <div><div className="mb-1.5 text-[12px] font-medium">下次查看日期</div><DatePicker value={config.nextCheckAt ?? null} onChange={nextCheckAt => patch({ nextCheckAt })} /></div>
        </div>}
        <p className="mt-2 text-xs text-slate-500">只提醒你主动查看，不自动抓取网站。系统通知需在设置中开启，并保持 App 运行；暂停或已结束时不提醒。</p>
      </div>
      <Field label="目标方向"><TextInput value={config.targetRole ?? ""} onChange={e => patch({ targetRole: e.target.value })} placeholder="如：软件研发、AI Infra" /></Field>
      <Field label="目标城市"><TextInput value={config.targetLocation ?? ""} onChange={e => patch({ targetLocation: e.target.value })} /></Field>
      <div className="col-span-2"><Field label="备注"><TextInput value={config.notes ?? ""} onChange={e => patch({ notes: e.target.value })} placeholder="关注原因、往年启动时间等" /></Field></div>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    <div className="mt-5 flex justify-end gap-2"><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? "保存中…" : watch ? "保存设置" : "关注公司"}</Button></div>
  </Modal>;
}

function WatchCheckDialog({ watch, historyOnly = false, onClose }: { watch: CompanyWatch; historyOnly?: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RecruitmentStatus>(watch.status);
  const [note, setNote] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const history = useQuery({ queryKey: ["company-watch-checks", watch.id], queryFn: () => api.listCompanyWatchChecks(watch.id) });
  const save = useMutation({ mutationFn: () => api.actOnCompanyWatch(watch.id, { action: "CHECK", status, note, evidenceUrl }), onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["company-watches"] });
    void queryClient.invalidateQueries({ queryKey: ["company-watch-checks", watch.id] });
    showToast({ kind: "success", message: status === "CLOSED" ? "已记录结束，本届不再提醒" : "已记录查看结果，并更新下次安排" }); onClose();
  } });
  const labels = { FOLLOWED: "开始关注", CHECK: "查看结果", SNOOZE: "延后提醒", PAUSE: "暂停关注", RESUME: "恢复关注", EDIT: "修改设置" };
  return <Modal open onClose={onClose} title={`${historyOnly ? "查看历史" : "记录查看结果"} · ${watch.companyName}`} wide>
    <div className="mb-4 flex items-center gap-3 text-sm"><span>{watchSeasonLabel(watch)}</span><RecruitmentBadge watch={watch} /><OpenCompanyWebsite url={watch.recruitmentUrl || watch.careersUrl || watch.website} /></div>
    {!historyOnly && <div className="space-y-3">
      <Field label="本次查看结果"><Select value={status} onChange={e => setStatus(e.target.value as RecruitmentStatus)}>{Object.entries(RECRUITMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="公告 / 依据链接"><TextInput value={evidenceUrl} onChange={e => setEvidenceUrl(e.target.value)} placeholder="可选，方便以后核实" /></Field>
      <Field label="本次记录"><TextInput value={note} onChange={e => setNote(e.target.value)} placeholder="如：仍为往年公告，尚未看到本届招聘" /></Field>
      {save.isError && <p role="alert" className="text-sm text-red-500">{String(save.error)}</p>}
      <div className="flex justify-end"><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>保存查看结果</Button></div>
    </div>}
    <h3 className="section-heading mt-5 text-sm font-semibold">最近查看与操作记录</h3>
    {history.isError && <p role="alert" className="text-sm text-red-500">历史加载失败：{String(history.error)}</p>}
    {history.isLoading && <p className="text-sm text-slate-500">加载中…</p>}
    <div className="striped-list max-h-64 overflow-y-auto">
      {history.data?.map(h => <div key={h.id} className="rounded p-3 text-sm">
        <div className="flex justify-between gap-3"><span className="font-medium">{labels[h.action]} · {RECRUITMENT_STATUS_LABELS[h.status]}</span><span className="text-xs text-slate-500">{fmtDateTime(h.recordedAt)}</span></div>
        {h.note && <p className="mt-1 break-words text-slate-500">{h.note}</p>}
        {h.nextCheckAt && <p className="mt-1 text-xs text-slate-500">下次查看 {fmtDate(h.nextCheckAt)}</p>}
        {h.evidenceUrl && <div className="mt-2"><OpenCompanyWebsite url={h.evidenceUrl} label="查看依据" /></div>}
      </div>)}
    </div>
  </Modal>;
}

export function CompanyWatchList({ initialFilter = "active", watchId, onFollow }: { initialFilter?: string; watchId?: string | null; onFollow: () => void }) {
  const now = useNow();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [season, setSeason] = useState("ALL");
  const [dialog, setDialog] = useState<{ type: "edit" | "check" | "history"; watch: CompanyWatch } | null>(null);
  const [jobCompany, setJobCompany] = useState<CompanyWatch | null>(null);
  const watches = useQuery({ queryKey: ["company-watches"], queryFn: api.listCompanyWatches, refetchInterval: 60000 });
  const action = useMutation({ mutationFn: ({ watch, type }: { watch: CompanyWatch; type: "SNOOZE" | "PAUSE" | "RESUME" }) => api.actOnCompanyWatch(watch.id, { action: type, days: 7 }), onSuccess: (_, { type }) => { void queryClient.invalidateQueries({ queryKey: ["company-watches"] }); void queryClient.invalidateQueries({ queryKey: ["company-watch-checks"] }); showToast({ kind: "success", message: type === "SNOOZE" ? "已延后 7 天，不会记为已查看" : type === "PAUSE" ? "已暂停关注，资料和历史保留" : "已恢复关注" }); }, onError: e => showToast({ kind: "error", message: String(e) }) });
  const remove = useMutation({
    mutationFn: api.deleteCompanyWatch,
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ["company-watches"] });
      void queryClient.invalidateQueries({ queryKey: ["company-watch-checks", id] });
      showToast({ kind: "success", message: "已删除本届关注，公司资料和已有岗位保留" });
    },
    onError: e => showToast({ kind: "error", message: String(e) }),
  });
  const items = (watches.data ?? []).filter(w => {
    const text = `${w.companyName} ${w.targetRole ?? ""} ${w.targetLocation ?? ""} ${w.notes ?? ""}`.toLocaleLowerCase();
    return (!watchId || w.id === watchId) && text.includes(search.trim().toLocaleLowerCase()) && (season === "ALL" || `${w.year}-${w.season}` === season)
      && (filter === "paused" ? w.paused : !w.paused && (filter === "due" ? watchIsDue(w, now) : filter === "active" || w.status === filter));
  });
  const seasons = [...new Map((watches.data ?? []).map(w => [`${w.year}-${w.season}`, watchSeasonLabel(w)])).entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return <>
    {watchId && <div className="native-inset mt-4 flex justify-between px-3 py-2 text-sm"><span>仅查看所选招聘关注</span><Link to="/companies" className="text-[var(--fyj-accent)]">查看全部</Link></div>}
    <div className="mt-4 flex flex-wrap gap-2">
      <div className="relative w-64"><Search className="absolute left-2.5 top-2 size-3.5 text-slate-400" /><TextInput data-global-search className="pl-8" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索公司 / 目标方向 / 备注…" /></div>
      <Select className="w-36" aria-label="关注范围" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">所有关注</option><option value="due">待查看</option>{Object.entries(RECRUITMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}<option value="paused">已暂停</option></Select>
      <Select className="w-44" aria-label="招聘季筛选" value={season} onChange={e => setSeason(e.target.value)}><option value="ALL">所有招聘季</option>{seasons.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
    </div>
    {watches.isError && <p role="alert" className="mt-4 text-red-500">加载失败：{String(watches.error)}</p>}
    {watches.isLoading && <p className="py-10 text-center text-slate-500">加载中…</p>}
    {!watches.isLoading && !watches.isError && !items.length && <div className="mt-4 rounded-xl border border-dashed border-[var(--fyj-border)] px-6 py-12 text-center">
      <Building2 className="mx-auto size-8 text-slate-400" /><p className="mt-3 text-sm">{watches.data?.length ? "没有符合条件的关注记录" : "还没有具体岗位？先把感兴趣的公司收好"}</p><div className="mt-4"><Button onClick={onFollow}><Plus className="size-4" />关注公司</Button></div>
    </div>}
    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
      {items.map(w => <section key={w.id} className="company-watch-card content-panel p-4" data-recruitment-status={w.paused ? "PAUSED" : w.status}>
        <div className="flex items-start justify-between gap-3"><button className="min-w-0 text-left" onClick={() => setDialog({ type: "history", watch: w })}><span className="line-clamp-2 break-words text-[15px] font-semibold">{w.companyName}</span><span className="mt-1 block text-xs text-slate-500">{watchSeasonLabel(w)}</span></button><RecruitmentBadge watch={w} /></div>
        {(w.targetRole || w.targetLocation) && <p className="mt-3 truncate text-sm text-slate-500" title={[w.targetRole, w.targetLocation].filter(Boolean).join(" · ")}>{[w.targetRole, w.targetLocation].filter(Boolean).join(" · ")}</p>}
        {w.notes && <p className="mt-2 line-clamp-2 break-words text-sm text-slate-500">{w.notes}</p>}
        <div className="native-inset mt-3 flex flex-wrap justify-between gap-2 px-3 py-2 text-xs"><span>上次查看 {w.lastCheckedAt ? fmtDate(w.lastCheckedAt) : "尚未记录"}</span><span className={watchIsDue(w, now) ? "font-medium text-amber-700 dark:text-amber-300" : "text-slate-500"}>{w.paused ? "已暂停提醒" : w.status === "CLOSED" ? "本届已结束" : w.nextCheckAt ? `${watchIsDue(w, now) ? "待查看" : "下次查看"} ${fmtDate(w.nextCheckAt)}` : "未设置提醒"}</span></div>
        <div className="mt-3 flex flex-wrap gap-2"><OpenCompanyWebsite url={w.recruitmentUrl || w.careersUrl || w.website} /><Button size="sm" disabled={w.paused} onClick={() => setDialog({ type: "check", watch: w })}>记录结果</Button><Button size="sm" variant="ghost" onClick={() => setDialog({ type: "edit", watch: w })}><Settings2 className="size-3.5" />设置</Button></div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
          {!w.paused && w.status !== "CLOSED" && <button disabled={action.isPending} className="hover:text-[var(--fyj-accent)]" onClick={() => action.mutate({ watch: w, type: "SNOOZE" })}>7 天后再看</button>}
          <button disabled={action.isPending} className="hover:text-[var(--fyj-accent)]" onClick={() => action.mutate({ watch: w, type: w.paused ? "RESUME" : "PAUSE" })}>{w.paused ? "恢复关注" : "暂停关注"}</button>
          <button className="hover:text-[var(--fyj-accent)]" onClick={() => setJobCompany(w)}>添加意向岗位</button>
          {!!w.applicationCount && <button className="hover:text-[var(--fyj-accent)]" onClick={() => navigate(`/applications?company=${encodeURIComponent(w.companyId)}`)}>查看关联岗位（{w.applicationCount}）</button>}
          <button
            disabled={remove.isPending || action.isPending}
            className="text-red-500 disabled:opacity-40"
            onClick={() => {
              if (confirm(`删除「${w.companyName} · ${watchSeasonLabel(w)}」的关注？\n\n将删除本届关注及查看历史，不能撤销。公司资料、其他招聘季和已有岗位均保留。`)) remove.mutate(w.id);
            }}
          >删除关注</button>
        </div>
      </section>)}
    </div>
    {dialog?.type === "edit" && <CompanyWatchDialog watch={dialog.watch} onClose={() => setDialog(null)} />}
    {dialog && dialog.type !== "edit" && <WatchCheckDialog watch={dialog.watch} historyOnly={dialog.type === "history"} onClose={() => setDialog(null)} />}
    {jobCompany && <CreateApplicationDialog key={jobCompany.id} open defaultBatch={jobCompany.season === "SPRING" ? "SPRING" : "FORMAL"} defaultCompanyName={jobCompany.companyName} onClose={() => setJobCompany(null)} />}
  </>;
}

export function CompanyWatchDue() {
  const now = useNow();
  const watches = useQuery({ queryKey: ["company-watches"], queryFn: api.listCompanyWatches, refetchInterval: 60000 });
  const due = (watches.data ?? []).filter(w => watchIsDue(w, now));
  if (!due.length && !watches.isError) return null;
  return <section className="content-panel mt-4 max-w-5xl p-4">
    <h2 className="section-heading flex items-center gap-2 text-sm font-semibold"><Building2 className="size-4 text-[var(--fyj-accent)]" />待查看公司<Link className="ml-auto text-[13px] font-normal text-[var(--fyj-accent)]" to="/companies?view=due">查看全部 →</Link></h2>
    {watches.isError ? <p className="text-sm text-red-500">公司关注暂时无法加载</p> : <div className="striped-list">{due.slice(0, 5).map(w => <Link key={w.id} to="/companies?view=due" className="flex items-center justify-between gap-3 rounded p-2.5 text-sm hover:bg-[var(--fyj-accent-soft)]"><span className="min-w-0 truncate font-medium">{w.companyName}<span className="ml-2 font-normal text-slate-500">{watchSeasonLabel(w)}</span></span><span className="shrink-0 text-xs text-slate-500">应于 {fmtDate(w.nextCheckAt)} 查看</span></Link>)}</div>}
  </section>;
}
