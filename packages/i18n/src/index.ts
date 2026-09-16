import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { SupportedLocale } from "@lifewood/domain";

export const supportedLocales = ["zh-CN", "en-US"] as const;

export function isSupportedLocale(
  value: string | undefined,
): value is SupportedLocale {
  return supportedLocales.includes(value as SupportedLocale);
}

const resources = {
  "zh-CN": {
    translation: {
      dashboard: {"title": "数据概览", "navigation": "主导航", "total": "全部项目", "actionRequired": "待我处理", "active": "进行中", "downloadable": "可下载成品", "calendar": "项目活动", "trend": "活动趋势", "distribution": "项目状态", "recent": "近期更新", "monthPrevious": "上个月", "monthNext": "下个月", "thisMonth": "本月", "refresh": "刷新数据", "rules": "统计口径", "rulesText": "仅统计当前账号的项目。活动包括首次提交、重新提交及成品发布（包含之后撤回的发布记录）；不统计浏览或自动保存。活动多少不代表制作进度。", "coverage": "{{date}} 起完整记录活动，更早的日期仅显示已保留的记录。", "timezone": "统计时区：{{zone}}", "partial": "历史记录可能不完整", "noActivity": "当天没有活动", "noKnownActivity": "当天没有已保留的活动记录", "noProjects": "还没有项目，创建项目后可在这里查看数据。", "projectsLink": "前往项目", "daySummary": "{{date}} · {{count}} 次活动 · {{projects}} 个项目", "breakdown": "首次提交 {{submissions}} · 重新提交 {{resubmissions}} · 成品发布 {{deliveries}}", "submission": "首次提交", "resubmission": "重新提交", "delivery": "成品发布", "submissions": "提交资料", "deliveries": "成品发布", "dayDetails": "当日活动", "date": "日期", "activities": "活动次数", "chartData": "查看图表数据", "noTrend": "本月暂无已记录的活动", "legend": "活动强度", "future": "尚未到来", "untitled": "未命名项目", "previous": "上一页", "next": "下一页", "pagination": "第 {{page}} / {{pages}} 页 · {{count}} 条", "updated": "更新于 {{date}}", "count": "{{count}} 次", "allProjects": "查看全部项目"},
      feedback: {"entry": "问题反馈", "adminTitle": "平台反馈", "category": "反馈类型", "description": "问题描述", "placeholder": "请描述遇到的问题、操作步骤或希望改进的地方…", "screenshot": "截图（选填）", "imageHint": "支持 PNG、JPG、WebP，最多 1 MB。请遮挡截图中的密码等敏感信息。", "removeImage": "移除截图", "page": "反馈页面", "submitted": "反馈已提交", "replyHint": "管理员的回复将通过站内通知送达。", "submit": "提交反馈", "sending": "正在提交…", "retry": "重试", "retryHint": "尚未确认提交结果，重试将核对同一份反馈，不会重复提交。", "loadError": "暂时无法加载，请重试。", "search": "搜索问题、姓名或邮箱", "allStatuses": "全部状态", "empty": "暂时没有反馈", "author": "反馈人", "status": "处理状态", "createdAt": "提交时间", "view": "查看详情", "original": "原始反馈", "reply": "处理回复", "replyPlaceholder": "回复将作为站内通知发送给反馈人…", "sendReply": "保存并发送通知", "saveStatus": "保存状态", "saved": "处理结果已保存", "replyHistory": "已发送的通知", "noReplies": "尚未发送回复", "previous": "上一页", "next": "下一页", "pagination": "第 {{page}} 页 · 共 {{count}} 条", "closedAccount": "已注销账号", "refresh": "刷新", "noticeReply": "管理员回复", "errors": {"invalid": "请填写 5–4000 字的问题描述，并检查反馈类型。", "image": "请选择不超过 1 MB 的 PNG、JPG 或 WebP 图片。", "limited": "反馈提交较频繁，请稍后再试。", "conflict": "反馈已更新，请刷新详情后核对处理结果。"}},
      clientUx: {
        sendingReply: "正在发送…","allSteps": "查看全部步骤", "hideSteps": "收起步骤", "returnedStatus": "待修改或回复", "resubmit": "重新提交需求", "backTo": "返回：{{unit}}", "revisionReviewHint": "核对本轮要求和回复后重新提交。若保留原需求，可以说明原因，无需强制修改。", "requestedUnits": "本轮请处理", "returnReason": "退回原因", "openFeedback": "查看反馈", "allProjects": "全部项目", "actionRequired": "待我处理", "continueDraft": "继续填写", "handleReturn": "处理退回", "viewProgress": "查看进展", "more": "更多操作", "optionalBook": "卖点与简介（选填）", "optionalFiles": "更多资料（选填）", "recognizedFields": "已填入：{{fields}}。请核对结果。", "searchOptions": "搜索{{label}}", "noOptions": "没有匹配的选项", "selected": "已选", "manuscriptOptional": "书籍正文（选填）"},
      bookIntake: {"recognitionEndpoint": "AI 服务地址或模型不可用，请联系管理员检查接入配置。已有信息未被修改。", "basicHint": "填写品牌、项目名称、视频目标、截止日期和目标受众。", "presetImage": "{{name}}的默认角色参考图", "presetHint": "AI 生成的默认参考图。可修改设定、上传自己的参考图，或删除整个角色。", "uploadCover": "上传封面", "recognizeShort": "识别填写", "recognitionTitle": "封面识别", "recognitionHint": "上传封面、封底或书腰照片后，可将最多 6 张、合计 20 MB 的照片发送给已配置的 AI，提取书名、作者、副标题、类型、卖点和简介。只填入空白字段，请核对结果。", "recognitionDisabled": "尚未配置封面识别服务；请手动填写书籍信息。", "recognitionImages": "请选择 1–6 张已上传的封面照片，每张最多 10 MB，合计不超过 20 MB。", "recognitionFailed": "识别失败。请稍后重试或手动填写，已有信息未被修改。", "recognize": "识别并填写空白字段", "recognizing": "正在识别封面…", "recognitionDone": "已填入识别到的资料，请核对并补充。未识别的信息保留为空。", "recognitionNoChange": "没有可自动填入的新资料。已有内容已保留，您可以手动补充。", "uploadFirst": "上传封面照片", "takePhoto": "拍摄封面照片", "preparingPhoto": "正在处理并上传照片…", "photoFormat": "当前类别不接受 JPG 或 PNG 照片，请联系管理员检查文件类别配置。", "photoSize": "照片压缩后仍超过大小限制，请选择较小的照片。", "photoUnreadable": "无法读取这张照片，请将相机格式设为 JPG 后重拍，或选择 JPG、PNG 图片上传。", "photoInterrupted_camera": "拍照期间页面重新加载，尚未收到照片。请从相册重新选择照片上传。", "photoInterrupted_processing": "处理照片时页面重新加载，上传已中断。请降低拍照分辨率后重试。", "photoInterrupted_uploading": "上传时页面重新加载。请先检查封面列表，未出现时再重新上传。", "photoTimeout": "照片处理超时，请重新选择照片或降低相机分辨率后再试。", "photoUploadFailed": "照片上传失败，请重试。"},
      app: { name: "Lifewood · Deseret Book", clientName: "Deseret Book", providerName: "Lifewood" },
      nav: {
        tasks: "项目",
        workspace: "Deseret Book · 图书成片",
        language: "语言",
        adminCenter: "管理后台",
        account: "账户信息",
        profile: "个人资料",
        accountMenu: "账户信息：{{name}}",
        openAvatarEditor: "查看或更换头像",
        avatarEditorTitle: "头像",
        chooseAvatar: "选择图片",
        chooseAnotherAvatar: "重新选择",
        avatarCropInstruction: "拖动图片或使用方向键调整位置；按住 Shift 可快速移动。使用滑块缩放，圆形区域是最终显示范围。",
        avatarZoom: "缩放",
        saveAvatar: "确认更换",
        avatarSourceInvalid: "请选择不超过 20 MB、可正常打开的 PNG、JPEG 或 WebP 图片。",
        changeAvatar: "更换头像",
        removeAvatar: "恢复默认头像",
        avatarUploading: "正在上传头像…",
        avatarRemoving: "正在恢复…",
        avatarFailed: "头像更新失败，请重新选择图片后再试。",
        avatarUpdated: "头像已更新。",
        avatarRemoved: "已恢复默认头像。",
        removeAvatarConfirm: "恢复默认头像后，自定义头像文件将被删除。确定继续吗？",
        avatarInput: "选择头像图片",
        changePassword: "修改密码",
        currentPassword: "当前密码",
        newPassword: "新密码",
        confirmNewPassword: "确认新密码",
        passwordMismatch: "两次输入的新密码不一致。",
        passwordInvalid: "当前密码不正确，或新密码不符合要求。",
        savePassword: "保存新密码",
        savingPassword: "正在保存…",
        logout: "退出登录",
        loggingOut: "正在退出…",
        logoutFailed: "退出失败，请重试。",
        skipToContent: "跳到主要内容",
      },
      auth: {
        title: "登录",
        description: "使用平台账号进入图书视频项目登记。",
        bootstrapTitle: "创建平台负责人账号",
        bootstrapDescription:
          "首次使用需要创建负责人账号。该账号用于管理并提交本平台中的项目资料。",
        firstSetup: "首次设置",
        secureAccess: "账号登录",
        displayName: "姓名",
        organizationName: "组织名称",
        phone: "联系电话",
        organizationOptional: "选填；创建后由管理员维护。",
        phoneOptional: "选填；以后可在个人资料中补充。",
        email: "邮箱",
        password: "密码",
        confirmPassword: "确认密码",
        passwordHint: "至少 8 个字符。请使用仅用于本平台的密码。",
        passwordMismatch: "两次输入的密码不一致。",
        rememberMe: "在此设备上保持登录",
        showPassword: "显示密码",
        hidePassword: "隐藏密码",
        signIn: "登录",
        signingIn: "正在登录…",
        createAccount: "创建账号并进入平台",
        creatingAccount: "正在创建账号…",
        storyTitle: "从书页，",
        storyTitleEnd: "到银幕。",
        storyCharacters: "让角色，",
        storyCharactersEnd: "走出书页。",
        storyVision: "让想象，",
        storyVisionEnd: "成为画面。",
        storyShowcase: "图书视频创作展示",
        pauseStory: "暂停自动轮播",
        resumeStory: "继续自动轮播",
        footerLinks: "官网与联系方式",
        officialWebsite: "官网",
        contactUs: "联系我们",
        storyPages: "切换展示页",
        storyPage: "第 {{number}} 页：{{title}}",
        securityNote: "登录状态保存在安全会话 Cookie 中，密码不会存入浏览器。",
      },
      profile: {
        title: "个人资料",
        description: "维护项目登记时自动带入的联系人信息。",
        backToProjects: "返回项目",
        identityEyebrow: "账户资料",
        intakeTitle: "用于项目登记",
        intakeDescription: "新建项目时自动带入最新联系信息",
        avatarTitle: "头像",
        avatarDescription: "点击头像可预览、裁剪或更换图片。",
        changeAvatar: "查看或更换头像",
        contactTitle: "联系信息",
        edit: "编辑",
        contactDescription: "所属组织名称、联系人和电话会自动填入之后新建的项目草稿。",
        accountTitle: "账户与归属",
        accountDescription: "查看登录身份、组织归属与安全设置。",
        displayName: "姓名",
        clientName: "默认客户名称",
        phone: "联系电话",
        phonePlaceholder: "选填",
        email: "登录邮箱",
        organization: "所属组织",
        notSet: "未填写",
        notAssigned: "未分配",
        readonlyNote: "登录邮箱和所属组织由管理员维护。如需修改，请联系平台管理员。",
        passwordTitle: "登录密码",
        passwordDescription: "定期更新仅用于本平台的密码。",
        preferencesTitle: "个人偏好",
        preferencesDescription: "调整仅作用于当前账户的界面设置。",
        language: "界面语言",
        languageDescription: "切换后立即保存，并在下次登录时继续使用。",
        preferenceSaving: "正在保存偏好…",
        preferenceSaved: "偏好已保存。",
        roles: { owner: "平台负责人", admin: "管理员", operator: "运营人员", customer: "客户成员", member: "平台成员" },
        save: "保存个人资料",
        saved: "个人资料已更新",
      },
      common: {
        createTask: "新建项目",
        noPreference: "不指定",
        creating: "正在创建项目…",
        saveDraft: "保存为草稿",
        saveNow: "立即保存",
        backHome: "返回主页",
        save: "保存",
        savePending: "等待自动保存…",
        saveNeedsAttention: "有内容尚未保存，请先修正",
        saving: "正在保存…",
        saved: "已保存",
        retry: "重试",
        reload: "重新载入",
        close: "关闭",
        cancel: "取消",
        confirmTitle: "确认操作",
        confirmAction: "确认继续",
        back: "返回",
        continue: "保存并继续",
        loading: "正在加载…",
        all: "全部",
        previous: "上一页",
        next: "下一页",
        pageOf: "第 {{page}} 页，共 {{pages}} 页",
        paginationLabel: "项目列表分页",
        goToPage: "前往第 {{page}} 页",
        currentPage: "当前为第 {{page}} 页",
        fatalErrorTitle: "页面暂时无法显示",
        fatalErrorDescription: "页面遇到了意外问题。请重新载入后再试。",
        reloadPage: "重新载入页面",
      },
      errors: {
        requestId: "请求编号：{{id}}",
        network: {
          unavailable: "无法连接服务器，请检查网络后重试。",
          upload: "上传未能完成，请检查网络后重试。",
          invalidResponse: "服务器返回了无效响应，请重试。",
        },
        auth: {
          unauthorized: "请先登录。",
          forbidden: "当前账号没有此操作权限。",
          invalidCredentials: "邮箱或密码不正确。",
          passwordInvalid: "当前密码不正确，或新密码不符合要求。",
          currentPassword: "当前密码不正确。",
          locked: "登录失败次数过多，请 15 分钟后重试。",
          alreadyInitialized: "平台负责人账号已经创建，请直接登录。",
          bootstrapLocalOnly: "首次初始化只能在服务器本机完成。请在服务器上打开页面，或通过 SSH 端口转发访问。",
          csrf: "安全会话已过期，请刷新页面后重试。",
          fields: {
            displayName: "姓名应为 2 至 100 个字符。",
            email: "请输入有效邮箱。",
            password: "密码应为 8 至 128 个字符。",
            phone: "联系电话不能超过 50 个字符。",
            clientName: "客户名称不能超过 200 个字符。",
            organizationName: "组织名称应为 2 至 120 个字符。",
            locale: "请选择受支持的界面语言。",
            request: "账号信息无效。",
          },
        },
        project: {
          notFound: "项目不存在或无权访问。",
          notEditable: "项目资料已提交，不能再修改。",
          versionConflict: "项目草稿已在别处更新，请重新载入。",
          workflowConflict: "其他管理员刚刚更新了跟进信息。请重新载入后再试。",
        },
        validation: {
          failed: "部分字段无效，请检查后重试。",
          required: "缺少必需数据。",
          max_length: "内容过长。",
          email: "邮箱格式无效。",
          date: "日期格式无效。",
          past_date: "日期不能早于今天。",
          unknown_option: "包含无效选项。",
          too_many: "选择或添加的项目过多。",
          invalid: "数据格式无效。",
          url: "素材地址无效。",
          file: "文件格式或大小不符合当前类别的要求，请重新选择。",
          fileSize: "文件超过当前类别的大小限制，请压缩后重新上传。",
          fileType: "当前类别不支持该文件格式，请选择卡片上列出的格式。",
          fileContent: "文件内容与声明的格式不符，请重新导出为支持的格式后上传。",
        },
        system: { unexpected: "系统暂时无法完成请求，请稍后重试。" },
        http: {
          notFound: "接口不存在。",
        },
      },
      saveRecovery: {
        title: "保存需要处理", retry: "重试保存", locate: "定位问题", loadLatest: "比较最新版本",
        keptHint: "当前页面的输入已保留，请处理后再离开。", invalidHint: "点击定位问题，修正对应字段后将自动保存。",
        replaceConfirm: "载入最新版本会替换当前页面尚未保存的修改。确定继续吗？",
        changedWhileLoading: "加载期间你又修改了内容，仍要用服务器最新版本替换当前输入吗？",
        reloadFailed: "未能载入最新版本，当前输入未被修改。",
      },
      tasks: {
        title: "项目看板",
        subtitle: "管理图书视频需求采集与提交记录。",
        searchLabel: "搜索书籍视频项目",
        filters: { open: "筛选", keyword: "关键词", reset: "重置", apply: "应用筛选" },
        searchPlaceholder: "项目名、书名或作者",
        searchAction: "搜索",
        listUx: {
          sortLabel: "项目排序", sortOption: "{{column}} · {{direction}}", activeFilters: "已选筛选条件",
          removeSearch: "移除关键词：{{value}}", removeStatus: "移除状态：{{value}}", clearAll: "清除筛选",
          noResultsTitle: "没有符合条件的项目", noResultsDescription: "试试其他关键词，或清除筛选查看全部项目。",
          noActionTitle: "暂时没有需要你处理的项目", noActionDescription: "可以查看全部项目，了解已提交项目的进展。",
        },
        filterLabel: "项目状态",
        sort: {
          asc: "升序",
          desc: "降序",
          change: "按{{column}}{{direction}}排列",
        },
        emptyTitle: "还没有书籍视频项目",
        emptyDescription:
          "创建第一个书籍视频项目，向制作团队提交书籍资料、创意方向和参考素材。",
        columns: {
          project: "项目",
          book: "作者",
          status: "状态",
          updated: "更新时间",
          action: "操作",
        },
        untitledDraft: "未命名草稿",
        pendingInput: "待完善",
        coverPending: "封面待上传",
        continueEditing: "需求采集",
        view: "查看采集详情",
        deleteDraft: "删除草稿",
        deleteReturned: "删除项目",
        deleteReturnedTitle: "删除这个已退回的项目？",
        deleteReturnedDescription: "项目资料、提交及退回记录、沟通记录和附件将永久删除，管理后台也将移除该项目。此操作无法撤销。",
        deleteDialogTitle: "删除这个草稿？",
        deleteDialogDescription: "已填写的资料和上传的文件将永久删除，此操作无法撤销。",
        deletingDraft: "正在删除…",
        deleteDraftConfirm:
          "确定删除此草稿吗？已填写的资料和上传文件将永久删除。",
        deleteDraftFailed: "草稿删除失败，请重试。",
        count: "共 {{count}} 项",
        stats: {
          label: "项目概览",
          total: "全部",
          drafts: "草稿 / 采集中",
          active: "进行中",
          completed: "已完成",
          actionRequired: "待处理",
        },
      },
      taskDetail: {
        title: "项目提交记录",
        project: "项目资料",
        book: "书籍资料",
        creative: "角色与视觉方向",
        voice: "旁白配音与参考资料",
        direction: "制作要求",
        sourceFiles: "书籍文件与源材料",
        referenceFiles: "参考文件",
        referenceLinks: "参考链接",
        preferredVoice: "首选参考音色",
        selectedVoices: "候选参考音色",
        character: "角色 {{index}}",
        taskNumber: "项目编号",
        created: "创建时间",
        updated: "提交时间",
      },
      review: {
        intro: "确认交接资料包后提交给 Lifewood 制作团队。",
        edit: "修改",
        packageCount: "{{files}} 个文件 · {{links}} 个链接",
        noticeTitle: "提交后资料将锁定",
        noticeBody: "确认资料准确后再提交。如需调整，请先返回对应部分。",
        submit: "确认并提交制作需求",
        submitting: "正在校验并提交…",
        validationTitle: "还有资料需要补充",
        validationBody:
          "平台服务完成了最终检查，请返回对应部分处理后再次提交。",
        validationCount: "{{count}} 项",
      },
      delivery: {
        title: "成品交付",
        pendingTitle: "成品尚在准备",
        pendingBody: "制作团队发布最终成品后，您可以直接在此处下载。",
        readyTitle: "最终成品已交付",
        readyBody: "请下载并妥善保存项目成品。",
        readyBadge: "可下载",
        fileMeta: "{{size}} · {{date}}",
        downloadLatest: "下载最终成品",
        downloading: "正在下载…",
        downloadSaved: "文件已准备好，请在浏览器下载记录中查看。",
        fileSaved: "文件已保存到所选位置。",
        saving: "正在完成文件保存…",
        saveFailed: "无法保存文件，请检查可用空间和文件夹权限，或选择其他位置后重试。",
        download: "下载此版本",
      },
      submitted: {
        title: "项目资料已提交",
        body: "制作团队已经收到当前版本的项目资料包。该记录现已锁定，您可以随时返回查看。",
        submittedAt: "提交时间",
        files: "文件数量",
        links: "参考链接",
        viewRecord: "查看提交记录",
        backToProjects: "返回项目列表",
        nextTitle: "接下来",
        nextBody:
          "制作团队将根据提交的书籍、创意方向和参考资料开展后续沟通。如需变更，请通过约定的项目沟通渠道联系团队。",
      },
      wizard: {
        stepProgress: "第 {{current}} 步，共 {{total}} 步",
        steps: {
          project: "上传图书",
          characters: "故事角色",
          style: "视觉风格",
          voice: "旁白配音",
          references: "参考与创意",
          review: "审阅与提交",
        },
        pageTitles: {
          project: "创建图书视频项目",
          characters: "故事角色",
          style: "视觉风格",
          voice: "旁白配音",
          references: "参考素材与创意方向",
          review: "审阅并提交交接包",
        },
        pageSubtitles: {
          project: "上传图书与项目信息，建立完整的项目需求资料。",
          characters: "设定核心角色的人物身份、外观与故事作用。",
          style: "选择全片统一的视觉方向、画面标签与风格参考。",
          voice: "先确认是否需要旁白配音，需要时再配置声音偏好。",
          references: "上传参考素材、补充外部链接并填写成片创意方向。",
          review: "确认交接资料包后提交给 Lifewood 制作团队。",
        },
        projectIntro: "上传图书与项目信息，建立完整的项目需求资料。",
        sections: {
          project: "基本信息",
          book: "书籍信息",
          sources: "文件与源材料",
        },
        sectionHints: {
          project: "记录项目归属与成片用途。",
          book: "用于故事视频简报与资料检索的核心元数据。",
        },
        footerNotes: {
          project: "结构化采集能为制作团队提供更清晰的项目简报。",
          characters: "这些选择帮助团队在各场景保持视觉一致性。",
          style: "视觉方向将作为全片画面设计与场景制作的统一依据。",
          voice: "配音选择将作为声音制作偏好进入交接清单。",
          references: "参考素材、链接和创意备注将作为独立领域进入交接清单。",
          review: "首轮审阅稿之后仍可申请修改。",
        },
        actions: {
          backUpload: "返回上传图书",
          backCharacters: "返回故事角色",
          backStyle: "返回视觉风格",
          backVoice: "返回旁白配音",
          backReferences: "返回参考素材与创意方向",
          toCharacters: "继续：故事角色",
          toStyle: "继续：视觉风格",
          toVoice: "继续：旁白配音",
          toReferences: "继续：参考素材与创意方向",
          toReview: "继续：审阅并提交",
        },
        fields: {
          clientName: "客户名称",
          contactName: "联系人",
          email: "邮箱",
          phone: "电话",
          brand: "品牌线",
          projectName: "临时项目名",
          videoGoal: "视频目标",
          deadline: "截止日期",
          audiences: "目标受众",
          bookTitle: "书名",
          subtitle: "副标题",
          authorName: "作者",
          genre: "类型",
          sellingPoint: "一句话卖点",
          synopsis: "短简介",
          contentLanguage: "目标语言",
          duration: "期望时长",
          platforms: "投放平台",
        },
        summary: {
          title: "项目摘要",
          untitled: "未命名项目",
          noBook: "尚未填写书名",
          checklist: "处理清单",
          client: "已填写项目信息",
          book: "已填写书籍信息",
          cover: "书籍封面已上传",
          manuscript: "书籍内容已上传",
          status: "状态",
          created: "创建时间",
          direction: "已填写制作方向",
          nextTitle: "下一步：故事角色",
          nextBody: "下一步先填写故事角色，再设置配音偏好；视觉风格与参考创意随后连续完成，提交前均可返回修改。",
        },
        validation: {
          required: "请填写{{field}}",
          email: "请输入有效邮箱",
          chooseOne: "请至少选择一项",
          max: "最多 {{max}} 个字符",
          futureDate: "截止时间不能早于今天",
          customDuration: "请输入具体的期望时长",
        },
        durationEditableHint: "可从列表选择，也可直接输入具体时长。",
        durationPlaceholder: "例如：45 秒…",
        revisionRefreshFailed: "沟通消息暂时无法刷新，您可以继续编辑。",
        saveFailed: "草稿保存失败，请检查连接后重试。",
        versionConflict: "此草稿已在别处更新，请重新载入后继续。",
        unsavedChanges: "有尚未保存的修改，确定离开当前页面吗？",
        unavailableOption: "已停用选项",
      },
      sourceFiles: {
        hint: "请上传图书封面；书籍正文和补充图片均为选填。",
        required: "必传",
        chooseFor: "为{{category}}选择文件",
        removeFile: "移除文件 {{fileName}}",
        coverAlt: "《{{title}}》书籍封面",
        coverPendingAlt: "尚未上传书籍封面",
        missingRequired: "请先上传标为必传的文件。",
        removeConfirm: "确定移除这个书籍文件吗？平台存储中的文件也会被删除。",
      },
      uploadZone: {
        tapHint: "点击选择文件",
        dropHint: "点击卡片选择文件，或拖拽到此处",
        dropActive: "松开即可上传",
        browseHint: "支持从本机选择文件",
        limitReached: "已达到文件数量上限",
        unavailable: "该文件分类已停用",
      },
      creative: {
        colorTone: {
          hint: "选择一种色彩基调；情绪、光照和构图不属于此项。",
          noPreference: "不指定",
          legacy: "已保留原画面要求：{{values}}。选择新的色彩基调将替换这些选项。",
          singleSelection: "请选择一种色彩基调。",
        },
        intro: "分别设定故事角色与全片视觉方向，形成可独立修改的制作要求。",
        sections: { characters: "故事角色", style: "视觉故事风格" },
        stylePreview: {
          alt: "{{style}}风格示例图",
          videoAlt: "{{style}}风格示例视频",
          unavailable: "暂无风格示例图",
          note: "以下为 AI 生成的风格示例，仅用于比较视觉方向，不代表项目成片；动态图形展示的是静态示意帧。",
        },
        characterHint: "定义故事中的关键人物。切换角色位以分别配置。",
        addCharacter: "添加角色",
        addFirst: "创建自定义角色",
        emptyTitle: "尚未添加角色",
        emptyBody: "定义故事中需要明确呈现的关键人物。",
        unnamedCharacter: "未命名角色",
        rolePending: "未选择角色类型",
        moveUp: "上移角色",
        moveDown: "下移角色",
        delete: "删除",
        deleteConfirm: "确定删除这个角色吗？已填写的角色资料将被移除。",
        characterListLabel: "角色列表",
        addReferenceImages: "添加参考图",
        referenceLimit: "最多 {{count}} 张，每张不超过 {{size}} MB",
        referenceEmpty: "尚未添加参考图片",
        characterPortraitAlt: "{{name}}的角色图片",
        referenceAdded: "已添加 {{count}} 张参考图片",
        referencesUnavailable: "参考图分类当前未启用，请联系管理员。",
        removeReferenceImage: "移除参考图 {{name}}",
        removeReferenceConfirm: "确定移除参考图“{{name}}”吗？平台存储中的文件也会被删除。",
        fields: {
          roleType: "角色类型",
          characterName: "角色名",
          storyRole: "故事中的作用",
          personality: "角色描述",
          appearance: "外貌",
          ageRange: "年龄段",
          gender: "性别",
          clothing: "服装",
          emotion: "表情气质",
          voiceHint: "声音提示",
          referenceImages: "角色参考图",
          styleReferences: "风格参考图",
          visualStyle: "视觉故事风格",
          moodTags: "情绪标签",
          imageTags: "色彩基调",
          paceTags: "节奏偏好（可多选）",
        },
        validation: {
          characterRequired: "请至少添加一个主要角色",
          styleRequired: "请选择主要视觉风格",
        },
        summary: {
          casting: "角色阵容",
          characterCount: "{{count}} 个角色",
          more: "另有 {{count}} 个角色",
          direction: "视觉方向",
          noStyle: "尚未选择风格",
          noTags: "尚未选择补充标签",
          nextVoiceTitle: "下一步：旁白配音",
          nextVoiceBody: "角色资料保存后，将单独配置内容语言、声音特征与参考音色。",
          nextReferencesTitle: "下一步：参考素材与创意方向",
          nextReferencesBody: "视觉方向保存后，将继续补充风格参考、制作素材与成片要求。",
        },
      },
      voice: {
        narration: {
          question: "是否需要旁白配音？",
          yes: "是，需要旁白配音",
          no: "否，不需要旁白配音",
          required: "需要旁白配音",
          notRequired: "不需要旁白配音",
          unselected: "尚未选择",
          scope: "此处仅配置旁白，不包含角色对白、音乐或字幕。",
          disabledHint: "本项目将记录为无需旁白配音；具体旁白配置不再提交，其他项目资料不受影响。",
        },
        intro: "分别填写配音偏好，以及参考素材与创意方向。",
        sections: {
          settings: "旁白配音设置",
          samples: "旁白音色试听与选择",
          references: "参考素材输入",
          direction: "创意方向",
        },
        settingsHint: "设定语言、语气与节奏，使旁白贴合故事。",
        sampleDisclaimer: "参考音色仅用于表达偏好，最终效果以制作结果为准。",
        selectedCount: "已选 {{count}}／{{max}}",
        recommended: "推荐参考",
        play: "试听",
        pause: "暂停",
        playSample: "试听{{name}}",
        pauseSample: "暂停{{name}}",
        sampleUnavailable: "试听待配置",
        preferred: "首选",
        setPreferred: "设为首选",
        noSamples: "当前语言暂未配置参考音色。",
        unavailableRemoved:
          "已有 {{count}} 个参考音色被管理员停用，已从当前草稿选择中移除。",
        referenceHint:
          "文件会交给制作团队作为参考，不会在本页面自动分析或生成内容。",
        fileLimit: "单个不超过 {{size}}，最多 {{count}} 个",
        chooseFiles: "选择文件",
        chooseFor: "为{{category}}选择文件",
        waitingUpload: "等待上传…",
        uploading: "正在上传…",
        uploadCancelled: "上传已取消。",
        cancelUpload: "取消上传",
        remove: "移除",
        removeFile: "移除文件 {{fileName}}",
        removeLink: "移除参考链接 {{index}}",
        removeConfirm: "确定移除这个参考文件吗？平台存储中的文件也会被删除。",
        competitorHint: "可补充公开网页或视频链接，最多 5 个。",
        addLink: "添加链接",
        linkNumber: "参考链接 {{index}}",
        directionHint: "补充成片需要传达的核心方向。",
        continueToReview: "继续：审阅并提交",
        fields: {
          contentLanguage: "内容语言",
          narrationTone: "旁白语气",
          speechRate: "语速",
          pronunciationNotes: "发音备注",
          voiceGender: "声音性别",
          voiceAge: "声音年龄感",
          accent: "口音",
          emotionStyle: "情绪风格",
          customVoice: "自定义音色描述",
          competitorLinks: "竞品示例 / 链接",
          coreMessage: "核心信息",
          requiredScenes: "必含场景",
          authorPreferences: "作者偏好",
          closingMessage: "希望观众采取的行动",
          musicMood: "音乐氛围",
          avoidContent: "需规避内容",
        },
        validation: {
          narrationChoice: "请选择是否需要旁白配音。",
          url: "请输入以 http:// 或 https:// 开头的有效地址",
          preferred: "首选音色必须同时处于已选状态",
          limit: "最多选择 {{max}} 个参考音色",
        },
        summary: {
          selection: "当前首选参考",
          noPreferred: "尚未设置首选",
          candidates: "另有 {{count}} 个候选参考",
          noCandidates: "可以不选择参考音色",
          package: "项目资料包",
          fileCount: "{{count}} 个参考文件",
          linkCount: "{{count}} 个外部链接",
          nextStyleTitle: "下一步：视觉风格",
          nextStyleBody: "配音偏好保存后，将确定全片统一的视觉方向与风格参考。",
          nextReviewTitle: "下一步：确认提交资料包",
          nextReviewBody: "参考素材与创意备注将与配音偏好共同进入交接资料包。",
        },
      },
    },
  },
  "en-US": {
    translation: {
      dashboard: {"title": "Overview", "navigation": "Main navigation", "total": "All projects", "actionRequired": "Needs your input", "active": "In progress", "downloadable": "Ready to download", "calendar": "Project activity", "trend": "Activity trends", "distribution": "Project status", "recent": "Recently updated", "monthPrevious": "Previous month", "monthNext": "Next month", "thisMonth": "This month", "refresh": "Refresh data", "rules": "About these numbers", "rulesText": "Only your account’s projects are included. Activity counts first submissions, resubmissions and delivery publications (including publications later withdrawn), excluding views and autosaves. Activity volume does not measure production progress.", "coverage": "Activity is fully recorded from {{date}}. Earlier dates show only retained records.", "timezone": "Reporting time zone: {{zone}}", "partial": "Historical records may be incomplete", "noActivity": "No activity on this day", "noKnownActivity": "No retained activity records for this day", "noProjects": "No projects yet. Create a project to see its activity here.", "projectsLink": "Go to projects", "daySummary": "{{date}} · {{count}} activities · {{projects}} projects", "breakdown": "First submissions {{submissions}} · Resubmissions {{resubmissions}} · Delivery publications {{deliveries}}", "submission": "First submission", "resubmission": "Resubmission", "delivery": "Delivery published", "submissions": "Submissions", "deliveries": "Delivery publications", "dayDetails": "Daily activity", "date": "Date", "activities": "Activity count", "chartData": "View chart data", "noTrend": "No recorded activity this month", "legend": "Activity intensity", "future": "Future date", "untitled": "Untitled project", "previous": "Previous page", "next": "Next page", "pagination": "Page {{page}} / {{pages}} · {{count}} records", "updated": "Updated {{date}}", "count": "{{count}} activities", "allProjects": "View all projects"},
      feedback: {"entry": "Report an issue", "adminTitle": "Platform feedback", "category": "Category", "description": "Description", "placeholder": "Describe the issue, the steps you took, or your suggestion…", "screenshot": "Screenshot (optional)", "imageHint": "PNG, JPG or WebP, up to 1 MB. Hide passwords and other sensitive information in your screenshot.", "removeImage": "Remove screenshot", "page": "Page", "submitted": "Feedback submitted", "replyHint": "Administrator replies will arrive in your notifications.", "submit": "Submit feedback", "sending": "Submitting…", "retry": "Retry", "retryHint": "Submission is not yet confirmed. Retrying checks the same feedback without creating a duplicate.", "loadError": "Unable to load. Please try again.", "search": "Search issue, name or email", "allStatuses": "All statuses", "empty": "No feedback yet", "author": "Submitted by", "status": "Status", "createdAt": "Submitted", "view": "View details", "original": "Original feedback", "reply": "Response", "replyPlaceholder": "Your response will be sent as an in-app notification…", "sendReply": "Save and notify", "saveStatus": "Save status", "saved": "Changes saved", "replyHistory": "Sent notifications", "noReplies": "No response sent yet", "previous": "Previous", "next": "Next", "pagination": "Page {{page}} · {{count}} total", "closedAccount": "Closed account", "refresh": "Refresh", "noticeReply": "Administrator response", "errors": {"invalid": "Enter a description of 5–4000 characters and check the category.", "image": "Choose a PNG, JPG or WebP image up to 1 MB.", "limited": "You have submitted several reports recently. Please try again later.", "conflict": "Feedback has changed. Refresh the details and check the latest result."}},
      clientUx: {
        sendingReply: "Sending…","allSteps": "View all steps", "hideSteps": "Hide steps", "returnedStatus": "Changes or reply needed", "resubmit": "Resubmit brief", "backTo": "Back to {{unit}}", "revisionReviewHint": "Review the requested changes and your replies before resubmitting. You can explain why you want to keep the original brief without changing it.", "requestedUnits": "Please address", "returnReason": "Requested change", "openFeedback": "View feedback", "allProjects": "All projects", "actionRequired": "Needs my attention", "continueDraft": "Continue draft", "handleReturn": "Address feedback", "viewProgress": "View progress", "more": "More actions", "optionalBook": "Selling point & synopsis (optional)", "optionalFiles": "More materials (optional)", "recognizedFields": "Filled in: {{fields}}. Please review.", "searchOptions": "Search {{label}}", "noOptions": "No matching options", "selected": "Selected", "manuscriptOptional": "Manuscript or excerpt (optional)"},
      bookIntake: {"recognitionEndpoint": "The AI endpoint or model is unavailable. Please ask an administrator to check the provider settings. Existing information has not changed.", "basicHint": "Set the brand, project name, video goal, deadline and target audience.", "presetImage": "Default reference portrait for {{name}}", "presetHint": "AI-generated reference portrait. Edit the preset, upload your own reference images, or delete this character.", "uploadCover": "Upload cover", "recognizeShort": "Scan & fill", "recognitionTitle": "Cover recognition", "recognitionHint": "After uploading cover, back-cover or book-jacket photos, send up to 6 photos (20 MB total) to the configured AI to extract title, author, subtitle, genre, hook and synopsis. Only blank fields are filled. Please check the results.", "recognitionDisabled": "Cover recognition is not configured. Enter the book information manually.", "recognitionImages": "Choose 1–6 uploaded cover photos, up to 10 MB each and 20 MB in total.", "recognitionFailed": "Recognition failed. Try again later or enter the information manually. Existing information has been preserved.", "recognize": "Recognize and fill blank fields", "recognizing": "Recognizing cover…", "recognitionDone": "Recognized information has been filled in. Please review and complete it. Unreadable details remain blank.", "recognitionNoChange": "No new information could be filled in. Existing content was preserved; you can complete the fields manually.", "uploadFirst": "Go to 1.2 to upload cover photos", "takePhoto": "Take a cover photo", "preparingPhoto": "Processing and uploading photo…", "photoFormat": "This category does not accept JPG or PNG photos. Ask an administrator to check its file settings.", "photoSize": "The compressed photo still exceeds the size limit. Choose a smaller photo.", "photoUnreadable": "This photo could not be read. Set the camera format to JPG and retake it, or upload a JPG or PNG image.", "photoInterrupted_camera": "The page reloaded before receiving the photo. Please select it from your gallery to upload.", "photoInterrupted_processing": "The page reloaded while processing the photo. Try a lower camera resolution.", "photoInterrupted_uploading": "The page reloaded during upload. Check your covers before uploading again.", "photoTimeout": "Photo processing timed out. Select the photo again or try a lower camera resolution.", "photoUploadFailed": "Photo upload failed. Please try again."},
      app: { name: "Lifewood · Deseret Book", clientName: "Deseret Book", providerName: "Lifewood" },
      nav: {
        tasks: "Projects",
        workspace: "Deseret Book · Book to Video",
        language: "Language",
        adminCenter: "Admin",
        account: "Account information",
        profile: "Profile",
        accountMenu: "Account information for {{name}}",
        openAvatarEditor: "View or change avatar",
        avatarEditorTitle: "Avatar",
        chooseAvatar: "Choose image",
        chooseAnotherAvatar: "Choose another",
        avatarCropInstruction: "Drag or use the arrow keys to reposition; hold Shift to move faster. Use the slider to zoom. The circle shows the final avatar.",
        avatarZoom: "Zoom",
        saveAvatar: "Use this avatar",
        avatarSourceInvalid: "Choose a readable PNG, JPEG, or WebP image under 20 MB.",
        changeAvatar: "Change avatar",
        removeAvatar: "Restore default avatar",
        avatarUploading: "Uploading avatar…",
        avatarRemoving: "Restoring…",
        avatarFailed: "The avatar could not be updated. Choose the image again and retry.",
        avatarUpdated: "Avatar updated.",
        avatarRemoved: "Default avatar restored.",
        removeAvatarConfirm: "Restoring the default avatar will delete the custom image. Continue?",
        avatarInput: "Choose an avatar image",
        changePassword: "Change password",
        currentPassword: "Current password",
        newPassword: "New password",
        confirmNewPassword: "Confirm new password",
        passwordMismatch: "The new passwords do not match.",
        passwordInvalid:
          "The current password is incorrect or the new password does not meet the requirements.",
        savePassword: "Save new password",
        savingPassword: "Saving…",
        logout: "Log out",
        loggingOut: "Logging out…",
        logoutFailed: "Could not log out. Try again.",
        skipToContent: "Skip to main content",
      },
      auth: {
        title: "Sign in",
        description:
          "Use your platform account to access book video project intake.",
        bootstrapTitle: "Create the platform owner account",
        bootstrapDescription:
          "Create the owner account for the first use of this platform. It will manage and submit project information.",
        firstSetup: "First-time setup",
        secureAccess: "Account access",
        displayName: "Name",
        organizationName: "Organization name",
        phone: "Phone",
        organizationOptional: "Optional. An administrator manages it after setup.",
        phoneOptional: "Optional. You can complete this later in your profile.",
        email: "Email",
        password: "Password",
        confirmPassword: "Confirm password",
        passwordHint:
          "Use at least 8 characters and a password unique to this platform.",
        passwordMismatch: "The passwords do not match.",
        rememberMe: "Keep me signed in on this device",
        showPassword: "Show password",
        hidePassword: "Hide password",
        signIn: "Sign in",
        signingIn: "Signing in…",
        createAccount: "Create account & enter platform",
        creatingAccount: "Creating account…",
        storyTitle: "From page",
        storyTitleEnd: "to screen.",
        storyCharacters: "Characters",
        storyCharactersEnd: "come alive.",
        storyVision: "Imagination",
        storyVisionEnd: "in motion.",
        storyShowcase: "Book video creation showcase",
        pauseStory: "Pause slideshow",
        resumeStory: "Resume slideshow",
        footerLinks: "Website and contact links",
        officialWebsite: "Official website",
        contactUs: "Contact us",
        storyPages: "Showcase pages",
        storyPage: "Page {{number}}: {{title}}",
        securityNote:
          "Your session uses a secure cookie. Passwords are never stored in the browser.",
      },
      profile: {
        title: "Profile",
        description: "Maintain the contact details automatically used for project intake.",
        backToProjects: "Back to projects",
        identityEyebrow: "Account profile",
        intakeTitle: "Used for project intake",
        intakeDescription: "New projects automatically use your latest contact details",
        avatarTitle: "Avatar",
        avatarDescription: "Select the avatar to preview, crop, or replace the image.",
        changeAvatar: "View or change avatar",
        contactTitle: "Contact information",
        edit: "Edit",
        contactDescription: "Your organization name, contact name, and phone number will be added to new project drafts.",
        accountTitle: "Account & organization",
        accountDescription: "Review your sign-in identity, organization, and security settings.",
        displayName: "Name",
        clientName: "Default client name",
        phone: "Phone",
        phonePlaceholder: "Optional",
        email: "Sign-in email",
        organization: "Organization",
        notSet: "Not provided",
        notAssigned: "Not assigned",
        readonlyNote: "Your sign-in email and organization are managed by an administrator. Contact an administrator to change them.",
        passwordTitle: "Sign-in password",
        passwordDescription: "Keep a password that is unique to this platform up to date.",
        preferencesTitle: "Personal preferences",
        preferencesDescription: "Adjust interface settings that apply only to your account.",
        language: "Interface language",
        languageDescription: "Changes are saved immediately and reused at your next sign-in.",
        preferenceSaving: "Saving preferences…",
        preferenceSaved: "Preferences saved.",
        roles: { owner: "Platform owner", admin: "Administrator", operator: "Operations staff", customer: "Customer member", member: "Platform member" },
        save: "Save profile",
        saved: "Profile updated.",
      },
      common: {
        createTask: "New project",
        noPreference: "No preference",
        creating: "Creating project…",
        saveDraft: "Save as Draft",
        saveNow: "Save now",
        backHome: "Back to home",
        save: "Save",
        savePending: "Waiting to save…",
        saveNeedsAttention: "Some changes need attention before saving",
        saving: "Saving…",
        saved: "Saved",
        retry: "Retry",
        reload: "Reload",
        close: "Close",
        cancel: "Cancel",
        confirmTitle: "Confirm action",
        confirmAction: "Continue",
        back: "Back",
        continue: "Save and continue",
        loading: "Loading…",
        all: "All",
        previous: "Previous",
        next: "Next",
        pageOf: "Page {{page}} of {{pages}}",
        paginationLabel: "Project list pagination",
        goToPage: "Go to page {{page}}",
        currentPage: "Current page, page {{page}}",
        fatalErrorTitle: "This page cannot be displayed",
        fatalErrorDescription: "The page encountered an unexpected problem. Reload it and try again.",
        reloadPage: "Reload page",
      },
      errors: {
        requestId: "Request ID: {{id}}",
        network: {
          unavailable: "The server could not be reached. Check your connection and try again.",
          upload: "The upload could not be completed. Check your connection and try again.",
          invalidResponse: "The server returned an invalid response. Try again.",
        },
        auth: {
          unauthorized: "Sign in to continue.",
          forbidden: "Your account does not have permission for this action.",
          invalidCredentials: "The email or password is incorrect.",
          passwordInvalid:
            "The current password is incorrect or the new password does not meet the requirements.",
          currentPassword: "The current password is incorrect.",
          locked: "Too many failed sign-in attempts. Try again in 15 minutes.",
          alreadyInitialized:
            "The platform owner account already exists. Sign in instead.",
          bootstrapLocalOnly:
            "Initial setup can only be completed on the server. Open the page locally or use an SSH port forward.",
          csrf: "The secure session expired. Refresh the page and try again.",
          fields: {
            displayName: "Use 2 to 100 characters for the name.",
            email: "Enter a valid email address.",
            password: "Use 8 to 128 characters for the password.",
            phone: "The phone number cannot exceed 50 characters.",
            clientName: "The client name cannot exceed 200 characters.",
            organizationName: "Use 2 to 120 characters for the organization name.",
            locale: "Choose a supported interface language.",
            request: "The account details are invalid.",
          },
        },
        project: {
          notFound: "The project was not found or is not accessible.",
          notEditable:
            "This project package has been submitted and can no longer be changed.",
          versionConflict:
            "This project draft changed elsewhere. Reload it first.",
          workflowConflict:
            "Another administrator just updated this workflow. Reload and try again.",
        },
        validation: {
          failed: "Some fields are invalid. Review them and try again.",
          required: "Required data is missing.",
          max_length: "The value is too long.",
          email: "The email format is invalid.",
          date: "The date format is invalid.",
          past_date: "The date cannot be before today.",
          unknown_option: "An option is not valid.",
          too_many: "Too many items were selected or added.",
          invalid: "The data format is invalid.",
          url: "A reference URL is invalid.",
          file: "This file type or size is not allowed for the selected category. Choose another file.",
          fileSize: "The file exceeds the category size limit. Compress it and try again.",
          fileType: "This category does not support the file format. Choose a format listed on the card.",
          fileContent: "The file contents do not match its declared format. Export it again in a supported format and retry.",
        },
        system: {
          unexpected: "The request could not be completed. Try again later.",
        },
        http: {
          notFound: "The endpoint was not found.",
        },
      },
      saveRecovery: {
        title: "Saving needs attention", retry: "Retry saving", locate: "Locate issue", loadLatest: "Compare latest version",
        keptHint: "Your input is still on this page. Resolve the issue before leaving.", invalidHint: "Locate and correct the field to resume automatic saving.",
        replaceConfirm: "Loading the latest version will replace your unsaved changes on this page. Continue?",
        changedWhileLoading: "You made more changes while loading. Replace your current input with the latest server version?",
        reloadFailed: "The latest version could not be loaded. Your input has not been changed.",
      },
      tasks: {
        title: "Projects Dashboard",
        subtitle: "Manage book-to-video intakes and submitted project records.",
        searchLabel: "Search book video projects",
        filters: { open: "Filters", keyword: "Keyword", reset: "Reset", apply: "Apply filters" },
        searchPlaceholder: "Project, book, or author",
        searchAction: "Search",
        listUx: {
          sortLabel: "Sort projects", sortOption: "{{column}} · {{direction}}", activeFilters: "Active filters",
          removeSearch: "Remove keyword: {{value}}", removeStatus: "Remove status: {{value}}", clearAll: "Clear filters",
          noResultsTitle: "No matching projects", noResultsDescription: "Try another keyword or clear the filters to see all projects.",
          noActionTitle: "Nothing needs your attention", noActionDescription: "View all projects to check the progress of your submissions.",
        },
        filterLabel: "Project status",
        sort: {
          asc: "ascending",
          desc: "descending",
          change: "Sort {{column}} {{direction}}",
        },
        emptyTitle: "No book video projects yet",
        emptyDescription:
          "Create your first book video project and send the book, creative direction, and references to the production team.",
        columns: {
          project: "Project",
          book: "Author",
          status: "Status",
          updated: "Updated",
          action: "Actions",
        },
        untitledDraft: "Untitled draft",
        pendingInput: "Pending",
        coverPending: "Cover pending",
        continueEditing: "Intake",
        view: "View intake details",
        deleteDraft: "Delete draft",
        deleteReturned: "Delete project",
        deleteReturnedTitle: "Delete this returned project?",
        deleteReturnedDescription: "Project details, submission and return history, discussions and attachments will be permanently deleted. The project will also be removed from the admin portal. This cannot be undone.",
        deleteDialogTitle: "Delete this draft?",
        deleteDialogDescription: "All entered details and uploaded files will be permanently deleted. This cannot be undone.",
        deletingDraft: "Deleting…",
        deleteDraftConfirm:
          "Delete this draft? Its entered details and uploaded files will be permanently removed.",
        deleteDraftFailed: "The draft could not be deleted. Try again.",
        count: "{{count}} items",
        stats: {
          label: "Project overview",
          total: "Total",
          drafts: "Draft / Intake",
          active: "In progress",
          completed: "Completed",
          actionRequired: "Action needed",
        },
      },
      taskDetail: {
        title: "Project submission record",
        project: "Project details",
        book: "Book details",
        creative: "Characters & visual direction",
        voice: "Narration & references",
        direction: "Production requirements",
        sourceFiles: "Book files & source materials",
        referenceFiles: "Reference files",
        referenceLinks: "Reference links",
        preferredVoice: "Preferred reference voice",
        selectedVoices: "Candidate reference voices",
        character: "Character {{index}}",
        taskNumber: "Project number",
        created: "Created",
        updated: "Submitted",
      },
      review: {
        intro:
          "Confirm the handoff package before sending it to the Lifewood production team.",
        edit: "Edit",
        packageCount: "{{files}} files · {{links}} links",
        noticeTitle: "Project details lock after submission",
        noticeBody:
          "Confirm the details before submitting. Return to the relevant section if anything needs to change.",
        submit: "Confirm & Submit Production Request",
        submitting: "Validating and submitting…",
        validationTitle: "Some details still need attention",
        validationBody:
          "The platform service completed its final check. Return to the relevant section, resolve the items, and submit again.",
        validationCount: "{{count}} items",
      },
      delivery: {
        title: "Final delivery",
        pendingTitle: "Your final video is being prepared",
        pendingBody:
          "When the production team publishes the final video, you can download it here.",
        readyTitle: "Your final video is ready",
        readyBody: "Download and keep a copy of the completed project.",
        readyBadge: "Ready to download",
        fileMeta: "{{size}} · {{date}}",
        downloadLatest: "Download final video",
        downloading: "Downloading…",
        downloadSaved: "Your file is ready. Check your browser downloads.",
        fileSaved: "Your file has been saved to the selected location.",
        saving: "Finishing file save…",
        saveFailed: "The file could not be saved. Check available space and folder permissions, or choose another location and retry.",
        download: "Download this version",
      },
      submitted: {
        title: "Project details submitted",
        body: "The production team has received this version of the project package. The record is now locked and remains available for review.",
        submittedAt: "Submitted",
        files: "Files",
        links: "Reference links",
        viewRecord: "View submission record",
        backToProjects: "Back to projects",
        nextTitle: "What happens next",
        nextBody:
          "The production team will use the book, creative direction, and references for the next conversation. Contact the team through the agreed project channel if anything changes.",
      },
      wizard: {
        stepProgress: "Step {{current}} of {{total}}",
        steps: {
          project: "Upload Book",
          characters: "Story Characters",
          style: "Visual Style",
          voice: "Narration Voiceover",
          references: "References & Direction",
          review: "Review & Submit",
        },
        pageTitles: {
          project: "Create Book Video Project",
          characters: "Story Characters",
          style: "Visual Style",
          voice: "Narration Voiceover",
          references: "References & Creative Direction",
          review: "Review & Submit Package",
        },
        pageSubtitles: {
          project:
            "Upload your book and project details to build a complete production brief.",
          characters:
            "Define each key character's identity, appearance, and role in the story.",
          style:
            "Choose a consistent visual direction, image tags, and style references for the video.",
          voice:
            "Choose whether narration is needed, then configure voice preferences if enabled.",
          references:
            "Upload references, add external links, and describe the creative direction.",
          review:
            "Confirm the handoff package before sending it to the Lifewood production team.",
        },
        projectIntro:
          "Upload your book and project details to build a complete production brief.",
        sections: {
          project: "Basic Information",
          book: "Book Information",
          sources: "Files & Source Materials",
        },
        sectionHints: {
          project:
            "Capture who this project is for and how the finished video will be used.",
          book: "Core metadata used to brief the story video and keep the package searchable.",
        },
        footerNotes: {
          project:
            "Structured intake builds a clearer brief for the production team.",
          characters:
            "Character details give the production team a stable cast specification.",
          style:
            "The visual direction becomes the shared reference for scene and image production.",
          voice:
            "Voice selections become the audio-production preference in the handoff checklist.",
          references:
            "Reference assets, links, and creative notes enter the handoff as an independent domain.",
          review: "You can still request changes after the first review draft.",
        },
        actions: {
          backUpload: "Back to Upload Book",
          backCharacters: "Back to Story Characters",
          backStyle: "Back to Visual Style",
          backVoice: "Back to Narration Voiceover",
          backReferences: "Back to References & Creative Direction",
          toCharacters: "Continue to Story Characters",
          toStyle: "Continue to Visual Style",
          toVoice: "Continue to Narration Voiceover",
          toReferences: "Continue to References & Creative Direction",
          toReview: "Continue to Review & Submit",
        },
        fields: {
          clientName: "Client name",
          contactName: "Contact person",
          email: "Email",
          phone: "Phone",
          brand: "Brand / Imprint",
          projectName: "Project name (temporary)",
          videoGoal: "Goal of video",
          deadline: "Deadline",
          audiences: "Target audience",
          bookTitle: "Book title",
          subtitle: "Subtitle",
          authorName: "Author name",
          genre: "Genre",
          sellingPoint: "One-line hook",
          synopsis: "Short synopsis",
          contentLanguage: "Target language",
          duration: "Desired video length",
          platforms: "Intended platform",
        },
        summary: {
          title: "Project summary",
          untitled: "Untitled project",
          noBook: "Book title not entered",
          checklist: "Processing Checklist",
          client: "Project info added",
          book: "Book information added",
          cover: "Book cover uploaded",
          manuscript: "Book content uploaded",
          status: "Status",
          created: "Created",
          direction: "Production direction added",
          nextTitle: "Next: Story characters",
          nextBody:
            "Continue with story characters, then set voice preferences. Visual style and creative references follow together, and every completed step remains revisable before submission.",
        },
        validation: {
          required: "Enter {{field}}",
          email: "Enter a valid email",
          chooseOne: "Choose at least one option",
          max: "Use no more than {{max}} characters",
          futureDate: "The deadline cannot be before today",
          customDuration: "Enter the desired video length",
        },
        durationEditableHint: "Choose a listed value or type a specific duration.",
        durationPlaceholder: "For example, 45 seconds…",
        saveFailed:
          "The draft could not be saved. Check your connection and try again.",
        versionConflict:
          "This draft changed elsewhere. Reload it before continuing.",
        revisionRefreshFailed: "Discussion messages could not be refreshed. You can continue editing.",
        unsavedChanges: "You have unsaved changes. Leave this page?",
        unavailableOption: "No longer available",
      },
      sourceFiles: {
        hint: "Upload the book cover. Book text and additional images are optional.",
        required: "Required",
        chooseFor: "Choose files for {{category}}",
        removeFile: "Remove file {{fileName}}",
        coverAlt: "Book cover for {{title}}",
        coverPendingAlt: "Book cover not uploaded yet",
        missingRequired:
          "Upload the files marked as required first.",
        removeConfirm:
          "Remove this book file? It will also be deleted from platform storage.",
      },
      uploadZone: {
        tapHint: "Tap to choose files",
        dropHint: "Click the card to choose files, or drag them here",
        dropActive: "Drop to upload",
        browseHint: "Choose files from this device",
        limitReached: "File limit reached",
        unavailable: "This file category is unavailable",
      },
      creative: {
        colorTone: {
          hint: "Choose one color tone. Mood, lighting, and composition are separate preferences.",
          noPreference: "No preference",
          legacy: "Previous image preferences retained: {{values}}. Choosing a color tone will replace them.",
          singleSelection: "Choose one color tone.",
        },
        intro:
          "Define story characters and the overall visual direction as independently editable production requirements.",
        sections: {
          characters: "Story Characters",
          style: "Visual Story Style",
        },
        stylePreview: {
          alt: "{{style}} style example",
          videoAlt: "{{style}} style video preview",
          unavailable: "Style example unavailable",
          note: "These AI-generated examples illustrate visual directions, not your final production. Motion graphics is represented by a still frame.",
        },
        characterHint:
          "Define the key people who appear in your story. Switch roles to configure each cast member.",
        addCharacter: "Add Character",
        addFirst: "Create Custom Character",
        emptyTitle: "No characters added",
        emptyBody:
          "Define the key people who need to appear clearly in the story.",
        unnamedCharacter: "Unnamed character",
        rolePending: "Role type not selected",
        moveUp: "Move character up",
        moveDown: "Move character down",
        delete: "Delete",
        deleteConfirm:
          "Delete this character? The information entered for it will be removed.",
        characterListLabel: "Character list",
        addReferenceImages: "Add reference images",
        referenceLimit: "Up to {{count}} images, {{size}} MB each",
        referenceEmpty: "No reference images added yet",
        characterPortraitAlt: "Character portrait of {{name}}",
        referenceAdded: "{{count}} reference image added",
        referenceAdded_other: "{{count}} reference images added",
        referencesUnavailable: "Reference image uploads are currently disabled. Contact an administrator.",
        removeReferenceImage: "Remove reference image {{name}}",
        removeReferenceConfirm: "Remove reference image “{{name}}”? The stored file will also be deleted.",
        fields: {
          roleType: "Role type",
          characterName: "Character name",
          storyRole: "Role in story",
          personality: "Describe your character",
          appearance: "Appearance",
          ageRange: "Age range",
          gender: "Gender",
          clothing: "Outfit / Attire",
          emotion: "Expression",
          voiceHint: "Voice hint",
          referenceImages: "Character reference images",
          styleReferences: "Style reference images",
          visualStyle: "Visual Story Style",
          moodTags: "Mood tags",
          imageTags: "Color tone",
          paceTags: "Pace preferences (multiple choices)",
        },
        validation: {
          characterRequired: "Add at least one primary character",
          styleRequired: "Choose a primary visual style",
        },
        summary: {
          casting: "Character cast",
          characterCount: "{{count}} characters",
          more: "{{count}} more",
          direction: "Visual direction",
          noStyle: "No style selected",
          noTags: "No supporting tags selected",
          nextVoiceTitle: "Next: Narration Voiceover",
          nextVoiceBody:
            "After saving the cast, configure language, voice characteristics, and reference voices separately.",
          nextReferencesTitle: "Next: References & Creative Direction",
          nextReferencesBody:
            "After saving the visual direction, add style references, production materials, and final-video requirements.",
        },
      },
      voice: {
        narration: {
          question: "Is narration voiceover needed?",
          yes: "Yes, include narration",
          no: "No narration",
          required: "Narration required",
          notRequired: "No narration required",
          unselected: "Not selected",
          scope: "This configures narration only, not character dialogue, music, or subtitles.",
          disabledHint: "This project will be recorded as not requiring narration. Narration settings will not be submitted; other project information is unchanged.",
        },
        intro:
          "Complete voice preferences separately from references and creative direction.",
        sections: {
          settings: "Narration Voiceover Settings",
          samples: "Narrator Voice Preview & Selection",
          references: "Reference Inputs",
          direction: "Creative Direction",
        },
        settingsHint:
          "Set language, tone, and delivery so narration matches the story.",
        sampleDisclaimer:
          "Reference voices express a preference only. Final delivery depends on production decisions.",
        selectedCount: "{{count}} / {{max}} selected",
        recommended: "Suggested reference",
        play: "Play",
        pause: "Pause",
        playSample: "Play {{name}}",
        pauseSample: "Pause {{name}}",
        sampleUnavailable: "Sample pending",
        preferred: "Preferred",
        setPreferred: "Set preferred",
        noSamples: "No reference voices are configured for this language.",
        unavailableRemoved:
          "Unavailable voice selections were removed from this draft ({{count}}).",
        referenceHint:
          "The production team receives these files as references. This page does not analyze or generate their content.",
        fileLimit: "Up to {{size}} each, maximum {{count}}",
        chooseFiles: "Choose files",
        chooseFor: "Choose files for {{category}}",
        waitingUpload: "Waiting to upload…",
        uploading: "Uploading…",
        uploadCancelled: "Upload cancelled.",
        cancelUpload: "Cancel upload",
        remove: "Remove",
        removeFile: "Remove file {{fileName}}",
        removeLink: "Remove reference link {{index}}",
        removeConfirm:
          "Remove this reference file? It will also be deleted from platform storage.",
        competitorHint: "Add public web or video references, up to 5 links.",
        addLink: "Add link",
        linkNumber: "Reference link {{index}}",
        directionHint:
          "Add the core direction the finished video should communicate.",
        continueToReview: "Continue to Review & Submit",
        fields: {
          contentLanguage: "Content language",
          narrationTone: "Narration tone",
          speechRate: "Speech rate",
          pronunciationNotes: "Pronunciation notes",
          voiceGender: "Voice gender",
          voiceAge: "Voice age",
          accent: "Accent",
          emotionStyle: "Emotional style",
          customVoice: "Custom voice description",
          competitorLinks: "Competitive examples / links",
          coreMessage: "Main message",
          requiredScenes: "Key scenes to include",
          authorPreferences: "Author preference",
          closingMessage: "What should viewers do next?",
          musicMood: "Music feel",
          avoidContent: "Anything sensitive to avoid",
        },
        validation: {
          narrationChoice: "Choose whether narration is needed.",
          url: "Enter a valid http:// or https:// address",
          preferred: "The preferred voice must also be selected",
          limit: "Choose no more than {{max}} reference voices",
        },
        summary: {
          selection: "Preferred reference",
          noPreferred: "No preferred voice set",
          candidates: "{{count}} candidate references",
          noCandidates: "Reference voices are optional",
          package: "Submission package",
          fileCount: "{{count}} reference files",
          linkCount: "{{count}} external links",
          nextStyleTitle: "Next: Visual Style",
          nextStyleBody:
            "After saving voice preferences, define the consistent visual direction and style references for the full video.",
          nextReviewTitle: "Next: Review submission package",
          nextReviewBody:
            "References and creative notes join the voice preferences in the handoff package.",
        },
      },
    },
  },
} as const;

