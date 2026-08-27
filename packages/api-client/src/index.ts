import type {
  AppErrorShape,
  AuditEvent,
  ConfigOption,
  AdminOverview,
  AdminProjectDetail,
  AdminProjectSummary,
  AdminUser,
  FinalDelivery,
  ProjectPriority,
  WorkflowStatus,
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
import type { AdminFileCategory, AdminFormOption, AdminVoiceReference } from "@lifewood/domain";

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
  changePassword: async (credentials: { currentPassword: string; newPassword: string }) => {
    await request<void>("/me/password", { method: "POST", body: JSON.stringify(credentials) });
    clearCsrfToken();
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
  deleteDraft: (projectId: string, version: number, locale: SupportedLocale) =>
    request<void>(`/projects/${encodeURIComponent(projectId)}?version=${version}`, { method: "DELETE", locale }),
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
  listDeliveries: (projectId: string, locale: SupportedLocale) =>
    request<FinalDelivery[]>(`/projects/${encodeURIComponent(projectId)}/deliveries`, { locale }),
};

export const optionService = {
  getFormOptions: (locale: SupportedLocale) => request<FormOptions>("/form-options", { locale }),
  getVoices: (locale: SupportedLocale) => request<VoiceReference[]>("/voices", { locale }),
};

export interface AdminProjectListQuery {
  workflowStatus?: WorkflowStatus;
  priority?: ProjectPriority;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminUserListQuery {
  search?: string;
  role?: string;
  page?: number;
  pageSize?: number;
}

interface UploadOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

function getCsrfTokenForUpload(signal?: AbortSignal): Promise<string> {
  if (!signal) return getCsrfToken();
  if (signal.aborted) return Promise.reject(new DOMException("Upload cancelled", "AbortError"));
  return new Promise<string>((resolve, reject) => {
    const abort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void getCsrfToken().then(
      (token) => { signal.removeEventListener("abort", abort); resolve(token); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

async function upload<T>(path: string, body: FormData, options: UploadOptions = {}, retryCsrf = true): Promise<T> {
  if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
  const token = await getCsrfTokenForUpload(options.signal);
  if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBaseUrl}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-CSRF-TOKEN", token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    const abort = () => xhr.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      options.signal.removeEventListener("abort", abort);
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    xhr.onload = () => {
      options.signal?.removeEventListener("abort", abort);
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(100);
        if (xhr.status === 204) {
          resolve(undefined as T);
          return;
        }
        try { resolve(JSON.parse(xhr.responseText) as T); }
        catch { reject(new ApiError({ code: "network.invalidResponse", messageKey: "errors.network.invalidResponse", fallbackMessage: "The server returned an invalid response.", retryable: true })); }
        return;
      }
      let details: AppErrorShape = { code: `http.${xhr.status}`, fallbackMessage: xhr.statusText, retryable: xhr.status >= 500 };
      try { details = JSON.parse(xhr.responseText) as AppErrorShape; } catch { /* Keep the safe HTTP fallback. */ }
      if (details.code === "auth.csrf" && retryCsrf) {
        clearCsrfToken();
        void upload<T>(path, body, options, false).then(resolve, reject);
        return;
      }
      reject(new ApiError(details));
    };
    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new ApiError({ code: "network.upload", messageKey: "errors.network.upload", fallbackMessage: "The upload could not be completed.", retryable: true }));
    };
    xhr.onabort = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    xhr.send(body);
  });
}

export interface AuditEventListQuery {
  search?: string;
  actionId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const adminService = {
  getOverview: () => request<AdminOverview>("/admin/overview"),
  listAuditActions: (locale: SupportedLocale) => request<ConfigOption[]>("/admin/audit-actions", { locale }),
  listAuditEvents: ({ search, actionId, from, to, page = 1, pageSize = 30 }: AuditEventListQuery = {}) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) query.set("search", search);
    if (actionId) query.set("actionId", actionId);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    return request<PagedResult<AuditEvent>>(`/admin/audit-events?${query}`);
  },
  listProjects: ({ workflowStatus, priority, search, page = 1, pageSize = 20 }: AdminProjectListQuery = {}) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (workflowStatus) query.set("workflowStatus", workflowStatus);
    if (priority) query.set("priority", priority);
    if (search) query.set("search", search);
    return request<PagedResult<AdminProjectSummary>>(`/admin/projects?${query}`);
  },
  getProject: (id: string) => request<AdminProjectDetail>(`/admin/projects/${encodeURIComponent(id)}`),
  updateWorkflow: (id: string, workflowStatus: WorkflowStatus, priority: ProjectPriority, assigneeUserId?: string) =>
    request<AdminProjectDetail>(`/admin/projects/${encodeURIComponent(id)}/workflow`, { method: "PUT", body: JSON.stringify({ workflowStatus, priority, assigneeUserId: assigneeUserId || null }) }),
  addNote: (id: string, body: string) =>
    request(`/admin/projects/${encodeURIComponent(id)}/notes`, { method: "POST", body: JSON.stringify({ body }) }),
  listDeliveries: (id: string) => request<FinalDelivery[]>(`/admin/projects/${encodeURIComponent(id)}/deliveries`),
  publishFinalDelivery: (id: string, file: File, note: string, options?: UploadOptions) => {
    const body = new FormData();
    body.append("file", file);
    body.append("note", note);
    return upload<FinalDelivery>(`/admin/projects/${encodeURIComponent(id)}/deliveries`, body, options);
  },
  revokeFinalDelivery: (projectId: string, deliveryId: string) =>
    request<void>(`/admin/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(deliveryId)}`, { method: "DELETE" }),
  listAssignees: () => request<AdminUser[]>("/admin/assignees"),
  listUsers: ({ search, role, page = 1, pageSize = 20 }: AdminUserListQuery = {}) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) query.set("search", search);
    if (role) query.set("role", role);
    return request<PagedResult<AdminUser>>(`/admin/users?${query}`);
  },
  createUser: (account: { displayName: string; email: string; password: string; role: "customer" | "admin" }) =>
    request<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(account) }),
  updateUser: (id: string, account: { displayName: string; role: "customer" | "admin"; active: boolean }) =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(account) }),
  resetUserPassword: (id: string, newPassword: string) =>
    request<void>(`/admin/users/${encodeURIComponent(id)}/password`, { method: "PUT", body: JSON.stringify({ newPassword }) }),
  listVoiceReferences: () => request<AdminVoiceReference[]>("/admin/voices"),
  listSupportedFileContentTypes: () => request<string[]>("/admin/file-content-types"),
  listFileCategories: (scope: "source" | "reference") => request<AdminFileCategory[]>(`/admin/file-categories/${scope}`),
  saveFileCategory: (category: AdminFileCategory) => {
    const { updatedAt, ...payload } = category;
    return request<AdminFileCategory>(`/admin/file-categories/${category.scope}/${encodeURIComponent(category.id)}`, { method: "PUT", body: JSON.stringify({ ...payload, expectedUpdatedAt: updatedAt }) });
  },
  listFormOptions: (groupId: string) => request<AdminFormOption[]>(`/admin/form-options/${encodeURIComponent(groupId)}`),
  saveFormOption: (option: AdminFormOption) => {
    const { updatedAt, ...payload } = option;
    return request<AdminFormOption>(`/admin/form-options/${encodeURIComponent(option.groupId)}/${encodeURIComponent(option.id)}`, { method: "PUT", body: JSON.stringify({ ...payload, expectedUpdatedAt: updatedAt }) });
  },

  saveVoiceReference: (voice: AdminVoiceReference) => {
    const { audioUrl: _audioUrl, updatedAt, ...metadata } = voice;
    return request<AdminVoiceReference>(`/admin/voices/${encodeURIComponent(voice.id)}`, { method: "PUT", body: JSON.stringify({ ...metadata, expectedUpdatedAt: updatedAt }) });
  },
  uploadVoiceSample: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<AdminVoiceReference>(`/admin/voices/${encodeURIComponent(id)}/sample`, { method: "POST", body });
  },
  removeVoiceSample: (id: string) =>
    request<AdminVoiceReference>(`/admin/voices/${encodeURIComponent(id)}/sample`, { method: "DELETE" }),
};
