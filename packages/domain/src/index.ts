export { safeLinkUrl } from "./safe-link";
export type SupportedLocale = "zh-CN" | "en-US";

export interface CurrentUser {
  id: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
  phone?: string;
  clientName?: string;
  organization?: { id: string; name: string };
  roles: string[];
  permissions: string[];
  locale?: SupportedLocale;
  timeZone?: string;
  hasCustomAvatar?: boolean;
  taskBackgroundMotion?: boolean;
}

export interface OrganizationMemberProfile {
  id: string;
  displayName: string;
  roleLabel: string;
  organizationName: string;
  avatarUrl: string;
  labels: { name: string; organization: string; role: string };
}
export interface OrganizationMemberActivity {
  calendar: { trackedFrom: string; days: Array<{ date: string; collected: boolean; logins: number; activePeriods: number }> };
  presence: { status: string; lastActiveAt?: string; lastLoginAt?: string };
  presenceLabel: string;
  counts: { submitted: number; inProgress: number; actionRequired: number; completed: number };
  projects: Array<{ id: string; name: string; statusLabel: string; status: string; submittedAt?: string; canOpen: boolean }>;
  total: number;
  page: number;
  pageSize: number;
  labels: Record<string, string>;
}

export interface MyOrganizationPage {
  organization?: { name: string; active: boolean; memberCount: number };
  items: Array<{ id: string; displayName: string; roleLabel: string; active: boolean; isSelf: boolean; avatarUrl: string }>;
  page: number;
  pageSize: number;
  total: number;
  labels: { members: string; search: string; empty: string; unassigned: string; active: string; inactive: string; you: string };
}

export interface ConfigOption {
  id: string;
  label: string;
  description?: string;
  tone?: "neutral" | "info" | "warning" | "success" | "danger";
  previewColor?: string;
  previewImageUrl?: string;
  previewVideoUrl?: string;
  allowsCustomValue?: boolean;
}

export interface ReferenceCategory extends ConfigOption {
  accept: string[];
  maxBytes: number;
  maxFiles: number;
  allowsUrl: boolean;
  required: boolean;
}

export interface VoiceReference {
  id: string;
  name: string;
  description: string;
  audioUrl?: string;
  tagIds: string[];
  recommended: boolean;
  enabled: boolean;
}

export interface AdminVoiceReference {
  id: string;
  nameZhCn: string;
  nameEnUs: string;
  descriptionZhCn: string;
  descriptionEnUs: string;
  audioUrl: string | null;
  tagIds: string[];
  recommended: boolean;
  enabled: boolean;
  sortOrder: number;
  updatedAt: string | null;
}

export interface AdminFileCategory {
  scope: "source" | "reference";
  id: string;
  labelZhCn: string;
  labelEnUs: string;
  descriptionZhCn?: string;
  descriptionEnUs?: string;
  accept: string[];
  maxBytes: number;
  maxFiles: number;
  allowsUrl: boolean;
  required: boolean;
  enabled: boolean;
  sortOrder: number;
  updatedAt?: string;
}

export interface FormOptionSection {
  id: string;
  label: string;
  groups: { id: string; label: string }[];
}

export interface AdminFormOption {
  previewImageUrl?: string;
  previewVideoUrl?: string;
  groupId: string;
  id: string;
  labelZhCn: string;
  labelEnUs: string;
  descriptionZhCn?: string;
  descriptionEnUs?: string;
  tone?: "neutral" | "info" | "warning" | "success" | "danger";
  previewColor?: string;
  allowsCustomValue?: boolean;
  enabled: boolean;
  sortOrder: number;
  updatedAt?: string;
}

export interface WebListenerSettings {
  scheme: "http" | "https";
  listenAddress: string;
  port: number;
  shared: boolean;
}
export interface RuntimeSettings {
  scheme: "http" | "https";
  listenAddress: string;
  port: number;
  activeScheme: "http" | "https";
  activeListenAddress: string;
  activePort: number;
  restartRequired: boolean;
  canRestart: boolean;
  canShutdown: boolean;
  customer?: WebListenerSettings;
  admin?: WebListenerSettings;
  activeCustomer?: WebListenerSettings;
  activeAdmin?: WebListenerSettings;
  externalFrontends?: boolean;
}

export interface RuntimeAction {
  action: "restart" | "shutdown";
  requestedAt: string;
}


