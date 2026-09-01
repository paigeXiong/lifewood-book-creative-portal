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
}

export interface ConfigOption {
  id: string;
  label: string;
  description?: string;
  tone?: "neutral" | "info" | "warning" | "success" | "danger";
  previewColor?: string;
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

export interface AdminFormOption {
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

export interface RuntimeSettings {
  listenAddress: string;
  port: number;
  activeListenAddress: string;
  activePort: number;
  restartRequired: boolean;
  canRestart: boolean;
  canShutdown: boolean;
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


export type AdminRole = "owner" | "admin" | "customer";
export type WorkflowStatus = "new" | "contacting" | "confirmed" | "in_production" | "awaiting_customer" | "completed" | "closed";
export type ProjectPriority = "low" | "normal" | "high" | "urgent";

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
}

export interface AdminOrganization {
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
export interface TaskDraft {
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
