import type {
  AdminCharacterPreset,
  AppErrorShape,
  BookRecognition,
  AuditEvent,
  ConfigOption,
  AdminOverview,
  AdminAnalytics,
  AdminOrganization,
  AdminProjectDetail,
  AdminProjectSummary,
  AdminUser,
  AdminUserDirectory,
  AdminUserDetails,
  FinalDelivery,
  ProjectPriority,
  WorkflowStatus,
  CurrentUser,
  MyOrganizationPage,
  OrganizationMemberProfile,
  OrganizationMemberActivity,
  FormOptions,
  RuntimeAction,
  BackupPage, BackupPolicy, BackupRecord, BackupSchedule, RestorePreview, RestoreState, RestoreOverview, RestoreHistoryPage,
  RuntimeSettings,
  WebListenerSettings,
  RuntimeHealth,
  PagedResult,
  ProjectStats,
  CustomerDashboard,
  ProjectValidationResult,
  SupportedLocale,
  TaskDraft,
  TaskSummary,
  UploadReferenceResult,
  VoiceReference,
} from "@lifewood/domain";
import type { FormOptionSection, AdminFileCategory, AdminFormOption, AdminVoiceReference } from "@lifewood/domain";

export class ApiError extends Error {
  readonly details: AppErrorShape;

  constructor(details: AppErrorShape) {
    super(details.fallbackMessage ?? details.code);
    this.name = "ApiError";
    this.details = details;
  }
}

export function localizedApiError(error: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!(error instanceof ApiError)) return t("errors.system.unexpected");
  const translated = error.details.messageKey ? t(error.details.messageKey) : "";
  const message = translated && translated !== error.details.messageKey ? translated : t("errors.system.unexpected");
  return error.details.requestId ? `${message} · ${t("errors.requestId", { id: error.details.requestId })}` : message;
}

function httpErrorFallback(status: number): AppErrorShape {
  if (status === 401) {
    return { code: "auth.unauthorized", messageKey: "errors.auth.unauthorized", retryable: false };
  }
  if (status === 403) {
    return { code: "auth.forbidden", messageKey: "errors.auth.forbidden", retryable: false };
  }
  if (status === 429) {
    return { code: "http.429", messageKey: "errors.rateLimit.exceeded", retryable: true };
  }
  return { code: `http.${status}`, messageKey: "errors.system.unexpected", retryable: status >= 500 };
}

function normalizeErrorPayload(value: unknown, fallback: AppErrorShape): AppErrorShape {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<AppErrorShape>;
  if (typeof candidate.code !== "string" || !candidate.code.trim()) return fallback;
  const fieldErrors = Array.isArray(candidate.fieldErrors)
    ? candidate.fieldErrors.filter((entry) => entry && typeof entry.field === "string" && typeof entry.code === "string")
    : undefined;
  return {
    code: candidate.code,
    messageKey: typeof candidate.messageKey === "string" && candidate.messageKey ? candidate.messageKey : fallback.messageKey,
    fieldErrors,
    retryable: typeof candidate.retryable === "boolean" ? candidate.retryable : fallback.retryable,
    requestId: typeof candidate.requestId === "string" ? candidate.requestId : undefined,
    currentVersion: typeof candidate.currentVersion === "number" && Number.isFinite(candidate.currentVersion) ? candidate.currentVersion : undefined,
  };
}

interface RequestOptions extends RequestInit {
  publicEmailAction?: boolean;
  responseType?: "blob" | "stream";
  destination?: WritableStream<Uint8Array>;
  onCommitting?: () => void;
  locale?: SupportedLocale;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";
export type HelpArticle = { id: string; category: string; title: string; summary: string; steps: string[]; faq: { question: string; answer: string }[]; image: string | null; updated: string };
export type FunctionSearchResult = { title: string; category: string; path: string; kind: "function" | "admin" | "customer" };
export const helpService = {
  searchFunctions: (locale: string, q: string, signal?: AbortSignal) => request<FunctionSearchResult[]>("/admin/function-search?" + new URLSearchParams({ locale, q }), { signal }),
  list: (locale: string, audience: string, q: string, signal?: AbortSignal) => request<HelpArticle[]>("/help?" + new URLSearchParams({ locale, audience, q }), { signal }),
  imageUrl: (name: string, locale: string) => `${apiBaseUrl}/help/images/${encodeURIComponent(name)}?locale=${encodeURIComponent(locale)}`,
};
let boundAccount: string | undefined;
let accountBlocked = false;
export function captureAccountGuard(): () => void {
  const account = boundAccount;
  return () => {
    if (accountBlocked || account !== boundAccount) throw new ApiError({code:"auth.account_changed",messageKey:"accountSwitch.changed",retryable:false});
  };
}
function reportAccountChange() {
  if(accountBlocked)return;
  accountBlocked = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("lw-account-changed"));
}
let csrfToken: string | undefined;
let csrfRequest: Promise<string> | undefined;

async function fetchResponse(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({
      code: "network.unavailable",
      messageKey: "errors.network.unavailable",
      fallbackMessage: "The server could not be reached. Check your connection and try again.",
      retryable: true,
    });
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({
      code: "network.invalidResponse",
      messageKey: "errors.network.invalidResponse",
      fallbackMessage: "The server returned an invalid response.",
      retryable: true,
    });
  }
}

function clearCsrfToken() {
  csrfToken = undefined;
  csrfRequest = undefined;
}