export interface FormOptions {
  brands: ConfigOption[];
  videoGoals: ConfigOption[];
  audiences: ConfigOption[];
  genres: ConfigOption[];
  contentLanguages: ConfigOption[];
  videoDurations: ConfigOption[];
  publishingPlatforms: ConfigOption[];
  taskStatuses: ConfigOption[];
  roleTypes: ConfigOption[];
  ageRanges: ConfigOption[];
  genders: ConfigOption[];
  visualStyles: ConfigOption[];
  moodTags: ConfigOption[];
  imageStyleTags: ConfigOption[];
  /** Display-only labels for retired selections; never offer as new choices. */
  legacyImageStyleTags?: ConfigOption[];
  bookRecognitionEnabled?: boolean;
  projectCopyEnabled?: boolean;
  paceTags: ConfigOption[];
  narrationTones: ConfigOption[];
  speechRates: ConfigOption[];
  voiceGenders: ConfigOption[];
  voiceAges: ConfigOption[];
  accents: ConfigOption[];
  voiceEmotions: ConfigOption[];
  voiceTags: ConfigOption[];
  sourceCategories: ReferenceCategory[];
  referenceCategories: ReferenceCategory[];
  maxSelectedVoices: number;
  workflowStatuses: ConfigOption[];
  projectPriorities: ConfigOption[];
}

export interface UploadReferenceResult {
  draft: TaskDraft;
  asset: ReferenceAsset;
}

export interface ProjectInfo {
  clientName: string;
  contactName: string;
  email: string;
  phone?: string;
  brandId?: string;
  projectName: string;
  videoGoalId?: string;
  deadline?: string;
  audienceIds: string[];
}

export interface BookInfo {
  title: string;
  subtitle?: string;
  authorName: string;
  genreId?: string;
  sellingPoint: string;
  synopsis: string;
  contentLanguageId?: string;
  videoDurationId?: string;
  customVideoDuration?: string;
  publishingPlatformIds: string[];
  sourceAssets: ReferenceAsset[];
}

export interface CharacterInfo {
  presetId?: string;
  presetImageUrl?: string;
  id: string;
  roleTypeId?: string;
  name: string;
  storyRole: string;
  personality: string;
  appearance: string;
  ageRangeId?: string;
  genderId?: string;
  clothing?: string;
  emotion?: string;
  voiceHint?: string;
  referenceImageUrls: string[];
  referenceImages: ReferenceAsset[];
}

export interface CreativeInfo {
  characters: CharacterInfo[];
  visualStyleId?: string;
  moodTagIds: string[];
  imageStyleTagIds: string[];
  paceTagIds: string[];
  styleReferenceImageUrls: string[];
  styleReferenceImages: ReferenceAsset[];
}

export interface ReferenceAsset {
  id: string;
  categoryId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  url: string;
}

export interface VoiceoverInfo {
  narrationEnabled?: boolean | null;
  contentLanguageId?: string;
  narrationToneId?: string;
  speechRateId?: string;
  pronunciationNotes?: string;
  voiceGenderId?: string;
  voiceAgeId?: string;
  accentId?: string;
  emotionStyleId?: string;
  selectedVoiceIds: string[];
  preferredVoiceId?: string;
  customVoiceDescription?: string;
}

// Legacy projects did not store a choice. Only narration-specific settings
// imply opt-in; a prefilled book language alone does not.
export function getNarrationEnabled(voice: VoiceoverInfo): boolean | undefined {
  if (typeof voice.narrationEnabled === "boolean") return voice.narrationEnabled;
  return [voice.narrationToneId, voice.speechRateId, voice.pronunciationNotes,
    voice.voiceGenderId, voice.voiceAgeId, voice.accentId, voice.emotionStyleId,
    voice.preferredVoiceId, voice.customVoiceDescription].some((value) => value?.trim())
    || voice.selectedVoiceIds.length > 0 ? true : undefined;
}

export function normalizeNarration(voice: VoiceoverInfo): VoiceoverInfo {
  const narrationEnabled = getNarrationEnabled(voice);
  return narrationEnabled === false
    ? { narrationEnabled: false, selectedVoiceIds: [] }
    : { ...voice, narrationEnabled };
}

export interface CreativeDirectionInfo {
  coreMessage: string;
  requiredScenes?: string;
  authorPreferences?: string;
  closingMessage?: string;
  musicMood?: string;
  avoidContent?: string;
}

