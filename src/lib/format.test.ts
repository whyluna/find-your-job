import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, isUrgent, deadlineLabel } from "./format";

describe("fmtDate / fmtDateTime", () => {
  it("格式化日期与时间", () => {
    const iso = "2026-09-01T09:05:00Z";
    // 本地时区渲染，直接验证字段存在与形状
    expect(fmtDate(iso)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fmtDateTime(iso)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("空值与非法值返回占位符", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("not-a-date")).toBe("—");
    expect(fmtDateTime("")).toBe("—");
  });
});

describe("isUrgent", () => {
  it("72 小时内为紧急", () => {
    const soon = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    expect(isUrgent(soon)).toBe(true);
  });

  it("已过期 / 很远 / 空值不紧急", () => {
    expect(isUrgent(new Date(Date.now() - 1000).toISOString())).toBe(false);
    expect(isUrgent(new Date(Date.now() + 10 * 86400000).toISOString())).toBe(false);
    expect(isUrgent(null)).toBe(false);
  });

  it("可自定义阈值", () => {
    const in5Days = new Date(Date.now() + 5 * 86400000).toISOString();
    expect(isUrgent(in5Days, 24)).toBe(false);
    expect(isUrgent(in5Days, 24 * 6)).toBe(true);
  });
});

describe("deadlineLabel", () => {
  it("临近截止的文案", () => {
    expect(deadlineLabel(new Date(Date.now() + 3600 * 1000).toISOString())).toBe("今天截止");
    expect(deadlineLabel(new Date(Date.now() + 30 * 3600 * 1000).toISOString())).toBe("明天截止");
    expect(deadlineLabel(new Date(Date.now() - 3600 * 1000).toISOString())).toBe("已过期");
    expect(deadlineLabel(null)).toBe("");
  });
});
