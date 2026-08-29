/** Tauri IPC 薄封装：类型安全入口，页面不直接 invoke */


/** 底层技术错误 → 友好中文 */
function friendly(e: unknown): Error {
  const msg = String(e);
  if (msg.includes("premature end of input") || msg.includes("invalid args")) {
    return new Error("参数格式有误，请检查日期等输入后重试");
  }
  if (msg.includes("Failed to connect") || msg.includes("Connection refused")) {
    return new Error("无法连接本地服务，请重试");
  }
  return new Error(msg);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await call<T>(cmd, args);
  } catch (e) {
    throw friendly(e);
  }
}
import type {
  AddEventInput,
  AddInterviewInput,
  AddQuestionInput,
  AppEvent,
  Application,
  ApplicationDetail,
  ApplicationListItem,
  Company,
  CreateApplicationInput,
  CustomEventType,
  DictionaryItem,
  Interview,
  InterviewQuestion,
  ListFilter,
  ResumeVersion,
  UpdateApplicationInput,
  UpdateEventInput,
  UpdateInterviewInput,
  UpdateQuestionInput,
} from "@shared/ipc-types";

export const api = {
  dbReady: () =>
    call<{
      ok: boolean;
      dbPath: string;
      companies: number;
      applications: number;
      events: number;
    }>("db_ready"),

  searchCompanies: (query: string, limit = 8) =>
    call<Company[]>("search_companies", { query, limit }),
  listCompanies: () => call<(Company & { applicationCount: number })[]>("list_companies"),
  updateCompany: (
    id: string,
    input: {
      name: string;
      aliases: string[];
      industry?: string | null;
      nature?: string | null;
      website?: string | null;
      careersUrl?: string | null;
      notes?: string | null;
    },
  ) => call<Company>("update_company", { id, ...input }),
  deleteCompany: (id: string) => call<void>("delete_company", { id }),

  listApplications: (filter?: ListFilter) =>
    call<ApplicationListItem[]>("list_applications", { filter: filter ?? null }),

  getApplicationDetail: (id: string) =>
    call<ApplicationDetail>("get_application_detail", { id }),

  createApplication: (input: CreateApplicationInput) =>
    call<Application>("create_application", { input }),

  updateApplication: (id: string, input: UpdateApplicationInput) =>
    call<Application>("update_application", { id, input }),

  deleteApplication: (id: string) => call<void>("delete_application", { id }),

  setApplicationArchived: (id: string, archived: boolean) =>
    call<void>("set_application_archived", { id, archived }),
  reorderApplications: (orderedIds: string[]) =>
    call<void>("reorder_applications", { orderedIds }),

  addEvent: (input: AddEventInput) => call<AppEvent>("add_event", { input }),
  updateEvent: (id: string, input: UpdateEventInput) =>
    call<AppEvent>("update_event", { id, input }),
  deleteEvent: (id: string) => call<void>("delete_event", { id }),

  addInterview: (input: AddInterviewInput) =>
    call<Interview>("add_interview", { input }),
  updateInterview: (id: string, input: UpdateInterviewInput) =>
    call<Interview>("update_interview", { id, input }),
  deleteInterview: (id: string) => call<void>("delete_interview", { id }),

  addQuestion: (input: AddQuestionInput) =>
    call<InterviewQuestion>("add_question", { input }),
  updateQuestion: (id: string, input: UpdateQuestionInput) =>
    call<InterviewQuestion>("update_question", { id, input }),
  deleteQuestion: (id: string) => call<void>("delete_question", { id }),
  reorderQuestions: (orderedIds: string[]) =>
    call<void>("reorder_questions", { orderedIds }),

  listResumes: () => call<ResumeVersion[]>("list_resumes"),
  uploadResume: (name: string, targetRole: string | null, sourcePath: string, notes: string | null) =>
    call<ResumeVersion>("upload_resume", { name, targetRole, sourcePath, notes }),
  deleteResumeFile: (id: string) => call<void>("delete_resume_file", { id }),
  setDefaultResume: (id: string) => call<void>("set_default_resume", { id }),

  listDictionary: (category: string) =>
    call<DictionaryItem[]>("list_dictionary", { category }),

  listCustomEventTypes: () => call<CustomEventType[]>("list_custom_event_types"),

  getSetting: (key: string) => call<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    call<void>("set_setting", { key, value }),

  exportJson: (path: string) => call<number>("export_json", { path }),
  listAllQuestions: (search: string | null) =>
    call<
      {
        questionId: string;
        question: string;
        myAnswer?: string | null;
        quality: import("@shared").QuestionQuality;
        reflection?: string | null;
        tags: string[];
        round: number;
        roundLabel?: string | null;
        applicationId: string;
        companyName: string;
        positionTitle: string;
        department?: string | null;
      }[]
    >("list_all_questions", { search }),

  exportCsv: (path: string) => call<number>("export_csv", { path }),
  readTextFile: (path: string) => call<string>("read_text_file", { path }),
  importJson: (path: string) =>
    call<{ total: number; counts: Record<string, number> }>("import_json", { path }),
  revealDataDir: () => call<void>("reveal_data_dir"),

  uploadAttachment: (parentType: "APPLICATION" | "INTERVIEW", parentId: string, sourcePath: string) =>
    call<import("@shared").Attachment>("upload_attachment", { parentType, parentId, sourcePath }),
  deleteAttachment: (id: string) => call<void>("delete_attachment", { id }),

  llmGetSettings: () =>
    call<{ baseUrl: string; apiKey: string; model: string }>("llm_get_settings"),
  llmSaveSettings: (input: { baseUrl: string | null; apiKey: string | null; model: string | null }) =>
    call<void>("llm_save_settings", input),
  llmTest: () => call<string>("llm_test"),

  localApiStatus: () =>
    call<{ enabled: boolean; running: boolean; port: number; token: string }>("local_api_status"),
  localApiSetEnabled: (enabled: boolean) =>
    call<void>("local_api_set_enabled", { enabled }),
  localApiResetToken: () => call<void>("local_api_reset_token"),

  getStats: () =>
    call<
      {
        statusCounts: { key: string; count: number }[];
        channelCounts: { key: string; count: number }[];
        batchCounts: { key: string; count: number }[];
        dailyApplied: { key: string; count: number }[];
        silent: {
          id: string;
          companyName: string;
          positionTitle: string;
          status: import("@shared").Status;
          updatedAt: string;
        }[];
        resumeFunnel: { resumeName: string; total: number; interviewed: number; offered: number }[];
      }
    >("get_stats"),

  getUpcoming: (deadlineDays = 3, interviewDays = 7) =>
    call<
      {
        kind: string;
        applicationId: string;
        companyName: string;
        positionTitle: string;
        detail?: string | null;
        at: string;
      }[]
    >("get_upcoming", { deadlineDays, interviewDays }),
};
