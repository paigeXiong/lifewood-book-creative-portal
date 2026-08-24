import { i18n } from "@lifewood/i18n";

i18n.addResourceBundle("zh-CN", "translation", {
  testConsole: {
    documentTitle: "本地项目接收测试台",
    title: "项目接收测试台",
    removable: "仅本地测试 · 可整体移除",
    identityTitle: "选择要检查的测试客户",
    identityHint: "控制台使用测试客户身份读取其项目，用于验收提交结果，不提供后台业务处理功能。",
    listTitle: "测试项目列表",
    detailTitle: "项目接收详情",
    selectProject: "选择左侧项目查看接收到的资料。",
    refresh: "刷新",
    receivedCount: "当前身份共 {{count}} 项",
    receivedFiles: "接收到的文件（{{count}}）",
    noFiles: "未接收到文件",
    characters: "角色数量",
    readonlyTitle: "只读测试工具",
    readonlyBody: "这里仅验证客户提交内容是否被平台 API 正确接收，不改变项目状态，也不属于正式产品发布物。",
    empty: "当前筛选条件下没有项目。",
  },
}, true, true);

i18n.addResourceBundle("en-US", "translation", {
  testConsole: {
    documentTitle: "Local project intake test console",
    title: "Project intake test console",
    removable: "Local test only · removable",
    identityTitle: "Choose a test customer to inspect",
    identityHint: "The console reads projects as a test customer to verify submissions. It does not provide production workflow management.",
    listTitle: "Test project list",
    detailTitle: "Received project details",
    selectProject: "Select a project on the left to inspect its received data.",
    refresh: "Refresh",
    receivedCount: "{{count}} projects for this identity",
    receivedFiles: "Received files ({{count}})",
    noFiles: "No files received",
    characters: "Characters",
    readonlyTitle: "Read-only test tool",
    readonlyBody: "This console only verifies that the local platform API received the customer submission. It does not change workflow state and is excluded from production releases.",
    empty: "No projects match the current filters.",
  },
}, true, true);
