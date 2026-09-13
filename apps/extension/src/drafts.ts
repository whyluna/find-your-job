import type { ExtractResult, PageContext } from "./extract";
import type { FollowCompanyInput, FollowCompanyResult } from "../../../packages/shared/src/ipc-types";
import { newCompanyDraft, patchCompanyDraft, type CompanyPatch } from "./company-draft";

export const API = "http://127.0.0.1:37321";
export const stateKey = (windowId: number) => `fyj-draft:${windowId}`;
export type Field = "companyName" | "positionTitle" | "department" | "workLocation" | "channel" | "jobUrl" | "jdText";
export const FIELDS: Field[] = ["companyName", "positionTitle", "department", "workLocation", "channel", "jobUrl", "jdText"];
export interface Source { tabId: number; windowId: number; documentId: string; url: string; title: string }
export interface Draft {
  id: string; source: Source; clip: ExtractResult; dirty: Partial<Record<Field, boolean>>;
  ai: { status: "idle" | "running" | "done" | "failed"; id?: string; error?: string; startedAt?: number };
  submitting?: boolean;
  submitStartedAt?: number;
  duplicate?: { id: string; companyName: string; positionTitle: string };
  company?: FollowCompanyInput;
}
export interface PanelState { revision: number; initialized: boolean; draft: Draft | null; mode?: "job" | "company"; notice: string; noticeKind?: "info" | "success" | "error" }
export const emptyState = (): PanelState => ({ revision: 0, initialized: false, draft: null, notice: "点击“收录当前页面”开始" });
export type JobResult = { status: "running" | "cancelled" | "done" | "failed"; result?: Partial<ExtractResult>; error?: string };
export interface Platform {
  load(windowId: number): Promise<PanelState>;
  save(windowId: number, state: PanelState): Promise<void>;
  capture(windowId: number): Promise<{ source: Source; clip: ExtractResult; company?: Partial<FollowCompanyInput> }>;
  current(source: Source): Promise<boolean>;
  page(source: Source): Promise<PageContext>;
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

/** session storage 是唯一草稿事实源；后台重启后可恢复，但页面刷新和浏览器重启不保留。 */
export class DraftController {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly platform: Platform) {}
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async write(windowId: number, state: PanelState) {
    state.revision++;
    await this.platform.save(windowId, state);
    return state;
  }
  private cancel(id?: string) {
    if (id) void this.platform.request("DELETE", `/api/ext/extract/jobs/${id}`).catch(() => undefined);
  }
  private async clear(windowId: number, state: PanelState, notice: string, noticeKind: PanelState["noticeKind"] = "info") {
    this.cancel(state.draft?.ai.id);
    return this.write(windowId, { ...state, initialized: true, draft: null, notice, noticeKind });
  }
  async state(windowId: number): Promise<PanelState> {
    return this.lock(async () => {
      const state = await this.platform.load(windowId);
      if (state.draft && !(await this.platform.current(state.draft.source))) {
        return this.clear(windowId, state, "来源页面已刷新或跳转，草稿已清空");
      }
      if (state.draft && !state.draft.company) {
        state.draft.company = newCompanyDraft(state.draft.clip);
        return this.write(windowId, state);
      }
      if (state.draft?.submitting && Date.now() - (state.draft.submitStartedAt ?? 0) > 15000) {
        state.draft.submitting = false;
        state.notice = "上次提交未得到确认，可重试；App 会检查重复岗位";
        state.noticeKind = "error";
        return this.write(windowId, state);
      }
      return state;
    });
  }
  async invalidate(windowId: number, tabId: number) {
    return this.lock(async () => {
      const state = await this.platform.load(windowId);
      return state.draft?.source.tabId === tabId
        ? this.clear(windowId, state, "来源页面已刷新、跳转或关闭，草稿已清空") : state;
    });
  }
  async capture(windowId: number) {
    const captured = await this.platform.capture(windowId);
    return this.lock(async () => {
      if (!(await this.platform.current(captured.source))) throw new Error("页面正在刷新，请加载完成后重试");
      const state = await this.platform.load(windowId);
      this.cancel(state.draft?.ai.id);
      return this.write(windowId, { revision: state.revision, mode: state.mode, initialized: true, notice: "草稿已保存至本次页面，刷新来源页面即清空", draft: {
        id: crypto.randomUUID(), ...captured, company: newCompanyDraft(captured.clip, captured.company), dirty: {}, ai: { status: "idle" },
      } });
    });
  }
  async discard(windowId: number, draftId: string) {
    return this.lock(async () => {
      const state = await this.platform.load(windowId);
      return state.draft?.id === draftId ? this.clear(windowId, state, "草稿已清空") : state;
    });
  }
  async edit(windowId: number, draftId: string, field: Field, value: string) {
    return this.lock(async () => {
      const state = await this.platform.load(windowId);
      const draft = state.draft;
      if (!draft || draft.id !== draftId || draft.submitting) return state;
      if (!(await this.platform.current(draft.source))) return this.clear(windowId, state, "来源页面已刷新，草稿已清空");
      draft.clip[field] = value;
      draft.dirty[field] = true;
      draft.duplicate = undefined;
      state.notice = "草稿已保存 · 刷新来源页面即清空";
      state.noticeKind = "info";
      return this.write(windowId, state);
    });
  }
  async startAi(windowId: number, draftId: string) {
    let launch = false;
    const state = await this.lock(async () => {
      const state = await this.platform.load(windowId);
      if (state.mode === "company" || !state.draft || state.draft.id !== draftId || state.draft.ai.status === "running" || state.draft.submitting) return state;
      if (!(await this.platform.current(state.draft.source))) return this.clear(windowId, state, "来源页面已刷新，草稿已清空");
      state.draft.ai = { status: "running", id: crypto.randomUUID(), startedAt: Date.now() };
      launch = true;
      return this.write(windowId, state);
    });
    const draft = state.draft;
    if (!launch || !draft || draft.id !== draftId || draft.ai.status !== "running") return state;
    // 网络请求不占草稿锁：刷新事件和手动编辑可立即处理。
    void this.launch(windowId, structuredClone(draft));
    return state;
  }
  private async launch(windowId: number, draft: Draft) {
    try {
      const page = await this.platform.page(draft.source);
      const latest = await this.state(windowId);
      if (latest.draft?.id !== draft.id || latest.draft.ai.id !== draft.ai.id) return;
      const result = await this.platform.request<JobResult>("POST", "/api/ext/extract/jobs", { ...page, requestId: draft.ai.id });
      await this.applyResult(windowId, draft.id, draft.ai.id!, result);
    } catch (error) {
      await this.applyResult(windowId, draft.id, draft.ai.id!, { status: "failed", error: String(error) });
    }
  }
  async poll(windowId: number) {
    const state = await this.state(windowId);
    const draft = state.draft;
    if (!draft || draft.ai.status !== "running" || !draft.ai.id) return state;
    try {
      const result = await this.platform.request<JobResult>("GET", `/api/ext/extract/jobs/${draft.ai.id}`);
      return this.applyResult(windowId, draft.id, draft.ai.id, result);
    } catch (error) {
      // 启动与首轮轮询可能交错；短暂 404 容许启动请求抵达。
      if (Date.now() - (draft.ai.startedAt ?? 0) < 12000) return state;
      return this.applyResult(windowId, draft.id, draft.ai.id, { status: "failed", error: String(error) });
    }
  }
  private async applyResult(windowId: number, draftId: string, jobId: string, result: JobResult) {
    return this.lock(async () => {
      const state = await this.platform.load(windowId);
      const draft = state.draft;
      if (!draft || draft.id !== draftId || draft.ai.id !== jobId) { this.cancel(jobId); return state; }
      if (!(await this.platform.current(draft.source))) return this.clear(windowId, state, "来源页面已刷新，旧解析结果已丢弃");
      if (result.status === "running") return state;
      if (result.status === "done" && result.result) {
        for (const field of ["companyName", "positionTitle", "workLocation", "jdText"] as Field[]) {
          const value = result.result[field];
          if (!draft.dirty[field] && typeof value === "string" && value.trim()) draft.clip[field] = value;
        }
        draft.clip.source = "llm";
        draft.ai = { status: "done" };
        state.notice = "AI 解析完成，已保留手动修改的字段";
        state.noticeKind = "info";
      } else {
        draft.ai = { status: "failed", error: result.error ?? "任务已取消，请重新识别" };
      }
      this.cancel(jobId);
      return this.write(windowId, state);
    });
  }
  async submit(windowId: number, draftId: string, allowDuplicate: boolean) {
    const started = await this.lock(async () => {
      const state = await this.platform.load(windowId);
      if (state.mode === "company") throw new Error("当前是关注公司模式");
      const draft = state.draft;
      if (!draft || draft.id !== draftId || draft.submitting) throw new Error("草稿已更新，请重新查看");
      if (!(await this.platform.current(draft.source))) return this.clear(windowId, state, "来源页面已刷新，草稿已清空");
      if (!draft.clip.companyName.trim() || !draft.clip.positionTitle.trim()) throw new Error("请填写公司和岗位");
      draft.submitting = true;
      draft.submitStartedAt = Date.now();
      this.cancel(draft.ai.id);
      draft.ai = { status: "idle" };
      return this.write(windowId, state);
    });
    if (!started.draft) return started;
    try {
      const body = await this.platform.request<{ created: boolean; application: NonNullable<Draft["duplicate"]> }>("POST", "/api/ext/clip", { ...started.draft.clip, allowDuplicate });
      return this.lock(async () => {
        const state = await this.platform.load(windowId);
        if (state.draft?.id !== draftId) return state;
        if (body.created) return this.clear(windowId, state, "已添加到意向岗位", "success");
        state.draft.submitting = false;
        state.draft.duplicate = body.application;
        state.notice = "这个岗位已经收录过，没有重复创建";
        state.noticeKind = "info";
        return this.write(windowId, state);
      });
    } catch (error) {
      return this.lock(async () => {
        const state = await this.platform.load(windowId);
        if (state.draft?.id === draftId) { state.draft.submitting = false; state.notice = String(error); state.noticeKind = "error"; return this.write(windowId, state); }
        return state;
      });
    }
  }
  async setMode(windowId: number, mode: "job" | "company") {
    return this.lock(async () => {
      const state = await this.platform.load(windowId);
      if (state.draft?.submitting) throw new Error("正在保存，请稍后切换");
      if ((state.mode ?? "job") === mode) return state;
      if (state.draft) { this.cancel(state.draft.ai.id); state.draft.ai = { status: "idle" }; }
      state.mode = mode;
      if (state.draft && !(await this.platform.current(state.draft.source))) return this.clear(windowId, state, "来源页面已变化，草稿已清空");
      return this.write(windowId, state);
    });
  }
  async editCompany(windowId: number, draftId: string, patch: CompanyPatch) {
    return this.lock(async () => {
      const state = await this.platform.load(windowId);
      const draft = state.draft;
      if (!draft || draft.id !== draftId || draft.submitting) return state;
      if (!(await this.platform.current(draft.source))) return this.clear(windowId, state, "来源页面已变化，草稿已清空");
      draft.company = patchCompanyDraft(draft.company ?? newCompanyDraft(draft.clip), patch);
      return this.write(windowId, state);
    });
  }
  async submitCompany(windowId: number, draftId: string) {
    const started = await this.lock(async () => {
      const state = await this.platform.load(windowId);
      const draft = state.draft;
      if (state.mode !== "company" || !draft || draft.id !== draftId || draft.submitting) throw new Error("草稿已变化，请重新查看");
      if (!(await this.platform.current(draft.source))) return this.clear(windowId, state, "来源页面已变化，草稿已清空");
      draft.company ??= newCompanyDraft(draft.clip);
      if (!draft.company.companyName.trim()) throw new Error("请填写公司名称，无需填写岗位");
      draft.submitting = true; draft.submitStartedAt = Date.now();
      this.cancel(draft.ai.id); draft.ai = { status: "idle" };
      return this.write(windowId, state);
    });
    if (!started.draft) return started;
    try {
      const result = await this.platform.request<FollowCompanyResult>("POST", "/api/ext/company-watch", started.draft.company);
      return this.lock(async () => {
        const state = await this.platform.load(windowId);
        return state.draft?.id === draftId ? this.clear(windowId, state, result.created ? "已关注公司，可在 App 的公司页跟进招聘进展" : result.watch?.paused ? "该公司本届已有暂停记录，未覆盖；可在 App 恢复关注" : "该公司本届已有关注记录，未覆盖原有状态", "success") : state;
      });
    } catch (error) {
      return this.lock(async () => {
        const state = await this.platform.load(windowId);
        if (state.draft?.id === draftId) { state.draft.submitting = false; state.notice = String(error); state.noticeKind = "error"; return this.write(windowId, state); }
        return state;
      });
    }
  }
}
