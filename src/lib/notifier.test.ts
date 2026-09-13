import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompanyWatch } from "@shared";
import { api } from "./ipc";
import { refreshNotifierSchedule, setNotificationsEnabled, startNotifier } from "./notifier";
import { sendNotification } from "@tauri-apps/plugin-notification";

vi.mock("./ipc", () => ({ api: { getSetting: vi.fn(), setSetting: vi.fn(), getUpcoming: vi.fn(), listCompanyWatches: vi.fn() } }));
vi.mock("@tauri-apps/plugin-notification", () => ({ isPermissionGranted: vi.fn(async () => true), requestPermission: vi.fn(), sendNotification: vi.fn(async () => undefined) }));
let watches: CompanyWatch[];
const make = (id: string): CompanyWatch => ({ id, companyId: id, companyName: `示例公司${id}`, year: 2027, season: "AUTUMN", status: "NOT_OPEN", intervalDays: 7, nextCheckAt: "2026-09-12T00:00:00Z", paused: false, applicationCount: 0, createdAt: "", updatedAt: "" });
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T01:00:00Z")); vi.clearAllMocks();
  watches = [make("a"), make("b"), { ...make("paused"), paused: true }, { ...make("closed"), status: "CLOSED" }];
  vi.mocked(api.getSetting).mockImplementation(async key => key === "notifications_enabled" ? "true" : null);
  vi.mocked(api.getUpcoming).mockResolvedValue([]);
  vi.mocked(api.listCompanyWatches).mockImplementation(async () => watches);
});
afterEach(async () => { await setNotificationsEnabled(false); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("公司待查看合并成一条通知，同一到期不重发，新到期每天至多合并一次", async () => {
  await startNotifier();
  expect(sendNotification).toHaveBeenCalledOnce();
  expect(sendNotification).toHaveBeenLastCalledWith(expect.objectContaining({ title: "2 项公司招聘动态待查看" }));
  await vi.advanceTimersByTimeAsync(5 * 60000);
  expect(sendNotification).toHaveBeenCalledOnce();
  watches.push(make("new-today"));
  await refreshNotifierSchedule();
  expect(sendNotification).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date("2026-09-14T01:00:00Z"));
  await refreshNotifierSchedule();
  expect(sendNotification).toHaveBeenCalledTimes(2);
  expect(sendNotification).toHaveBeenLastCalledWith(expect.objectContaining({ title: "1 项公司招聘动态待查看" }));
  await refreshNotifierSchedule();
  expect(sendNotification).toHaveBeenCalledTimes(2);
});

it("暂时读取失败不会丢掉去重记录或导致退出后继续提醒", async () => {
  await startNotifier();
  const delivered = localStorage.getItem("fyj-company-check-notified");
  vi.mocked(api.listCompanyWatches).mockRejectedValueOnce(new Error("临时错误"));
  await refreshNotifierSchedule();
  expect(localStorage.getItem("fyj-company-check-notified")).toBe(delivered);
  await setNotificationsEnabled(false);
  watches.push(make("later"));
  await vi.advanceTimersByTimeAsync(86400000);
  expect(sendNotification).toHaveBeenCalledOnce();
});
