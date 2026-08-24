# 项目文档索引

## 本地启动

Windows 用户可以直接双击项目根目录的 `启动本地环境.bat`。启动成功后会自动打开客户提交页面；需要停止时双击 `停止本地环境.bat`。无需手动输入 PowerShell 命令。若某些压缩或传输工具不支持中文文件名，也可以使用等价的 `start-local.bat` 和 `stop-local.bat`。

启动脚本可以重复双击：服务健康时会直接复用并打开页面；检测到失效或不完整的旧记录时会自动清理并重新启动。

也可以在项目根目录执行：

```powershell
npm run start:local
```

启动后访问 `http://127.0.0.1:5173/zh-CN/tasks`。平台 API 运行在 `http://127.0.0.1:5077`。另有一个只读、仅限本地且可整体移除的验收控制台：`http://127.0.0.1:5174/zh-CN`。日志写入 `artifacts/dev-logs/`。

停止三个本地服务：

```powershell
npm run stop:local
```

脚本启动正式平台 API、客户登记前端和可移除验收控制台。两个前端共用平台真实账号与会话；正式发布只包含客户前端和平台 API。

`apps/test-console/` 是明确隔离的测试工具，不属于客户产品。它使用真实账号只读检查项目是否被 API 正确接收，不提供假身份或业务工单处理能力。正式发布流程只能构建 `apps/task-entry-web`；移除方法见 `apps/test-console/TEST_ONLY_REMOVABLE.md`。

## 开始开发前必读

1. [产品需求](./product-requirements.md)：范围、用户、字段、流程、状态和验收标准。
2. [技术架构](./technical-architecture.md)：React 前端、API 适配层、正式平台服务及 Native AOT 限制。
3. [UI 设计规范](./ui-design-specification.md)：品牌化项目资料提交体验、紧凑布局、组件和 i18n 规则。
4. [开发准备与实施基线](./development-readiness.md)：仓库结构、路由、API、组件清单和第一轮顺序。

## 设计研究与参考

- [设计调研](./design-research.md)：主流官方设计体系、需求图结论和最终参考权重。
- `需求图片/`：原始需求、业务流程及三张高优先级产品界面参考。
- `docs/ui-references/`：生成的页面方向图，仅用于结构和视觉讨论。
- `工单填写系统后台参考图片/`：补充后台页面参考。

## 已确认基线

- 第一阶段实现客户使用的书籍视频项目创建、草稿、文件上传、校验、提交和项目提交记录。
- 不实现任何 AI 分析、推荐、生成或实时预览能力。
- 平台自带真实账号与 Cookie 会话；不包含默认账号、假登录或 Mock Token，验收控制台保持可移除。
- 前端使用 React 19、TypeScript 和 Vite。
- 正式平台 API 使用 C#、.NET 10、ASP.NET Core Minimal API、SQLite 和 Native AOT。
- 所有用户页面使用 locale 路由，首期为 `zh-CN` 和 `en-US`。
- 业务选项、视觉示例、参考音色和文件限制全部通过 API 配置。
- 正式客户前端不是工单管理系统；已提交项目资料包冻结，只提供项目提交记录与受理状态。
- 确认页在提交前调用服务端完整性校验；提交使用幂等键，成功后进入独立的双语提交结果页。
- 创建项目流程具有品牌化和服务引导能力；独立测试控制台仍保持紧凑高效。
