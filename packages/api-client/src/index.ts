import type {
  AppErrorShape,
  CurrentUser,
  FormOptions,
  PagedResult,
  ProjectValidationResult,
  SupportedLocale,
  TaskDraft,
  TaskSummary,
  UploadReferenceResult,
  VoiceReference,
} from "@lifewood/domain";

export class ApiError extends Error {
  readonly details: AppErrorShape;

  constructor(details: AppErrorShape) {
    super(details.fallbackMessage ?? details.code);
    this.name = "ApiError";
    this.details = details;
  }
}

export function localizedApiError(error: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : t("errors.system.unexpected");
  const translated = error.details.messageKey ? t(error.details.messageKey) : "";
  const message = translated && translated !== error.details.messageKey ? translated : (error.details.fallbackMessage ?? t("errors.system.unexpected"));
  return error.details.requestId ? `${message} · ${t("errors.requestId", { id: error.details.requestId })}` : message;
}

interface RequestOptions extends RequestInit {
  locale?: SupportedLocale;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.locale) {
    headers.set("Accept-Language", options.locale);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    let details: AppErrorShape = {
      code: `http.${response.status}`,
      fallbackMessage: response.statusText,
      retryable: response.status >= 500,
    };
    try {
      details = (await response.json()) as AppErrorShape;
    } catch {
      // Keep the safe HTTP fallback when the response is not JSON.
    }
    throw new ApiError(details);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const authService = {
  getCurrentUser: () => request<CurrentUser>("/me"),
  logout: async () => {
    const logoutUrl = import.meta.env.VITE_EXTERNAL_LOGOUT_URL as string | undefined;
    if (logoutUrl) window.location.assign(logoutUrl);
  },
};

export const localAuthService = {
  listUsers: () => request<CurrentUser[]>("/auth/test-users"),
  login: (userId: string) =>
    request<CurrentUser>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
};

export interface TaskListQuery {
  locale: SupportedLocale;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const projectService = {
  listProjects: ({ locale, status, search, page = 1, pageSize = 10 }: TaskListQuery) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) query.set("status", status);
    if (search) query.set("search", search);
    return request<PagedResult<TaskSummary>>(`/projects?${query}`, { locale });
  },
  createDraft: (locale: SupportedLocale) =>
    request<TaskDraft>("/projects", { method: "POST", locale, body: "{}" }),
  getProject: (projectId: string, locale: SupportedLocale) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}`, { locale }),
  saveDraft: (projectId: string, draft: TaskDraft, locale: SupportedLocale) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}/draft`, {
      method: "PUT",
      locale,
      body: JSON.stringify({ version: draft.version, project: draft.project, book: draft.book }),
    }),
  saveCreative: (projectId: string, draft: TaskDraft, locale: SupportedLocale) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}/creative`, {
      method: "PUT",
      locale,
      body: JSON.stringify({ version: draft.version, creative: draft.creative }),
    }),
  saveVoiceAndReferences: (projectId: string, draft: TaskDraft, locale: SupportedLocale, requireComplete = false) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}/voice-and-references`, {
      method: "PUT",
      locale,
      body: JSON.stringify({ version: draft.version, voiceAndReferences: draft.voiceAndReferences, requireComplete }),
    }),
  validateProject: (projectId: string, version: number, locale: SupportedLocale) =>
    request<ProjectValidationResult>(`/projects/${encodeURIComponent(projectId)}/validate`, {
      method: "POST",
      locale,
      body: JSON.stringify({ version }),
    }),
  submitProject: (projectId: string, version: number, idempotencyKey: string, locale: SupportedLocale) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}/submit`, {
      method: "POST",
      locale,
      body: JSON.stringify({ version, idempotencyKey }),
    }),
  uploadAsset: (projectId: string, version: number, categoryId: string, file: File, locale: SupportedLocale, signal?: AbortSignal) => {
    const body = new FormData();
    body.append("version", String(version));
    body.append("categoryId", categoryId);
    body.append("file", file);
    return request<UploadReferenceResult>(`/projects/${encodeURIComponent(projectId)}/files`, { method: "POST", locale, body, signal });
  },
  deleteAsset: (projectId: string, fileId: string, version: number, locale: SupportedLocale) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}?version=${version}`, { method: "DELETE", locale }),
};

export const optionService = {
  getFormOptions: (locale: SupportedLocale) => request<FormOptions>("/form-options", { locale }),
  getVoices: (locale: SupportedLocale) => request<VoiceReference[]>("/voices", { locale }),
};