async function getCsrfToken(signal?: AbortSignal | null): Promise<string> {
  signal?.throwIfAborted();
  if (csrfToken) return csrfToken;
  let pending = csrfRequest;
  if (!pending) {
    pending = (async () => {
      const response = await fetchResponse(`${apiBaseUrl}/auth/csrf`, { credentials: "include", headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new ApiError({ code: "auth.csrf", messageKey: "errors.auth.csrf", fallbackMessage: "The secure session could not be initialized.", retryable: true });
      const payload = await readJson<{ token?: unknown }>(response);
      if (typeof payload.token !== "string" || !payload.token) {
        throw new ApiError({ code: "network.invalidResponse", messageKey: "errors.network.invalidResponse", fallbackMessage: "The server returned an invalid response.", retryable: true });
      }
      // A cancelled/cleared lookup must not overwrite a newer token.
      if (csrfRequest === pending) csrfToken = payload.token;
      return payload.token;
    })();
    csrfRequest = pending;
  }
  let abort: (() => void) | undefined;
  try {
    if (!signal) return await pending;
    return await new Promise<string>((resolve, reject) => {
      abort = () => reject(new DOMException("Request cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      pending.then(resolve, reject);
    });
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    // Detach only this lookup; other consumers may still finish awaiting it.
    if (csrfRequest === pending) csrfRequest = undefined;
  }
}

async function request<T>(path: string, options: RequestOptions = {}, retryCsrf = true): Promise<T> {
  if (accountBlocked && !path.startsWith("/auth/")) throw new ApiError({code:"auth.account_changed",messageKey:"accountSwitch.changed",retryable:false});
  options.signal?.throwIfAborted();
  const requestAccount = boundAccount;
  const headers = new Headers(options.headers);
  if (boundAccount && !options.publicEmailAction && !["/auth/login", "/auth/bootstrap", "/auth/status"].includes(path)) headers.set("X-LW-Account", boundAccount);
  headers.set("Accept", options.responseType ? "*/*" : "application/json");
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.locale) {
    headers.set("Accept-Language", options.locale);
  }
  const method = (options.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-TOKEN", await getCsrfToken(options.signal));
  }

  options.signal?.throwIfAborted();
  const response = await fetchResponse(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    const fallback = httpErrorFallback(response.status);
    let details = fallback;
    try {
      details = normalizeErrorPayload(await response.json(), fallback);
    } catch {
      // Keep the safe HTTP fallback when the response is not JSON.
    }
    if (details.code === "auth.csrf" && retryCsrf) {
      clearCsrfToken();
      return request<T>(path, options, false);
    }
    if (details.code === "auth.account_changed") reportAccountChange();
    throw new ApiError(details);
  }

  if (options.responseType === "stream") {
    const current = () => {
      options.signal?.throwIfAborted();
      if (accountBlocked || requestAccount !== boundAccount) throw new ApiError({code:"auth.account_changed",messageKey:"accountSwitch.changed",retryable:false});
    };
    if (!response.body || !options.destination) throw new ApiError({code:"network.invalidResponse",messageKey:"errors.network.invalidResponse",retryable:true});
    const reader = response.body.getReader(), writer = options.destination.getWriter();
    const abort = () => { void reader.cancel(options.signal?.reason).catch(() => {}); void writer.abort(options.signal?.reason).catch(() => {}); };
    options.signal?.addEventListener("abort", abort, {once:true});
    const write = async (operation: () => Promise<unknown>) => {
      try { await operation(); }
      catch (error) {
        options.signal?.throwIfAborted();
        throw new ApiError({code:"download.save_failed",messageKey:"delivery.saveFailed",retryable:true});
      }
    };
    try {
      while (true) {
        current();
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); }
        catch (error) {
          options.signal?.throwIfAborted();
          throw new ApiError({code:"network.unavailable",messageKey:"errors.network.unavailable",retryable:true});
        }
        current();
        if (chunk.done) break;
        // Await every write: at most one received chunk is being written here.
        await write(() => writer.write(chunk.value));
      }
      current();
      options.onCommitting?.();
      current();
      await write(() => writer.close());
      return undefined as T;
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      await writer.abort(error).catch(() => {});
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      reader.releaseLock(); writer.releaseLock();
    }
  }
  if (response.status === 204) {
    return undefined as T;
  }
  if (options.responseType === "blob") {
    let blob: Blob;
    try { blob = await response.blob(); }
    catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      throw new ApiError({ code: "network.unavailable", messageKey: "errors.network.unavailable", retryable: true });
    }
    if (accountBlocked || requestAccount !== boundAccount) throw new ApiError({code:"auth.account_changed",messageKey:"accountSwitch.changed",retryable:false});
    return blob as T;
  }
  return readJson<T>(response);
}

