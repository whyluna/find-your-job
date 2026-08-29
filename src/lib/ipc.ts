/** Tauri IPC 薄封装：类型安全入口，页面不直接 invoke */
import { invoke } from "@tauri-apps/api/core";
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
    invoke<{
      ok: boolean;
      dbPath: string;
      companies: number;
      applications: number;
      events: number;
    }>("db_ready"),

  searchCompanies: (query: string, limit = 8) =>
    invoke<Company[]>("search_companies", { query, limit }),

  listApplications: (filter?: ListFilter) =>
    invoke<ApplicationListItem[]>("list_applications", { filter: filter ?? null }),

  getApplicationDetail: (id: string) =>
    invoke<ApplicationDetail>("get_application_detail", { id }),

  createApplication: (input: CreateApplicationInput) =>
    invoke<Application>("create_application", { input }),

  updateApplication: (id: string, input: UpdateApplicationInput) =>
    invoke<Application>("update_application", { id, input }),

  deleteApplication: (id: string) => invoke<void>("delete_application", { id }),

  setApplicationArchived: (id: string, archived: boolean) =>
    invoke<void>("set_application_archived", { id, archived }),

  addEvent: (input: AddEventInput) => invoke<AppEvent>("add_event", { input }),
  updateEvent: (id: string, input: UpdateEventInput) =>
    invoke<AppEvent>("update_event", { id, input }),
  deleteEvent: (id: string) => invoke<void>("delete_event", { id }),

  addInterview: (input: AddInterviewInput) =>
    invoke<Interview>("add_interview", { input }),
  updateInterview: (id: string, input: UpdateInterviewInput) =>
    invoke<Interview>("update_interview", { id, input }),
  deleteInterview: (id: string) => invoke<void>("delete_interview", { id }),

  addQuestion: (input: AddQuestionInput) =>
    invoke<InterviewQuestion>("add_question", { input }),
  updateQuestion: (id: string, input: UpdateQuestionInput) =>
    invoke<InterviewQuestion>("update_question", { id, input }),
  deleteQuestion: (id: string) => invoke<void>("delete_question", { id }),
  reorderQuestions: (orderedIds: string[]) =>
    invoke<void>("reorder_questions", { orderedIds }),

  listResumes: () => invoke<ResumeVersion[]>("list_resumes"),
  uploadResume: (name: string, targetRole: string | null, sourcePath: string, notes: string | null) =>
    invoke<ResumeVersion>("upload_resume", { name, targetRole, sourcePath, notes }),
  deleteResumeFile: (id: string) => invoke<void>("delete_resume_file", { id }),
  setDefaultResume: (id: string) => invoke<void>("set_default_resume", { id }),

  listDictionary: (category: string) =>
    invoke<DictionaryItem[]>("list_dictionary", { category }),

  listCustomEventTypes: () => invoke<CustomEventType[]>("list_custom_event_types"),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),

  exportJson: (path: string) => invoke<number>("export_json", { path }),
  importJson: (path: string) =>
    invoke<{ total: number; counts: Record<string, number> }>("import_json", { path }),
  revealDataDir: () => invoke<void>("reveal_data_dir"),

  uploadAttachment: (parentType: "APPLICATION" | "INTERVIEW", parentId: string, sourcePath: string) =>
    invoke<import("@shared").Attachment>("upload_attachment", { parentType, parentId, sourcePath }),
  deleteAttachment: (id: string) => invoke<void>("delete_attachment", { id }),

  localApiStatus: () =>
    invoke<{ enabled: boolean; running: boolean; port: number; token: string }>("local_api_status"),
  localApiSetEnabled: (enabled: boolean) =>
    invoke<void>("local_api_set_enabled", { enabled }),
  localApiResetToken: () => invoke<void>("local_api_reset_token"),

  getStats: () =>
    invoke<
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
    invoke<
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
