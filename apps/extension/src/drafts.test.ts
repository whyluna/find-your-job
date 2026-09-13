import { describe, expect, it, vi } from "vitest";
import { DraftController, emptyState, type JobResult, type PanelState, type Platform, type Source } from "./drafts";

function setup() {
  const states = new Map<number, PanelState>();
  let source: Source = { tabId: 7, windowId: 1, documentId: "doc-A", url: "https://example.com/jobs/A", title: "岗位 A" };
  const request = vi.fn<Platform["request"]>().mockImplementation(async (method) => (method === "DELETE" ? undefined : { status: "running" }) as never);
  const platform: Platform = {
    load: async (id) => structuredClone(states.get(id) ?? emptyState()),
    save: async (id, state) => { states.set(id, structuredClone(state)); },
    capture: async () => ({ source: structuredClone(source), clip: { companyName: "启发式公司", positionTitle: "岗位", channel: "OTHER", source: "heuristic", jobUrl: source.url } }),
    current: async (original) => original.documentId === source.documentId && original.url === source.url,
    page: async () => ({ title: source.title, url: source.url, text: "页面正文" }),
    request,
  };
  return { controller: new DraftController(platform), platform, states, request, navigate: (patch: Partial<Source>) => { source = { ...source, ...patch }; } };
}

describe("页面生命周期草稿", () => {
  it("关闭侧边栏或后台重启后恢复草稿，不重新覆盖手动内容", async () => {
    const { controller, platform } = setup();
    const captured = await controller.capture(1);
    await controller.edit(1, captured.draft!.id, "companyName", "手动填写");
    const reopened = new DraftController(platform);
    expect((await reopened.state(1)).draft?.clip.companyName).toBe("手动填写");
  });
  it("同网址刷新也清理，旧编辑消息不能重新创建草稿", async () => {
    const { controller, navigate } = setup();
    const { draft } = await controller.capture(1);
    navigate({ documentId: "doc-B" });
    expect((await controller.state(1)).draft).toBeNull();
    expect((await controller.edit(1, draft!.id, "companyName", "旧输入")).draft).toBeNull();
  });
  it("来源标签关闭清空，其他标签刷新保留；会话结束后不恢复", async () => {
    const { controller, states, platform } = setup();
    await controller.capture(1);
    expect((await controller.invalidate(1, 8)).draft).not.toBeNull();
    expect((await controller.invalidate(1, 7)).draft).toBeNull();
    await controller.capture(1);
    states.clear(); // chrome.storage.session 在浏览器重启时清空。
    expect((await new DraftController(platform).state(1)).draft).toBeNull();
  });
  it("SPA 地址变化也失效，显式收录新页面后不串旧结果", async () => {
    const { controller, navigate } = setup();
    const a = await controller.capture(1);
    navigate({ url: "https://example.com/jobs/B" });
    expect((await controller.state(1)).draft).toBeNull();
    const b = await controller.capture(1);
    await controller.edit(1, a.draft!.id, "companyName", "旧岗位");
    expect((await controller.state(1)).draft?.id).toBe(b.draft!.id);
  });
});

describe("AI 任务与编辑竞争", () => {
  it("关闭后重新打开可读完成结果，AI 不覆盖解析前或解析中的手动修改", async () => {
    const { controller, platform, request } = setup();
    const { draft } = await controller.capture(1);
    await controller.edit(1, draft!.id, "companyName", "用户公司");
    await controller.startAi(1, draft!.id);
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("POST", "/api/ext/extract/jobs", expect.anything()));
    await controller.edit(1, draft!.id, "workLocation", "");
    request.mockImplementation(async (method) => (method === "GET" ? { status: "done", result: { companyName: "AI公司", positionTitle: "AI岗位", workLocation: "北京", jdText: "AI岗位要求" } } : undefined) as never);
    const state = await new DraftController(platform).poll(1);
    expect(state.draft?.clip).toMatchObject({ companyName: "用户公司", positionTitle: "AI岗位", workLocation: "", jdText: "AI岗位要求" });
  });
  it("刷新后迟到的启动响应和解析结果都会被丢弃并取消", async () => {
    const { controller, request, navigate } = setup();
    let finish!: (value: JobResult) => void;
    request.mockImplementation(async (method) => (method === "POST" ? new Promise<JobResult>((resolve) => { finish = resolve; }) : undefined) as never);
    const { draft } = await controller.capture(1);
    const running = await controller.startAi(1, draft!.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    navigate({ documentId: "reloaded" });
    await controller.invalidate(1, 7);
    finish({ status: "done", result: { companyName: "不应出现" } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("DELETE", `/api/ext/extract/jobs/${running.draft!.ai.id}`));
    expect((await controller.state(1)).draft).toBeNull();
  });
  it("重复点击 AI 不重复启动任务，失败保留草稿并允许重试", async () => {
    const { controller, request } = setup();
    const { draft } = await controller.capture(1);
    await controller.startAi(1, draft!.id);
    await controller.startAi(1, draft!.id);
    await vi.waitFor(() => expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1));
    request.mockImplementation(async (method) => (method === "GET" ? { status: "failed", error: "服务不可用" } : undefined) as never);
    const state = await controller.poll(1);
    expect(state.draft?.ai.status).toBe("failed");
    expect(state.draft?.clip.companyName).toBe("启发式公司");
  });
  it("成功收录清空草稿；失败时保留输入", async () => {
    const { controller, request } = setup();
    const { draft } = await controller.capture(1);
    request.mockRejectedValue(new Error("未连接"));
    expect((await controller.submit(1, draft!.id, false)).draft?.submitting).toBe(false);
    request.mockResolvedValue({ created: true, application: { id: "app" } });
    expect((await controller.submit(1, draft!.id, false)).draft).toBeNull();
  });
});

