/**
 * 共享枚举、中文标签与场景模板（前端与 P1 浏览器扩展共用）。
 *
 * 注意：STATUS / EVENT_TYPE 及其状态投影与 Rust core（src-tauri/crates/core）保持一致，
 * Rust 侧 derive_status 是唯一事实源；此处副本仅用于 UI 菜单与展示。
 */

// ---------- 投递状态（看板列序即此序） ----------
export const STATUS_LIST = [
  "SAVED",
  "APPLIED",
  "ASSESSMENT",
  "WRITTEN",
  "INTERVIEWING",
  "OC",
  "INTENT",
  "OFFER",
  "SIGNED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type Status = (typeof STATUS_LIST)[number];

export const STATUS_LABELS: Record<Status, string> = {
  SAVED: "已保存",
  APPLIED: "已投递",
  ASSESSMENT: "测评中",
  WRITTEN: "笔试中",
  INTERVIEWING: "面试中",
  OC: "已OC",
  INTENT: "意向书",
  OFFER: "offer",
  SIGNED: "已签约",
  REJECTED: "已挂",
  WITHDRAWN: "已放弃",
};

/** 状态语义分组，用于看板分区（正向流程 / 终态） */
export const POSITIVE_STATUSES: Status[] = [
  "SAVED",
  "APPLIED",
  "ASSESSMENT",
  "WRITTEN",
  "INTERVIEWING",
  "OC",
  "INTENT",
  "OFFER",
  "SIGNED",
];
export const TERMINAL_BAD_STATUSES: Status[] = ["REJECTED", "WITHDRAWN"];

// ---------- 事件类型 ----------
export const EVENT_TYPES = [
  "APPLIED",
  "ASSESSMENT_INVITED",
  "ASSESSMENT_DONE",
  "ASSESSMENT_FAILED",
  "WRITTEN_INVITED",
  "WRITTEN_DONE",
  "WRITTEN_FAILED",
  "RESUME_PASS",
  "RESUME_FAIL",
  "HR_CONTACT",
  "OC",
  "INTENT_LETTER",
  "OFFER",
  "DUAL_AGREEMENT",
  "TRIPLICATE",
  "SIGNED",
  "REJECTED",
  "WITHDRAWN",
  "NOTE",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventTypeDef {
  label: string;
  /** 录入表单是否需要 deadline 字段（邀请类） */
  needsDeadline: boolean;
  /** 录入表单是否需要 result 字段（完成类） */
  needsResult: boolean;
}

export const EVENT_TYPE_DEFS: Record<EventType, EventTypeDef> = {
  APPLIED: { label: "已投递", needsDeadline: false, needsResult: false },
  ASSESSMENT_INVITED: { label: "测评邀请", needsDeadline: true, needsResult: false },
  ASSESSMENT_DONE: { label: "测评完成", needsDeadline: false, needsResult: true },
  ASSESSMENT_FAILED: { label: "测评挂", needsDeadline: false, needsResult: false },
  WRITTEN_INVITED: { label: "笔试邀请", needsDeadline: true, needsResult: false },
  WRITTEN_DONE: { label: "笔试完成", needsDeadline: false, needsResult: true },
  WRITTEN_FAILED: { label: "笔试挂", needsDeadline: false, needsResult: false },
  RESUME_PASS: { label: "简历过筛", needsDeadline: false, needsResult: false },
  RESUME_FAIL: { label: "简历挂", needsDeadline: false, needsResult: false },
  HR_CONTACT: { label: "HR沟通/约面", needsDeadline: false, needsResult: false },
  OC: { label: "口头offer", needsDeadline: false, needsResult: false },
  INTENT_LETTER: { label: "意向书", needsDeadline: false, needsResult: false },
  OFFER: { label: "正式offer", needsDeadline: false, needsResult: false },
  DUAL_AGREEMENT: { label: "两方协议", needsDeadline: false, needsResult: false },
  TRIPLICATE: { label: "三方协议", needsDeadline: false, needsResult: false },
  SIGNED: { label: "已签约", needsDeadline: false, needsResult: false },
  REJECTED: { label: "已挂（通用）", needsDeadline: false, needsResult: false },
  WITHDRAWN: { label: "主动放弃", needsDeadline: false, needsResult: false },
  NOTE: { label: "备注事件", needsDeadline: false, needsResult: false },
};

export const EVENT_RESULT_LABELS = {
  PENDING: "待定",
  PASS: "通过",
  FAIL: "未过",
  UNKNOWN: "不明",
} as const;
export type EventResult = keyof typeof EVENT_RESULT_LABELS;

// ---------- 渠道 / 批次 / 优先级 ----------
export const CHANNEL_LABELS = {
  COMPANY_SITE: "官网网申",
  BOSS: "Boss直聘",
  NOWCODER: "牛客",
  SHIXISENG: "实习僧",
  LIEPIN: "猎聘",
  REFERRAL: "内推",
  EMAIL: "邮箱投递",
  JOBFAIR: "宣讲会/双选会",
  OTHER: "其他",
} as const;
export type Channel = keyof typeof CHANNEL_LABELS;

export const BATCH_LABELS = {
  EARLY: "提前批",
  FORMAL: "正式批",
  SPRING: "春招",
  SUPPLEMENT: "补录",
  DAILY_INTERN: "日常实习",
  VACATION_INTERN: "寒暑假实习",
  OTHER: "其他",
} as const;
export type Batch = keyof typeof BATCH_LABELS;

export const PRIORITY_LABELS = { HIGH: "高", MEDIUM: "中", LOW: "低" } as const;
export type Priority = keyof typeof PRIORITY_LABELS;

// ---------- 面试 ----------
export const INTERVIEW_FORMAT_LABELS = {
  PHONE: "电话",
  VIDEO: "视频",
  ONSITE: "现场",
  GROUP: "群面",
  AI: "AI面",
} as const;
export type InterviewFormat = keyof typeof INTERVIEW_FORMAT_LABELS;

export const INTERVIEW_STATUS_LABELS = {
  SCHEDULED: "已约",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
} as const;
export type InterviewStatus = keyof typeof INTERVIEW_STATUS_LABELS;

export const INTERVIEW_OUTCOME_LABELS = {
  PENDING: "待定",
  PASS: "过",
  FAIL: "未过",
  UNKNOWN: "不明",
} as const;
export type InterviewOutcome = keyof typeof INTERVIEW_OUTCOME_LABELS;

export const QUESTION_QUALITY_LABELS = {
  GOOD: "答得好",
  OK: "一般",
  BAD: "答得差",
  UNKNOWN: "未评",
} as const;
export type QuestionQuality = keyof typeof QUESTION_QUALITY_LABELS;

/** 常用轮次标签（dictionary 表亦有种子，前端快捷输入用） */
export const ROUND_LABEL_PRESETS = [
  "一面",
  "二面",
  "三面",
  "HR面",
  "群面",
  "交叉面",
  "终面",
  "电话面",
  "AI面",
] as const;

// ---------- 首次启动场景模板（§3.6） ----------
export interface ScenarioTemplate {
  key: string;
  name: string;
  description: string;
  /** 看板显示的列 */
  boardStatuses: Status[];
  /** "添加事件"菜单默认展示的事件类型 */
  activeEventTypes: EventType[];
  /** 新建投递时默认批次 */
  defaultBatch: Batch;
}

export * from "./ipc-types";

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [

  {
    key: "campus",
    name: "校招（全流程）",
    description: "网申→测评→笔试→群面→多轮面试→OC→意向书→三方→签约，节点最全",
    boardStatuses: [...STATUS_LIST],
    activeEventTypes: [...EVENT_TYPES],
    defaultBatch: "FORMAL",
  },
  {
    key: "social",
    name: "社招（精简）",
    description: "投递→HR沟通→面试→offer→签约，隐藏校招特有节点",
    boardStatuses: [
      "SAVED",
      "APPLIED",
      "INTERVIEWING",
      "OC",
      "OFFER",
      "SIGNED",
      "REJECTED",
      "WITHDRAWN",
    ],
    activeEventTypes: [
      "APPLIED",
      "HR_CONTACT",
      "RESUME_PASS",
      "RESUME_FAIL",
      "OC",
      "OFFER",
      "DUAL_AGREEMENT",
      "SIGNED",
      "REJECTED",
      "WITHDRAWN",
      "NOTE",
    ],
    defaultBatch: "OTHER",
  },
  {
    key: "intern",
    name: "实习",
    description: "日常/寒暑假实习投递，保留笔试面试节点",
    boardStatuses: [...STATUS_LIST],
    activeEventTypes: [...EVENT_TYPES],
    defaultBatch: "DAILY_INTERN",
  },
  {
    key: "blank",
    name: "空白",
    description: "不预选模板，全部自行配置（事件类型仍可后续在字典中自定义）",
    boardStatuses: [...STATUS_LIST],
    activeEventTypes: ["APPLIED", "REJECTED", "WITHDRAWN", "NOTE"],
    defaultBatch: "OTHER",
  },
];
