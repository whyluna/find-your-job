import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CompanyWatch } from "@shared";
import { api } from "@/lib/ipc";
import { defaultWatchConfig, watchSeasonLabel } from "@/lib/company-watch";
import { CompanyWatchDialog, CompanyWatchList } from "./CompanyWatch";

vi.mock("@/lib/ipc", () => ({ api: { searchCompanies: vi.fn(), followCompany: vi.fn(), listCompanyWatches: vi.fn(), actOnCompanyWatch: vi.fn(), updateCompanyWatch: vi.fn(), listCompanyWatchChecks: vi.fn(), deleteCompanyWatch: vi.fn(), deleteCompany: vi.fn(), listResumes: vi.fn(), createApplication: vi.fn() } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const w: CompanyWatch = { ...defaultWatchConfig(), id: "watch", companyId: "company", companyName: "示例公司", careersUrl: "https://example.com/careers", applicationCount: 0, createdAt: "", updatedAt: "", nextCheckAt: new Date(Date.now() - 86400000).toISOString() };
const clients: QueryClient[] = [];
function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return render(<MemoryRouter><QueryClientProvider client={client}>{ui}</QueryClientProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.searchCompanies).mockResolvedValue([]);
  vi.mocked(api.followCompany).mockResolvedValue({ watch: w, created: true });
  vi.mocked(api.listCompanyWatches).mockResolvedValue([w]);
  vi.mocked(api.actOnCompanyWatch).mockResolvedValue(w);
  vi.mocked(api.listCompanyWatchChecks).mockResolvedValue([]);
  vi.mocked(api.listResumes).mockResolvedValue([]);
  vi.mocked(openUrl).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.restoreAllMocks(); });

it("没有岗位也能关注公司，关闭提醒会明确提交空安排", async () => {
  const close = vi.fn();
  mount(<CompanyWatchDialog onClose={close} />);
  fireEvent.change(screen.getByRole("textbox", { name: "公司名称 *" }), { target: { value: "示例公司" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "提醒我查看招聘动态" }));
  fireEvent.click(screen.getByRole("button", { name: "关注公司" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.followCompany).toHaveBeenCalledWith(expect.objectContaining({ companyName: "示例公司", intervalDays: null, nextCheckAt: null, status: "UNKNOWN" }));
  expect(api.createApplication).not.toHaveBeenCalled();
});
it("打开招聘网站不标记已查看，也不创建投递", async () => {
  mount(<CompanyWatchList onFollow={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "打开招聘页" }));
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(w.careersUrl);
  expect(api.actOnCompanyWatch).not.toHaveBeenCalled();
  expect(api.createApplication).not.toHaveBeenCalled();
});
it("记录结果和延后提醒使用不同动作", async () => {
  mount(<CompanyWatchList onFollow={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "7 天后再看" }));
  await waitFor(() => expect(api.actOnCompanyWatch).toHaveBeenCalledWith(w.id, { action: "SNOOZE", days: 7 }));
  fireEvent.click(screen.getByRole("button", { name: "记录结果" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "本次查看结果" }), { target: { value: "NOT_OPEN" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存查看结果" }));
  await waitFor(() => expect(api.actOnCompanyWatch).toHaveBeenCalledWith(w.id, expect.objectContaining({ action: "CHECK", status: "NOT_OPEN" })));
});
it("关注公司可预填到意向岗位表单，但不会自动保存岗位", async () => {
  mount(<CompanyWatchList onFollow={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "添加意向岗位" }));
  expect((screen.getByRole("textbox", { name: "公司 *" }) as HTMLInputElement).value).toBe(w.companyName);
  expect(api.createApplication).not.toHaveBeenCalled();
});

it.each(["UNKNOWN", "NOT_OPEN", "OPEN", "CLOSED"] as const)("%s 状态无需先暂停就能看到删除关注", async status => {
  vi.mocked(api.listCompanyWatches).mockResolvedValue([{ ...w, status }]);
  mount(<CompanyWatchList onFollow={() => {}} />);
  expect(await screen.findByRole("button", { name: "删除关注" })).toBeTruthy();
  expect(api.actOnCompanyWatch).not.toHaveBeenCalled();
});

it("已暂停的关注同样直接提供删除入口", async () => {
  vi.mocked(api.listCompanyWatches).mockResolvedValue([{ ...w, paused: true }]);
  mount(<CompanyWatchList initialFilter="paused" onFollow={() => {}} />);
  expect(await screen.findByRole("button", { name: "删除关注" })).toBeTruthy();
});

it("取消删除不发出写入请求，确认文字说明具体招聘季与保留范围", async () => {
  const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
  mount(<CompanyWatchList onFollow={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "删除关注" }));
  expect(confirmation).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`${w.companyName} · ${watchSeasonLabel(w)}`));
  expect(confirmation.mock.calls[0][0]).toContain("公司资料、其他招聘季和已有岗位均保留");
  expect(api.deleteCompanyWatch).not.toHaveBeenCalled();
  expect(api.deleteCompany).not.toHaveBeenCalled();
});

it("确认后只删除所选关注，刷新卡片并保留其他招聘季", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const other = { ...w, id: "other-watch", year: w.year + 1 };
  let records = [w, other];
  vi.mocked(api.listCompanyWatches).mockImplementation(async () => records);
  vi.mocked(api.deleteCompanyWatch).mockImplementation(async id => { records = records.filter(record => record.id !== id); });
  mount(<CompanyWatchList onFollow={() => {}} />);
  const name = new RegExp(`^${w.companyName}\\s*${watchSeasonLabel(w)}$`);
  const card = (await screen.findByRole("button", { name })).closest("section")!;
  fireEvent.click(within(card).getByRole("button", { name: "删除关注" }));
  await waitFor(() => expect(screen.queryByRole("button", { name })).toBeNull());
  expect(api.deleteCompanyWatch).toHaveBeenCalledOnce();
  expect(vi.mocked(api.deleteCompanyWatch).mock.calls[0][0]).toBe(w.id);
  expect(screen.getByRole("button", { name: new RegExp(`^${other.companyName}\\s*${watchSeasonLabel(other)}$`) })).toBeTruthy();
  expect(api.deleteCompany).not.toHaveBeenCalled();
  expect(api.actOnCompanyWatch).not.toHaveBeenCalled();
});

it("删除失败保留卡片并允许重试", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(api.deleteCompanyWatch).mockRejectedValue(new Error("写入失败"));
  mount(<CompanyWatchList onFollow={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "删除关注" }));
  await waitFor(() => expect(api.deleteCompanyWatch).toHaveBeenCalledOnce());
  await waitFor(() => expect((screen.getByRole("button", { name: "删除关注" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole("button", { name: new RegExp(`^${w.companyName}\\s*${watchSeasonLabel(w)}$`) })).toBeTruthy();
});
