# Lifewood AIGC Story Studio 技术架构与 Native AOT 开发规范

> 文档状态：初稿  
> 版本：v0.6  
> 更新日期：2026-08-21  
> 关联需求：`docs/product-requirements.md`

## 1. 技术决策

本项目确认采用以下技术方案：

### 1.1 客户项目提交前端

- React 19。
- TypeScript。
- Vite。
- React Router。
- TanStack Query。
- React Hook Form。
- Zod。
- i18next。
- Vitest。
- Playwright。

路由采用 locale 前缀，例如 `/zh-CN/tasks` 和 `/en-US/tasks`。

### 1.2 本地测试工单服务

- C#。
- .NET 10 LTS。
- ASP.NET Core Minimal API。
- Native AOT。
- `Microsoft.Data.Sqlite`。
- `System.Text.Json` 源码生成。
- ASP.NET Core 内置 OpenAPI。

### 1.3 测试管理页面

- React 19。
- TypeScript。
- Vite。
- 作为独立测试应用，不包含在正式客户项目提交前端构建中。

### 1.4 明确排除

- 不使用 EF Core。
- 不使用依赖运行时代码生成的 ORM。
- 不使用需要运行时扫描程序集的插件体系。
- 不把本地测试服务或测试管理页面打入正式发布物。
- 不接入任何 AI 模型、AI SDK、AI 推理 API 或生成任务队列。
- 不在测试服务中模拟虚假的 AI 分析或 AI 生成结果。
- 不实现动态表单设计器或运行时加载任意表单 Schema 的执行引擎。

### 1.5 系统职责边界

正式客户前端只处理确定性的项目资料填写与提交操作；测试服务可以独立模拟接收端工单：

```text
登录
→ 查询本人书籍视频项目
→ 创建或编辑项目草稿
→ 上传文件
→ 校验表单
→ 提交项目资料包
→ 查看项目提交记录
```

业务选项、视觉示例和参考音色来自正式 API 或本地测试服务的配置数据。它们是静态参考内容，不是 AI 推荐或实时生成内容。

## 2. 选择 Native AOT 的目标

测试工单服务采用 Native AOT 的目的：

- 生成不依赖目标机器安装 .NET Runtime 的原生可执行程序。
- 缩短服务启动时间。
- 降低运行时内存占用。
- 使测试服务容易作为独立工具分发给开发或测试人员。
- 通过编译期检查减少反射、动态代码和隐式 API 契约带来的不确定性。

Native AOT 不是为了应对当前性能瓶颈。AOT 兼容性属于技术约束，不能为了开发便利在后期临时关闭。

## 3. 总体架构

```text
apps/task-entry-web
  React 客户项目提交前端
        │
        ▼
packages/api-client
  业务服务 + API 适配器
        │
        ├── local/test ──► services/test-api
        │                    .NET Native AOT
        │                    SQLite + 本地文件
        │
        └── production ──► 客户正式 API

apps/test-console
  React 测试管理页面
        │
        └───────────────► services/test-api/test-admin/*
```

客户端页面不得区分当前连接的是测试服务还是正式服务。环境差异由配置和 API 适配层处理。

## 4. 建议仓库结构

```text
Aigc/
├── apps/
│   ├── task-entry-web/
│   └── test-console/
├── services/
│   └── test-api/
│       ├── Contracts/
│       ├── Endpoints/
│       ├── Features/
│       ├── Persistence/
│       ├── Serialization/
│       ├── Migrations/
│       └── Program.cs
├── packages/
│   ├── api-client/
│   ├── domain/
│   ├── i18n/
│   └── ui/
└── docs/
```

测试服务与前端使用同一个仓库便于联调，但具有独立项目、独立启动命令和独立发布流程。

## 5. Native AOT 项目配置

测试服务项目必须以 AOT 兼容为默认配置：

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <PublishAot>true</PublishAot>
    <IsAotCompatible>true</IsAotCompatible>
    <InvariantGlobalization>false</InvariantGlobalization>
  </PropertyGroup>
