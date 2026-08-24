import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { SupportedLocale } from "@lifewood/domain";

export const supportedLocales = ["zh-CN", "en-US"] as const;

export function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return supportedLocales.includes(value as SupportedLocale);
}

const resources = {
  "zh-CN": {
    translation: {
      app: { name: "Lifewood AIGC Story Studio", ...(import.meta.env.DEV ? { testEnvironment: "本地测试环境" } : {}) },
      nav: { tasks: "我的书籍视频项目", language: "语言", logout: "退出登录", skipToContent: "跳到主要内容" },
      auth: {
        externalMissing: "尚未配置正式登录系统，请联系管理员。",
        ...(import.meta.env.DEV ? {
        title: "选择本地测试身份",
        description: "此入口仅用于本地开发，不会进入正式发布版本。",
        continueAs: "以 {{name}} 身份继续",
        signingIn: "正在登录…",
        noUsers: "没有可用的本地测试身份，请检查测试服务配置。",
        } : {}),
      },
      common: {
        createTask: "创建书籍视频项目",
        creating: "正在创建项目…",
        saveDraft: "保存草稿",
        saving: "正在保存…",
        saved: "已保存",
        retry: "重试",
        reload: "重新载入",
        back: "返回",
        continue: "保存并继续",
        loading: "正在加载…",
        all: "全部",
        previous: "上一页",
        next: "下一页",
        pageOf: "第 {{page}} 页，共 {{pages}} 页",
      },
      errors: { requestId: "请求编号：{{id}}", auth: { unauthorized: "请先登录。", forbidden: "当前账号没有此操作权限。", unknownUser: "测试用户不存在。" }, project: { notFound: "项目不存在或无权访问。", notEditable: "项目资料已提交，不能再修改。", versionConflict: "项目草稿已在别处更新，请重新载入。" }, validation: { failed: "部分字段无效，请检查后重试。", required: "缺少必需数据。", max_length: "内容过长。", email: "邮箱格式无效。", date: "日期格式无效。", past_date: "日期不能早于今天。", unknown_option: "包含无效选项。", too_many: "选择或添加的项目过多。", invalid: "数据格式无效。", url: "素材地址无效。", file: "文件格式或大小不符合当前类别的要求，请重新选择。" }, system: { unexpected: "系统暂时无法完成请求，请稍后重试。" }, http: { notFound: "接口不存在。" } },
      tasks: {
        searchLabel: "搜索书籍视频项目",
        searchPlaceholder: "项目名、书名或作者",
        searchAction: "搜索",
        filterLabel: "项目状态",
        emptyTitle: "还没有书籍视频项目",
        emptyDescription: "创建第一个书籍视频项目，向制作团队提交书籍资料、创意方向和参考素材。",
        columns: { project: "项目", book: "书籍", status: "状态", updated: "最近更新", action: "操作" },
        continueEditing: "继续填写",
        view: "查看项目提交记录",
        count: "共 {{count}} 项",
      },
      taskDetail: { title: "项目提交记录", project: "项目资料", book: "书籍资料", creative: "角色与视觉方向", voice: "配音与参考资料", direction: "制作要求", sourceFiles: "书籍文件与源材料", referenceFiles: "参考文件", referenceLinks: "参考链接", preferredVoice: "首选参考音色", selectedVoices: "候选参考音色", character: "角色 {{index}}", taskNumber: "项目编号", created: "创建时间", updated: "提交时间" },
      review: { intro: "请最后核对项目资料包。提交后，制作团队将以当前资料开展后续工作。", edit: "修改", packageCount: "{{files}} 个文件 · {{links}} 个链接", noticeTitle: "提交后资料将锁定", noticeBody: "确认资料准确后再提交。如需调整，请先返回对应部分。", submit: "提交给制作团队", submitting: "正在校验并提交…", validationTitle: "还有资料需要补充", validationBody: "测试服务完成了最终检查，请返回对应部分处理后再次提交。", validationCount: "{{count}} 项" },
      submitted: { title: "项目资料已提交", body: "制作团队已经收到当前版本的项目资料包。该记录现已锁定，您可以随时返回查看。", submittedAt: "提交时间", files: "文件数量", links: "参考链接", viewRecord: "查看提交记录", backToProjects: "返回项目列表", nextTitle: "接下来", nextBody: "制作团队将根据提交的书籍、创意方向和参考资料开展后续沟通。如需变更，请通过约定的项目沟通渠道联系团队。" },
      wizard: {
        stepProgress: "第 {{current}} 步，共 {{total}} 步",
        steps: { project: "项目资料与书籍", characters: "角色、标签与视觉风格", voice: "配音、参考素材与制作要求", review: "确认提交资料包" },
        projectIntro: "填写书籍视频项目的基础信息、书籍资料和传播目标，帮助制作团队理解项目。",
        sections: { project: "项目与客户", book: "书籍信息", sources: "书籍文件与源材料" },
        fields: {
          clientName: "客户名称", contactName: "联系人", email: "邮箱", phone: "电话",
          brand: "品牌或业务分支", projectName: "项目名称", videoGoal: "视频目标",
          deadline: "截止时间", audiences: "目标受众", bookTitle: "书名", subtitle: "副标题",
          authorName: "作者姓名", genre: "书籍类型", sellingPoint: "一句话卖点",
          synopsis: "内容简介", contentLanguage: "内容语言", duration: "期望视频时长",
          platforms: "发布平台"
        },
        summary: {
          title: "项目摘要", untitled: "未命名项目", noBook: "尚未填写书名",
          checklist: "本步骤检查", client: "客户与联系人", book: "书籍基本信息",
          direction: "制作方向", nextTitle: "接下来", nextBody: "保存后继续配置角色和视觉风格。项目提交前，您可以随时返回修改。"
        },
        validation: { required: "请填写{{field}}", email: "请输入有效邮箱", chooseOne: "请至少选择一项", max: "最多 {{max}} 个字符", futureDate: "截止时间不能早于今天" },
        saveFailed: "草稿保存失败，请检查连接后重试。",
        versionConflict: "此草稿已在别处更新，请重新载入后继续。",
        unsavedChanges: "有尚未保存的修改，确定离开当前页面吗？",
      },
      sourceFiles: {
        hint: "上传真实书籍文件。封面和手稿是提交项目资料包的必需内容。",
        required: "必传",
        chooseFor: "为{{category}}选择文件",
        removeFile: "移除文件 {{fileName}}",
        coverAlt: "《{{title}}》书籍封面",
        missingRequired: "请先上传书籍封面和完整手稿或节选。",
        removeConfirm: "确定移除这个书籍文件吗？本地测试服务中的文件也会被删除。",
      },
      creative: {
        intro: "定义故事中的关键人物和整体视觉方向。这些内容只表达制作偏好，不会在页面中自动生成图片。",
        sections: { characters: "角色设定", style: "视觉方向" },
        characterHint: "添加需要在视频中明确呈现的人物，并按故事重要性排序。",
        addCharacter: "添加角色", addFirst: "添加第一个角色", emptyTitle: "尚未添加角色", emptyBody: "先添加故事中最重要的人物；项目提交前可以继续修改。",
        unnamedCharacter: "未命名角色", rolePending: "未选择角色类型", moveUp: "上移角色", moveDown: "下移角色", delete: "删除", deleteConfirm: "确定删除这个角色吗？已填写的角色资料将被移除。",
        fields: { roleType: "角色类型", characterName: "角色名称", storyRole: "故事定位", personality: "性格描述", appearance: "外貌描述", ageRange: "年龄范围", gender: "性别", clothing: "服装描述", emotion: "表情或情绪特点", voiceHint: "声线提示", visualStyle: "主要视觉风格", moodTags: "情绪标签", imageTags: "画面标签", paceTags: "节奏标签" },
        validation: { characterRequired: "请至少添加一个主要角色", styleRequired: "请选择主要视觉风格" },
        summary: { casting: "角色阵容", characterCount: "{{count}} 个角色", more: "另有 {{count}} 个角色", direction: "视觉方向", noStyle: "尚未选择风格", noTags: "尚未选择补充标签", nextTitle: "接下来", nextBody: "继续补充声音偏好和参考素材；制作团队将结合完整项目背景确定最终音色。" }
      },
      voice: {
        intro: "说明旁白偏好、上传制作参考，并整理希望制作团队传达的核心方向。参考音色不是最终指定音色。",
        sections: { settings: "配音偏好", samples: "参考音色", references: "参考素材", direction: "制作要求" },
        settingsHint: "内容语言独立于界面语言；选择用于表达旁白的整体方向。",
        sampleDisclaimer: "参考音色仅用于表达偏好，最终效果以制作结果为准。",
        selectedCount: "已选 {{count}}／{{max}}", recommended: "推荐参考", play: "试听", pause: "暂停", playSample: "试听{{name}}", pauseSample: "暂停{{name}}", sampleUnavailable: "试听待配置", preferred: "首选", setPreferred: "设为首选",
        noSamples: "当前语言暂未配置参考音色。",
        referenceHint: "文件会交给制作团队作为参考，不会在本页面自动分析或生成内容。",
        fileLimit: "单个不超过 {{size}}，最多 {{count}} 个", chooseFiles: "选择文件", chooseFor: "为{{category}}选择文件", uploading: "正在上传…", uploadCancelled: "上传已取消。", cancelUpload: "取消上传", remove: "移除", removeFile: "移除文件 {{fileName}}", removeLink: "移除参考链接 {{index}}", removeConfirm: "确定移除这个参考文件吗？本地测试服务中的文件也会被删除。",
        competitorHint: "可补充公开网页或视频链接，最多 5 个。", addLink: "添加链接", linkNumber: "参考链接 {{index}}",
        directionHint: "用简洁、可交付的文字说明成片必须传达什么。", continueToReview: "保存并前往确认",
        fields: { contentLanguage: "旁白语言", narrationTone: "旁白语气", speechRate: "语速", pronunciationNotes: "发音与读法备注", voiceGender: "声音性别", voiceAge: "声音年龄", accent: "口音", emotionStyle: "情绪风格", customVoice: "自定义音色描述", competitorLinks: "竞品或案例链接", coreMessage: "核心信息", requiredScenes: "必须出现的场景", authorPreferences: "作者偏好", closingMessage: "CTA 或结尾信息", musicMood: "音乐氛围", avoidContent: "敏感或需要避免的内容" },
        validation: { url: "请输入以 http:// 或 https:// 开头的有效地址", preferred: "首选音色必须同时处于已选状态", limit: "最多选择 {{max}} 个参考音色" },
        summary: { selection: "当前首选参考", noPreferred: "尚未设置首选", candidates: "另有 {{count}} 个候选参考", noCandidates: "可以不选择参考音色", package: "项目资料包", fileCount: "{{count}} 个参考文件", linkCount: "{{count}} 个外部链接", nextTitle: "下一步：确认提交资料包", nextBody: "检查全部内容；提交后，当前版本将保存为只读记录。" }
      }
    }
  },
  "en-US": {
    translation: {
      app: { name: "Lifewood AIGC Story Studio", ...(import.meta.env.DEV ? { testEnvironment: "Local test environment" } : {}) },
      nav: { tasks: "My book video projects", language: "Language", logout: "Log out", skipToContent: "Skip to main content" },
      auth: {
        externalMissing: "The production sign-in system is not configured. Contact an administrator.",
        ...(import.meta.env.DEV ? {
        title: "Choose a local test identity",
        description: "This entry is for local development only and is excluded from production builds.",
        continueAs: "Continue as {{name}}",
        signingIn: "Signing in…",
        noUsers: "No local test identities are available. Check the test service configuration.",
        } : {}),
      },
      common: {
        createTask: "Create book video project", creating: "Creating project…", saveDraft: "Save draft", saving: "Saving…", saved: "Saved",
        retry: "Retry", reload: "Reload", back: "Back", continue: "Save and continue", loading: "Loading…", all: "All",
        previous: "Previous", next: "Next", pageOf: "Page {{page}} of {{pages}}"
      },
      errors: { requestId: "Request ID: {{id}}", auth: { unauthorized: "Sign in to continue.", forbidden: "Your account does not have permission for this action.", unknownUser: "The test user does not exist." }, project: { notFound: "The project was not found or is not accessible.", notEditable: "This project package has been submitted and can no longer be changed.", versionConflict: "This project draft changed elsewhere. Reload it first." }, validation: { failed: "Some fields are invalid. Review them and try again.", required: "Required data is missing.", max_length: "The value is too long.", email: "The email format is invalid.", date: "The date format is invalid.", past_date: "The date cannot be before today.", unknown_option: "An option is not valid.", too_many: "Too many items were selected or added.", invalid: "The data format is invalid.", url: "A reference URL is invalid.", file: "This file type or size is not allowed for the selected category. Choose another file." }, system: { unexpected: "The request could not be completed. Try again later." }, http: { notFound: "The endpoint was not found." } },
      tasks: {
        searchLabel: "Search book video projects", searchPlaceholder: "Project, book, or author", searchAction: "Search", filterLabel: "Project status",
        emptyTitle: "No book video projects yet", emptyDescription: "Create your first book video project and send the book, creative direction, and references to the production team.",
        columns: { project: "Project", book: "Book", status: "Status", updated: "Updated", action: "Action" },
        continueEditing: "Continue editing", view: "View submission record", count: "{{count}} items"
      },
      taskDetail: { title: "Project submission record", project: "Project details", book: "Book details", creative: "Characters & visual direction", voice: "Voice & references", direction: "Production requirements", sourceFiles: "Book files & source materials", referenceFiles: "Reference files", referenceLinks: "Reference links", preferredVoice: "Preferred reference voice", selectedVoices: "Candidate reference voices", character: "Character {{index}}", taskNumber: "Project number", created: "Created", updated: "Submitted" },
      review: { intro: "Review the submission package. The production team will use this version for the next stage of work.", edit: "Edit", packageCount: "{{files}} files · {{links}} links", noticeTitle: "Project details lock after submission", noticeBody: "Confirm the details before submitting. Return to the relevant section if anything needs to change.", submit: "Send to production team", submitting: "Validating and submitting…", validationTitle: "Some details still need attention", validationBody: "The test service completed its final check. Return to the relevant section, resolve the items, and submit again.", validationCount: "{{count}} items" },
      submitted: { title: "Project details submitted", body: "The production team has received this version of the project package. The record is now locked and remains available for review.", submittedAt: "Submitted", files: "Files", links: "Reference links", viewRecord: "View submission record", backToProjects: "Back to projects", nextTitle: "What happens next", nextBody: "The production team will use the book, creative direction, and references for the next conversation. Contact the team through the agreed project channel if anything changes." },
      wizard: {
        stepProgress: "Step {{current}} of {{total}}",
        steps: { project: "Project details & book", characters: "Characters, tags & visual style", voice: "Voice, references & production requirements", review: "Review submission package" },
        projectIntro: "Share the project background, book details, and communication goal to give the production team a clear starting point.",
        sections: { project: "Project & client", book: "Book information", sources: "Book files & source materials" },
        fields: {
          clientName: "Client name", contactName: "Contact", email: "Email", phone: "Phone",
          brand: "Brand or business unit", projectName: "Project name", videoGoal: "Video goal",
          deadline: "Deadline", audiences: "Target audience", bookTitle: "Book title", subtitle: "Subtitle",
          authorName: "Author", genre: "Genre", sellingPoint: "One-line hook", synopsis: "Synopsis",
          contentLanguage: "Content language", duration: "Desired duration", platforms: "Publishing platforms"
        },
        summary: {
          title: "Project summary", untitled: "Untitled project", noBook: "Book title not entered",
          checklist: "Step checklist", client: "Client and contact", book: "Book information",
          direction: "Production direction", nextTitle: "What happens next", nextBody: "Save and continue to characters and visual style. You can revise every choice before submission."
        },
        validation: { required: "Enter {{field}}", email: "Enter a valid email", chooseOne: "Choose at least one option", max: "Use no more than {{max}} characters", futureDate: "The deadline cannot be before today" },
        saveFailed: "The draft could not be saved. Check your connection and try again.",
        versionConflict: "This draft changed elsewhere. Reload it before continuing.",
        unsavedChanges: "You have unsaved changes. Leave this page?"
      },
      sourceFiles: {
        hint: "Upload the actual book files. The cover and manuscript are required before submitting the project package.",
        required: "Required",
        chooseFor: "Choose files for {{category}}",
        removeFile: "Remove file {{fileName}}",
        coverAlt: "Book cover for {{title}}",
        missingRequired: "Upload the book cover and full manuscript or excerpt first.",
        removeConfirm: "Remove this book file? It will also be deleted from the local test service.",
      },
      creative: {
        intro: "Define the key characters and overall visual direction. These choices express production preferences; this page does not generate imagery.",
        sections: { characters: "Character direction", style: "Visual direction" },
        characterHint: "Add the people who need to appear clearly in the video and order them by story importance.",
        addCharacter: "Add character", addFirst: "Add the first character", emptyTitle: "No characters added", emptyBody: "Start with the most important person in the story. You can revise each character before submission.",
        unnamedCharacter: "Unnamed character", rolePending: "Role type not selected", moveUp: "Move character up", moveDown: "Move character down", delete: "Delete", deleteConfirm: "Delete this character? The information entered for it will be removed.",
        fields: { roleType: "Role type", characterName: "Character name", storyRole: "Story role", personality: "Personality", appearance: "Appearance", ageRange: "Age range", gender: "Gender", clothing: "Clothing", emotion: "Expression or emotional quality", voiceHint: "Voice note", visualStyle: "Primary visual style", moodTags: "Mood tags", imageTags: "Image tags", paceTags: "Pace tags" },
        validation: { characterRequired: "Add at least one primary character", styleRequired: "Choose a primary visual style" },
        summary: { casting: "Character cast", characterCount: "{{count}} characters", more: "{{count}} more", direction: "Visual direction", noStyle: "No style selected", noTags: "No supporting tags selected", nextTitle: "What happens next", nextBody: "Continue with voice preferences and references. The production team will choose the final voice using the complete project context." }
      },
      voice: {
        intro: "Describe the narration preference, attach production references, and state the direction the production team should carry forward. Reference voices are not final casting choices.",
        sections: { settings: "Voice preferences", samples: "Reference voices", references: "Reference materials", direction: "Production requirements" },
        settingsHint: "The narration language is separate from the interface language. Use these choices to express the overall delivery.",
        sampleDisclaimer: "Reference voices express a preference only. Final delivery depends on production decisions.",
        selectedCount: "{{count}} / {{max}} selected", recommended: "Suggested reference", play: "Play", pause: "Pause", playSample: "Play {{name}}", pauseSample: "Pause {{name}}", sampleUnavailable: "Sample pending", preferred: "Preferred", setPreferred: "Set preferred",
        noSamples: "No reference voices are configured for this language.",
        referenceHint: "The production team receives these files as references. This page does not analyze or generate their content.",
        fileLimit: "Up to {{size}} each, maximum {{count}}", chooseFiles: "Choose files", chooseFor: "Choose files for {{category}}", uploading: "Uploading…", uploadCancelled: "Upload cancelled.", cancelUpload: "Cancel upload", remove: "Remove", removeFile: "Remove file {{fileName}}", removeLink: "Remove reference link {{index}}", removeConfirm: "Remove this reference file? It will also be deleted from the local test service.",
        competitorHint: "Add public web or video references, up to 5 links.", addLink: "Add link", linkNumber: "Reference link {{index}}",
        directionHint: "State, in concise production-ready language, what the finished video must communicate.", continueToReview: "Save and review",
        fields: { contentLanguage: "Narration language", narrationTone: "Narration tone", speechRate: "Speech rate", pronunciationNotes: "Pronunciation notes", voiceGender: "Voice gender", voiceAge: "Voice age", accent: "Accent", emotionStyle: "Emotional style", customVoice: "Custom voice description", competitorLinks: "Competitor or example links", coreMessage: "Core message", requiredScenes: "Required scenes", authorPreferences: "Author preferences", closingMessage: "CTA or closing message", musicMood: "Music mood", avoidContent: "Sensitive or excluded content" },
        validation: { url: "Enter a valid http:// or https:// address", preferred: "The preferred voice must also be selected", limit: "Choose no more than {{max}} reference voices" },
        summary: { selection: "Preferred reference", noPreferred: "No preferred voice set", candidates: "{{count}} candidate references", noCandidates: "Reference voices are optional", package: "Submission package", fileCount: "{{count}} reference files", linkCount: "{{count}} external links", nextTitle: "Next: Review submission package", nextBody: "Review every field. Submission saves this version as a read-only project record." }
      }
    }
  }
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "zh-CN",
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export async function setLocale(locale: SupportedLocale): Promise<void> {
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
}

export function localizedPath(locale: SupportedLocale, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalized}`;
}

export { i18n };