describe("公司关注与岗位草稿隔离", () => {
  it("无需岗位名称即可关注公司，且不会调用岗位收录接口", async () => {
    const { controller, request } = setup();
    const { draft } = await controller.capture(1);
    await controller.edit(1, draft!.id, "positionTitle", "");
    await controller.setMode(1, "company");
    await controller.editCompany(1, draft!.id, { companyName: "准备关注的公司", status: "NOT_OPEN" });
    request.mockResolvedValue({ created: true, watch: { id: "watch" } });
    expect((await controller.submitCompany(1, draft!.id)).draft).toBeNull();
    expect(request).toHaveBeenCalledWith("POST", "/api/ext/company-watch", expect.objectContaining({ companyName: "准备关注的公司", status: "NOT_OPEN" }));
    expect(request.mock.calls.some(([, path]) => path === "/api/ext/clip")).toBe(false);
  });
  it("切换模式、关闭重开都保留各自编辑内容，刷新后两套草稿一起清空", async () => {
    const { controller, platform, navigate } = setup();
    const { draft } = await controller.capture(1);
    await controller.edit(1, draft!.id, "companyName", "岗位公司");
    await controller.setMode(1, "company");
    await controller.editCompany(1, draft!.id, { companyName: "关注公司", notes: "等正式秋招" });
    await controller.setMode(1, "job");
    const reopened = await new DraftController(platform).state(1);
    expect(reopened.draft?.clip.companyName).toBe("岗位公司");
    expect(reopened.draft?.company?.companyName).toBe("关注公司");
    navigate({ documentId: "new-document" });
    expect((await controller.state(1)).draft).toBeNull();
    expect((await controller.editCompany(1, draft!.id, { notes: "旧编辑" })).draft).toBeNull();
  });
  it("重复关注不覆盖已有记录；失败保留公司表单，改名称会清除旧关联", async () => {
    const { controller, request } = setup();
    const { draft } = await controller.capture(1);
    await controller.setMode(1, "company");
    await controller.editCompany(1, draft!.id, { companyName: "旧公司", companyId: "old-id" });
    expect((await controller.editCompany(1, draft!.id, { companyName: "新公司" })).draft?.company?.companyId).toBeNull();
    request.mockRejectedValue(new Error("未连接 App"));
    expect((await controller.submitCompany(1, draft!.id)).draft?.company?.companyName).toBe("新公司");
    request.mockResolvedValue({ created: false, watch: { id: "existing" } });
    const done = await controller.submitCompany(1, draft!.id);
    expect(done.draft).toBeNull();
    expect(done.notice).toContain("未覆盖");
  });
  it("公司模式不会运行岗位 AI，来源刷新后迟到的保存响应不会复活草稿", async () => {
    const { controller, request, navigate } = setup();
    const { draft } = await controller.capture(1);
    await controller.setMode(1, "company");
    await controller.startAi(1, draft!.id);
    expect(request).not.toHaveBeenCalled();
    let finish!: (value: unknown) => void;
    request.mockImplementation(async () => await new Promise(resolve => { finish = resolve; }) as never);
    const pending = controller.submitCompany(1, draft!.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    navigate({ documentId: "reloaded" });
    await controller.invalidate(1, 7);
    finish({ created: true, watch: { id: "watch" } });
    expect((await pending).draft).toBeNull();
  });
});