// Re-evaluating this module (for example during HMR) must not replace the
// resource store: the admin app registers additional translations after import.
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
} else {
  for (const locale of supportedLocales) {
    i18n.addResourceBundle(locale, "translation", resources[locale].translation, true, true);
  }
}

i18n.addResource(
  "zh-CN",
  "translation",
  "errors.project.draftLimit",
  "草稿数量已达上限，请先完成或删除现有草稿。",
);
i18n.addResource(
  "zh-CN",
  "translation",
  "errors.storage.quota",
  "平台存储空间已满，请联系管理员处理。",
);
i18n.addResource("zh-CN", "translation", "errors.rateLimit.exceeded", "操作过于频繁，请稍候再试。");
i18n.addResource(
  "en-US",
  "translation",
  "errors.project.draftLimit",
  "The draft limit has been reached. Finish or delete an existing draft first.",
);
i18n.addResource(
  "en-US",
  "translation",
  "errors.storage.quota",
  "Platform storage is full. Contact an administrator.",
);
i18n.addResource("en-US", "translation", "errors.rateLimit.exceeded", "Too many requests. Wait briefly and try again.");

export async function setLocale(locale: SupportedLocale): Promise<void> {
  if (i18n.language !== locale) await i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
}

export function localizedPath(locale: SupportedLocale, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalized}`;
}

export { i18n };

i18n.addResourceBundle("zh-CN", "translation", { errors: { validation: { optionRemoved: "保存期间有选项被管理员移除，请重新加载可用选项后再试。" } } }, true, true);
i18n.addResourceBundle("en-US", "translation", { errors: { validation: { optionRemoved: "An option was removed while saving. Reload the available options and try again." } } }, true, true);

i18n.addResourceBundle("zh-CN", "translation", {"announcements": {"title": "公告", "history": "我的公告", "new": "新建公告", "edit": "编辑草稿", "copy": "复制为新公告", "publish": "发布", "withdraw": "下架", "draft": "草稿", "published": "已发布", "withdrawn": "已下架", "save": "保存草稿", "close": "关闭", "cancel": "取消", "search": "搜索公告标题", "empty": "暂无公告", "more": "加载更多", "end": "已显示全部公告", "retry": "重试", "loading": "正在加载…", "placement": "展示位置", "login": "登录前（公开）", "personal": "登录后（个人）", "audience": "发布范围", "all": "全部账号", "specified": "指定范围", "languages": "语言偏好", "organizations": "指定组织", "chooseOrgs": "选择组织", "clear": "清除", "scopeHint": "语言与组织同时选择时取交集；未设置语言偏好的账号按简体中文匹配。", "snapshotHint": "发布时确定收件账号，新注册账号不会收到旧公告。", "publicHint": "登录前公告公开可见，只能按页面语言筛选，不支持组织定向。", "titleZh": "中文标题", "bodyZh": "中文正文", "titleEn": "英文标题", "bodyEn": "英文正文", "startsAt": "开始时间（可选）", "endsAt": "结束时间（可选）", "preview": "预览", "recipients": "收件账号", "status": "状态", "actions": "操作", "publishConfirm": "按当前范围发布此公告？发布后正文与收件范围将锁定。", "withdrawConfirm": "下架此公告？客户将无法继续查看。", "invalid": "请检查双语标题、正文、发布范围及时间。", "conflict": "公告已被其他管理员更改，请刷新列表后重试。", "select": "选择", "selected": "已选择", "done": "完成选择", "unsaved": "放弃未保存的公告修改？", "dismiss": "关闭并不再提醒", "newNotices": "新公告", "readHistory": "查看历史公告", "recipientCount": "{{count}} 个账号", "refresh": "刷新", "noSelection": "尚未选择组织"}}, true, true);

i18n.addResourceBundle("en-US", "translation", {"announcements": {"title": "Announcements", "history": "My announcements", "new": "New announcement", "edit": "Edit draft", "copy": "Copy as new", "publish": "Publish", "withdraw": "Withdraw", "draft": "Draft", "published": "Published", "withdrawn": "Withdrawn", "save": "Save draft", "close": "Close", "cancel": "Cancel", "search": "Search announcement titles", "empty": "No announcements", "more": "Load more", "end": "All announcements loaded", "retry": "Retry", "loading": "Loading…", "placement": "Display location", "login": "Before sign-in (public)", "personal": "After sign-in (personal)", "audience": "Audience", "all": "All accounts", "specified": "Selected audience", "languages": "Language preference", "organizations": "Organizations", "chooseOrgs": "Choose organizations", "clear": "Clear", "scopeHint": "Language and organization filters both apply. Accounts without a language preference match Simplified Chinese.", "snapshotHint": "Recipients are fixed at publication. New accounts do not receive older notices.", "publicHint": "Public notices can target the page language, not an organization.", "titleZh": "Chinese title", "bodyZh": "Chinese body", "titleEn": "English title", "bodyEn": "English body", "startsAt": "Start time (optional)", "endsAt": "End time (optional)", "preview": "Preview", "recipients": "Recipients", "status": "Status", "actions": "Actions", "publishConfirm": "Publish to this audience? Content and recipients will be locked.", "withdrawConfirm": "Withdraw this announcement? Customers will no longer see it.", "invalid": "Check both translations, audience and dates.", "conflict": "Another administrator changed this announcement. Refresh and try again.", "select": "Select", "selected": "Selected", "done": "Finish selection", "unsaved": "Discard unsaved announcement changes?", "dismiss": "Dismiss and do not remind again", "newNotices": "New announcements", "readHistory": "View announcement history", "recipientCount": "{{count}} accounts", "refresh": "Refresh", "noSelection": "No organizations selected"}}, true, true);

i18n.addResourceBundle("zh-CN","translation",{"announcements": {"allStatuses": "全部状态", "allPlacements": "全部展示位置", "estimate": "预计发送给 {{count}} 个账号", "publicEstimate": "公开公告，符合页面语言条件的访客均可查看，不按账号计数。", "estimateHint": "人数按当前账号资料计算，最终以发布时的匹配结果为准。", "deleteDraft": "删除草稿", "deleteConfirm": "删除公告草稿“{{title}}”？此操作无法撤销。"}},true,true);

i18n.addResourceBundle("en-US","translation",{"announcements": {"allStatuses": "All statuses", "allPlacements": "All locations", "estimate": "Estimated audience: {{count}} accounts", "publicEstimate": "Public notice: visible to visitors matching the page language, without an account count.", "estimateHint": "The estimate uses current account data. Actual recipients are determined at publication.", "deleteDraft": "Delete draft", "deleteConfirm": "Delete announcement draft “{{title}}”? This cannot be undone."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{announcements:{contentTitle:"标题",contentBody:"正文",singleContentHint:"每条公告只需一份内容。可发给全部账号，也可按语言偏好定向；如需其他语言版本，可另行创建公告。",invalid:"请检查标题、正文、发布范围及时间。"}},true,true);
i18n.addResourceBundle("en-US","translation",{announcements:{contentTitle:"Title",contentBody:"Body",singleContentHint:"One version of the content per announcement. Send to all accounts or target a language preference. Create another announcement only if needed.",invalid:"Check the title, body, audience and dates."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{announcements:{legacyContentHint:"这是旧版双语公告，当前显示界面语言对应的内容。只调整范围或时间会保留原双语内容；编辑标题或正文、复制为新公告后，将以当前这份内容发送。"}},true,true);
i18n.addResourceBundle("en-US","translation",{announcements:{legacyContentHint:"This legacy notice has two translations. The current interface language is shown. Changing only audience or dates preserves both; editing text or copying as new sends the content shown here."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{announcements:{displayDays:"公示天数",displayDaysHint:"从发布时起计算，每天为 24 小时。公示期结束后不再自动弹出，个人历史仍可查看。可填写 1–3650 天。",invalid:"请检查标题、正文、发布范围和公示天数（1–3650 天）。"}},true,true);
i18n.addResourceBundle("en-US","translation",{announcements:{displayDays:"Display duration (days)",displayDaysHint:"Counted from publication in 24-hour days. Automatic pop-ups stop when the period ends; personal history remains available. Enter 1–3650 days.",invalid:"Check the title, body, audience and display duration (1–3650 days)."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"notifications": {"title": "通知", "entry": "通知，{{count}} 条未读", "newArrivals": "你有新的通知，点击查看", "center": "进入通知中心", "search": "搜索项目名称或操作人", "type": "通知类型", "allTypes": "全部类型", "unread": "只看未读", "preferences": "通知偏好", "businessState": "处理状态", "allStates": "全部状态", "project": "项目编号", "from": "开始日期", "to": "结束日期", "archived": "已归档", "readAll": "全部标为已读", "readSelected": "选中标为已读", "restore": "取消归档", "archive": "归档选中", "refresh": "刷新", "unavailable": "关联事项已失效、无权访问或暂时无法加载，请刷新后重试。", "empty": "暂无通知", "select": "选择：{{title}}", "openProject": "查看关联事项", "markUnread": "标为未读", "markRead": "标为已读", "more": "加载更多", "details": "通知详情", "toast": "显示即时轻提示", "sound": "播放提示音", "quietStart": "免打扰开始", "quietEnd": "免打扰结束", "muteHint": "关闭下列类别的即时提醒，通知仍保留在通知中心。免打扰使用当前设备时区。", "save": "保存", "retention": "归档保留天数", "retentionHint": "仅清理超过保留期限且已读、已归档的历史通知。范围为 30–3650 天。", "enabled": "启用", "disabled": "停用", "edit": "编辑", "exampleProject": "示例项目", "exampleActor": "示例用户", "deliveryLogs": "通知发送记录", "queueCounts": "等待发送 {{pending}} 条 · 失败 {{failed}} 条", "deliveryCount": "{{count}} 个收件账号 · 连续失败 {{attempts}} 次", "storageFailure": "存储暂时不可用，可重试发送。", "editRule": "编辑通知规则", "titleZh": "中文模板", "titleEn": "英文模板", "templateHint": "可用变量：{project}（项目名称）、{actor}（操作人）。业务原文不会自动翻译。", "level": "提醒级别", "audience": "管理端接收范围", "responsible": "优先项目负责人，未分配时通知管理员", "allAdmins": "所有具有项目管理权限的管理员", "audienceHint": "仅影响发给管理端的通知；客户通知始终只发给项目所属账号，并排除操作人本人。", "allowMute": "允许用户关闭该类别即时提醒", "ruleConflict": "规则已变化或模板无效，请刷新后重试。", "kinds": {"submitted": "项目提交", "resubmitted": "资料重新提交", "returned": "资料退回", "customer_reply": "客户回复", "admin_reply": "管理员回复", "workflow": "项目进度", "delivery": "成品交付"}, "states": {"pending": "待处理", "done": "已处理", "info": "信息更新", "expired": "已失效"}, "levels": {"normal": "一般", "important": "重要", "action": "需要处理"}, "deliveryStates": {"pending": "等待发送", "sent": "已处理", "failed": "发送失败"}}},true,true);
i18n.addResourceBundle("en-US","translation",{"notifications": {"title": "Notifications", "entry": "Notifications, {{count}} unread", "newArrivals": "New notifications — open to view", "center": "Notification center", "search": "Search project or actor", "type": "Notification type", "allTypes": "All types", "unread": "Unread only", "preferences": "Preferences", "businessState": "Action status", "allStates": "All states", "project": "Project ID", "from": "From", "to": "To", "archived": "Archived", "readAll": "Mark all read", "readSelected": "Mark selected read", "restore": "Restore selected", "archive": "Archive selected", "refresh": "Refresh", "unavailable": "The item is unavailable, inaccessible, or could not be loaded. Refresh and retry.", "empty": "No notifications", "select": "Select: {{title}}", "openProject": "Open related item", "markUnread": "Mark unread", "markRead": "Mark read", "more": "Load more", "details": "Notification details", "toast": "Show instant reminders", "sound": "Play a sound", "quietStart": "Quiet hours start", "quietEnd": "Quiet hours end", "muteHint": "Mute instant reminders for these categories. Records remain in the notification center. Quiet hours use this device’s time zone.", "save": "Save", "retention": "Archived retention (days)", "retentionHint": "Only read, archived notifications older than this period are removed. Range: 30–3650 days.", "enabled": "Enabled", "disabled": "Disabled", "edit": "Edit", "exampleProject": "Example project", "exampleActor": "Example user", "deliveryLogs": "Delivery records", "queueCounts": "{{pending}} pending · {{failed}} failed", "deliveryCount": "{{count}} recipients · {{attempts}} consecutive failures", "storageFailure": "Storage is temporarily unavailable. Retry delivery.", "editRule": "Edit notification rule", "titleZh": "Chinese template", "titleEn": "English template", "templateHint": "Variables: {project} (project name), {actor} (actor). User content is not translated.", "level": "Reminder level", "audience": "Admin recipients", "responsible": "Project assignee, or administrators when unassigned", "allAdmins": "All administrators with project access", "audienceHint": "Applies to admin notifications. Customer notifications go only to the project owner. The actor is excluded.", "allowMute": "Allow users to mute instant reminders", "ruleConflict": "The rule changed or the template is invalid. Refresh and retry.", "kinds": {"submitted": "Project submitted", "resubmitted": "Changes resubmitted", "returned": "Changes requested", "customer_reply": "Customer reply", "admin_reply": "Admin reply", "workflow": "Project progress", "delivery": "Final delivery"}, "states": {"pending": "Action needed", "done": "Handled", "info": "Update", "expired": "Unavailable"}, "levels": {"normal": "Normal", "important": "Important", "action": "Action needed"}, "deliveryStates": {"pending": "Pending", "sent": "Processed", "failed": "Failed"}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{notifications:{kinds:{account:"账号变更"}}},true,true);
i18n.addResourceBundle("en-US","translation",{notifications:{kinds:{account:"Account changes"}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"accountSwitch": {"title": "切换账号", "hint": "最多添加 5 个账号。首次添加需登录验证，登录有效期内可一键切换。请仅在可信设备上使用。", "current": "当前账号", "currentNamed": "当前账号：{{name}}", "switchNamed": "切换到 {{name}}", "removeNamed": "从此设备移除 {{name}}", "add": "添加账号", "addAndSwitch": "登录并切换", "switching": "正在切换…", "limit": "最多添加 5 个账号，请先移除一个账号。", "expired": "该账号的登录已失效，请重新添加并验证。", "changed": "账号已在其他页面切换或登录已失效。当前页面已暂停操作，请刷新后继续；刷新会丢弃未保存的内容。", "reload": "刷新页面", "logoutHint": "移除账号不会删除账号或项目。退出登录会清除此设备上所有已添加账号的快捷登录。"}},true,true);

i18n.addResourceBundle("en-US","translation",{"accountSwitch": {"title": "Switch account", "hint": "Add up to 5 accounts. Sign in once per account, then switch while its session remains valid. Use only on a trusted device.", "current": "Current", "currentNamed": "Current account: {{name}}", "switchNamed": "Switch to {{name}}", "removeNamed": "Remove {{name}} from this device", "add": "Add account", "addAndSwitch": "Sign in and switch", "switching": "Switching…", "limit": "Up to 5 accounts can be added. Remove one first.", "expired": "This account session has expired. Add it again to sign in.", "changed": "The account changed in another page or the session expired. Actions on this page are paused. Reload to continue; unsaved changes will be lost.", "reload": "Reload page", "logoutHint": "Removing an account does not delete its account or projects. Signing out clears quick access to all accounts added on this device."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{notifications:{readStatus:"已读",unreadStatus:"未读"}},true,true);
i18n.addResourceBundle("en-US","translation",{notifications:{readStatus:"Read",unreadStatus:"Unread"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"operations": {"workbench": "运营工作台", "mine": "只看我负责", "refresh": "刷新", "total": "共 {{count}} 项", "queues": "跟进队列", "project": "项目 / 客户", "deadline": "内部跟进期限", "updated": "更新时间", "empty": "当前队列暂无项目", "previous": "上一页", "next": "下一页", "page": "第 {{page}} / {{pages}} 页", "notSet": "未设置", "editDeadline": "设置跟进", "export": "导出资料包", "exporting": "正在打包…", "deadlineHint": "按本地时间设置；到期前 24 小时及逾期时各提醒一次。完成本次跟进可清除期限。此设置独立于客户要求的截止日期。", "localTime": "跟进时间（本地时区）", "terminal": "项目已完成或关闭，仅可清除原有期限。", "complete": "完成本次跟进", "conflict": "跟进期限已被修改，请关闭后重新打开再操作。", "invalidDeadline": "请选择有效的跟进时间；已完成或关闭的项目不能设置新期限。", "exportChanged": "打包期间项目发生变更，请重新导出。", "exportTooLarge": "项目附件超过 1 GB，请分别下载附件。", "exportFiles": "部分附件缺失或已变更，未生成资料包。请刷新项目后重试。"}, "notifications": {"kinds": {"followup_due": "跟进即将到期", "followup_overdue": "跟进已逾期"}}},true,true);

i18n.addResourceBundle("en-US","translation",{"operations": {"workbench": "Operations workbench", "mine": "Assigned to me", "refresh": "Refresh", "total": "{{count}} projects", "queues": "Follow-up queues", "project": "Project / customer", "deadline": "Internal follow-up deadline", "updated": "Updated", "empty": "No projects in this queue", "previous": "Previous", "next": "Next", "page": "Page {{page}} of {{pages}}", "notSet": "Not set", "editDeadline": "Set follow-up", "export": "Export project ZIP", "exporting": "Preparing ZIP…", "deadlineHint": "Use your local time. A reminder is sent within 24 hours before the deadline and once overdue. Complete the follow-up to clear its deadline. This is separate from the customer’s requested deadline.", "localTime": "Follow-up time (local time zone)", "terminal": "This project is completed or closed. You can only clear its existing deadline.", "complete": "Complete follow-up", "conflict": "The follow-up deadline changed. Close and reopen this dialog to try again.", "invalidDeadline": "Choose a valid follow-up time. Completed or closed projects cannot receive a new deadline.", "exportChanged": "The project changed while preparing the ZIP. Export again.", "exportTooLarge": "Project attachments exceed 1 GB. Download the attachments individually.", "exportFiles": "Some attachments are missing or changed; no ZIP was generated. Refresh the project and try again."}, "notifications": {"kinds": {"followup_due": "Follow-up due soon", "followup_overdue": "Follow-up overdue"}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"uiDensity": {"expand": "展开全文", "collapse": "收起", "unavailableOption": "选项信息不可用", "noDetails": "未填写", "deadlineHint": "到期前及逾期各提醒一次，与客户截止日期独立。", "referenceLink": "参考链接 {{number}}"}},true,true);

i18n.addResourceBundle("en-US","translation",{"uiDensity": {"expand": "Read more", "collapse": "Show less", "unavailableOption": "Option unavailable", "noDetails": "Not provided", "deadlineHint": "One reminder before the deadline and one when overdue. Separate from the customer deadline.", "referenceLink": "Reference {{number}}"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{projectActions:{title:"项目操作",editWorkflow:"更新进度"}},true,true);
i18n.addResourceBundle("en-US","translation",{projectActions:{title:"Project actions",editWorkflow:"Update workflow"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{profile:{taskBackgroundMotion:"项目列表动态背景"}},true,true);
i18n.addResourceBundle("en-US","translation",{profile:{taskBackgroundMotion:"Animated project background"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{notifications:{enterSelection:"批量选择",exitSelection:"退出选择",selectionActions:"批量操作",selectedCount:"已选 {{count}} 条",selectionLimit:"每次最多选择 500 条通知"}},true,true);
i18n.addResourceBundle("en-US","translation",{notifications:{enterSelection:"Select notifications",exitSelection:"Exit selection",selectionActions:"Bulk actions",selectedCount:"{{count}} selected",selectionLimit:"Select up to 500 notifications at a time"}},true,true);

i18n.addResource("zh-CN", "translation", "errors.project.organizationRequired", "请联系管理员分配所属组织后再创建项目。");
i18n.addResource("en-US", "translation", "errors.project.organizationRequired", "Ask an administrator to assign an organization before creating a project.");

i18n.addResourceBundle("zh-CN","translation",{userActivity:{online:"在线",away:"离开",offline:"离线",noData:"暂无记录",summary:"当前筛选用户统计",onlineCount:"当前在线",todayActive:"今日活跃",enabled:"启用账号",unassigned:"未分配组织",lastActive:"最近活跃",lastLogin:"最近登录",details:"用户详情",submittedProjects:"已提交项目",pendingProjects:"待处理项目",statusFilter:"在线状态",allPresence:"全部在线状态",organizationFilter:"所属组织",allOrganizations:"全部组织",enabledFilter:"账号状态",allEnabled:"全部账号状态"}},true,true);
i18n.addResourceBundle("en-US","translation",{userActivity:{online:"Online",away:"Away",offline:"Offline",noData:"No record",summary:"Filtered user statistics",onlineCount:"Online now",todayActive:"Active today",enabled:"Enabled accounts",unassigned:"No organization",lastActive:"Last active",lastLogin:"Last sign-in",details:"User details",submittedProjects:"Submitted projects",pendingProjects:"Pending projects",statusFilter:"Presence",allPresence:"All presence states",organizationFilter:"Organization",allOrganizations:"All organizations",enabledFilter:"Account status",allEnabled:"All account states"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{accountClosure:{title:"注销账号",closeNamed:"注销 {{name}} 的账号",target:"永久注销 {{name}} 的账号？",effect:"清除姓名、邮箱、电话、头像与个人偏好，使所有登录失效。此操作无法恢复。",owned:"保留 {{count}} 个所属项目",assigned:"释放 {{count}} 个负责项目的分配",retained:"项目资料及历史记录保留，其中已有的联系人信息、消息和审计记录不会被删除。",confirmEmail:"输入此账号的邮箱确认",confirm:"永久注销",review:"重新核对",success:"账号已永久注销。",deleted:"已注销账号",protected:"无法注销当前账号或平台负责人账号。",conflict:"账号信息已变化，请重新核对后确认。",invalid:"请输入该账号的邮箱确认。"}},true,true);
i18n.addResourceBundle("en-US","translation",{accountClosure:{title:"Close account",closeNamed:"Close {{name}}’s account",target:"Permanently close {{name}}’s account?",effect:"Remove the name, email, phone, avatar and personal preferences, and revoke all sign-ins. This cannot be undone.",owned:"Keep {{count}} owned projects",assigned:"Unassign {{count}} assigned projects",retained:"Project materials and history remain, including existing contact information, messages and audit records.",confirmEmail:"Enter this account’s email to confirm",confirm:"Permanently close",review:"Review again",success:"Account permanently closed.",deleted:"Closed account",protected:"The current account and platform owner cannot be closed.",conflict:"The account changed. Review its details before confirming.",invalid:"Enter this account’s email to confirm."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{revisionDiff:{title:"修改对比",count:"本次变更 {{count}} 项",field:"修改内容",before:"退回前",after:"重新提交后",added:"新增",removed:"移除",changed:"修改",empty:"无",noChanges:"资料内容未变更，可查看本轮回复。",unavailable:"历史资料不完整，暂无法生成对比。",customDuration:"自定义时长",file:"附件",unavailableLink:"链接不可用",character:"故事角色",unnamedCharacter:"未命名角色",presetImage:"预设角色图",characterOrder:"角色顺序"}},true,true);
i18n.addResourceBundle("en-US","translation",{revisionDiff:{title:"Compare changes",count:"Changes: {{count}}",field:"Changed content",before:"Before return",after:"After resubmission",added:"Added",removed:"Removed",changed:"Changed",empty:"None",noChanges:"Project content is unchanged. Check the replies in this round.",unavailable:"Historical data is incomplete. A comparison is unavailable.",customDuration:"Custom duration",file:"Attachment",unavailableLink:"Link unavailable",character:"Story character",unnamedCharacter:"Unnamed character",presetImage:"Preset portrait",characterOrder:"Character order"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{productivity:{savedViews:"常用筛选",saveCurrent:"保存当前筛选",rename:"重命名",renameNamed:"重命名 {{name}}",removeNamed:"移除 {{name}}",viewConflict:"保存未完成：请检查名称是否重复、是否已达 20 个上限，或刷新后重试。"}},true,true);
i18n.addResourceBundle("en-US","translation",{productivity:{savedViews:"Saved filters",saveCurrent:"Save current filters",rename:"Rename",renameNamed:"Rename {{name}}",removeNamed:"Remove {{name}}",viewConflict:"Could not save: check for duplicate names or the 20-view limit, or refresh and try again."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"productivity": {"batch": "批量处理", "selected": "已选择 {{count}} 个项目", "unavailableProject": "项目不可访问", "action": "修改项目", "clearDeadline": "留空将清除跟进期限。", "batchCheck": "将处理 {{count}} 个可访问项目；发生冲突的项目会保留原值。", "preview": "查看所选项目", "unnamedProject": "未命名项目", "reports": "趋势报表", "exitSelection": "退出选择", "select": "批量选择", "selectPage": "选择本页", "selectNamed": "选择 {{name}}", "outcomes": {"Saved": "已保存", "NotFound": "不可访问", "Conflict": "已被修改，请刷新", "Protected": "无操作权限", "Invalid": "设置无效"}, "devices": "登录设备", "browsers": {"edge": "Edge", "firefox": "Firefox", "chrome": "Chrome", "safari": "Safari", "unknown": "其他浏览器"}, "platforms": {"android": "Android", "ios": "iOS", "windows": "Windows", "macos": "macOS", "linux": "Linux", "unknown": "其他系统"}, "currentDevice": "当前设备", "connectedAt": "最近连接", "expiresAt": "登录有效期至", "revoke": "退出登录", "revokeOthersConfirm": "退出其他设备后，需要重新登录才能访问或切换到此账号。当前设备不受影响。", "revokeConfirm": "退出此设备后，需要重新登录才能访问或切换到此账号。", "revokeOthers": "退出其他设备", "date": "日期", "metrics": {"submitted": "首次提交", "delivered": "有效交付", "overdue": "当前逾期"}, "exportCsv": "导出 CSV", "from": "开始日期", "to": "结束日期", "organizationSearch": "搜索组织名称", "assigneeSearch": "搜索姓名或邮箱", "reportScope": "按当前组织和负责人筛选，按本地当前时区偏移汇总（最多 366 天）。交付不含已撤回记录；逾期按仍未完成项目的期限日期统计。", "trend": "每日首次提交、有效交付和当前逾期项目数量", "invalidRange": "请选择不超过 366 天的有效日期范围。"}},true,true);

i18n.addResourceBundle("en-US","translation",{"productivity": {"batch": "Batch update", "selected": "{{count}} projects selected", "unavailableProject": "Project unavailable", "action": "Change field", "clearDeadline": "Leave empty to clear the follow-up deadline.", "batchCheck": "Update {{count}} accessible projects. Conflicting projects will keep their current values.", "preview": "View selected projects", "unnamedProject": "Untitled project", "reports": "Trend reports", "exitSelection": "Exit selection", "select": "Select projects", "selectPage": "Select this page", "selectNamed": "Select {{name}}", "outcomes": {"Saved": "Saved", "NotFound": "Unavailable", "Conflict": "Changed; refresh to retry", "Protected": "Not permitted", "Invalid": "Invalid settings"}, "devices": "Login devices", "browsers": {"edge": "Edge", "firefox": "Firefox", "chrome": "Chrome", "safari": "Safari", "unknown": "Other browser"}, "platforms": {"android": "Android", "ios": "iOS", "windows": "Windows", "macos": "macOS", "linux": "Linux", "unknown": "Other system"}, "currentDevice": "This device", "connectedAt": "Last connection", "expiresAt": "Signed in until", "revoke": "Sign out", "revokeOthersConfirm": "Other devices will need to sign in again to access or switch to this account. This device stays signed in.", "revokeConfirm": "This device will need to sign in again to access or switch to this account.", "revokeOthers": "Sign out other devices", "date": "Date", "metrics": {"submitted": "First submissions", "delivered": "Valid deliveries", "overdue": "Currently overdue"}, "exportCsv": "Export CSV", "from": "Start date", "to": "End date", "organizationSearch": "Search organization name", "assigneeSearch": "Search name or email", "reportScope": "Filtered by current organization and assignee, using your current time-zone offset (up to 366 days). Deliveries exclude revoked records; overdue projects are grouped by deadline date and exclude completed projects.", "trend": "Daily first submissions, valid deliveries and currently overdue projects", "invalidRange": "Choose a valid date range of up to 366 days."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{productivity:{metricScope:"统计口径",noActivity:"此时间段暂无统计记录"}},true,true);
i18n.addResourceBundle("en-US","translation",{productivity:{metricScope:"How metrics are counted",noActivity:"No activity in this date range"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"auditTools": {"refresh": "刷新", "export": "导出 CSV", "details": "操作详情", "detailsFor": "查看 {{name}} 的操作详情", "unavailable": "对象不可用", "otherAction": "其他操作", "before": "变更前", "after": "变更后", "noValue": "未设置", "yes": "是", "no": "否", "unchanged": "本次没有字段变化", "noChanges": "此记录未保存字段变更明细", "technical": "技术信息", "exportLimit": "请缩小筛选范围，每次最多导出 2,000 条记录。", "sources": {"recorded": "名称为操作时记录；关联入口指向当前对象。", "current": "历史记录没有名称快照，此处显示当前关联对象的名称。", "unavailable": "关联对象已删除或无法获取。"}, "fields": {"labelZh": "中文名称", "labelEn": "英文名称", "descriptionZh": "中文说明", "descriptionEn": "英文说明", "enabled": "启用", "sortOrder": "排序", "allowsCustomValue": "允许自定义", "removed": "已移除", "titleZh": "中文通知标题", "titleEn": "英文通知标题", "level": "重要程度", "allowMute": "允许静音", "audience": "接收范围", "retentionDays": "归档保留天数"}}, "runtimeHealth": {"title": "运行状态", "measured": "采样于 {{time}}", "measuring": "正在采样", "unknown": "暂不可用", "available": "正常", "unavailable": "异常", "quotaUse": "存储配额使用 {{value}}%", "storage": "数据目录 / 配额", "database": "数据库连接", "free": "磁盘可用空间", "started": "本次启动", "details": "存储与异常详情", "uploads": "项目附件", "deliveries": "交付文件", "failed": "发送失败的通知事件", "audit": "审计落库", "pending": "有待补写记录", "clear": "无待补写记录", "scope": "每分钟采样。占用包含数据目录内的数据库、附件及其他文件；不含外部备份。磁盘空间为该目录所在卷的可用空间。数据库状态仅检查连接，不代表完整数据校验。", "partial": "目录扫描未完整完成，占用显示为暂不可用。"}},true,true);

i18n.addResourceBundle("en-US","translation",{"auditTools": {"refresh": "Refresh", "export": "Export CSV", "details": "Operation details", "detailsFor": "View operation details for {{name}}", "unavailable": "Target unavailable", "otherAction": "Other action", "before": "Before", "after": "After", "noValue": "Not set", "yes": "Yes", "no": "No", "unchanged": "No fields changed", "noChanges": "Field changes were not recorded for this event", "technical": "Technical information", "exportLimit": "Narrow the filters to 2,000 records or fewer.", "sources": {"recorded": "Name recorded at the time of the operation; links open the current object.", "current": "This historical event has no name snapshot. The current associated name is shown.", "unavailable": "The associated object was deleted or is unavailable."}, "fields": {"labelZh": "Chinese name", "labelEn": "English name", "descriptionZh": "Chinese description", "descriptionEn": "English description", "enabled": "Enabled", "sortOrder": "Order", "allowsCustomValue": "Allow custom values", "removed": "Removed", "titleZh": "Chinese notification title", "titleEn": "English notification title", "level": "Importance", "allowMute": "Allow muting", "audience": "Recipients", "retentionDays": "Archive retention days"}}, "runtimeHealth": {"title": "Runtime health", "measured": "Sampled at {{time}}", "measuring": "Collecting a sample", "unknown": "Unavailable", "available": "Healthy", "unavailable": "Unhealthy", "quotaUse": "Storage quota usage {{value}}%", "storage": "Data directory / quota", "database": "Database connection", "free": "Available disk space", "started": "Started", "details": "Storage and issues", "uploads": "Project attachments", "deliveries": "Delivery files", "failed": "Failed notification events", "audit": "Audit persistence", "pending": "Records awaiting replay", "clear": "No pending records", "scope": "Sampled every minute. Usage includes the database, attachments and other files in the data directory, excluding external backups. Available space refers to its volume. Database status checks connectivity, not full data integrity.", "partial": "The directory scan was incomplete. Storage usage is unavailable."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{auditTools:{values:{normal:"普通",important:"重要",action:"需处理",responsible:"项目相关人员",allAdmins:"全部管理员"}}},true,true);
i18n.addResourceBundle("en-US","translation",{auditTools:{values:{normal:"Normal",important:"Important",action:"Action required",responsible:"Project participants",allAdmins:"All administrators"}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{auditTools:{search:"搜索操作人或对象名称"}},true,true);
i18n.addResourceBundle("en-US","translation",{auditTools:{search:"Search actor or target name"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{auditTools:{fields:{tone:"展示色调",previewColor:"预览颜色",previewImageUrl:"预览图片",previewVideoUrl:"预览视频"}},runtimeHealth:{uptime:"运行时长",uptimeValue:"{{hours}} 小时 {{minutes}} 分钟"}},true,true);
i18n.addResourceBundle("en-US","translation",{auditTools:{fields:{tone:"Display tone",previewColor:"Preview color",previewImageUrl:"Preview image",previewVideoUrl:"Preview video"}},runtimeHealth:{uptime:"Uptime",uptimeValue:"{{hours}} h {{minutes}} min"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{helpPopover:{label:"关于{{label}}的说明"}},true,true);
i18n.addResourceBundle("en-US","translation",{helpPopover:{label:"Help for {{label}}"}},true,true);

i18n.addResourceBundle("zh-CN", "translation", { runtimeListeners: {
  backend: "后端服务", customer: "客户页面", admin: "管理后台", port: "端口", shared: "共用后端监听", active: "当前访问地址", pending: "应用后访问地址",
  externalHelp: "本地客户页面和管理后台由开发服务运行。保存后，请重新运行本地启动脚本，使三个服务的监听、代理和页面跳转一起更新。",
  hostedHelp: "发布版默认共用后端监听。取消共用后，可配置独立地址和端口，重启平台后生效；三个入口仍由同一个进程提供服务，不代表权限隔离。",
  httpsHelp: "HTTPS 需要配置有效证书。发布版使用服务端的 HTTPS 证书；本地开发需设置 LIFEWOOD_DEV_TLS_CERT 与 LIFEWOOD_DEV_TLS_KEY 文件路径。切换协议不会自动申请证书。",
  portHelp: "可用范围 1–65535。独立监听端口不能与后端或另一页面重复，也不能被其他程序占用。",
  externalRestart: "本地开发由启动脚本管理：保存后重新运行 scripts/start-local.ps1，三个服务将使用新配置。"
}}, true, true);
i18n.addResourceBundle("en-US", "translation", { runtimeListeners: {
  backend: "Backend service", customer: "Customer portal", admin: "Admin portal", port: "Port", shared: "Share backend listener", active: "Current address", pending: "Address after applying",
  externalHelp: "Local portals run in development servers. After saving, run the local launcher again to update all three listeners, API proxies and portal links together.",
  hostedHelp: "Published portals share the backend listener by default. Turn off sharing to configure a separate address and port, then restart the platform. All listeners use one process; this does not isolate permissions.",
  httpsHelp: "HTTPS requires a valid certificate. Published portals use the server HTTPS certificate. For local development, set LIFEWOOD_DEV_TLS_CERT and LIFEWOOD_DEV_TLS_KEY file paths. Changing the protocol does not provision a certificate.",
  portHelp: "Use a port from 1–65535. Separate listeners must use different ports, and the ports must not be occupied by other programs.",
  externalRestart: "The local launcher manages development services. Save, then run scripts/start-local.ps1 again to apply the configuration to all three services."
}}, true, true);

i18n.addResourceBundle("zh-CN","translation",{"backups": {"title": "备份", "source": "来源", "statusLabel": "状态", "allSources": "全部来源", "allStates": "全部状态", "manual": "手动备份", "scheduled": "自动备份", "policy": "备份策略", "create": "创建备份", "download": "下载备份", "delete": "删除备份", "deleteConfirm": "删除 {{time}} 的备份？此操作不会删除当前平台数据，备份文件删除后无法撤销。", "createdAt": "创建时间", "size": "大小", "actions": "操作", "empty": "暂无备份", "total": "共 {{count}} 份", "previous": "上一页", "nextPage": "下一页", "enable": "启用自动备份", "enabled": "自动备份已启用", "disabled": "自动备份未启用", "next": "下次执行：{{time}}", "frequency": "执行周期", "daily": "每天", "weekly": "每周", "weekday": "星期", "hour": "执行时刻（小时）", "timezone": "时区", "shanghai": "北京时间", "retainDays": "自动备份保留天数", "retainCount": "自动备份最多保留份数", "forbidden": "只有平台负责人可以管理备份。", "alreadyRunning": "已有备份任务正在执行。", "paused": "正在生成一致性备份快照，业务操作暂时不可用，请稍后重试。", "integrityError": "备份文件无法读取或校验失败，请重新创建备份。", "help": "包含数据库、附件、成品和配置。快照期间会等待正在进行的请求完成，并暂时暂停业务操作；压缩和校验期间恢复业务。备份保存在服务端，不会自动上传异地。下载文件包含客户及账号资料，请妥善保管。", "retentionHelp": "自动备份默认关闭。保留策略只清理成功的自动备份，至少保留最新一份；手动备份需自行删除。服务停机错过执行时间后，启动时补执行一次。恢复暂时使用现有停机恢复脚本。", "states": {"queued": "等待执行", "snapshot": "生成快照", "compressing": "压缩中", "verifying": "校验中", "completed": "已完成并校验", "failed": "失败"}, "errors": {"failed": "备份未完成，请检查服务器日志、可用磁盘空间和目录权限后重试。", "interrupted": "服务停止或快照超时，备份未完成，请重试。"}}},true,true);

i18n.addResourceBundle("en-US","translation",{"backups": {"title": "Backups", "source": "Source", "statusLabel": "Status", "allSources": "All sources", "allStates": "All statuses", "manual": "Manual", "scheduled": "Scheduled", "policy": "Backup policy", "create": "Create backup", "download": "Download backup", "delete": "Delete backup", "deleteConfirm": "Delete the backup from {{time}}? Current platform data will be kept. Deleting the archive cannot be undone.", "createdAt": "Created", "size": "Size", "actions": "Actions", "empty": "No backups yet", "total": "{{count}} backups", "previous": "Previous page", "nextPage": "Next page", "enable": "Enable scheduled backups", "enabled": "Scheduled backups enabled", "disabled": "Scheduled backups disabled", "next": "Next run: {{time}}", "frequency": "Frequency", "daily": "Daily", "weekly": "Weekly", "weekday": "Day of week", "hour": "Run at hour (0–23)", "timezone": "Time zone", "shanghai": "Beijing time", "retainDays": "Keep scheduled backups for days", "retainCount": "Maximum scheduled backups", "forbidden": "Only platform owners can manage backups.", "alreadyRunning": "A backup is already running.", "paused": "A consistent backup snapshot is being prepared. Business operations are temporarily unavailable; retry shortly.", "integrityError": "The archive is unreadable or failed verification. Create a new backup.", "help": "Includes the database, attachments, deliveries and configuration. Snapshot creation drains active requests and temporarily pauses business operations. Operations resume during compression and verification. Archives stay on the server; off-site replication is not automatic. Downloads contain private customer and account data.", "retentionHelp": "Scheduling is disabled by default. Retention applies only to successful scheduled backups, keeping at least the newest one. Delete manual backups explicitly. A missed run is executed once after startup. Restore still uses the existing offline restore script.", "states": {"queued": "Queued", "snapshot": "Taking snapshot", "compressing": "Compressing", "verifying": "Verifying", "completed": "Completed · verified", "failed": "Failed"}, "errors": {"failed": "Backup did not complete. Check server logs, available disk space and directory permissions before retrying.", "interrupted": "The service stopped or snapshot timed out. Create a new backup."}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"restore": {"title": "恢复备份", "target": "恢复到 {{time}}", "checking": "正在校验备份文件和数据库…", "verified": "预检通过", "files": "{{count}} 个文件", "checkHelp": "已检查文件校验和、数据库完整性、版本和可用空间。备份中需保留当前平台负责人账号。执行前会再次校验。", "warning": "将覆盖当前项目、附件和账号数据，所有用户需重新登录。执行前自动创建安全备份；保留当前监听和备份策略配置。", "confirmLabel": "输入 RESTORE 确认恢复", "execute": "创建安全备份并恢复", "submitting": "提交中…", "login": "重新登录", "unavailable": "当前运行方式需停机恢复", "offlineHelp": "Windows 服务和系统服务由外部进程管理，使用部署文档中的停机恢复脚本。独立进程支持后台恢复。", "preflightError": "预检未通过。请检查备份完整性、磁盘空间和版本，并确认备份中存在当前有效的负责人账号。", "stale": "预检已过期或已有任务执行，请重新校验后再恢复。", "reconnecting": "服务正在重启。恢复完成后请重新登录查看结果。", "progressHelp": "恢复前先生成安全备份，再停机替换数据。若新数据无法启动，将自动回退；结果会保存在服务端，重新登录后可查看。", "states": {"queued": "恢复已排队", "checking": "正在复核备份", "safetyBackup": "正在生成恢复前安全备份", "restarting": "正在重启服务", "switching": "正在替换数据", "starting": "正在验证恢复后的启动", "completed": "恢复完成", "failed": "恢复未执行", "rolledBack": "启动失败，已回退原数据", "recoveryRequired": "需要人工恢复"}, "errors": {"preflight": "准备失败，当前平台数据未被替换。请检查服务日志后重新预检。", "interrupted": "恢复被中断，请查看服务日志并重新预检。", "startup": "恢复后的服务未能正常启动，已切回恢复前的数据。", "recovery": "自动回退未完成。请停止服务，按部署文档使用恢复前的安全备份进行恢复。"}}, "backups": {"safety": "恢复前安全备份", "retentionHelp": "自动备份默认关闭。只自动清理成功的自动备份，至少保留最新一份。手动和恢复前安全备份需自行删除。错过执行时间后启动时补执行一次。"}},true,true);

i18n.addResourceBundle("en-US","translation",{"restore": {"title": "Restore backup", "target": "Restore to {{time}}", "checking": "Verifying archive and database…", "verified": "Preflight passed", "files": "{{count}} files", "checkHelp": "Checks file hashes, database integrity, version and available space. This backup must contain the current active platform owner. Checks run again before restoration.", "warning": "Current projects, attachments and accounts will be replaced. Everyone must sign in again. A safety backup is created first; current listener and backup policy settings are kept.", "confirmLabel": "Type RESTORE to confirm", "execute": "Back up and restore", "submitting": "Submitting…", "login": "Sign in again", "unavailable": "This deployment requires an offline restore", "offlineHelp": "Windows and system services use an external process manager. Follow the offline restore procedure in the deployment guide. Standalone processes support managed restoration.", "preflightError": "Preflight failed. Check archive integrity, disk space and version, and confirm the backup contains your active owner account.", "stale": "Preflight expired or another task is active. Run preflight again.", "reconnecting": "The server is restarting. Sign in again after restoration to see the result.", "progressHelp": "A safety backup is created before replacing data. If the restored server cannot start, the original data is restored automatically. Sign in again to view the saved result.", "states": {"queued": "Restore queued", "checking": "Rechecking backup", "safetyBackup": "Creating safety backup", "restarting": "Restarting server", "switching": "Replacing data", "starting": "Checking restored startup", "completed": "Restore completed", "failed": "Restore not applied", "rolledBack": "Startup failed · original data restored", "recoveryRequired": "Manual recovery required"}, "errors": {"preflight": "Preparation failed. Current platform data was not replaced. Check server logs and run preflight again.", "interrupted": "Restoration was interrupted. Check server logs before retrying preflight.", "startup": "The restored server failed to start. The original data has been put back.", "recovery": "Automatic rollback could not finish. Stop the service and follow the deployment guide to restore the safety backup."}}, "backups": {"safety": "Safety backup", "retentionHelp": "Scheduling is off by default. Only successful scheduled backups are pruned, keeping at least the newest one. Delete manual and safety backups explicitly. A missed run is executed once after startup."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{restore:{listenerChanges:"监听设置有待生效变更",listenerHelp:"请先应用或撤销监听设置的变更，再恢复备份，以保持访问地址不变。"}},true,true);
i18n.addResourceBundle("en-US","translation",{restore:{listenerChanges:"Listener changes are pending",listenerHelp:"Apply or discard pending listener changes before restoring to keep your access addresses unchanged."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"restore": {"history": {"title": "恢复记录", "all": "全部结果", "filter": "恢复结果", "refresh": "刷新记录", "startedAt": "记录时间", "actor": "操作人", "target": "恢复目标", "result": "结果", "details": "查看详情", "updatedAt": "最后更新：{{time}}", "recordHelp": "此记录在恢复后保留。关联安全备份保存的是该次恢复执行前的数据。", "downloadSafety": "下载恢复前安全备份", "noSafety": "安全备份未生成或已删除", "empty": "暂无恢复记录", "total": "共 {{count}} 条", "unknownTime": "未记录", "unknownActor": "账号不可用", "unknownStatus": "未知状态", "incomplete": "部分记录无法读取", "incompleteHelp": "部分历史记录暂时无法读取，已展示其余记录。请刷新重试，持续异常时检查服务端历史文件。"}, "states": {"preparing": "准备恢复数据"}, "errors": {"integrity": "备份文件校验失败或包含不安全路径。请选择其他已校验备份，或重新创建备份。", "version": "此备份由更高版本创建，请先升级平台后再恢复。", "space": "可用磁盘空间不足。请释放空间后重新预检。", "database": "备份中的数据库完整性或数据关系校验未通过，请选择其他备份。", "ownerMissing": "备份中不存在当前有效的平台负责人账号，无法执行恢复。", "missingArchive": "备份文件已删除或无法找到，请刷新备份列表。", "busy": "已有备份或恢复任务正在执行，请等待完成后重试。", "listenerChanges": "请先应用或撤销待生效的监听设置，再恢复备份。", "unavailable": "当前服务运行方式不支持后台恢复，请使用停机恢复流程。", "safetyBackup": "恢复前安全备份未能完成，当前数据未被替换。请检查磁盘空间和目录权限后重试。", "handoff": "未能将任务交给恢复进程，当前数据未被替换。请检查服务日志后重试。"}}},true,true);

i18n.addResourceBundle("en-US","translation",{"restore": {"history": {"title": "Restore history", "all": "All results", "filter": "Restore result", "refresh": "Refresh history", "startedAt": "Recorded", "actor": "Requested by", "target": "Restore point", "result": "Result", "details": "View details", "updatedAt": "Last updated: {{time}}", "recordHelp": "This record survives restoration. The linked safety backup contains the data from immediately before this restore.", "downloadSafety": "Download pre-restore safety backup", "noSafety": "Safety backup was not created or has been deleted", "empty": "No restore history yet", "total": "{{count}} records", "unknownTime": "Not recorded", "unknownActor": "Account unavailable", "unknownStatus": "Unknown status", "incomplete": "Some records could not be read", "incompleteHelp": "Some history records are temporarily unreadable. Other records are shown. Refresh to retry; if the issue persists, check the server history files."}, "states": {"preparing": "Preparing restored data"}, "errors": {"integrity": "The archive failed verification or contains unsafe paths. Choose another verified backup or create a new one.", "version": "This backup was created by a newer version. Upgrade the platform before restoring it.", "space": "There is not enough disk space. Free up space and run preflight again.", "database": "The backup database failed integrity or reference checks. Choose another backup.", "ownerMissing": "This backup does not contain your active platform owner account, so it cannot be restored.", "missingArchive": "The backup archive was deleted or could not be found. Refresh the backup list.", "busy": "Another backup or restore is running. Wait for it to finish before retrying.", "listenerChanges": "Apply or discard pending listener changes before restoring.", "unavailable": "This service mode requires the offline restore procedure.", "safetyBackup": "The pre-restore safety backup failed. Current data was not replaced. Check disk space and directory permissions before retrying.", "handoff": "The recovery process could not take over. Current data was not replaced. Check server logs before retrying."}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"backups": {"check": {"label": "校验结果", "all": "全部校验结果", "action": "校验备份", "passed": "校验通过", "damaged": "文件损坏", "unavailable": "无法读取", "interrupted": "校验中断", "unchecked": "未记录校验", "queued": "等待校验", "checking": "正在校验", "time": "最近检查：{{time}}", "noTime": "未记录检查时间", "unavailableAction": "当前无法校验，请等待其他备份或恢复任务结束后重试。", "help": {"passed": "整包与文件清单校验通过，结果仅反映检查时的文件完整性。恢复时仍需重新预检。", "damaged": "备份内容与校验记录不一致，或文件清单无效。请使用其他备份或重新创建。", "unavailable": "备份文件不存在或无法读取。检查存储和访问权限后可重新校验。", "interrupted": "服务停止或检查超时，可重新校验。原备份文件保留。", "unchecked": "旧备份未记录独立校验结果，可点击盾牌图标重新检查。", "queued": "校验任务已排队，完成后自动更新结果。", "checking": "正在检查整包和文件清单，不暂停业务操作。"}}, "states": {"checkingArchive": "正在校验备份"}}},true,true);

i18n.addResourceBundle("en-US","translation",{"backups": {"check": {"label": "Verification result", "all": "All verification results", "action": "Verify backup", "passed": "Verification passed", "damaged": "Damaged archive", "unavailable": "Unreadable archive", "interrupted": "Verification interrupted", "unchecked": "No recorded verification", "queued": "Verification queued", "checking": "Checking archive", "time": "Last checked: {{time}}", "noTime": "No check time recorded", "unavailableAction": "Verification is unavailable. Wait for the current backup or restore task to finish and retry.", "help": {"passed": "Archive and file checksums passed. This reflects integrity at the time of the check. Restore still requires a new preflight.", "damaged": "The archive differs from its checksum record or has an invalid manifest. Use another backup or create a new one.", "unavailable": "The archive is missing or unreadable. Check storage and access permissions, then retry.", "interrupted": "The service stopped or the check timed out. Retry verification; the archive is retained.", "unchecked": "This older backup has no recorded verification result. Use the shield icon to check it again.", "queued": "Verification is queued. The result updates automatically.", "checking": "Checking the archive and manifest without pausing business operations."}}, "states": {"checkingArchive": "Checking archive"}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{"backups": {"check": {"recordFailed": "结果未保存", "help": {"recordFailed": "检查结果未能保存。请检查存储空间和权限后重新校验；当前结果未被确认为通过。"}}}},true,true);

i18n.addResourceBundle("en-US","translation",{"backups": {"check": {"recordFailed": "Result not saved", "help": {"recordFailed": "The check result could not be saved. Check storage space and permissions, then verify again. This result is not confirmed as passed."}}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{notifications:{openBackups:"查看备份",owners:"平台负责人",backupAudienceHint:"备份提醒仅发送给有效的平台负责人。",kinds:{backup_failed:"自动备份失败",backup_damaged:"备份损坏",backup_stale:"缺少近期备份"}}},true,true);
i18n.addResourceBundle("en-US","translation",{notifications:{openBackups:"View backups",owners:"Platform owners",backupAudienceHint:"Backup alerts are sent only to active platform owners.",kinds:{backup_failed:"Automatic backup failed",backup_damaged:"Damaged backup",backup_stale:"No recent backup"}}},true,true);

i18n.addResourceBundle("zh-CN", "translation", { fileTransfer: {
  resolveFirst: "请先处理待上传文件", resume: "继续上传", processing: "服务器处理中…", progress: "正在上传 {{percent}}%", progressFor: "{{name}} 上传进度",
  cancelFor: "取消上传 {{name}}", retryFor: "重试上传 {{name}}", dismissFor: "移除上传记录 {{name}}"
}}, true, true);
i18n.addResourceBundle("en-US", "translation", { fileTransfer: {
  resolveFirst: "Resolve pending uploads first", resume: "Resume upload", processing: "Processing…", progress: "Uploading {{percent}}%", progressFor: "Upload progress for {{name}}",
  cancelFor: "Cancel upload of {{name}}", retryFor: "Retry upload of {{name}}", dismissFor: "Dismiss upload of {{name}}"
}}, true, true);

// On-demand draft conflict comparison.
i18n.addResourceBundle("zh-CN", "translation", { saveRecovery: {
  compareTitle: "处理编辑冲突", compareHint: "选择要保留的输入，其余采用最新版本。附件保持最新。",
  local: "本次输入", latest: "服务器最新", apply: "应用并继续编辑", copyLocal: "复制本次输入", copied: "已复制", copyFailed: "复制失败，请手动选择并复制文字。",
  empty: "未填写", yes: "需要", no: "不需要", unavailableOption: "已停用或不可用的选项", unnamedCharacter: "未命名角色",
  narration: "旁白配音", voices: "参考音色", preferredVoice: "首选音色", noDifferences: "填写内容一致，可直接使用最新版本继续编辑。",
  changedAgain: "内容又有更新，已刷新比较结果，请重新确认。", notEditable: "项目已不可编辑，可复制本次输入后载入最新状态。",
  characterChanged: "角色有新增或删除，角色列表采用最新版本；未匹配角色的输入可复制保留。"
}}, true, true);
i18n.addResourceBundle("en-US", "translation", { saveRecovery: {
  compareTitle: "Resolve editing conflict", compareHint: "Choose the inputs to keep. Other fields and attachments use the latest version.",
  local: "Your input", latest: "Latest on server", apply: "Apply and continue", copyLocal: "Copy your input", copied: "Copied", copyFailed: "Copy failed. Select and copy the text manually.",
  empty: "Not entered", yes: "Required", no: "Not required", unavailableOption: "Retired or unavailable option", unnamedCharacter: "Unnamed character",
  narration: "Narration", voices: "Reference voices", preferredVoice: "Preferred voice", noDifferences: "Your inputs match. Use the latest version to continue editing.",
  changedAgain: "Content changed again. The comparison has been refreshed; please review it again.", notEditable: "This project is no longer editable. Copy your input before loading its latest status.",
  characterChanged: "Characters were added or removed. The latest list is used; you can copy inputs for unmatched characters."
}}, true, true);

i18n.addResourceBundle("zh-CN", "translation", { submissionRecovery: {
  checking: "正在核实结果…", check: "检查提交结果", unknown: "暂时无法确认提交结果。网络恢复后，请先检查结果。", retryHint: "当前仍为草稿，资料已保留，可以重试提交。", retry: "重试提交"
}}, true, true);
i18n.addResourceBundle("en-US", "translation", { submissionRecovery: {
  checking: "Checking result…", check: "Check submission result", unknown: "The submission result could not be confirmed. Check it once your connection returns.", retryHint: "The project is still a draft. Your information is retained and you can retry.", retry: "Retry submission"
}}, true, true);

i18n.addResource("zh-CN", "translation", "tasks.filters.activeCount", "筛选，已应用 {{count}} 项条件");
i18n.addResource("en-US", "translation", "tasks.filters.activeCount", "Filters, {{count}} active condition");

i18n.addResourceBundle("zh-CN", "translation", { tasks: { tabs: { all: "全部", pending: "待处理" } } }, true, true);
i18n.addResourceBundle("en-US", "translation", { tasks: { tabs: { all: "All", pending: "Pending" } } }, true, true);

i18n.addResourceBundle("zh-CN","translation",{notifications:{kinds:{feedback_reply:"平台反馈回复"}}},true,true);
i18n.addResourceBundle("en-US","translation",{notifications:{kinds:{feedback_reply:"Platform feedback reply"}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{feedback:{deliveryRuleHint:"反馈回复固定发送给反馈人，不能停用或静默。"}},true,true);
i18n.addResourceBundle("en-US","translation",{feedback:{deliveryRuleHint:"Feedback replies are always sent to the person who submitted the feedback and cannot be disabled or muted."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{feedback:{chooseImage:"选择图片",noImage:"未选择图片"}},true,true);
i18n.addResourceBundle("en-US","translation",{feedback:{chooseImage:"Choose image",noImage:"No image selected"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{feedback:{imageHint:"支持 PNG、JPG、WebP，原图最多 10 MB，上传前自动压缩。",processingImage:"正在处理图片…",errors:{image:"请选择不超过 10 MB 的 PNG、JPG 或 WebP 图片。",imageProcessing:"无法处理这张图片，请重新选择或裁剪后再试。"}}},true,true);
i18n.addResourceBundle("en-US","translation",{feedback:{imageHint:"PNG, JPG or WebP, up to 10 MB. Images are compressed automatically before upload.",processingImage:"Processing image…",errors:{image:"Choose a PNG, JPG or WebP image up to 10 MB.",imageProcessing:"Unable to process this image. Choose another image or crop it and try again."}}},true,true);

i18n.addResourceBundle("zh-CN","translation",{deliveryRecovery:{checking:"正在核对发布结果…",processing:"上传完成，服务器正在处理…",unknown:"暂时无法确认发布结果，请先检查结果。",retry:"尚未确认发布成功，可按原文件重试。",revoked:"这次成品已发布过，但已被撤回；重试不会重新发布。",error:"这次上传未完成，请检查提示后重新选择。",conflict:"同一次上传的文件或说明发生变化，请重新选择。",check:"检查发布结果",retryAction:"重试原文件",chooseAgain:"重新选择文件"}},true,true);
i18n.addResourceBundle("en-US","translation",{deliveryRecovery:{checking:"Checking publication result…",processing:"Upload complete. Processing on the server…",unknown:"Publication could not be confirmed. Check the result before continuing.",retry:"Publication is not confirmed. You can retry the original file.",revoked:"This delivery was published and then withdrawn. Retrying will not republish it.",error:"The upload did not complete. Review the error and choose a file again.",conflict:"The file or note changed for this upload. Choose a file again.",check:"Check publication result",retryAction:"Retry original file",chooseAgain:"Choose another file"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{projectProgress:{title:"当前进展",waiting:"资料已提交，正在由团队跟进。如需补充资料，你会收到站内通知。",production:"项目正在制作中，成品发布后可在这里下载。",completed:"项目已完成。请查看成品交付信息。",closed:"项目已关闭，已提交的资料仍可在下方查看。",viewMaterials:"查看提交资料"}},true,true);
i18n.addResourceBundle("en-US","translation",{projectProgress:{title:"Current progress",waiting:"Your brief has been submitted and is being followed up. We will notify you here if more information is needed.",production:"Your project is in production. The final file will be available here when published.",completed:"Your project is complete. Check the delivery information for available files.",closed:"This project is closed. Your submitted materials remain available below.",viewMaterials:"View submitted materials"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{notifications:{clearFilters:"清除筛选",noResults:"没有符合筛选条件的通知，请调整或清除筛选。",invalidDates:"请输入有效日期，结束日期不能早于开始日期。",readAll:"所有通知标为已读",readAllConfirm:"将当前账号已有的所有通知标为已读？这包括未显示和已归档的通知，不受当前筛选或勾选范围限制；不会改变事项的处理状态。"}},true,true);
i18n.addResourceBundle("en-US","translation",{clientUx:{manuscriptOptional:"Book text (optional)"},notifications:{clearFilters:"Clear filters",noResults:"No notifications match your filters. Adjust or clear the filters.",invalidDates:"Enter valid dates. The end date must not be before the start date.",readAll:"Mark all notifications as read",readAllConfirm:"Mark all existing notifications for this account as read? This includes hidden and archived notifications, regardless of the current filters or selection. This will not change their action status."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{recovery:{refreshFailed:"暂时无法更新，当前显示上次加载的内容。"},feedback:{timeout:"发送等待超时，内容已保留。可重试确认提交结果，不会重复提交同一条反馈。"}},true,true);
i18n.addResourceBundle("en-US","translation",{recovery:{refreshFailed:"Unable to refresh right now. Showing the last loaded content."},feedback:{timeout:"The request timed out. Your feedback is preserved. Retry to confirm the result without creating a duplicate."}},true,true);

i18n.addResourceBundle("zh-CN","translation",{taskDetail:{contents:"提交资料导航",previewCover:"查看原图"}},true,true);
i18n.addResourceBundle("en-US","translation",{taskDetail:{contents:"Submitted materials navigation",previewCover:"View original"}},true,true);

i18n.addResourceBundle("zh-CN","translation",{notifications:{listLimit:"已达到本次加载上限，请缩小筛选范围查找更多通知。"}},true,true);
i18n.addResourceBundle("en-US","translation",{notifications:{listLimit:"The loading limit has been reached. Narrow your filters to find more notifications."}},true,true);
i18n.addResourceBundle("zh-CN", "translation", {"email":{"verification":"邮箱验证","verified":"已验证，可用于找回密码","unverified":"尚未验证","sendVerification":"发送验证邮件","notifications":"邮件通知","notificationHint":"有新的未读站内通知时，通过邮件提醒。关闭后仍可接收站内通知。","queued":"验证邮件已加入发送队列，请留意发送状态。","saved":"邮件偏好已保存。","forgot":"忘记密码？","forgotHint":"请输入已验证的登录邮箱。未验证或无法访问邮箱时，请联系平台负责人。","forgotSent":"如果该邮箱对应可用且已验证的账号，你将收到重置邮件。请检查收件箱和垃圾邮件，60 秒后可重试。","sendReset":"发送重置链接","resetTitle":"重置密码","resetHint":"设置 8–128 个字符的新密码，完成后需要重新登录。","resetDone":"密码已重置，原登录会话已失效。请使用新密码登录。","verifyHint":"点击下方按钮确认验证此邮箱。链接仅可使用一次，10 分钟后失效。","verifyDone":"邮箱验证成功。可返回个人设置开启邮件通知。","confirmVerify":"确认验证","delivery":{"pending":"验证邮件等待发送中。","sent":"验证邮件已交给邮件服务器，请查看邮箱。","failed":"验证邮件发送失败，请稍后重试或联系平台负责人。","expired":"验证链接已过期，请重新发送。"},"errors":{"unavailable":"平台暂未启用邮件服务，请联系平台负责人。","invalidLink":"链接无效、已使用或已过期，请重新申请邮件链接。","cooldown":"请求过于频繁，请等待 60 秒后重试。","verifyFirst":"请先验证邮箱，再开启邮件通知。"}}}, true, true);
i18n.addResourceBundle("en-US", "translation", {"email":{"verification":"Email verification","verified":"Verified · available for password recovery","unverified":"Not verified","sendVerification":"Send verification email","notifications":"Email notifications","notificationHint":"Receive an email reminder for new unread notifications. In-app notifications remain available when this is off.","queued":"Verification email queued. Check the delivery status below.","saved":"Email preferences saved.","forgot":"Forgot password?","forgotHint":"Enter your verified sign-in email. If it is unverified or inaccessible, contact the platform owner.","forgotSent":"If this email belongs to an active, verified account, a reset email will be sent. Check your inbox and spam folder. You can retry after 60 seconds.","sendReset":"Send reset link","resetTitle":"Reset password","resetHint":"Choose a new password of 8–128 characters. Sign in again after resetting.","resetDone":"Password reset. Previous sessions have been revoked. Sign in with your new password.","verifyHint":"Confirm below to verify this email. The link can be used once and expires after 10 minutes.","verifyDone":"Email verified. Return to your profile to enable email notifications.","confirmVerify":"Verify email","delivery":{"pending":"Verification email waiting to be sent.","sent":"Verification email accepted by the mail server. Check your inbox.","failed":"Verification email failed to send. Retry later or contact the platform owner.","expired":"Verification link expired. Send a new email."},"errors":{"unavailable":"Email service is not enabled. Contact the platform owner.","invalidLink":"This link is invalid, expired or already used. Request a new email link.","cooldown":"Please wait 60 seconds before requesting another email.","verifyFirst":"Verify your email before enabling email notifications."}}}, true, true);
i18n.addResourceBundle("zh-CN", "translation", {"oidc":{"other":"其他登录方式","settings":"登录方式","account":"企业账号","none":"暂未启用其他登录方式","loginHint":"请使用已在个人设置中绑定的企业账号登录。","bound":"已绑定企业账号","notBound":"尚未绑定","bind":"绑定企业账号","unbind":"解除绑定","bindHint":"验证当前平台密码后，将前往企业登录服务。请确认选择的是你自己的企业账号。","unbindHint":"请输入当前平台密码确认解除绑定，之后仍可使用密码登录。","continue":"继续验证","boundDone":"企业账号绑定成功。","ownerOnly":"仅平台所有者可以配置第三方登录。","enabled":"已启用","disabled":"已关闭","configure":"配置","scopeHint":"可配置并同时启用多个 OIDC 登录服务。用户按服务绑定账号，角色与组织权限仍由平台管理。","enable":"启用企业登录","callbacks":"请将以下回调地址登记到身份服务中：","testHint":"配置检查只验证服务发现与签名公钥。Client ID、密钥和回调地址仍需通过真实账号登录验收。","tested":"服务发现与公钥检查通过，请继续完成真实登录验收。","test":"检查服务配置","save":"保存配置","secretRetained":"不修改时保留现有密钥；更换服务地址或 Client ID 时需重新填写。","secretHint":"按身份服务要求填写 Client Secret，仅保存在服务端。","publicOriginHint":"包含 https://，如 https://portal.example.com；本地开发可填 http://127.0.0.1:5173，不添加语言或页面路径。","adminOriginHint":"包含 https://，如 https://admin.example.com；同域部署可带 /admin，本地开发可填 http://127.0.0.1:5174。","fields":{"nameZh":"按钮名称（中文）","nameEn":"按钮名称（英文）","issuer":"OIDC Issuer 地址（HTTPS）","clientId":"Client ID","publicOrigin":"客户门户域名","adminOrigin":"管理后台域名","secret":"Client Secret"},"errors":{"invalid":"配置无效，请检查地址和必填信息。","connection":"无法验证 OIDC 服务发现或签名公钥，请检查服务地址及网络。","conflict":"配置已被其他操作修改，请取消编辑并刷新后重试。","unavailable":"企业登录暂不可用，请使用密码登录。","password":"密码验证失败，请检查密码或稍后重试。","failed":"企业登录未完成或已过期，请重新发起，也可使用密码登录。","unbound":"此企业账号尚未绑定可用的平台账号，或无权进入管理员后台。请先使用密码登录。","binding":"绑定未完成：账号已绑定、登录会话已变化或操作已过期。请重新登录后检查。"}}}, true, true);
i18n.addResourceBundle("en-US", "translation", {"oidc":{"other":"Other sign-in options","settings":"Sign-in methods","account":"Enterprise account","none":"No other sign-in methods are enabled","loginHint":"Use an enterprise account already linked in your profile.","bound":"Enterprise account linked","notBound":"Not linked","bind":"Link enterprise account","unbind":"Unlink account","bindHint":"Confirm your current platform password, then continue to your identity provider. Choose your own enterprise account.","unbindHint":"Confirm your current platform password to unlink. Password sign-in remains available.","continue":"Continue","boundDone":"Enterprise account linked.","ownerOnly":"Only the platform owner can configure third-party sign-in.","enabled":"Enabled","disabled":"Disabled","configure":"Configure","scopeHint":"Configure and enable multiple OIDC providers. Users link each provider separately; roles and organization access remain managed by the platform.","enable":"Enable enterprise sign-in","callbacks":"Register these callback URLs with your identity provider:","testHint":"This check validates discovery and signing keys only. Verify the Client ID, secret and callback URLs with a real sign-in before rollout.","tested":"Discovery and signing keys verified. Complete a real sign-in to validate the integration.","test":"Check provider configuration","save":"Save configuration","secretRetained":"The existing secret is retained unless changed. Enter it again when changing the issuer or Client ID.","secretHint":"Enter a Client Secret if required by your provider. Stored on the server only.","publicOriginHint":"Include https://, e.g. https://portal.example.com. For local development, use http://127.0.0.1:5173. Do not append a language or page path.","adminOriginHint":"Include https://, e.g. https://admin.example.com. Shared-domain deployments may include /admin; local development can use http://127.0.0.1:5174.","fields":{"nameZh":"Button label (Chinese)","nameEn":"Button label (English)","issuer":"OIDC Issuer URL (HTTPS)","clientId":"Client ID","publicOrigin":"Customer portal domain","adminOrigin":"Admin portal domain","secret":"Client Secret"},"errors":{"invalid":"Invalid configuration. Check the URLs and required fields.","connection":"Unable to validate OIDC discovery or signing keys. Check the issuer and network.","conflict":"The configuration changed elsewhere. Cancel editing and refresh before retrying.","unavailable":"Enterprise sign-in is unavailable. Use your password instead.","password":"Password verification failed. Check your password or try again later.","failed":"Enterprise sign-in failed or expired. Start again or use your password.","unbound":"This enterprise account is not linked to an active platform account, or cannot access administration. Sign in with your password first.","binding":"Unable to link: the account is already linked, the session changed or the request expired. Sign in again and check your profile."}}}, true, true);

i18n.addResourceBundle("zh-CN", "translation", { oidc: { add: "添加登录服务", noneConfigured: "尚未配置登录服务", delete: "删除", confirmDelete: "确认删除", deleteHint: "删除“{{name}}”及其账号绑定？已有平台账号不受影响。", saveForCallback: "先保存服务，再登记生成的回调地址并启用。", errors: { duplicate: "此 Issuer 与 Client ID 已配置，请编辑已有服务。" } } }, true, true);
i18n.addResourceBundle("en-US", "translation", { oidc: { add: "Add sign-in provider", noneConfigured: "No sign-in providers configured", delete: "Delete", confirmDelete: "Confirm deletion", deleteHint: "Delete {{name}} and its account links? Platform accounts will remain.", saveForCallback: "Save first, then register the generated callback URLs and enable the provider.", errors: { duplicate: "This issuer and client ID are already configured. Edit the existing provider." } } }, true, true);

i18n.addResourceBundle("zh-CN", "translation", { oidc: { helpFor: "{{field}}填写说明", callbackLabel: "回调地址", callbackPending: "保存后生成" } }, true, true);
i18n.addResourceBundle("en-US", "translation", { oidc: { helpFor: "Help for {{field}}", callbackLabel: "Callback URLs", callbackPending: "Available after saving" } }, true, true);

i18n.addResourceBundle("zh-CN", "translation", { mailQueue: { configuration: {
  title: "发件配置检查", scope: "仅检查当前进程读取的配置格式，不连接邮件服务器，也不验证凭据或实际投递。修改部署配置后需重启 API。", passed: "通过", failed: "需检查",
  labels: { enabled: "邮件开关", host: "SMTP 主机", port: "STARTTLS 端口", sender: "发件邮箱", portal: "客户门户域名", credentials: "认证配置" },
  hints: { enabled: "需要启用时，将 Lifewood__Mail__Enabled 设为 true。", host: "Lifewood__Mail__Host 只填写主机名或 IP，不含协议、端口、路径和空格。", port: "Lifewood__Mail__Port 需为 1–65535 的有效端口。当前使用 STARTTLS，不支持隐式 TLS 的 465 端口；未填写时默认 587。", sender: "Lifewood__Mail__From 需为完整发件邮箱，不含显示名称。", portal: "Lifewood__Mail__PublicUrl 需为包含 https:// 的门户域名，不附带页面路径、参数或片段。本机允许 HTTP。", credentials: "Lifewood__Mail__Username 与 Password 应同时配置；无认证中继可同时留空，是否允许仍由邮件服务器决定。" }
} } }, true, true);
i18n.addResourceBundle("en-US", "translation", { mailQueue: { configuration: {
  title: "Sender configuration checks", scope: "Checks configuration syntax loaded by this process only. No SMTP connection, credential validation or delivery test is performed. Restart the API after changing deployment configuration.", passed: "Passed", failed: "Check needed",
  labels: { enabled: "Email switch", host: "SMTP host", port: "STARTTLS port", sender: "Sender address", portal: "Customer portal domain", credentials: "Authentication settings" },
  hints: { enabled: "Set Lifewood__Mail__Enabled to true when ready to enable email.", host: "Lifewood__Mail__Host accepts a hostname or IP only, without a scheme, port, path or spaces.", port: "Lifewood__Mail__Port must be a valid port from 1 to 65535. This adapter uses STARTTLS, not implicit TLS on port 465. Omitted values default to 587.", sender: "Lifewood__Mail__From must be a complete email address without a display name.", portal: "Lifewood__Mail__PublicUrl must include https:// with no page path, query or fragment. Local loopback HTTP is allowed.", credentials: "Set both Lifewood__Mail__Username and Password, or leave both empty for an unauthenticated relay. The mail server still decides whether to accept the connection." }
} } }, true, true);

i18n.addResourceBundle("zh-CN", "translation", { mailQueue: {
  title: "邮件状态", ownerOnly: "仅平台负责人可以查看邮件发送状态。", available: "发件配置已就绪", unavailable: "邮件未启用或配置未就绪", refresh: "刷新", checked: "更新于 {{time}}",
  help: "这里显示当前保留的队列记录，不是完整邮件历史；超过发送有效期 7 天的记录不计入。统计不随筛选变化。已交给邮件服务器不代表已送达收件箱。失败会自动重试，最多 5 次；暂停表示发件配置或收件账号暂不可用。邮箱已脱敏，不展示邮件正文、链接和密钥。",
  status: "状态", kind: "邮件类型", all: "全部", clear: "清除筛选", empty: "没有符合条件的邮件记录", recipient: "收件邮箱", failures: "失败次数", next: "计划尝试时间", expires: "发送有效期至", page: "第 {{page}} / {{pages}} 页 · 共 {{count}} 条", previous: "上一页", nextPage: "下一页",
  states: { pending: "待发送", retrying: "等待重试", sent: "已交给邮件服务器", failed: "重试已耗尽", expired: "已过期", cancelled: "已取消", paused: "已暂停" },
  kinds: { verify: "邮箱验证", reset: "密码重置", notice: "通知提醒", security: "账号安全提醒" }
}, email: { errors: { invalidFilter: "筛选条件无效，请清除筛选后重试。" } } }, true, true);
i18n.addResourceBundle("en-US", "translation", { mailQueue: {
  title: "Email status", ownerOnly: "Only the platform owner can view email delivery status.", available: "Sender configuration ready", unavailable: "Email disabled or not configured", refresh: "Refresh", checked: "Updated {{time}}",
  help: "This shows retained queue records, not a complete email history. Records more than 7 days past their send deadline are excluded. Counts are not affected by filters. Accepted by the mail server does not mean delivered to the inbox. Failed sends retry automatically, up to 5 attempts. Paused means sender configuration or the recipient account is unavailable. Addresses are masked; message bodies, links and secrets are not shown.",
  status: "Status", kind: "Email type", all: "All", clear: "Clear filters", empty: "No matching email records", recipient: "Recipient", failures: "Failed attempts", next: "Scheduled attempt", expires: "Send deadline", page: "Page {{page}} / {{pages}} · {{count}} records", previous: "Previous", nextPage: "Next",
  states: { pending: "Pending", retrying: "Waiting to retry", sent: "Accepted by mail server", failed: "Retries exhausted", expired: "Expired", cancelled: "Cancelled", paused: "Paused" },
  kinds: { verify: "Email verification", reset: "Password reset", notice: "Notification reminder", security: "Account security notice" }
}, email: { errors: { invalidFilter: "Invalid filters. Clear them and try again." } } }, true, true);

i18n.addResourceBundle("zh-CN", "translation", { oidc: { errors: { conflict: "配置已在其他地方变更，请核对最新配置后再保存。" }, recovery: {
  title: "配置版本冲突", review: "核对最新配置", field: "字段", mine: "当前填写", server: "服务器最新值",
  replace: "采用服务器版本", keep: "保留本次改动", missing: "此登录服务已被删除。当前填写仍保留，请取消编辑后返回列表。",
  replaceConfirm: "放弃当前填写，载入服务器最新配置？尚未保存的密钥也会清空。",
  keepConfirm: "将本次修改过的字段保留到最新版本，其他字段采用服务器值？不会立即保存；尚未保存的密钥会清空，更换 Issuer 或 Client ID 后请重新填写密钥。",
  ready: "已载入最新版本，请核对后再保存。如需更换密钥，或修改了 Issuer、Client ID，请重新填写密钥。", same: "可见字段一致，版本或密钥可能已更新。"
} } }, true, true);
i18n.addResourceBundle("en-US", "translation", { oidc: { errors: { conflict: "The configuration changed elsewhere. Review the latest version before saving." }, recovery: {
  title: "Configuration conflict", review: "Review latest configuration", field: "Field", mine: "Current input", server: "Latest server value",
  replace: "Use server version", keep: "Keep my changes", missing: "This provider was deleted. Your input is preserved. Cancel editing to return to the list.",
  replaceConfirm: "Discard your current input and load the latest server configuration? Any unsaved secret will also be cleared.",
  keepConfirm: "Keep the fields you changed and use server values for the others? Nothing will be saved yet. Any unsaved secret will be cleared; enter it again if you changed the issuer or Client ID.",
  ready: "Latest version loaded. Review before saving. Enter the secret again if replacing it or if you changed the issuer or Client ID.", same: "Visible fields match; the version or secret may have changed."
} } }, true, true);
