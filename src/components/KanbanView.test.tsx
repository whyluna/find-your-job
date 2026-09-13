import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { ApplicationListItem } from "@shared";
import { KanbanView } from "./KanbanView";

vi.mock("@/lib/ipc", () => ({ api: { getSetting: vi.fn(async () => '["SAVED"]') } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("公司筛选禁用排序，但岗位卡片仍可访问和打开", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const item: ApplicationListItem = { id: "job", companyId: "company", companyName: "已筛选公司", positionTitle: "研发岗位", status: "SAVED", channel: "COMPANY_SITE", batch: "FORMAL", priority: "MEDIUM", tags: [], isArchived: false, createdAt: "", updatedAt: "", interviewCount: 0, maxInterviewRound: 0, hasScheduledInterview: false, hasOverdueInterview: false };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={["/applications"]}><QueryClientProvider client={client}><Routes>
    <Route path="/applications" element={<KanbanView items={[item]} canReorder={false} />} />
    <Route path="/applications/:id" element={<p>已打开岗位详情</p>} />
  </Routes></QueryClientProvider></MemoryRouter>);
  const card = await screen.findByRole("button", { name: /已筛选公司/ });
  expect(card.getAttribute("aria-disabled")).not.toBe("true");
  fireEvent.click(card);
  expect(await screen.findByText("已打开岗位详情")).toBeTruthy();
  client.clear();
});