export interface LoginCredentials { email: string; password: string; rememberMe: boolean }
export interface EmailSettings { available: boolean; email: string; verified: boolean; notifications: boolean; deliveryStatus?: string; topics?: Array<{ id: string; label: string; enabled: boolean }> }
export interface MailQueuePage {
  rate?: {minuteUsed:number;dayUsed:number;perMinute:number;perDay:number;resumeAt:number|null};
  configurationChecks?: { code: string; passed: boolean }[];
  available: boolean; checkedAt: number; counts: { status: string; count: number }[]; kinds: string[];
  items: { id: string; recipient: string; kind: string; status: string; failures: number; nextAttempt: number | null; expires: number }[];
  total: number; page: number; pageSize: number;
}
export const mailQueueService = {
  list: (status: string, kind: string, page: number, signal?: AbortSignal) => request<MailQueuePage>(`/admin/mail/status?${new URLSearchParams({ status, kind, page: String(page) })}`, { signal }),
};
export interface MailServiceSettings {
  revision: string; enabled: boolean; host: string; port: number; from: string; username: string;
  perMinute?: number; perDay?: number;
  hasPassword: boolean; publicUrl: string; available: boolean; labels: Record<string, string>;
}
export interface MailServiceInput {
  revision: string; enabled: boolean; host: string; port: number; from: string; username: string;
  perMinute?: number; perDay?: number;
  password: string; clearPassword: boolean; publicUrl: string;
}
export interface ProxyScope { id: string; label: string; mode: string; effectiveMode: string; address: string; username: string; hasPassword: boolean }
export interface ProxySettings { revision: string; scopes: ProxyScope[]; modes: { id: string; label: string }[]; labels: Record<string, string> }
export interface ProxyInput { revision: string; scope: string; mode: string; address: string; username: string; password: string; clearPassword: boolean }
export const outboundProxyService = {
  get: (locale: SupportedLocale, signal?: AbortSignal) => request<ProxySettings>(`/admin/outbound-proxy?locale=${locale}`, { signal }),
  save: (input: ProxyInput, locale: SupportedLocale) => request<ProxySettings>(`/admin/outbound-proxy?locale=${locale}`, { method: "PUT", body: JSON.stringify(input) }),
  test: (revision: string, scope: string) => request<{ status: number }>("/admin/outbound-proxy/test", { method: "POST", body: JSON.stringify({ revision, scope }) }),
};
export const mailSettingsService = {
  previewTemplate: (kind: string, locale: SupportedLocale, input: {revision:string;subject:string;introduction:string;enabled:boolean}) => request<MailTemplatePreview>(`/admin/mail/templates/${encodeURIComponent(kind)}/preview?locale=${locale}`, {method:"POST",body:JSON.stringify(input)}),
  testTemplate: (kind: string, locale: SupportedLocale, revision: string) => request<void>(`/admin/mail/templates/${encodeURIComponent(kind)}/test?locale=${locale}`, { method: "POST", body: JSON.stringify({revision}) }),
  saveTemplate: (kind: string, locale: SupportedLocale, input: { revision: string; subject: string; introduction: string; enabled: boolean; reset?: boolean }) => request<MailTemplatePreview[]>(`/admin/mail/templates/${encodeURIComponent(kind)}?locale=${locale}`, { method: "PUT", body: JSON.stringify(input) }),
  templates: (locale: SupportedLocale, signal?: AbortSignal) => request<MailTemplatePreview[]>(`/admin/mail/templates?locale=${locale}`, { signal }),
  get: (locale: SupportedLocale, signal?: AbortSignal) => request<MailServiceSettings>(`/admin/mail/settings?locale=${locale}`, { signal }),
  save: (input: MailServiceInput, locale: SupportedLocale) => request<MailServiceSettings>(`/admin/mail/settings?locale=${locale}`, { method: "PUT", body: JSON.stringify(input) }),
  test: (revision: string, locale: SupportedLocale) => request<void>(`/admin/mail/test?locale=${locale}`, { method: "POST", body: JSON.stringify({ revision }) }),
};
export interface MailTemplatePreview { introduction: string; enabled: boolean; revision: string; kind: string; subject: string; body: { text: string; html: string } }
export interface OidcConfiguration { id: string; version: number; nameZh: string; nameEn: string; issuer: string; clientId: string; publicOrigin: string; adminOrigin: string; enabled: boolean; hasSecret: boolean }
export interface OidcBindingStatus { id: string; available: boolean; bound: boolean; nameZh: string; nameEn: string }
export type OidcInput = Omit<OidcConfiguration, "hasSecret"> & { secret?: string };
export const oidcService = {
  providers: () => request<{ items: Array<{ id: string; nameZh: string; nameEn: string }> }>("/auth/oidc/providers", { publicEmailAction: true }),
  start: (locale: string, portal: "customer" | "admin", providerId: string, password?: string) => request<{ url: string }>("/auth/oidc/start", { publicEmailAction: password === undefined, method: "POST", body: JSON.stringify({ locale, portal, providerId, bind: password !== undefined, password }) }),
  binding: () => request<{ items: OidcBindingStatus[] }>("/me/oidc"),
  unbind: (password: string, providerId: string) => request<void>("/me/oidc/unbind", { method: "POST", body: JSON.stringify({ password, providerId }) }),
  configuration: () => request<{ items: OidcConfiguration[] }>("/admin/settings/oidc"),
  save: (input: OidcInput) => request<OidcConfiguration>("/admin/settings/oidc" + (input.id ? "/" + encodeURIComponent(input.id) : ""), { method: input.id ? "PUT" : "POST", body: JSON.stringify(input) }),
  remove: (id: string, version: number) => request<void>(`/admin/settings/oidc/${encodeURIComponent(id)}?version=${version}`, { method: "DELETE" }),
  test: (input: OidcInput) => request<void>("/admin/settings/oidc/test", { method: "POST", body: JSON.stringify(input) }),
};
export const emailService = {
  availability: () => request<{ available: boolean }>("/auth/email-status", { publicEmailAction: true }),
  settings: (locale?: SupportedLocale) => request<EmailSettings>(`/me/email${locale ? `?locale=${locale}` : ""}`, { locale }),
  verify: () => request<void>("/me/email/verify", { method: "POST" }),
  preferences: (notifications: boolean, topics?: string[]) => request<EmailSettings>("/me/email/preferences", { method: "PUT", body: JSON.stringify({ notifications, topics }) }),
  forgot: (email: string) => request<void>("/auth/password/forgot", { publicEmailAction: true, method: "POST", body: JSON.stringify({ email }) }),
  consume: (purpose: "verify" | "reset", token: string, newPassword?: string) => request<void>(purpose === "verify" ? "/auth/email/verify" : "/auth/password/reset", { publicEmailAction: true, method: "POST", body: JSON.stringify({ token, newPassword }) }),
};
export interface BootstrapAccount { displayName: string; email: string; password: string; phone?: string; organizationName?: string; locale?: SupportedLocale }

