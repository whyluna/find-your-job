import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Application } from "@shared";
import { api } from "@/lib/ipc";
import { CreateApplicationDialog } from "./CreateApplicationDialog";
import { ConfirmApplicationDialog } from "./ConfirmApplicationDialog";

vi.mock("@/lib/ipc", () => ({ api: {
  listResumes: vi.fn(), searchCompanies: vi.fn(), createApplication: vi.fn(), confirmApplication: vi.fn(),
} }));

const resume = { id: "default-resume", name: "默认简历", isDefault: true, fileName: "resume.pdf", filePath: "resume.pdf", usageCount: 0, createdAt: "", updatedAt: "" };
const app: Application = {
  id: "wishlist", companyId: "company", companyName: "测试公司", positionTitle: "工程师",
  channel: "COMPANY_SITE", batch: "FORMAL", priority: "MEDIUM", status: "SAVED", tags: [],
  isArchived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const clients: QueryClient[] = [];
function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listResumes).mockResolvedValue([resume]);
  vi.mocked(api.searchCompanies).mockResolvedValue([]);
  vi.mocked(api.createApplication).mockResolvedValue(app);
  vi.mocked(api.confirmApplication).mockResolvedValue({ ...app, status: "APPLIED" });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

it("默认收藏保留链接，且不会提前登记投递或绑定默认简历", async () => {
  const close = vi.fn();
  mount(<CreateApplicationDialog open onClose={close} defaultBatch="FORMAL" />);
  fireEvent.change(screen.getByRole("textbox", { name: "公司 *" }), { target: { value: "测试公司" } });
  fireEvent.change(screen.getByRole("textbox", { name: "岗位 *" }), { target: { value: "工程师" } });
  fireEvent.change(screen.getByRole("textbox", { name: /^岗位链接/ }), { target: { value: "https://example.com/jobs/42" } });
  fireEvent.click(screen.getByRole("button", { name: "添加到意向岗位" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.createApplication).toHaveBeenCalledWith(expect.objectContaining({
    applied: false, appliedDate: null, resumeVersionId: null, jobUrl: "https://example.com/jobs/42",
  }));
});

it("确认允许明确不选简历，且只向原岗位写入一次确认", async () => {
  const close = vi.fn();
  mount(<ConfirmApplicationDialog application={app} onClose={close} />);
  await screen.findByRole("option", { name: "默认简历（默认）" });
  fireEvent.change(screen.getByRole("combobox", { name: /^实际使用的简历/ }), { target: { value: "" } });
  fireEvent.change(screen.getByRole("combobox", { name: "投递渠道" }), { target: { value: "REFERRAL" } });
  fireEvent.click(screen.getByRole("button", { name: "确认已投递" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.confirmApplication).toHaveBeenCalledExactlyOnceWith("wishlist", expect.objectContaining({
    channel: "REFERRAL", resumeVersionId: null, appliedAt: expect.any(String),
  }));
});

it("取消确认没有写入；失败保留表单供重试", async () => {
  const close = vi.fn();
  const view = mount(<ConfirmApplicationDialog application={app} onClose={close} />);
  await screen.findByRole("option", { name: "默认简历（默认）" });
  fireEvent.click(screen.getByRole("button", { name: "暂不记录" }));
  expect(close).toHaveBeenCalledOnce();
  expect(api.confirmApplication).not.toHaveBeenCalled();
  view.unmount();
  close.mockClear();
  vi.mocked(api.confirmApplication).mockRejectedValue(new Error("写入失败"));
  mount(<ConfirmApplicationDialog application={app} onClose={close} />);
  await screen.findByRole("option", { name: "默认简历（默认）" });
  fireEvent.click(screen.getByRole("button", { name: "确认已投递" }));
  expect((await screen.findByRole("alert")).textContent).toContain("写入失败");
  expect(close).not.toHaveBeenCalled();
});
