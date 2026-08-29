/**
 * IPC 类型（与 src-tauri/crates/core/src/entities.rs 的 DTO 镜像，camelCase）。
 * 时间为 RFC3339 字符串。修改任一侧时保持同步。
 */
import type {
  Batch,
  Channel,
  EventResult,
  EventType,
  InterviewFormat,
  InterviewOutcome,
  InterviewStatus,
  Priority,
  QuestionQuality,
  Status,
} from "./index";

export interface Company {
  id: string;
  name: string;
  aliases: string[];
  industry?: string | null;
  nature?: string | null;
  website?: string | null;
  careersUrl?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeVersion {
  id: string;
  name: string;
  targetRole?: string | null;
  fileName: string;
  /** 应用数据目录内的存储路径（打开文件用） */
  filePath: string;
  fileSize?: number | null;
  notes?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface Application {
  id: string;
  companyId: string;
  companyName: string;
  positionTitle: string;
  department?: string | null;
  workLocation?: string | null;
  /** 开放枚举：内置键或 custom:xxx（字典渲染标签） */
  channel: string;
  batch: string;
  priority: Priority;
  status: Status;
  appliedDate?: string | null;
  jobUrl?: string | null;
  jdText?: string | null;
  jdSnapshotAt?: string | null;
  salaryRange?: string | null;
  tags: string[];
  resumeVersionId?: string | null;
  resumeVersionName?: string | null;
  referredById?: string | null;
  notes?: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationListItem extends Application {
  nextDeadline?: string | null;
  interviewCount: number;
  lastEventType?: string | null;
  lastEventAt?: string | null;
}

export interface AppEvent {
  id: string;
  applicationId: string;
  type: EventType | string; // 内置枚举名或 custom:xxx
  occurredAt: string;
  deadline?: string | null;
  result?: EventResult | null;
  note?: string | null;
  source: "MANUAL" | "EXTENSION" | "EMAIL";
  createdAt: string;
}

export interface Interview {
  id: string;
  applicationId: string;
  round: number;
  roundLabel?: string | null;
  format?: InterviewFormat | string | null;
  scheduledAt?: string | null;
  durationMin?: number | null;
  locationOrLink?: string | null;
  interviewerNote?: string | null;
  status: InterviewStatus;
  outcome: InterviewOutcome;
  selfRating?: number | null;
  overallReflection?: string | null;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
}

export interface InterviewQuestion {
  id: string;
  interviewId: string;
  ordinal: number;
  question: string;
  myAnswer?: string | null;
  quality: QuestionQuality;
  reflection?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InterviewDetail extends Interview {
  questions: InterviewQuestion[];
}

export interface Attachment {
  id: string;
  parentType: "APPLICATION" | "INTERVIEW";
  parentId: string;
  fileName: string;
  filePath: string;
  mimeType?: string | null;
  size?: number | null;
  createdAt: string;
}

export interface ImportSummary {
  total: number;
  counts: Record<string, number>;
}

export interface ApplicationDetail extends Application {
  events: AppEvent[];
  interviews: InterviewDetail[];
  attachments: Attachment[];
}

export interface DictionaryItem {
  id: string;
  category: string;
  key: string;
  label: string;
  sort: number;
  isActive: boolean;
  isSystem: boolean;
}

export interface CustomEventType {
  id: string;
  label: string;
  projection: string;
  deadlineRequired: boolean;
  resultRequired: boolean;
  sort: number;
  isActive: boolean;
}

// ---------- 输入 ----------

export interface CreateApplicationInput {
  companyName: string;
  companyWebsite?: string | null;
  companyCareersUrl?: string | null;
  positionTitle: string;
  department?: string | null;
  workLocation?: string | null;
  channel?: Channel | string;
  batch?: Batch | string;
  priority?: Priority;
  applied?: boolean;
  appliedDate?: string | null;
  jobUrl?: string | null;
  jdText?: string | null;
  salaryRange?: string | null;
  tags?: string[];
  resumeVersionId?: string | null;
  notes?: string | null;
}

export interface UpdateApplicationInput {
  companyName?: string;
  positionTitle?: string;
  department?: string | null;
  workLocation?: string | null;
  channel?: Channel | string;
  batch?: Batch | string;
  priority?: Priority;
  jobUrl?: string | null;
  jdText?: string | null;
  salaryRange?: string | null;
  tags?: string[];
  resumeVersionId?: string | null;
  notes?: string | null;
}

export interface AddEventInput {
  applicationId: string;
  type: EventType | string;
  occurredAt?: string | null;
  deadline?: string | null;
  result?: EventResult | null;
  note?: string | null;
}

export interface UpdateEventInput {
  type?: EventType | string;
  occurredAt?: string;
  deadline?: string | null;
  result?: EventResult | null;
  note?: string | null;
}

export interface AddInterviewInput {
  applicationId: string;
  round?: number;
  roundLabel?: string | null;
  format?: InterviewFormat | string | null;
  scheduledAt?: string | null;
  durationMin?: number | null;
  locationOrLink?: string | null;
  interviewerNote?: string | null;
  status?: InterviewStatus;
  outcome?: InterviewOutcome;
}

export interface UpdateInterviewInput {
  round?: number;
  roundLabel?: string | null;
  format?: InterviewFormat | string | null;
  scheduledAt?: string | null;
  durationMin?: number | null;
  locationOrLink?: string | null;
  interviewerNote?: string | null;
  status?: InterviewStatus;
  outcome?: InterviewOutcome;
  selfRating?: number | null;
  overallReflection?: string | null;
}

export interface AddQuestionInput {
  interviewId: string;
  question: string;
  myAnswer?: string | null;
  quality?: QuestionQuality | string | null;
  reflection?: string | null;
  tags?: string[];
}

export interface UpdateQuestionInput {
  question?: string;
  myAnswer?: string | null;
  quality?: QuestionQuality | string | null;
  reflection?: string | null;
  tags?: string[];
}

export interface ListFilter {
  statuses?: string[];
  channels?: string[];
  batches?: string[];
  search?: string | null;
  tag?: string | null;
  resumeVersionId?: string | null;
  includeArchived?: boolean;
  archivedOnly?: boolean;
}
