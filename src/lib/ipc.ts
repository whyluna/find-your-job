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

  listDictionary: (category: string) =>
    invoke<DictionaryItem[]>("list_dictionary", { category }),

  listCustomEventTypes: () => invoke<CustomEventType[]>("list_custom_event_types"),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
};
