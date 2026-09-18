# 帮助中心 / Help center

客户与管理端均提供 `/:locale/help`，支持中文和英文。当前客户文档 12 篇、管理文档 14 篇，覆盖入门、项目操作、账号组织、通知、配置与排障。内容以已实现行为为准，不把尚未确认的制作工作流描述为可用能力。

Both portals expose `/:locale/help` in Chinese and English. The initial catalog contains 12 customer and 14 administrator guides covering onboarding, projects, accounts, organizations, notifications, configuration and troubleshooting.

## 内容与维护 / Content maintenance

- 源文件：`services/platform-api/Help/{customer|admin}.{zh-CN|en-US}.json`。随服务端版本发布，不提供后台在线编辑器。新增或修改文章必须同步两种语言，保持文章 ID 一致，并更新 `updated`。
- 每篇包含分类、标题、摘要、操作步骤和 FAQ。以实际界面和后端权限为依据，技术文档仅供核对，避免沿用过期的入口或流程。
- 搜索通过服务端检索当前语言、当前版本的标题、摘要、分类、步骤及 FAQ。多个空格分隔词需全部匹配；不区分英文大小写。查询最长 200 字符；固定小型目录不分页。
- URL 保存 `audience`、`q` 和 `article`，可刷新、后退和直接分享。不支持的文章不会回退到其他文章而误导用户。
- 当前使用独立演示环境的 5 组中英文截图（10 张），日期为 2026-09-18，详见 `docs/images/screenshots/README.md`。图注明确演示数据范围；不是所有教程均有截图。界面发生变化时应更新截图和对应步骤。

Sources are versioned bilingual JSON embedded in the server, not a browser editor. Keep IDs synchronized, update both languages and the review date, and check instructions against the actual UI. Search covers all article text in the selected language and audience. URLs preserve query and article selection. Five pairs of Chinese/English screenshots were captured in a fresh isolated demo environment on September 18, 2026; not every tutorial currently has an image.

## 权限 / Access

- `GET /api/help` 每次重新读取有效用户及会话版本。customer 文档允许匿名读取；admin 仍要求有效登录及 `admin.access`。管理员可切换两类文档，但文档本身不授予操作权限。
- `GET /api/help/images/{name}` 使用固定白名单，管理员截图同样检查权限。未知名称及无权查看的管理截图返回 404。
- JSON 和截图均嵌入服务端程序集，避免放入公开静态目录。双语 JSON 设置 `WithCulture=false`，保证发布后仍可按固定资源名称加载。
- 登录页提供帮助入口，未登录阅读页支持返回登录与中英文切换；已登录访问保留原有导航。接口设置 `Cache-Control: no-store`；前端查询按账号、语言、受众、搜索词隔离，账号切换事件立即关闭截图并隐藏内容。

Customer articles and demo screenshots are public, including from both sign-in pages. Administrator articles and images require a valid session and `admin.access` on the server. Resources are embedded, not copied into public client assets. Responses prohibit caching. Client queries are account-scoped and hide content immediately on an account-change event.

## 验证 / Verification

`HelpApiTests` exercises anonymous access, customer/admin separation, protected images, invalid parameters, full-body bilingual search and resource loading. `help-center.spec.ts` covers both portal routes, search, article refresh, FAQ, screenshot enlargement, mobile overflow and customer denial of administrator documentation.


## 管理端功能搜索

顶部“搜索功能或帮助”打开搜索面板，按中英文关键词和同义词匹配功能入口，并全文检索管理员与客户教程。结果只导航，不自动提交或修改配置；例如“注册”可找到用户管理与登录方式，不代表平台开放自助注册。

功能目录位于 `services/platform-api/Help/functions.{zh-CN|en-US}.json`。每项维护 `path`、`title`、`category`、`keywords`、`permissions` 和 `owner`；新增页面或调整权限时同步维护两个语言版本。服务端 `/api/admin/function-search` 验证会话和管理员权限后，按全部必需权限及负责人限制过滤功能入口。帮助文档沿用现有管理员可读范围。

验证覆盖：`FunctionSearchRequiresAdminAndMatchesLocalizedSynonyms` 检查匿名、客户、普通管理员和负责人访问及同义词；`tests/e2e/help-center.spec.ts` 检查中英文搜索结果、Esc 关闭和焦点返回。
