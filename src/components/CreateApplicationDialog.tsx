/** 新建投递弹窗：公司自动补全 + JD 快照 + 简历版本关联 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/ipc";
import type { Company } from "@shared";
import { BATCH_LABELS, CHANNEL_LABELS, PRIORITY_LABELS } from "@shared";
import { Button, Field, Modal, Select, Segmented, TextInput } from "@/components/ui";
import { DatePicker } from "@/components/DatePicker";
import { ApplicationPlanFields } from "./ApplicationPlan";

export function CreateApplicationDialog({
  open,
  onClose,
  defaultBatch,
  initialApplied = false,
  defaultCompanyName = "",
}: {
  open: boolean;
  onClose: () => void;
  defaultBatch: string;
  initialApplied?: boolean;
  defaultCompanyName?: string;
}) {
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState(defaultCompanyName);
  const [companySuggestions, setCompanySuggestions] = useState<Company[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [positionTitle, setPositionTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [channel, setChannel] = useState("COMPANY_SITE");
  const [batch, setBatch] = useState(defaultBatch);
  const [priority, setPriority] = useState("MEDIUM");
  const [jdText, setJdText] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [tags, setTags] = useState("");
  const [resumeVersionId, setResumeVersionId] = useState<string | undefined>();
  const [applied, setApplied] = useState(initialApplied);
  const [appliedAt, setAppliedAt] = useState<string | null>(() => new Date().toISOString());
  const [error, setError] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [plannedApplyAt, setPlannedApplyAt] = useState<string | null>(null);
  const [applicationDeadline, setApplicationDeadline] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setApplied(initialApplied);
      setAppliedAt(new Date().toISOString());
    }
  }, [open, initialApplied]);

  const { data: resumes } = useQuery({
    queryKey: ["resumes"],
    queryFn: api.listResumes,
    enabled: open,
  });

  // 公司输入防抖联想
  useEffect(() => {
    if (!companyName.trim() || companyName.length < 1) {
      setCompanySuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const list = await api.searchCompanies(companyName.trim(), 6);
        setCompanySuggestions(list);
        setShowSuggestions(true);
      } catch {
        /* 忽略联想失败 */
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [companyName]);

  const selectedResume = resumeVersionId ?? resumes?.find((r) => r.isDefault)?.id ?? "";

  const create = useMutation({
    mutationFn: () =>
      api.createApplication({
        companyName: companyName.trim(),
        positionTitle: positionTitle.trim(),
        department: department.trim() || null,
        workLocation: workLocation.trim() || null,
        channel,
        batch,
        priority: priority as "HIGH" | "MEDIUM" | "LOW",
        applied,
        plannedApplyAt, applicationDeadline,
        appliedDate: applied ? appliedAt : null,
        jobUrl: jobUrl.trim() || null,
        jdText: jdText.trim() || null,
        tags: tags
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
        resumeVersionId: applied ? selectedResume || null : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      reset();
      onClose();
    },
    onError: (e) => setError(String(e)),
  });

  function reset() {
    setCompanyName("");
    setPositionTitle("");
    setDepartment("");
    setWorkLocation("");
    setJdText("");
    setJobUrl("");
    setTags("");
    setError("");
    setApplied(initialApplied);
    setResumeVersionId(undefined);
    setShowMore(false);
    setPlannedApplyAt(null);
    setApplicationDeadline(null);
    setCompanySuggestions([]);
  }

  function submit() {
    setError("");
    if (!companyName.trim()) return setError("请填写公司名");
    if (!positionTitle.trim()) return setError("请填写岗位名");
    if (plannedApplyAt && applicationDeadline && new Date(plannedApplyAt) > new Date(applicationDeadline)) return setError("计划投递时间不能晚于网申截止时间");
    if (jobUrl.trim() && !/^https?:\/\//i.test(jobUrl.trim())) return setError("岗位链接请以 https:// 或 http:// 开头");
    if (applied && (!appliedAt || new Date(appliedAt).getTime() > Date.now())) return setError("请填写已完成投递的时间，不能晚于现在");
    create.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={applied ? "记录已投递" : "添加意向岗位"} wide>
      <div className="mb-4 space-y-2">
        <Segmented value={applied ? "applied" : "wishlist"} onChange={(v) => setApplied(v === "applied")}
          options={[{ value: "wishlist", label: "意向岗位" }, { value: "applied", label: "已完成投递" }]} />
        <p className="text-[13px] text-[var(--fyj-secondary)]">{applied ? "记录已完成的投递，开始跟进招聘流程。" : "先收集感兴趣的岗位，准备好后再正式投递。"}</p>
        {!applied && <button type="button" aria-expanded={showMore} onClick={() => setShowMore((value) => !value)} className="text-[13px] text-[var(--fyj-accent)]">
          {showMore ? "收起更多信息" : "补充部门、城市、渠道与优先级…"}
        </button>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="relative" ref={boxRef}>
          <Field label="公司 *">
            <TextInput
              value={companyName}
              placeholder="如：美团"
              onChange={(e) => setCompanyName(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
            />
          </Field>
          {showSuggestions && companySuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {companySuggestions.map((c) => (
                <button
                  key={c.id}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                  onClick={() => {
                    setCompanyName(c.name);
                    setShowSuggestions(false);
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="岗位 *">
          <TextInput
            value={positionTitle}
            placeholder="如：运筹优化工程师"
            onChange={(e) => setPositionTitle(e.target.value)}
          />
        </Field>
        {(applied || showMore) && <><Field label="部门/事业部">
          <TextInput
            value={department}
            placeholder="如：到家事业群"
            onChange={(e) => setDepartment(e.target.value)}
          />
        </Field>
        <Field label="Base 城市">
          <TextInput
            value={workLocation}
            placeholder="如：北京"
            onChange={(e) => setWorkLocation(e.target.value)}
          />
        </Field>
        <Field label="渠道">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="批次">
          <Select value={batch} onChange={(e) => setBatch(e.target.value)}>
            {Object.entries(BATCH_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="优先级">
          <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        </>}
        {applied && <Field
          label="简历版本"
          hint={
            resumes && resumes.length === 0
              ? "简历库为空，可先跳过（投递列表会有黄条提醒）"
              : undefined
          }
        >
          <Select value={selectedResume} onChange={(e) => setResumeVersionId(e.target.value)}>
            <option value="">（未指定）</option>
            {(resumes ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.targetRole ? ` · ${r.targetRole}` : ""}
                {r.isDefault ? "（默认）" : ""}
              </option>
            ))}
          </Select>
        </Field>}
        <div className={applied || showMore ? undefined : "col-span-2"}>
          <Field label="岗位链接">
            <TextInput value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="https://…（保存原链接，之后直接前往投递）" />
          </Field>
        </div>
        {applied && <Field label="实际投递时间"><DatePicker value={appliedAt} onChange={setAppliedAt} withTime /></Field>}
        {!applied && <details className="col-span-2 text-[13px]">
          <summary className="mb-2 cursor-pointer text-[var(--fyj-accent)]">安排投递计划和网申截止（可选）</summary>
          <ApplicationPlanFields planned={plannedApplyAt} deadline={applicationDeadline} onPlanned={setPlannedApplyAt} onDeadline={setApplicationDeadline} />
        </details>}
        <div className="col-span-2">
          <Field label="JD 快照（粘贴岗位描述，保存原文防链接过期）">
            <textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              rows={5}
              placeholder="粘贴 JD 全文…"
              className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </Field>
        </div>
        <Field label="标签（逗号分隔）">
          <TextInput
            value={tags}
            placeholder="如：想去的, 保底"
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
      </div>

      {error && <div className="mt-3 text-sm text-red-500">{error}</div>}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button variant="primary" onClick={submit} disabled={create.isPending}>
          {create.isPending && <Loader2 className="size-4 animate-spin" />}
          {applied ? "记录已投递" : "添加到意向岗位"}
        </Button>
      </div>
    </Modal>
  );
}