export const authService = {
  getOrganizationMemberActivity: ({ id, locale, search = "", page = 1, signal }: { id: string; locale: SupportedLocale; search?: string; page?: number; signal?: AbortSignal }) =>
    request<OrganizationMemberActivity>(`/me/organization/members/${encodeURIComponent(id)}/activity?${new URLSearchParams({ locale, search, page: String(page) })}`, { locale, signal }),
  getOrganizationMember: ({ id, locale, signal }: { id: string; locale: SupportedLocale; signal?: AbortSignal }) =>
    request<OrganizationMemberProfile>(`/me/organization/members/${encodeURIComponent(id)}?${new URLSearchParams({ locale })}`, { locale, signal }),
  getMyOrganization: ({ locale, search = "", page = 1, signal }: { locale: SupportedLocale; search?: string; page?: number; signal?: AbortSignal }) =>
    request<MyOrganizationPage>(`/me/organization?${new URLSearchParams({ locale, search, page: String(page) })}`, { locale, signal }),
  getStatus: () => request<{ requiresBootstrap: boolean }>("/auth/status"),
  getCurrentUser: async () => { const user=await request<CurrentUser>("/me"); boundAccount=user.id; return user; },
  savedAccounts: () => request<{items: Array<{id:string;displayName:string;email?:string;current:boolean;expiresAt:string}>;limit:number}>("/auth/accounts"),
  addAccount: async (credentials: LoginCredentials) => { const user=await request<CurrentUser>("/auth/accounts/add",{method:"POST",body:JSON.stringify(credentials)}); clearCsrfToken();return user; },
  switchAccount: async (id:string) => { const user=await request<CurrentUser>("/auth/accounts/switch",{method:"POST",body:JSON.stringify({id})});clearCsrfToken();return user; },
  removeAccount: (id:string) => request<void>(`/auth/accounts/${encodeURIComponent(id)}`,{method:"DELETE"}),
  notifyAccountChanged: reportAccountChange,
  checkActiveAccount: async (id:string) => { const r=await fetchResponse(`${apiBaseUrl}/auth/active`,{credentials:"include",cache:"no-store"});if(r.status===401)return false;if(!r.ok)throw new Error("Account check unavailable");return await r.text()===id; },
  updateProfile: (profile: { displayName: string; phone?: string }) =>
    request<CurrentUser>("/me/profile", { method: "PUT", body: JSON.stringify(profile) }),
  updatePreferences: (preferences: { locale: SupportedLocale; taskBackgroundMotion?: boolean }) =>
    request<CurrentUser>("/me/preferences", { method: "PUT", body: JSON.stringify(preferences) }),
  login: async (credentials: LoginCredentials) => {
    const user = await request<CurrentUser>("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
    clearCsrfToken();
    boundAccount=user.id;accountBlocked=false;
    return user;
  },
  bootstrap: async (account: BootstrapAccount) => {
    const user = await request<CurrentUser>("/auth/bootstrap", { method: "POST", body: JSON.stringify(account) });
    clearCsrfToken();
    boundAccount=user.id;accountBlocked=false;
    return user;
  },
  changePassword: async (credentials: { currentPassword: string; newPassword: string }) => {
    await request<void>("/me/password", { method: "POST", body: JSON.stringify(credentials) });
    clearCsrfToken();
  },
  uploadAvatar: (file: File) => {
    const body = new FormData();
    body.append("avatar", file);
    return request<CurrentUser>("/me/avatar", { method: "POST", body });
  },
  removeAvatar: () => request<CurrentUser>("/me/avatar", { method: "DELETE" }),
  logout: async () => {
    await request<void>("/auth/logout", { method: "POST" });
    clearCsrfToken();
    boundAccount=undefined;accountBlocked=false;
  },
};

export interface TaskListQuery {
  scope?: "personal" | "organization";
  locale: SupportedLocale;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: "project" | "author" | "status" | "updated";
  direction?: "asc" | "desc";
}

export const projectService = {
  recognizeBook: (projectId: string, assetIds: string[], locale: SupportedLocale, signal?: AbortSignal) =>
    request<BookRecognition>(`/projects/${encodeURIComponent(projectId)}/recognize-book`, { method: "POST", locale, signal, body: JSON.stringify({ assetIds }) }),
  listProjects: ({ locale, status, search, scope, page = 1, pageSize = 10, sort = "updated", direction = "desc" }: TaskListQuery) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (scope) query.set("scope", scope);
    if (status) query.set("status", status);
    if (search) query.set("search", search);
    query.set("sort", sort);
    query.set("direction", direction);
    return request<PagedResult<TaskSummary>>(`/projects?${query}`, { locale });
  },
  getStats: () => request<ProjectStats>("/projects/stats"),
  getScopedStats: (scope: "personal" | "organization") => request<ProjectStats>(`/projects/stats?scope=${scope}`),
  getDashboard: (params: { month: string; timeZone: string; day: number; page: number; scope?: "personal" | "organization" }, signal?: AbortSignal) =>
    request<CustomerDashboard>(`/projects/dashboard?${new URLSearchParams({ scope: params.scope ?? "personal", month: params.month, timeZone: params.timeZone, day: String(params.day), page: String(params.page) })}`, { signal }),
  copyDraft: (id: string, requestId: string, locale: SupportedLocale) => request<TaskDraft>(`/projects/${encodeURIComponent(id)}/copy`, { method: "POST", locale, body: JSON.stringify({ requestId }) }),
  createDraft: (locale: SupportedLocale) =>
    request<TaskDraft>("/projects", { method: "POST", locale, body: "{}" }),
  getProject: (projectId: string, locale: SupportedLocale, signal?: AbortSignal) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}`, { locale, signal }),
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
  saveVoiceAndReferences: (projectId: string, draft: TaskDraft, locale: SupportedLocale, requireComplete = false, includeProject = false) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}/voice-and-references`, {
      method: "PUT",
      locale,
      body: JSON.stringify({ version: draft.version, voiceAndReferences: draft.voiceAndReferences, requireComplete, project: includeProject ? draft.project : undefined }),
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
  uploadAsset: (projectId: string, version: number, categoryId: string, file: File, locale: SupportedLocale, signal?: AbortSignal, characterId?: string, options?: Pick<UploadOptions, "onProgress" | "uploadId">) => {
    const body = new FormData();
    body.append("version", String(version));
    body.append("categoryId", categoryId);
    if (characterId) body.append("characterId", characterId);
    body.append("file", file);
    if (options?.uploadId) body.append("uploadId", options.uploadId);
    if (options) return upload<UploadReferenceResult>(`/projects/${encodeURIComponent(projectId)}/files?categoryId=${encodeURIComponent(categoryId)}`, body, { ...options, locale, signal });
    return request<UploadReferenceResult>(`/projects/${encodeURIComponent(projectId)}/files?categoryId=${encodeURIComponent(categoryId)}`, { method: "POST", locale, body, signal });
  },
  deleteAsset: (projectId: string, fileId: string, version: number, locale: SupportedLocale) =>
    request<TaskDraft>(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}?version=${version}`, { method: "DELETE", locale }),
  downloadDelivery: (projectId: string, deliveryId: string, locale: SupportedLocale, signal: AbortSignal) =>
    request<Blob>(`/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(deliveryId)}/file`, { locale, signal, responseType: "blob", cache: "no-store" }),
  downloadDeliveryTo: async (projectId: string, deliveryId: string, locale: SupportedLocale, signal: AbortSignal, destination: WritableStream<Uint8Array>, onCommitting?: () => void) => {
    try {
      await request<void>(`/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(deliveryId)}/file`, {locale,signal,responseType:"stream",destination,onCommitting,cache:"no-store"});
    } catch (error) {
      // Covers HTTP/authentication failures before a writer was acquired as well.
      await destination.abort(error).catch(() => {});
      throw error;
    }
  },
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
  assignableOnly?: boolean;
  status?: string;
  organization?: string;
  enabled?: string;
  todayStart?: string;
  search?: string;
  role?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminOrganizationListQuery {
  search?: string;
  page?: number;
  pageSize?: number;
}

interface UploadOptions {
  locale?: SupportedLocale;
  uploadId?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

function getCsrfTokenForUpload(signal?: AbortSignal): Promise<string> {
  return getCsrfToken(signal);
}


async function upload<T>(path: string, body: FormData, options: UploadOptions = {}, retryCsrf = true): Promise<T> {
  if(accountBlocked)throw new ApiError({code:"auth.account_changed",messageKey:"accountSwitch.changed",retryable:false});
  const expectedAccount=boundAccount;
  if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
  const token = await getCsrfTokenForUpload(options.signal);
  if (accountBlocked || expectedAccount !== boundAccount) throw new ApiError({ code: "auth.account_changed", messageKey: "accountSwitch.changed", retryable: false });
  if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBaseUrl}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    if (options.locale) xhr.setRequestHeader("Accept-Language", options.locale);
    xhr.setRequestHeader("X-CSRF-TOKEN", token);
    if(expectedAccount)xhr.setRequestHeader("X-LW-Account",expectedAccount);
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
      if (accountBlocked || expectedAccount !== boundAccount) {
        reject(new ApiError({ code: "auth.account_changed", messageKey: "accountSwitch.changed", retryable: false }));
        return;
      }
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
      const fallback = httpErrorFallback(xhr.status);
      let details = fallback;
      try { details = normalizeErrorPayload(JSON.parse(xhr.responseText) as unknown, fallback); } catch { /* Keep the safe HTTP fallback. */ }
      if (details.code === "auth.csrf" && retryCsrf) {
        clearCsrfToken();
        void upload<T>(path, body, options, false).then(resolve, reject);
        return;
      }
      if(details.code==="auth.account_changed")reportAccountChange();
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

export interface AiProvider {
  id: string; name: string; protocol: string; endpoint: string; model: string; hasApiKey: boolean; models: string[];
}
export interface AiProviderInput {
  id?: string; name: string; protocol: string; endpoint: string; model: string; apiKey: string; clearApiKey: boolean; models: string[];
}
export interface AiBinding { featureId: string; label: string; providerId: string | null; model: string; enabled: boolean; }
export interface AiSettings {
  bindings: AiBinding[]; activeProviderId: string | null; providers: AiProvider[];
  protocols: { id: string; label: string; endpointPlaceholder: string }[];
  labels: Record<string, string>;
}
export const adminService = {
  getAiSettings: (locale: SupportedLocale) => request<AiSettings>("/admin/ai-settings", { locale }),
  upsertAiProvider: (settings: AiProviderInput, locale: SupportedLocale) =>
    request<AiSettings>("/admin/ai-settings/providers", { method: "POST", locale, body: JSON.stringify(settings) }),
  updateAiBinding: (binding: Omit<AiBinding, "label">, locale: SupportedLocale) =>
    request<AiSettings>("/admin/ai-settings/bindings", { method: "PUT", locale, body: JSON.stringify(binding) }),
  selectAiProvider: (providerId: string | null, locale: SupportedLocale) =>
    request<AiSettings>("/admin/ai-settings/active", { method: "PUT", locale, body: JSON.stringify({ providerId }) }),
  deleteAiProvider: (id: string, locale: SupportedLocale) =>
    request<AiSettings>('/admin/ai-settings/providers/' + encodeURIComponent(id), { method: "DELETE", locale }),
  getOverview: () => request<AdminOverview>("/admin/overview"),
  getOverviewAnalytics: (days: number, timeZone: string, signal?: AbortSignal) => request<AdminAnalytics>(`/admin/overview/analytics?${new URLSearchParams({ days: String(days), timeZone })}`, { signal }),
  restoreHistory: (page: number, status: string, signal?: AbortSignal) => request<RestoreHistoryPage>("/admin/backups/restore/history?"+new URLSearchParams({page:String(page),status}), {signal}),
  restoreOverview: () => request<RestoreOverview>("/admin/backups/restore"),
  preflightRestore: (id: string, signal?: AbortSignal) => request<RestorePreview>(`/admin/backups/${encodeURIComponent(id)}/preflight`, {method:"POST",body:"{}",signal}),
  restoreBackup: (token: string, confirmation: string) => request<RestoreState>("/admin/backups/restore", {method:"POST",body:JSON.stringify({token,confirmation})}),
  listBackups: (page: number, source: string, status: string, verification = "") => request<BackupPage>("/admin/backups?" + new URLSearchParams({page:String(page),source,status,verification})),
  verifyBackup: (id: string) => request<BackupRecord>(`/admin/backups/${id}/verify`, {method:"POST",body:"{}"}),
  createBackup: () => request<BackupRecord>("/admin/backups", {method:"POST",body:"{}"}),
  saveBackupPolicy: (policy: BackupPolicy) => request<BackupSchedule>("/admin/backups/policy", {method:"PUT",body:JSON.stringify(policy)}),
  deleteBackup: (id: string) => request<void>(`/admin/backups/${encodeURIComponent(id)}`, {method:"DELETE"}),
  downloadBackup: (id: string, signal?: AbortSignal) => request<Blob>(`/admin/backups/${encodeURIComponent(id)}/download`, {responseType:"blob",signal}),
  getRuntimeHealth: () => request<RuntimeHealth>("/admin/runtime-health"),
  exportAuditEvents: (filters: Record<string,string>, locale: SupportedLocale, signal?:AbortSignal) => request<Blob>("/admin/audit-events/export?" + new URLSearchParams({...filters,locale}), {responseType:"blob", signal, locale}),
  getRuntimeSettings: () => request<RuntimeSettings>("/admin/runtime-settings"),
  updateRuntimeSettings: (settings: { scheme: "http" | "https"; listenAddress: string; port: number; customer?: WebListenerSettings; admin?: WebListenerSettings }) =>
    request<RuntimeSettings>("/admin/runtime-settings", { method: "PUT", body: JSON.stringify(settings) }),
  restartPlatform: () =>
    request<RuntimeAction>("/admin/runtime-actions/restart", { method: "POST", body: JSON.stringify({}) }),
  shutdownPlatform: () =>
    request<RuntimeAction>("/admin/runtime-actions/shutdown", { method: "POST", body: JSON.stringify({}) }),
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
  updateWorkflow: (id: string, workflowStatus: WorkflowStatus, priority: ProjectPriority, expectedWorkflowUpdatedAt: string, assigneeUserId?: string) =>
    request<AdminProjectDetail>(`/admin/projects/${encodeURIComponent(id)}/workflow`, { method: "PUT", body: JSON.stringify({ workflowStatus, priority, assigneeUserId: assigneeUserId || null, expectedWorkflowUpdatedAt }) }),
  addNote: (id: string, body: string) =>
    request(`/admin/projects/${encodeURIComponent(id)}/notes`, { method: "POST", body: JSON.stringify({ body }) }),
  listDeliveries: (id: string) => request<FinalDelivery[]>(`/admin/projects/${encodeURIComponent(id)}/deliveries`),
  getDeliveryUpload: (id: string, uploadId: string) => request<{ recorded: boolean; delivery?: FinalDelivery }>(`/admin/projects/${encodeURIComponent(id)}/deliveries/uploads/${encodeURIComponent(uploadId)}`),
  publishFinalDelivery: (id: string, file: File, note: string, options?: UploadOptions) => {
    const body = new FormData();
    body.append("file", file);
    body.append("note", note);
    if (options?.uploadId) body.append("uploadId", options.uploadId);
    return upload<FinalDelivery>(`/admin/projects/${encodeURIComponent(id)}/deliveries`, body, options);
  },
  revokeFinalDelivery: (projectId: string, deliveryId: string) =>
    request<void>(`/admin/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(deliveryId)}`, { method: "DELETE" }),
  listAssignees: () => request<AdminUser[]>("/admin/assignees"),
  listUsers: ({ search, role, status, organization, enabled, todayStart, assignableOnly, page = 1, pageSize = 20 }: AdminUserListQuery = {}) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) query.set("search", search);
    if (role) query.set("role", role);
    if (status) query.set("status", status);
    if (organization) query.set("organization", organization);
    if (enabled) query.set("enabled", enabled);
    if (todayStart) query.set("todayStart", todayStart);
    if (assignableOnly) query.set("assignableOnly", "true");
    return request<AdminUserDirectory>(`/admin/users?${query}`);
  },
  accountClosurePreview: (id:string) => request<{email:string;updatedAt:string;ownedProjects:number;assignedProjects:number}>(`/admin/users/${encodeURIComponent(id)}/closure`),
  closeAccount: (id:string,confirmEmail:string,expectedUpdatedAt:string) => request<void>(`/admin/users/${encodeURIComponent(id)}`,{method:"DELETE",body:JSON.stringify({confirmEmail,expectedUpdatedAt})}),
  userDetails: (id: string) => request<AdminUserDetails>(`/admin/users/${encodeURIComponent(id)}/details`),
  listRoles: (locale: SupportedLocale) => request<ConfigOption[]>("/admin/roles", { locale }),
  createUser: (account: { displayName: string; email: string; phone?: string; password: string; role: "customer" | "admin" | "operator"; organizationId?: string }) =>
    request<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(account) }),
  updateUser: (id: string, account: { displayName: string; phone?: string; role: "owner" | "customer" | "admin" | "operator"; active: boolean; organizationId?: string }) =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(account) }),
  resetUserPassword: (id: string, newPassword: string) =>
    request<void>(`/admin/users/${encodeURIComponent(id)}/password`, { method: "PUT", body: JSON.stringify({ newPassword }) }),
  listOrganizations: ({ search, page = 1, pageSize = 20, purpose }: AdminOrganizationListQuery & { purpose?: "announcement" } = {}) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) query.set("search", search);
    if (purpose) query.set("purpose", purpose);
    return request<PagedResult<AdminOrganization>>(`/admin/organizations?${query}`);
  },
  createOrganization: (name: string) =>
    request<AdminOrganization>("/admin/organizations", { method: "POST", body: JSON.stringify({ name }) }),
  updateOrganization: (id: string, value: { name: string; active: boolean }) =>
    request<AdminOrganization>(`/admin/organizations/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(value) }),
  removeFileCategory: (item: AdminFileCategory) => request<void>(`/admin/file-categories/${encodeURIComponent(item.scope)}/${encodeURIComponent(item.id)}?expectedUpdatedAt=${encodeURIComponent(item.updatedAt ?? "")}`, { method: "DELETE" }),
  removeCharacterPreset: (item: AdminCharacterPreset) => request<void>(`/admin/character-presets/${encodeURIComponent(item.id)}?expectedUpdatedAt=${encodeURIComponent(item.updatedAt ?? "")}`, { method: "DELETE" }),
  removeVoiceReference: (item: AdminVoiceReference) => request<void>(`/admin/voices/${encodeURIComponent(item.id)}?expectedUpdatedAt=${encodeURIComponent(item.updatedAt ?? "")}`, { method: "DELETE" }),
  listCharacterPresets: () => request<AdminCharacterPreset[]>("/admin/character-presets"),
  saveCharacterPreset: (preset: AdminCharacterPreset) => request<AdminCharacterPreset>(`/admin/character-presets/${encodeURIComponent(preset.id)}`, { method: "PUT", body: JSON.stringify({ zhCn: preset.zhCn, enUs: preset.enUs, enabled: preset.enabled, sortOrder: preset.sortOrder, expectedUpdatedAt: preset.updatedAt }) }),
  uploadCharacterPresetImage: (preset: AdminCharacterPreset, file: File) => {
    const body = new FormData(); body.append("file", file); body.append("expectedUpdatedAt", preset.updatedAt ?? "");
    return request<AdminCharacterPreset>(`/admin/character-presets/${encodeURIComponent(preset.id)}/image`, { method: "POST", body });
  },
  listProjectVoiceReferences: (id: string) => request<AdminVoiceReference[]>(`/admin/projects/${encodeURIComponent(id)}/voices`),
  listVoiceReferences: () => request<AdminVoiceReference[]>("/admin/voices"),
  listSupportedFileContentTypes: () => request<string[]>("/admin/file-content-types"),
  listFileCategories: (scope: "source" | "reference") => request<AdminFileCategory[]>(`/admin/file-categories/${scope}`),
  saveFileCategory: (category: AdminFileCategory) => {
    const { updatedAt, ...payload } = category;
    return request<AdminFileCategory>(`/admin/file-categories/${category.scope}/${encodeURIComponent(category.id)}`, { method: "PUT", body: JSON.stringify({ ...payload, expectedUpdatedAt: updatedAt }) });
  },
  listFormOptionGroups: (locale: SupportedLocale) => request<FormOptionSection[]>("/admin/form-option-groups", { locale }),
  listFormOptions: (groupId: string) => request<AdminFormOption[]>(`/admin/form-options/${encodeURIComponent(groupId)}`),
  removeFormOption: (option: AdminFormOption) => request<void>(`/admin/form-options/${encodeURIComponent(option.groupId)}/${encodeURIComponent(option.id)}?expectedUpdatedAt=${encodeURIComponent(option.updatedAt ?? "")}`, { method: "DELETE" }),
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

