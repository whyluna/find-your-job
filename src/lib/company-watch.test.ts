import { describe, expect, it } from "vitest";
import type { CompanyWatch } from "@shared";
import { companyWebsite, defaultWatchConfig, localDay, pendingCompanyChecks, watchIsDue, watchSeasonLabel } from "./company-watch";

const now = Date.parse("2026-09-13T01:00:00Z");
const watch: CompanyWatch = { ...defaultWatchConfig(new Date(now)), id: "watch-1", companyId: "company", companyName: "示例公司", applicationCount: 0, createdAt: "", updatedAt: "", nextCheckAt: "2026-09-12T01:00:00Z" };
describe("公司查看安排", () => {
  it("招聘季按届次显示，秋季默认下一毕业年份", () => {
    expect(defaultWatchConfig(new Date(2026, 8, 13))).toMatchObject({ year: 2027, season: "AUTUMN", status: "UNKNOWN" });
    expect(watchSeasonLabel({ year: 2027, season: "SPRING" })).toBe("2027 届春招");
    expect(localDay(new Date(2026, 8, 13))).toBe("2026-9-13");
  });
  it("只有到期且未暂停/结束的记录进入待查看", () => {
    expect(watchIsDue(watch, now)).toBe(true);
    for (const patch of [{ paused: true }, { status: "CLOSED" as const }, { nextCheckAt: null }, { nextCheckAt: "bad" }, { nextCheckAt: "2026-10-01T00:00:00Z" }]) expect(watchIsDue({ ...watch, ...patch }, now)).toBe(false);
  });
  it("同一到期时间只提醒一次；延后产生的新到期可再次提醒", () => {
    const delivered = { [watch.id]: watch.nextCheckAt! };
    expect(pendingCompanyChecks([watch], delivered, now)).toHaveLength(0);
    expect(pendingCompanyChecks([{ ...watch, nextCheckAt: "2026-09-13T00:00:00Z" }], delivered, now)).toHaveLength(1);
  });
  it("网站可补协议，但不会打开脚本、文件或内嵌账号密码的地址", () => {
    expect(companyWebsite("example.com/jobs")).toBe("https://example.com/jobs");
    for (const url of ["javascript:alert(1)", "file:///tmp/test", "https://user:password@example.com", ""]) expect(companyWebsite(url)).toBeNull();
  });
});