export interface VoiceAndReferencesInfo {
  voiceover: VoiceoverInfo;
  assets: ReferenceAsset[];
  competitorUrls: string[];
  creativeDirection: CreativeDirectionInfo;
}


export type AdminRole = "owner" | "admin" | "operator" | "customer";
export type WorkflowStatus = "new" | "contacting" | "confirmed" | "in_production" | "awaiting_customer" | "completed" | "closed";
export type ProjectPriority = "low" | "normal" | "high" | "urgent";

export interface UserPresence { status: "online" | "away" | "offline"; lastActiveAt?: string; lastLoginAt?: string }
export interface UserPresenceStats { online: number; todayActive: number; enabled: number; unassigned: number }
export interface AdminUserDirectory extends PagedResult<AdminUser> { statistics?: UserPresenceStats }
export interface AdminUserDetails { user: AdminUser; submittedProjects: number; pendingProjects: number }

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  phone?: string;
  role: AdminRole;
  active: boolean;
  organization?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  presence?: UserPresence;
}

export interface AdminOrganization {
  avatarUrl?: string;
  id: string;
  name: string;
  active: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProjectSummary {
  id: string;
  taskNumber?: string;
  projectName: string;
  clientName: string;
  bookTitle: string;
  authorName: string;
  coverUrl?: string;
  submissionStatus: string;
  workflowStatus: WorkflowStatus;
  priority: ProjectPriority;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  assigneeUserId?: string;
  assigneeName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCountMetric {
  id: string;
  count: number;
}

export interface AdminOverview {
  totalProjects: number;
  unassignedProjects: number;
  totalUsers: number;
  activeUsers: number;
  submissionStatuses: AdminCountMetric[];
  workflowStatuses: AdminCountMetric[];
  priorities: AdminCountMetric[];
}

export interface AdminAnalytics {
  days: number; timeZone: string; generatedAt: string; trackingStartedAt: string;
  submitted: number; completed: number; durationSamples: number; averageDays?: number | null; medianDays?: number | null;
  untrackedCompleted: number; queues: AdminCountMetric[]; aging: AdminCountMetric[];
  trend: Array<{ date: string; submitted: number; completed: number }>;
}

export interface AuditEvent {
  id: string;
  actorUserId: string;
  actorName: string;
  actorEmail: string;
  actionId: string;
  targetType: string;
  targetId?: string;
  occurredAt: string;
  traceId: string;
  context?: { labelZh?: string; labelEn?: string; source: "recorded" | "current" | "unavailable"; path?: string; changes?: Array<{field:string;before?:string;after?:string}> };
}

export interface FinalDelivery {
  id: string;
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  note?: string;
  publishedAt: string;
  revokedAt?: string;
}

export interface AdminNote {
  id: string;
  projectId: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface AdminProjectDetail {
  project: TaskDraft;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  workflowStatus: WorkflowStatus;
  priority: ProjectPriority;
  assigneeUserId?: string;
  assigneeName?: string;
  workflowUpdatedAt: string;
  notes: AdminNote[];
}
export interface ProjectCreator { id: string; displayName: string; avatarUrl: string }

export interface TaskDraft {
  creator?: ProjectCreator;
  canEdit?: boolean;
  id: string;
  taskNumber?: string;
  status: string;
  version: number;
  project: ProjectInfo;
  book: BookInfo;
  creative: CreativeInfo;
  voiceAndReferences: VoiceAndReferencesInfo;
  createdAt: string;
  updatedAt: string;
  workflowStatus?: WorkflowStatus;
}

export interface TaskSummary {
  creator?: ProjectCreator;
  canEdit?: boolean;
  id: string;
  taskNumber?: string;
  version: number;
  projectName: string;
  clientName: string;
  bookTitle: string;
  authorName: string;
  coverUrl?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  workflowStatus?: WorkflowStatus;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProjectStats {
  total: number;
  drafts: number;
  active: number;
  completed: number;
  actionRequired: number;
}

export interface ProjectValidationResult {
  valid: boolean;
  fieldErrors: Array<{ field: string; code: string; messageKey?: string }>;
}

export interface AppErrorShape {
  code: string;
  messageKey?: string;
  fallbackMessage?: string;
  fieldErrors?: Array<{ field: string; code: string; messageKey?: string }>;
  retryable: boolean;
  requestId?: string;
  currentVersion?: number;
}

export interface BookRecognition { title: string; authorName: string; subtitle: string; genreId: string; sellingPoint: string; synopsis: string; }

export interface AdminCharacterPreset {
  id: string; zhCn: CharacterInfo; enUs: CharacterInfo; imageUrl?: string | null;
  enabled: boolean; sortOrder: number; updatedAt: string | null;
}

export interface AnnouncementInput { displayDays?: number | null; title?: string; body?: string; titleZh?: string; bodyZh?: string; titleEn?: string; bodyEn?: string; placement: "login" | "personal" | "banner"; audience: "all" | "specified"; languages: string[]; organizationIds: string[]; startsAt: string | null; endsAt: string | null; version: number }
export interface AnnouncementDocument { scheduledAt?: string; id: string; sequence: number; content: AnnouncementInput; status: "draft" | "published" | "withdrawn" | "scheduled"; version: number; createdAt: string; recipients: number }
export interface AnnouncementItem { id: string; sequence: number; title: string; body: string; publishedAt: string; dismissed: boolean; popup: boolean; banner?: boolean }
export interface AnnouncementFeed { items: AnnouncementItem[]; nextCursor: number | null }
export interface AnnouncementPage { items: AnnouncementDocument[]; nextCursor: number | null }

export interface RuntimeHealth { startedAt:string; measuredAt?:string; databaseAvailable?:boolean; usedBytes?:number; uploadBytes?:number; deliveryBytes?:number; freeBytes?:number; quotaBytes:number; failedNotifications?:number; pendingAudit?:boolean; storageComplete:boolean; databaseBytes?:number; avatarBytes?:number; otherBytes?:number; backupBytes?:number; }

export interface BackupPolicy { enabled: boolean; frequency: "daily" | "weekly"; hour: number; dayOfWeek: number; timeZoneId: "Asia/Shanghai" | "UTC"; retainDays: number; retainCount: number; }
export interface BackupRecord { id: string; createdAt: string; source: "manual" | "scheduled" | "safety"; status: string; size?: number; fileCount?: number; errorCode?: string; verificationStatus?: string; verifiedAt?: string; }
export interface BackupSchedule { policy: BackupPolicy; nextRunAt?: string; }
export interface BackupPage { items: BackupRecord[]; page: number; pageSize: number; total: number; schedule: BackupSchedule; current?: BackupRecord; paused: boolean; verificationFilters?: { value: string; messageKey: string }[]; }

export interface RestorePreview { token: string; backupId: string; createdAt: string; fileCount: number; expandedSize: number; expiresAt: string; }
export interface RestoreState { id: string; backupId: string; status: string; updatedAt: string; safetyBackupId?: string; errorCode?: string; }
export interface RestoreOverview { available: boolean; current?: RestoreState; unavailableReason?: string; }

export interface RestoreHistoryItem { id: string; startedAt: string; updatedAt: string; backupCreatedAt?: string; actorName?: string; status: string; errorCode?: string; safetyBackup?: BackupRecord; }
export interface RestoreHistoryPage { items: RestoreHistoryItem[]; page: number; pageSize: number; total: number; incomplete: boolean; statuses: {value: string; messageKey: string}[]; }

export interface DashboardProject { id: string; projectName: string; bookTitle: string; taskNumber?: string; status: string; workflowStatus: string; updatedAt: string }
export interface DashboardDay { date: string; submissions: number; resubmissions: number; deliveries: number; projects: number }
export interface CustomerDashboard {
  month: string; timeZone: string; historyCompleteFrom: string; generatedAt: string;
  counts: { total: number; actionRequired: number; active: number; downloadable: number };
  statuses: Array<{ id: string; count: number }>;
  days: DashboardDay[];
  activities: PagedResult<{ id: string; kind: "submission" | "resubmission" | "delivery"; occurredAt: string; project: DashboardProject }>;
  recentProjects: DashboardProject[];
}

export interface AnnouncementJob {id:string;announcementId:string;title:string;status:"pending"|"completed"|"cancelled"|"failed";runAt:string;finishedAt?:string;errorCode?:string}
export interface AnnouncementJobsPage {items:AnnouncementJob[];page:number;total:number;pending:number;nextRunAt?:string}