export interface RevisionReason { unit: string; body: string }
export interface RevisionMessage { id: string; unit: string; body: string; authorId: string; authorName: string; avatarUrl?: string; isAdmin: boolean; createdAt: string }
export interface RevisionRound { id: string; createdAt: string; submittedAt?: string; reasons: RevisionReason[]; messages: RevisionMessage[]; beforeSnapshot?: string; afterSnapshot?: string }
export interface RevisionView { canEdit?: boolean; units: {id: string; label: string}[]; rounds: RevisionRound[]; hasMore: boolean; labels: Record<string,string> }
export const revisionService = {
  get: (id: string, locale: SupportedLocale, admin = false, page = 1) => request<RevisionView>(`/${admin ? "admin/" : ""}projects/${encodeURIComponent(id)}/revisions?page=${page}`, { locale }),
  returnProject: (id: string, version: number, reasons: RevisionReason[], locale: SupportedLocale, expectedWorkflowUpdatedAt: string) => request<RevisionView>(`/admin/projects/${encodeURIComponent(id)}/return`, { method: "POST", locale, body: JSON.stringify({version, reasons, expectedWorkflowUpdatedAt}) }),
  reply: (id: string, round: string, message: {id:string; unit:string; body:string}, locale: SupportedLocale, admin = false) => request<RevisionView>(`/${admin ? "admin/" : ""}projects/${encodeURIComponent(id)}/revisions/${encodeURIComponent(round)}/messages`, { method: "POST", locale, body: JSON.stringify(message) }),
};

