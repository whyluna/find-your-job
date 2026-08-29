/**
 * 共享层一致性测试：前端枚举/标签/模板的形状约束。
 * 这些不变量被 UI（看板列、事件菜单、首启向导）依赖。
 */
import { describe, expect, it } from "vitest";
import {
  STATUS_LIST,
  STATUS_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_DEFS,
  SCENARIO_TEMPLATES,
  CHANNEL_LABELS,
  BATCH_LABELS,
  POSITIVE_STATUSES,
  TERMINAL_BAD_STATUSES,
} from "./index";
import { STATUS_LIST as S2 } from "./index";

describe("状态枚举", () => {
  it("标签覆盖全部状态且无多余", () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...STATUS_LIST].sort());
  });

  it("看板列序：正向流程在前，两个终态旁路在最后", () => {
    expect(STATUS_LIST.slice(0, 9)).toEqual(POSITIVE_STATUSES);
    expect(STATUS_LIST.slice(9)).toEqual(TERMINAL_BAD_STATUSES);
  });

  it("重复 import 应是同一份（防止复制粘贴分叉）", () => {
    expect(S2).toBe(STATUS_LIST);
  });
});

describe("事件类型", () => {
  it("每个事件类型都有定义与标签", () => {
    for (const t of EVENT_TYPES) {
      expect(EVENT_TYPE_DEFS[t], `${t} 缺少定义`).toBeDefined();
      expect(EVENT_TYPE_DEFS[t].label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(EVENT_TYPE_DEFS).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("阶段类事件需要 deadline 与 result", () => {
    expect(EVENT_TYPE_DEFS.ASSESSMENT_INVITED.needsDeadline).toBe(true);
    expect(EVENT_TYPE_DEFS.WRITTEN_INVITED.needsDeadline).toBe(true);
    expect(EVENT_TYPE_DEFS.ASSESSMENT_INVITED.needsResult).toBe(true);
    expect(EVENT_TYPE_DEFS.WRITTEN_INVITED.needsResult).toBe(true);
    expect(EVENT_TYPE_DEFS.APPLIED.needsDeadline).toBe(false);
  });
});

describe("场景模板", () => {
  it("模板的看板列与事件类型均为合法值", () => {
    for (const tpl of SCENARIO_TEMPLATES) {
      expect(tpl.boardStatuses.length).toBeGreaterThan(0);
      for (const s of tpl.boardStatuses) expect(STATUS_LIST).toContain(s);
      for (const e of tpl.activeEventTypes) expect(EVENT_TYPES).toContain(e);
    }
  });

  it("模板 key 唯一，社招模板隐藏校招特有列", () => {
    const keys = SCENARIO_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    const social = SCENARIO_TEMPLATES.find((t) => t.key === "social")!;
    expect(social.boardStatuses).not.toContain("ASSESSMENT");
    expect(social.boardStatuses).not.toContain("INTENT");
    expect(social.boardStatuses).toContain("INTERVIEWING");
  });
});

describe("字典", () => {
  it("渠道与批次标签键值唯一", () => {
    expect(new Set(Object.values(CHANNEL_LABELS)).size).toBe(
      Object.keys(CHANNEL_LABELS).length,
    );
    expect(new Set(Object.values(BATCH_LABELS)).size).toBe(Object.keys(BATCH_LABELS).length);
  });
});