</Project>
```

要求：

- 使用 `WebApplication.CreateSlimBuilder(args)` 创建应用。
- 开发阶段可以执行普通 `dotnet run` 提高迭代速度。
- 合并前和 CI 中必须执行真实的 `dotnet publish` Native AOT 编译。
- 不允许用“普通构建成功”代替 AOT 发布验证。
- 不得全局关闭裁剪或 AOT 分析警告。
- 对单个警告的抑制必须附带原因、风险说明和运行测试。

## 6. AOT 的基本限制

Native AOT 在构建时确定需要保留和编译的代码，因此测试服务不能依赖运行时才发现的类型或生成的代码。

禁止或严格限制：

- `Assembly.Load`、`Assembly.LoadFile` 等运行时程序集加载。
- `System.Reflection.Emit`。
- 运行时生成代理、DTO、序列化器或数据库实体代码。
- 通过扫描所有程序集自动发现服务、端点或映射器。
- 通过类名字符串动态创建未知类型。
- 无边界反射，例如遍历任意程序集寻找接口实现。
- 依赖 JIT 编译表达式树的功能。
- 未经验证的动态插件系统。
- 依赖动态代理的拦截器和 Mock 库进入运行时代码。

可以有限使用编译器和框架已标注为 AOT 安全的反射功能，但每个第三方依赖必须通过实际 AOT 发布验证。

## 7. ASP.NET Core 开发方式

### 7.1 使用 Minimal API

- 使用 Minimal API，不使用依赖运行时控制器发现的传统 MVC Controller 架构。
- 按业务模块显式注册端点。
- 每个端点使用明确的请求和响应类型。
- 为响应声明明确的状态码和 OpenAPI 元数据。

示例结构：

```csharp
public static class ProjectEndpoints
{
    public static IEndpointRouteBuilder MapProjectEndpoints(
        this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/projects")
            .WithTags("Projects");

        group.MapPost("/", CreateProjectAsync);
        group.MapGet("/{id:guid}", GetProjectAsync);
        group.MapPut("/{id:guid}/draft", SaveDraftAsync);
        group.MapPost("/{id:guid}/submit", SubmitProjectAsync);

        return endpoints;
    }
}
```

### 7.2 显式依赖注入

服务必须显式注册：

```csharp
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddScoped<IProjectRepository, SqliteProjectRepository>();
builder.Services.AddScoped<ProjectService>();
```

不得通过运行时程序集扫描自动注册所有接口实现。

### 7.3 明确返回模型

- 端点不得直接返回数据库内部模型。
- 请求 DTO、响应 DTO 和持久化模型相互分离。
- 返回类型尽量使用 `TypedResults` 或明确的结果联合类型。
- 所有公开 DTO 必须纳入 JSON 源码生成上下文。

## 8. JSON 序列化限制

### 8.1 必须使用源码生成

所有 HTTP 请求和响应类型必须注册到 `JsonSerializerContext`：

```csharp
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CreateProjectRequest))]
[JsonSerializable(typeof(ProjectResponse))]
[JsonSerializable(typeof(ProjectResponse[]))]
[JsonSerializable(typeof(ApiErrorResponse))]
internal partial class AppJsonSerializerContext : JsonSerializerContext;
```

注册方式：

```csharp
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(
        0,
        AppJsonSerializerContext.Default);
});
```

### 8.2 开发规则

- 新增 DTO 时必须同步添加 `JsonSerializable` 声明。
- 集合、分页结果、错误结果和嵌套泛型类型也必须注册。
- 不允许依赖 `object` 保存未知业务 DTO 后再动态序列化。
- 不允许使用 `dynamic` 作为 API 契约。
- 可配置表单中的动态扩展字段应使用明确的键值结构或 `JsonElement`，不能依赖运行时生成类型。
- JSON 命名策略、枚举格式和空值策略必须统一配置。

## 9. API 可变性与 AOT 的关系

AOT 不妨碍后端 API 调整，但要求调整后的类型在重新构建时可被静态确定。

API 可变性通过以下方式实现：

- 页面只依赖前端领域模型和业务服务。
- API DTO 与前端领域模型通过适配器转换。
- 下拉项、标签、视觉风格和参考音色由配置接口动态返回。
- API 使用版本化路径或版本请求头。
- 新增字段优先设计为可选字段，保证前后兼容。
- 前端对未知响应字段保持容忍。
- 服务端对未知请求字段的处理策略需要明确且一致。
- 破坏性接口修改必须升级 API 版本。

限制：

- 不能在不重新编译测试服务的情况下动态加载一套新的 C# DTO 插件。
- 修改强类型请求或响应契约后必须重新执行 AOT 发布。
- 可配置选项可以运行时改变，但端点形状和外层数据结构仍需保持稳定。

## 10. 数据访问规范

### 10.1 不使用 EF Core

EF Core 的 Native AOT 和预编译查询能力目前仍有较多限制。测试服务明确不使用 EF Core，以降低 AOT 风险和构建复杂度。

### 10.2 使用 Microsoft.Data.Sqlite

采用：

```text
Endpoint
→ Application Service
→ Repository Interface
→ Microsoft.Data.Sqlite
→ SQLite
```

开发要求：

- 使用参数化 SQL，禁止拼接用户输入。
- SQL 查询结果进行显式字段读取和对象映射。
- 不使用基于反射的通用实体映射器。
- 数据库连接和事务范围显式管理。
- 数据库操作支持 `CancellationToken`。
- 所有数据库时间以 UTC 存储。
- 枚举保存稳定代码，不保存本地化显示文字。

### 10.3 数据库迁移

- 使用带版本号的显式 SQL 迁移脚本。
- 服务启动时读取当前 Schema 版本并按顺序执行未应用迁移。
- 每次迁移在事务中执行。
- 已发布的迁移脚本不得直接修改，只能新增后续版本。
- 测试服务必须支持安全重建本地数据库。
- 删除和重置操作只能作用于测试服务配置的专属数据目录。

## 11. 文件上传

- 大文件采用流式处理，禁止将整个文件无条件读入内存。
- 文件大小、格式和数量由配置接口提供，并由服务端再次校验。
- 文件名不得直接作为磁盘路径。
- 生成独立文件 ID，原始文件名仅作为元数据保存。
- 所有路径必须限制在测试服务自己的数据目录内。
- 文件写入采用临时文件加原子完成标记，避免半成品被当作成功上传。
- 文件删除需要同步清理元数据，并防止路径穿越。
- 测试服务不保存真实客户的重要或敏感生产资料。

## 12. 校验与错误模型

### 12.1 校验方式

- 优先使用显式、强类型校验函数。
- 可以使用已验证为 Native AOT 兼容的编译期校验方案。
- 引入基于反射发现验证器的框架前必须完成 AOT 验证。
- 业务校验和字段格式校验分离。
- 前端校验不能替代服务端校验。

### 12.2 错误响应

服务端返回稳定错误码和 i18n 键：

```json
{
  "code": "project.validation_failed",
  "messageKey": "errors.project.validationFailed",
  "fieldErrors": [
    {
      "field": "book.title",
      "code": "required",
      "messageKey": "validation.required"
    }
  ],
  "requestId": "...",
  "retryable": false
}
```

- 测试服务不需要承担全部界面翻译，前端根据 `messageKey` 本地化。
- 服务端必须提供安全的兜底错误信息，不能返回堆栈、SQL 或文件系统路径。
- 错误 DTO 同样必须注册到 JSON 源码生成上下文。

## 13. i18n 与全球化

- `<InvariantGlobalization>` 必须设为 `false`。
- 服务端使用稳定代码传递状态、标签和错误类型。
- 动态配置项支持 `zh-CN` 和 `en-US` 名称与描述。
- 日期在 API 中使用 ISO 8601，存储使用 UTC。
- 用户时区和语言由请求头或用户资料传入。
- API 接收 `Accept-Language`，但业务值不随语言改变。
- 不使用本地化显示文字作为数据库枚举值、查询条件或权限判断依据。
- 服务端本地化资源方案必须通过 Native AOT 发布和运行验证。

### 13.1 前端 locale 路由

用户页面的路由结构：

```text
/:locale/tasks
/:locale/tasks/new/:step
/:locale/tasks/:taskId
/:locale/tasks/:taskId/edit/:step
```

首期允许的 locale：

```ts
export const supportedLocales = ["zh-CN", "en-US"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
```

实现要求：

- 在路由树顶层解析和校验 `locale`。
- i18next 的当前语言由已验证的路由 locale 驱动，不能由组件各自设置。
- 使用统一的 `localizedPath` 或等效工具生成链接。
- 使用路由 loader、布局组件或统一守卫处理非法 locale。
- 语言切换只替换路径第一段，不重新创建表单实例。
- 向导草稿状态以任务 ID 和草稿版本为键，不以 locale 为键。
- Query Cache 中业务数据不因界面语言切换被错误清空；包含本地化显示数据的查询键必须包含 locale。
- 页面标题、动态选项和错误文案在 locale 改变后更新。
- 工单正文和管理员输入内容保持原值，不自动翻译。

推荐的链接生成接口：

```ts
localizedPath({
  locale,
  route: "taskEdit",
  params: { taskId, step: "voice" },
  search
});
```

禁止在页面中直接使用：

```ts
`/${locale}/tasks/${taskId}`
```

避免各页面对编码、查询参数和路径结构产生不同实现。

### 13.2 根路径与回退

访问 `/` 时按以下顺序决定跳转语言：

1. 已登录用户保存的界面语言。
2. 本机最近一次有效选择。
3. 浏览器 `Accept-Language` 或浏览器语言。
4. 产品默认语言。

不支持的 locale 必须规范化到受支持语言。重定向需要限制次数，避免语言守卫和认证守卫相互触发形成循环。

### 13.3 非本地化路由

以下技术路由不添加 locale 前缀：

- 正式登录系统认证回调。
- 本地测试登录回调。
- API 路由。
- OpenAPI。
- 健康检查。
- 文件上传及下载接口。
- 静态资源。

认证跳转前保存完整的本地化目标地址，认证完成后恢复原 locale 和业务路径。

### 13.4 API 语言传递

- 前端从路由 locale 生成 `Accept-Language` 请求头。
- 获取动态标签、视觉风格和参考音色时，查询缓存键包含 locale。
- 保存和提交业务数据时使用稳定 ID，不发送本地化显示文字作为枚举值。
- API 返回的 `messageKey` 由前端按当前路由 locale 翻译。
- API 返回的本地化选项与请求 locale 不一致时记录诊断信息。

## 14. 认证实现

### 14.0 标准用户模型

认证适配层必须将客户登录系统或本地测试登录服务返回的身份信息转换为统一模型：

```ts
interface CurrentUser {
  id: string
  username?: string
  displayName: string
  avatarUrl?: string
  email?: string
  organization?: {
    id: string
    name: string
  }
  roles: string[]
  permissions: string[]
  locale?: SupportedLocale
  timeZone?: string
}
```

约束：

- 页面组件只依赖 `CurrentUser`，不直接读取具体 Token Claims。
- 外部字段名、Claim 名称和嵌套结构由认证适配器转换。
- 用户 ID 是权限、审计和数据关联使用的稳定值；昵称只用于显示。
- 角色和权限使用稳定代码，不使用本地化显示文字作为判断条件。
- `avatarUrl` 视为不可信外部资源，需要限制协议、处理加载失败并遵守内容安全策略。
- 用户 locale 仅用于首次选择路由语言；进入页面后以路由 locale 为准。
- 时区必须使用 IANA 时区标识或通过适配器转换为前端统一格式。
- 不把完整 Token、原始 Claims 或无关个人资料持久化到浏览器本地存储。
- 本地测试服务返回相同模型，页面不得为测试用户编写特殊分支。

### 14.1 本地测试认证

- 本地测试认证只在测试服务中实现。
- 使用显式注册的认证处理器。
- 优先使用简单、可撤销的本地会话或已验证为 AOT 兼容的签名 Token。
- 测试账号和凭证从本地开发配置加载，不写入源代码。
- 支持登录、退出、过期、无权限和用户切换测试。

### 14.2 正式认证

- 正式工单填写前端通过认证适配器接入客户现有登录系统。
- 测试认证代码不包含在正式工单填写前端发布物中。
- 正式认证失败时不得回退到本地测试身份。
- 客户正式认证协议确定后，需要单独审查相关 SDK 的浏览器兼容性；它不影响测试服务的 Native AOT 编译。

## 15. OpenAPI

- 使用 ASP.NET Core 内置 `Microsoft.AspNetCore.OpenApi`。
- OpenAPI 文档至少包含请求、响应、状态码和字段说明。
- 开发环境可以暴露 OpenAPI JSON。
- 不默认引入依赖反射或不支持 AOT 的 Swagger UI 包。
- 如需要可视化文档，优先由独立开发工具读取 OpenAPI JSON。
- 前端 API 客户端可以根据 OpenAPI 生成，但生成代码必须包在 API 适配层后。
- OpenAPI 生成过程必须包含在 AOT CI 验证中。

## 16. 日志与诊断

- 使用 ASP.NET Core 内置日志抽象。
- 高频日志优先使用 `LoggerMessage` 源码生成。
- 日志不得输出 Token、密码、书籍正文、完整表单敏感内容或文件内容。
- 每个请求生成或传递 `requestId`。
- AOT 发布时保留与环境匹配的调试符号归档，但不将调试符号无条件公开分发。
- 不引入依赖运行时代理或动态注入的 APM SDK，除非已完成 AOT 验证。

## 17. 第三方依赖准入规则

新增测试服务依赖前必须检查：

1. 官方是否声明支持 Native AOT 和 trimming。
2. 是否使用反射扫描、动态代理、运行时代码生成或动态程序集加载。
3. AOT 发布是否产生 `IL2026`、`IL3050` 等警告。
4. 是否需要额外的 linker descriptor 或 `DynamicDependency`。
5. 是否在实际目标平台运行通过。
6. 是否可以用框架内置功能或更简单的显式代码替代。

依赖准入要求：

- “普通模式下能运行”不能作为兼容依据。
- 必须在真实 Native AOT 产物中执行冒烟测试。
- 对裁剪根、保留程序集或警告抑制的使用必须记录原因。
- 无法证明兼容性的库不得进入测试服务运行路径。

## 17.1 前端 SVG 图标资产

图标来源优先级：

1. `C:\Users\11915\Pictures\svg图标` 中已有的本地 SVG。
2. 本地缺失时，从 [iconfont](https://www.iconfont.cn/) 下载单个 SVG 文件。
3. 确实无法满足时，再评估其他具有明确许可证的 SVG 来源。

工程要求：

- 选定的 SVG 必须复制到项目自己的受版本管理资产目录，例如 `apps/task-entry-web/src/assets/icons/`。
- 文件名统一改为稳定的英文 kebab-case，例如 `save.svg`、`submit.svg`、`voice-wave.svg`。
- 维护图标来源清单，记录原文件名、项目内文件名、来源、下载日期和许可证或授权说明。
- 不直接引用桌面目录作为构建输入。
- 不在运行时连接 iconfont CDN。
- 不使用 iconfont 字体文件承载核心图标，优先使用独立 SVG。
- 不允许业务页面直接加载任意远程 SVG。
- 引入前检查并移除脚本、事件属性、外部资源引用、嵌入 HTML 和不必要元数据。
- SVG 必须具有正确 `viewBox`，不得依赖固定宽高才能显示。
- 单色功能图标优先使用 `currentColor`，由设计令牌控制颜色。
- 不把包含文字的 SVG 用作可翻译界面文案。
- 图标通过统一 `Icon` 组件或编译期 SVG 组件封装，不在业务页面散落原始 SVG 字符串。

动态业务配置如需指定图标，只允许服务端返回受控 `iconKey`，前端从本地白名单映射到图标组件。禁止服务端直接返回任意 SVG 或 HTML 供前端注入。

## 18. 跨平台发布

Native AOT 需要针对目标运行环境分别构建，不存在一个原生二进制同时运行于所有平台。

首期建议目标：

- `win-x64`：本地 Windows 开发和测试。
- `linux-x64`：CI 或容器测试环境。

按需增加：

- `win-arm64`。
- `linux-arm64`。
- `osx-x64`。
- `osx-arm64`。

发布要求：

- 每个 RID 独立构建和归档。
- 在对应操作系统或兼容执行环境运行冒烟测试。
- 不假设所有依赖都被打入单一文件；SQLite 原生组件和配置文件需要检查最终发布目录。
- 配置、数据库和上传目录位于可执行文件外部，升级程序时不得覆盖测试数据。

## 19. CI/CD 强制检查

每次合并至少执行：

1. 前端类型检查、lint 和单元测试。
2. 测试服务普通构建和单元测试。
3. 测试服务 Native AOT 发布。
4. 检查 AOT 和 trimming 警告。
5. 启动实际 AOT 可执行程序。
6. 调用健康检查。
7. 执行登录、创建草稿、上传、校验、提交和查询工单冒烟测试。
8. 关闭服务并确认退出正常。
9. 检查正式前端发布物不包含测试管理路由、测试账号或 Mock Token。

建议的 AOT 验证矩阵：

```text
Windows CI  → dotnet publish -r win-x64
Linux CI    → dotnet publish -r linux-x64
```

禁止：

- 因为 AOT 构建耗时而长期跳过 CI AOT 发布。
- 无审查地使用 `SuppressTrimAnalysisWarnings` 隐藏问题。
- 只编译不运行发布后的原生程序。

## 20. 测试要求

### 20.1 单元测试

- 表单校验。
- DTO 与领域模型转换。
- SQL Repository。
- 状态转换。
- 错误码映射。
- i18n 键完整性。

### 20.2 集成测试

- SQLite 迁移。
- 草稿新增、更新和并发版本检查。
- 文件上传、替换和删除。
- 提交幂等性。
- 本地认证和权限。
- 管理端工单状态更新。

### 20.3 AOT 冒烟测试

必须针对真实 AOT 可执行程序验证：

- 所有请求和响应 DTO 均可正常序列化。
- OpenAPI 可以生成。
- SQLite 可以创建、迁移、读写和事务回滚。
- 文件可以上传、读取和删除。
- 日志和错误处理正常。
- 中文与英文配置内容不会因为全球化裁剪而异常。
- 服务停止后数据库和文件状态一致。

## 21. 开发检查清单

提交测试服务代码前，开发者需要确认：

- [ ] 新 DTO 已加入 JSON 源码生成上下文。
- [ ] 新服务采用显式 DI 注册。
- [ ] 没有新增运行时程序集扫描。
- [ ] 没有新增动态代理或运行时代码生成。
- [ ] SQL 使用参数化查询。
- [ ] 数据库映射为显式代码。
- [ ] 新依赖已通过 Native AOT 发布和运行验证。
- [ ] 没有隐藏 AOT 或 trimming 警告。
- [ ] 错误返回稳定错误码和 i18n 键。
- [ ] 文件操作限制在测试数据目录。
- [ ] 普通测试和 AOT 冒烟测试均通过。
- [ ] 正式工单填写前端构建不包含测试服务功能。

## 22. 官方参考

- [.NET 10 下载与支持状态](https://dotnet.microsoft.com/en-us/download)
- [ASP.NET Core Native AOT](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/native-aot?view=aspnetcore-10.0)
- [Native AOT 部署概览](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
- [ASP.NET Core OpenAPI](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/aspnetcore-openapi?view=aspnetcore-10.0)
- [System.Text.Json 源码生成](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation)
- [EF Core Native AOT 限制](https://learn.microsoft.com/en-us/ef/core/performance/nativeaot-and-precompiled-queries)