export const announcementService = {
  jobs: (page=1, locale: SupportedLocale="zh-CN") => request<import("@lifewood/domain").AnnouncementJobsPage>(`/admin/announcements/jobs?page=${page}`,{locale}),
  schedule: (id:string,version:number,runAt:string) => request<import("@lifewood/domain").AnnouncementDocument>(`/admin/announcements/${id}/schedule`,{method:"POST",body:JSON.stringify({version,runAt})}),
  cancelSchedule: (id:string,version:number) => request<import("@lifewood/domain").AnnouncementDocument>(`/admin/announcements/${id}/cancel-schedule`,{method:"POST",body:JSON.stringify({version})}),
  banner: (locale: SupportedLocale) => request<import("@lifewood/domain").AnnouncementFeed>("/announcements/banner", { locale }),
  preview: (id: string, version: number) => request<{count: number | null}>(`/admin/announcements/${id}/preview?version=${version}`),
  deleteDraft: (id: string, version: number) => request<void>(`/admin/announcements/${id}?version=${version}`, {method:"DELETE"}),
  dismissMany: (ids: string[]) => request<void>("/announcements/dismiss", { method: "POST", body: JSON.stringify({ids}) }),
  feed: (locale: SupportedLocale, before?: number, unread = false, publicOnly = false) => request<import("@lifewood/domain").AnnouncementFeed>(`/announcements${publicOnly ? "/public" : ""}?unread=${unread}${before ? `&before=${before}` : ""}`, { locale }),
  dismiss: (id: string) => request<void>(`/announcements/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
  list: (search: string, before?: number, status = "", placement = "") => request<import("@lifewood/domain").AnnouncementPage>(`/admin/announcements?status=${encodeURIComponent(status)}&placement=${encodeURIComponent(placement)}&search=${encodeURIComponent(search)}${before ? `&before=${before}` : ""}`),
  save: (id: string, content: import("@lifewood/domain").AnnouncementInput) => request<import("@lifewood/domain").AnnouncementDocument>(`/admin/announcements/${id}`, {method:"PUT", body:JSON.stringify(content)}),
  transition: (id: string, version: number, action: "publish" | "withdraw") => request<import("@lifewood/domain").AnnouncementDocument>(`/admin/announcements/${id}/${action}`, {method:"POST",body:JSON.stringify({version})}),
};

export interface NotificationItem { id:number;kind:string;projectId:string;projectTitle:string;actor:string;createdAt:string;read:boolean;archived:boolean;state:string;targetId:string;title:string;level:string }
export interface NotificationPage {items:NotificationItem[];nextCursor:number|null;watermark:number;unread:number}
export interface NotificationRule {kind:string;titleZh:string;titleEn:string;level:string;enabled:boolean;allowMute:boolean;audience:string;version:number}
export interface NotificationRules {items:NotificationRule[];retentionDays:number}
export interface NotificationPreferences {toast:boolean;sound:boolean;quietStart:string|null;quietEnd:string|null;timeZone:string;mutedKinds:string[]|null}
export interface NotificationLog {id:number;kind:string;projectId:string;createdAt:string;status:string;attempts:number;recipients:number;error:string|null}
export const notificationService={
 target:(id:number,locale:SupportedLocale,admin:boolean,signal?:AbortSignal)=>request<{path:string}>(`/notifications/${id}/target?admin=${admin}`,{locale,signal}),
 list:(locale:SupportedLocale,params:Record<string,string>={},before?:number)=>request<NotificationPage>(`/notifications?${new URLSearchParams({...params,...(before?{before:String(before)}:{})})}`,{locale}),
 counts:()=>request<{unread:number;watermark:number}>("/notifications/counts"),
 update:(action:string,ids?:number[],through?:number,signal?:AbortSignal)=>request<void>("/notifications/state",{method:"POST",signal,body:JSON.stringify({action,ids,through})}),
 preferences:()=>request<NotificationPreferences>("/notifications/preferences"),
 savePreferences:(p:NotificationPreferences)=>request<NotificationPreferences>("/notifications/preferences",{method:"PUT",body:JSON.stringify(p)}),
 catalog:()=>request<NotificationRules>("/notifications/catalog"),
 rules:()=>request<NotificationRules>("/admin/notifications/rules"),
 saveRule:(r:NotificationRule)=>request<NotificationRules>("/admin/notifications/rules",{method:"PUT",body:JSON.stringify(r)}),
 retention:(days:number)=>request<void>("/admin/notifications/retention",{method:"PUT",body:JSON.stringify({days})}),
 logs:(before?:number)=>request<{items:NotificationLog[];nextCursor:number|null;pending:number;failed:number}>(`/admin/notifications/logs${before?`?before=${before}`:""}`),
 retry:(id:number)=>request<void>(`/admin/notifications/retry/${id}`,{method:"POST"}),
};

export interface Followup { dueAt: string | null; version: number }
export interface Workbench {
  queues: { id: string; label: string; count: number }[];
  items: { id: string; taskNumber?: string; projectName: string; bookTitle: string; ownerName: string; assigneeName?: string; workflowStatus: string; priority: string; status: string; dueAt?: string; updatedAt: string }[];
  page: number; pageSize: number; total: number; serverTime: string;
}
export const operationsService = {
  workbench: (query: {queue: string; search: string; mine: boolean; page: number}, locale: SupportedLocale, signal?: AbortSignal) =>
    request<Workbench>("/admin/workbench?" + new URLSearchParams({...query, mine:String(query.mine), page:String(query.page)}), {locale, signal}),
  followup: (id: string, signal?: AbortSignal) => request<Followup>(`/admin/projects/${encodeURIComponent(id)}/followup`, {signal}),
  saveFollowup: (id: string, dueAt: string | null, expectedVersion: number) => request<Followup>(`/admin/projects/${encodeURIComponent(id)}/followup`, {method:"PUT", body:JSON.stringify({dueAt,expectedVersion})}),
  export: (id: string, locale: SupportedLocale, signal: AbortSignal) => request<Blob>(`/admin/projects/${encodeURIComponent(id)}/export`, {method:"POST", locale, signal, responseType:"blob"}),
};

export const presenceService = {
  heartbeat: (userId:string, data:{tabId:string;visible:boolean;interacted:boolean}, signal?:AbortSignal) => {
    if(boundAccount && boundAccount!==userId)return Promise.resolve();
    return request<void>("/me/presence", {method:"POST",headers:{"X-LW-Account":userId},body:JSON.stringify(data),signal});
  },
  leave: (userId:string,tabId:string) => {
    if(boundAccount && boundAccount!==userId)return Promise.resolve();
    return request<void>(`/me/presence?tabId=${encodeURIComponent(tabId)}`,{method:"DELETE",headers:{"X-LW-Account":userId},keepalive:true});
  },
};

export interface SavedView {id:string;area:string;name:string;filters:Record<string,string>;version:number}
export const personalWorkspaceService={
 views:(area:string)=>request<SavedView[]>(`/me/views/${area}`),
 saveView:(area:string,id:string,value:{name:string;filters:Record<string,string>;version:number})=>request<void>(`/me/views/${area}/${id}`,{method:"PUT",body:JSON.stringify(value)}),
 deleteView:(id:string,version:number)=>request<void>(`/me/views/${id}?version=${version}`,{method:"DELETE"}),
 resumeSteps:(ids:string[])=>request<{projectId:string;step:string}[]>(`/me/resume?ids=${encodeURIComponent(ids.join(','))}`),
 saveResume:(id:string,step:string)=>request<void>(`/projects/${id}/resume`,{method:"PUT",body:JSON.stringify({step})}),
};

export interface BatchPreview {id:string;name:string;workflowVersion:string;followupVersion:number}
export interface BatchRequest {action:"priority"|"assign"|"followup";items:Omit<BatchPreview,"name">[];priority?:string;assigneeId?:string|null;dueAt?:string|null}
export const productivityService={
 preview:(ids:string[])=>request<BatchPreview[]>(`/admin/projects/batch-preview?ids=${encodeURIComponent(ids.join(','))}`),
 batch:(value:BatchRequest)=>request<{id:string;outcome:string}[]>("/admin/projects/batch",{method:"POST",body:JSON.stringify(value)}),
 report:(value:{from:string;to:string;offset:number;organization:string;assignee:string})=>request<{days:{date:string;submitted:number;delivered:number;overdue:number}[];serverTime:string}>(`/admin/reports?${new URLSearchParams({...value,offset:String(value.offset)})}`),
};

export interface LoginDevice {id:string;browser:string;platform:string;current:boolean;createdAt?:string;lastSeen?:string;expiresAt:string}
export const loginDeviceService={list:(page:number)=>request<{items:LoginDevice[];page:number;total:number}>(`/me/sessions?page=${page}`),revoke:(id:string)=>request<void>(`/me/sessions/${encodeURIComponent(id)}`,{method:"DELETE"}),revokeOthers:()=>request<void>("/me/sessions/revoke-others",{method:"POST"})};

export interface FeedbackOption {id:string;label:string}
export interface FeedbackCatalog {categories:FeedbackOption[];statuses:FeedbackOption[];screenshotMaxBytes:number;screenshotSourceMaxBytes:number}
export interface FeedbackInput {id:string;category:string;description:string;pagePath:string;screenshotBase64?:string;screenshotType?:string}
export interface FeedbackItem {id:string;category:string;description:string;pagePath:string;status:string;createdAt:string;updatedAt:string;version:number;author:string;email?:string;hasScreenshot:boolean}
export interface FeedbackResponse {body:string;status:string;createdAt:string;author:string}
export interface FeedbackDetail {item:FeedbackItem;responses:FeedbackResponse[]}
export const feedbackService={
 catalog:(locale:SupportedLocale)=>request<FeedbackCatalog>(`/feedback/catalog?locale=${locale}`),
 submit:async(input:FeedbackInput)=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try {
   await Promise.race([
    request<void>("/feedback",{method:"POST",body:JSON.stringify(input),signal:controller.signal}),
    new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new ApiError({code:"feedback.timeout",messageKey:"feedback.timeout",retryable:true}));controller.abort();},30_000);}),
   ]);
  } finally {clearTimeout(timer);}
 },
 list:(page:number,search:string,status:string)=>request<{items:FeedbackItem[];total:number;page:number;pageSize:number}>(`/admin/feedback?${new URLSearchParams({page:String(page),search,status})}`),
 detail:(id:string)=>request<FeedbackDetail>(`/admin/feedback/${encodeURIComponent(id)}`),
 update:(id:string,input:{version:number;status:string;reply?:string})=>request<void>(`/admin/feedback/${encodeURIComponent(id)}`,{method:"PUT",body:JSON.stringify(input)}),
 notice:(id:number)=>request<{description:string;reply:string;status:string}>(`/notifications/${id}/feedback`),
};
