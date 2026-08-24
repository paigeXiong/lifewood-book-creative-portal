# 第一阶段开发准备与实施基线

> 基线更新（2026-08-24）：本文件记录最初测试 API 阶段，仅供历史追溯。当前实现已迁移为自带真实账号和数据存储的 `services/platform-api`；认证与范围以 `docs/scope-registration-platform.md` 和 `docs/technical-architecture.md` 为准。

> 状态：可开工  
> 更新日期：2026-08-21  
> 范围：客户书籍视频项目提交前端、独立本地测试 API、独立测试控制台

## 1. 开工结论

当前资料已经足够开始基础工程和第一条纵向业务链路。正式登录协议、大文件上传方式和正式 API DTO 尚未确认，但不会阻止以稳定领域模型和 API 适配器开始开发。

首个可运行目标：负责人首次创建真实平台账号并登录，进入项目列表、创建草稿、填写第一步资料，保存后刷新页面可以恢复。

## 2. 固定技术基线

| 模块 | 技术 |
| --- | --- |
| 正式前端 | React 19、TypeScript、Vite、React Router |
| 数据请求 | TanStack Query |
| 表单 | React Hook Form、Zod |
| 国际化 | i18next，locale 路由前缀 |
| 前端测试 | Vitest、Playwright |
| 本地测试 API | C#、.NET 10、ASP.NET Core Minimal API、Native AOT |
| 本地存储 | Microsoft.Data.Sqlite、显式 SQL |
| JSON | System.Text.Json 源码生成 |

## 3. 仓库目标结构

```text
apps/
  task-entry-web/       正式客户项目提交前端
  test-console/         独立测试管理页面
services/
  test-api/             独立 Native AOT 测试服务
packages/
  api-client/           HTTP、DTO 适配器和业务服务
  domain/               稳定领域模型与纯业务规则
  i18n/                 路由语言、翻译资源和格式化
  ui/                   设计令牌与通用组件
docs/
```

正式前端不得依赖 `test-console` 或本地测试认证实现。

## 4. 首期路由

```text
/:locale/tasks
/:locale/tasks/new/project
/:locale/tasks/:taskId/edit/project
/:locale/tasks/:taskId/edit/characters
/:locale/tasks/:taskId/edit/voice
/:locale/tasks/:taskId/edit/review
/:locale/tasks/:taskId
/:locale/tasks/:taskId/submitted
```

首期 locale 为 `zh-CN` 和 `en-US`。非法 locale 统一由顶层路由守卫处理；语言切换保留任务 ID、步骤和查询参数。

## 5. API 契约基线

前端页面只依赖业务服务，不直接访问 URL 或后端 DTO：

```ts
projectService.listProjects(query)
projectService.createDraft(input)
projectService.getProject(projectId)
projectService.saveDraft(projectId, draft, version)
projectService.validateProject(projectId)
projectService.submitProject(projectId, idempotencyKey)
projectService.deleteDraft(projectId)

uploadService.upload(projectId, category, file)
uploadService.cancel(uploadId)
uploadService.remove(projectId, fileId)

optionService.getFormOptions(locale)
visualStyleService.list(locale)
voiceService.list(query, locale)
```

建议测试 API 首批实现：

| 优先级 | 接口 | 用途 |
| --- | --- | --- |
| P0 | `GET /api/me` | 当前真实登录用户 |
| P0 | `GET /api/projects` | 搜索、筛选和分页 |
| P0 | `POST /api/projects` | 创建草稿 |
| P0 | `GET /api/projects/{id}` | 加载草稿或详情 |
| P0 | `PUT /api/projects/{id}/draft` | 带版本号保存草稿 |
| P0 | `GET /api/form-options` | 字段选项、限制和本地化内容 |
| P1 | `POST /api/projects/{id}/files` | 文件上传 |
| P1 | `DELETE /api/projects/{id}/files/{fileId}` | 删除文件 |
| P1 | `GET /api/visual-styles` | 视觉风格示例 |
| P1 | `GET /api/voices` | 参考音色及试听 |
| P1 | `POST /api/projects/{id}/validate` | 服务端完整性检查 |
| P1 | `POST /api/projects/{id}/submit` | 幂等提交 |

## 6. 配置与枚举原则

以下内容不得散落硬编码在页面组件中：

- 状态名称和状态颜色映射。
- 书籍类型、目标受众、视频目标、平台和标签。
- 角色类型、年龄段和性别选项。
- 视觉风格名称、说明、图片和排序。
- 参考音色名称、说明、音频、标签和推荐状态。
- 文件类别、允许格式、大小和数量限制。

业务值保存稳定代码或 ID。前端静态翻译资源只保存通用界面文案；业务动态内容由测试 API 或正式 API 返回对应 locale 的显示内容。

## 7. UI 组件首批清单

### P0 基础组件

- `AppShell`、`LocaleGuard`、`UserMenu`。
- `Button`、`IconButton`、`Field`、`TextInput`、`Select`、`TextArea`。
- `StatusBadge`、`InlineMessage`、`EmptyState`、`Skeleton`。
- `StepProgress`、`StickyActionBar`、`SaveState`。
- `Panel`、`MediaCard`、`ContextRail`。

### P0 业务组件

- `TaskTable`、`TaskFilters`。
- `ProjectSummaryCard`、`CompletionChecklist`。
- `FileUploadField`、`UploadedFileRow`。
- `VisualStyleCard`、`VoiceReferenceCard`。
- `CharacterList`、`CharacterEditor`。
- `ValidationSummary`、`SubmissionResult`。

组件状态至少覆盖默认、Hover、Focus、Disabled、Loading、Empty、Error 和只读。

## 8. 第一轮开发顺序

1. 创建 monorepo、代码规范、构建脚本和环境隔离。
2. 建立设计令牌、基础 UI 和中英文资源。
3. 建立 locale 路由、真实账号、Cookie 会话与 CSRF 防护。
4. 定义领域模型、服务接口、错误模型和 Mock 数据。
5. 实现 Native AOT 测试 API 的用户、选项、任务列表、创建和保存接口。
6. 打通任务列表 → 创建草稿 → 第一步填写 → 保存恢复。
7. 实现上传、角色与视觉风格、配音与参考素材。
8. 实现确认、服务端校验、幂等提交和结果页。
9. 实现独立测试控制台。
10. 完成移动端、双语、键盘操作、异常场景和 AOT 发布验证。

## 9. 第一条纵向链路验收

- `/zh-CN/tasks` 和 `/en-US/tasks` 均可访问并显示对应语言。
- 首次建号、密码登录、退出、会话恢复、锁定和 CSRF 拒绝均使用真实认证实现。
- 列表使用服务端分页和筛选，不在页面内假分页。
- 创建草稿后获得稳定任务 ID 和版本号。
- 第一步短字段保持合理宽度，长文本按内容需要扩展。
- 项目摘要只显示当前步骤相关内容。
- 保存成功、保存失败和版本冲突均有明确状态。
- 刷新页面后可以从测试 API 恢复草稿。
- 正式前端构建物中不存在测试账号、测试登录入口或测试控制台代码。
- 测试 API 可以通过 Native AOT 发布并完成启动、保存、读取冒烟测试。

## 10. 开发前仍需业务方确认

以下内容不阻塞开工，但会影响正式联调：

- 正式登录协议、回调和用户 Claims。
- 大文件上传采用直传、分片还是普通上传。
- 授权确认是勾选声明还是签署文件。
- 提交后是否允许撤回或补充资料。
- 正式动态配置和参考音色由哪个后台维护。
- 首期英文业务内容采用美式还是英式表达。
