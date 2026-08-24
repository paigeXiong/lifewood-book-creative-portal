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
let csrfToken: string | undefined;
let csrfRequest: Promise<string> | undefined;

function clearCsrfToken() {
  csrfToken = undefined;
  csrfRequest = undefined;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfRequest ??= (async () => {
    const response = await fetch(`${apiBaseUrl}/auth/csrf`, { credentials: "include", headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new ApiError({ code: "auth.csrf", messageKey: "errors.auth.csrf", fallbackMessage: "The secure session could not be initialized.", retryable: true });
    csrfToken = ((await response.json()) as { token: string }).token;
    return csrfToken;
  })();
  try { return await csrfRequest; }
  finally { csrfRequest = undefined; }
}

async function request<T>(path: string, options: RequestOptions = {}, retryCsrf = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.locale) {
    headers.set("Accept-Language", options.locale);
  }
  const method = (options.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-TOKEN", await getCsrfToken());
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
    if (details.code === "auth.csrf" && retryCsrf) {
      clearCsrfToken();
      return request<T>(path, options, false);
    }
    throw new ApiError(details);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export interface LoginCredentials { email: string; password: string; rememberMe: boolean }
export interface BootstrapAccount { displayName: string; email: string; password: string }

export const authService = {
  getStatus: () => request<{ requiresBootstrap: boolean }>("/auth/status"),
  getCurrentUser: () => request<CurrentUser>("/me"),
  login: async (credentials: LoginCredentials) => {
    const user = await request<CurrentUser>("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
    clearCsrfToken();
    return user;
  },
  bootstrap: async (account: BootstrapAccount) => {
    const user = await request<CurrentUser>("/auth/bootstrap", { method: "POST", body: JSON.stringify(account) });
    clearCsrfToken();
    return user;
  },
  logout: async () => {
    await request<void>("/auth/logout", { method: "POST" });
    clearCsrfToken();
  },
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
