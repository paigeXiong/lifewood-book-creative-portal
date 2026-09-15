# 项目文档索引

## 本地启动

Windows 用户可以直接双击项目根目录的 `启动本地环境.bat`。启动成功后会自动打开客户提交页面；需要停止时双击 `停止本地环境.bat`。无需手动输入 PowerShell 命令。若某些压缩或传输工具不支持中文文件名，也可以使用等价的 `start-local.bat` 和 `stop-local.bat`。

启动脚本可以重复双击：服务健康时会直接复用并打开页面；检测到失效或不完整的旧记录时会自动清理并重新启动。

也可以在项目根目录执行：

```powershell
npm run start:local
```

启动后访问客户门户 `http://127.0.0.1:5173/zh-CN/tasks`、管理中心 `http://127.0.0.1:5174/zh-CN/projects`。服务端运行在 `http://127.0.0.1:5077`，日志写入 `artifacts/dev-logs/`。

停止三个本地服务：

```powershell
npm run stop:local
```

本地脚本启动服务端及两套 Vite 开发页面。正式发布时，客户门户与管理中心的构建产物均由同一个服务端进程托管，不再启动 Vite 或 Node.js。

`apps/test-console/` 是历史验收工具，不再由启动脚本运行，也不得进入正式发布物；需要时仍可按 `apps/test-console/TEST_ONLY_REMOVABLE.md` 整体移除。

## 开始开发前必读

1. [产品需求基线](./scope-registration-platform.md)：当前范围、角色、流程、配置、交付和验收优先级。
2. [剩余工作与待确认事项](./remaining-work.md)：可继续推进的验证、未决业务规则和上线条件。
3. [客户详细需求](./product-requirements.md)：客户字段、页面和历史决策细节。
4. [管理中心需求](./admin-center-requirements.md)：用户、组织、项目跟进、最终交付和系统配置。
5. [技术架构](./technical-architecture.md)：React 前端、服务端及 Native AOT 限制。
6. [UI 设计规范](./ui-design-specification.md)：品牌化项目资料提交体验、紧凑布局、组件和 i18n 规则。
7. [当前实现与继续开发基线](./development-readiness.md)：已交付范围、仓库结构、工程约束和继续开发优先级。
8. [正式部署与数据备份](./deployment-and-backup.md)：同域路由、Native AOT 发布、数据目录、备份和恢复要求。
9. [验证并发布平台](./release-readiness.md)：Windows 与 Linux 验证、Native AOT 发布包和上线前人工检查。

## 项目处理效率

- [大文件与传输中断验证](./large-transfer-validation.md)：500 MB 成品、双语取消与连接中断恢复，以及复现方法和验证边界。
- [大文件下载内存诊断](./transfer-memory-validation.md)：独立浏览器的两轮采样、临时链接释放和峰值优化方向。
- [大文件流式保存](./streamed-delivery-download.md)：按浏览器能力直接写入所选文件，保留账号校验、取消及双语错误，并记录磁盘模式内存对照。
- [持续新增附件与文件清理验证](./attachment-growth-validation.md)：不同内容图片的持续写入、满额重放、上限拒绝、删除补传及重启后的逐项文件校验。
- [存储配额触顶与上传恢复](./storage-quota-validation.md)：507 拒绝、并发空间预留、双语错误提示、删除释放与原请求重试。
- [后台文件上传错误与恢复](./admin-upload-recovery.md)：试听音频保留文件重试、角色图片双语配额错误及最终成品的可恢复标记。
- [后台导出与下载恢复](./admin-export-recovery.md)：防止重复导出、取消后重试、切换筛选时丢弃旧结果及双语下载错误。
- [后台表单未保存保护](./admin-unsaved-editors.md)：备份策略、项目截止日期和共用关闭逻辑的双语确认、保存保护与导航恢复。

- [批量处理、趋势报表、常用筛选、草稿续填与登录设备](./productivity-tools.md)

## 设计研究与参考

- [原始需求图片与文档核对（2026-09-14）](./requirements-image-audit-2026-09-14.md)：15 张原图覆盖矩阵、四处未细化项与主文档冲突；不自动扩大开发范围。

- [生产协作与客户审阅：需求批注](./production-workflow-annotations.md)：原图歧义、当前讨论方向及开发前待确认事项（2026-09-04，暂不开发）。

- [设计调研](./design-research.md)：主流官方设计体系、需求图结论和最终参考权重。
- `需求图片/`：原始需求、业务流程及三张高优先级产品界面参考。
- `docs/ui-references/`：生成的页面方向图，仅用于结构和视觉讨论。
- `工单填写系统后台参考图片/`：补充后台页面参考。

## 已确认基线

- 第一阶段实现客户使用的书籍视频项目创建、草稿、文件上传、校验、提交和项目提交记录。
- 支持已批准的书籍资料辅助识别和后台 AI 接入配置，不提供端到端生产内容生成。
- 平台自带真实账号与 Cookie 会话；不包含默认账号、假登录或 Mock Token，历史验收工具保持可移除。
- 前端使用 React 19、TypeScript 和 Vite。
- 正式服务端使用 C#、.NET 10、ASP.NET Core Minimal API、SQLite 和 Native AOT，并托管两套生产前端。
- 所有用户页面使用 locale 路由，首期为 `zh-CN` 和 `en-US`。
- 业务选项、视觉示例、参考音色和文件限制全部通过服务端配置。
- 项目提交后默认冻结；管理员可定向退回资料单元，客户修改或回复后重新提交，退回历史仅管理员可见。最终成品由后台上传、客户下载。
- 确认页在提交前调用服务端完整性校验；提交使用幂等键，成功后进入独立的双语提交结果页。
- 创建项目流程具有品牌化和服务引导能力；管理中心采用紧凑的项目跟进布局。

## 后续维护方向（2026-09-07）

优先修复当前流程与优化反馈，保持中英文和移动端一致。客户验收、生产协作、组织共享等不自动进入开发范围；快捷账号切换、批量处理与导出已实现；模板与复制项目等未批准能力仍保留为候选。具体以[产品需求基线](./scope-registration-platform.md)为准。日常开发使用 `C:\Aigc`，不另建工作树。

- [2026-09-07 发布准备检查记录](./release-readiness-2026-09-07.md)：本地回归结果及发布前剩余检查。

- [平台公告](./announcements.md)：发布范围、登录前弹窗、个人历史和关闭记忆。

- [站内通知](./notifications.md)：业务事件、双端中心、偏好、规则、发送记录与可靠性。

- [2026-09-08 验收记录](./release-readiness-2026-09-08.md)：v0.3.10 通知、公告及升级兼容验收。

- [运营工作台、跟进期限与资料导出](operations-workbench.md)

- [用户在线状态与活跃数据](./user-presence.md)：在线判定、用户筛选统计、登录与活跃记录及权限边界。

- [账号永久注销](./account-closure.md)：注销确认、数据清理与保留范围、会话失效和不可恢复规则。

- [退回修改前后对比](./revision-comparison.md)：管理员按单元查看字段变化及附件增删，兼容历史快照和中英文。

- [审计增强与运行状态](./admin-audit-and-runtime.md)：可读对象、配置变化、CSV 导出和运行采样，以及隔离升级恢复验证。

- [后台备份管理](./managed-backups.md)：一致性快照、负责人权限、手动与定时备份、校验、保留策略及恢复兼容性。

- [客户文件上传与恢复](./file-uploads.md)：逐文件进度、取消、失败重试、避免重复文件及并发修改保护。

- [草稿编辑冲突恢复](draft-recovery.md)：逐字段比较、恢复和并发保护。

- [客户表单手机与键盘操作](mobile-workflow.md)：布局、焦点及浏览器验收范围。

- [提交结果恢复](submission-recovery.md)：响应丢失后的状态核实、原请求重试与提交回执。

- [平台反馈与站内通知回复](platform-feedback.md)

- [成品交付恢复与客户进展](./delivery-recovery.md)：上传结果核对、原文件重试、客户进展与下载入口。

- [Windows 安装与升级验证](./installer-lifecycle.md)：备份目录权限、真实服务 CI 演练及本机验证边界。

## 客户数据概览

- [客户数据概览的功能、数据口径与验证](./customer-dashboard.md)

## 稳定性诊断

- [公告草稿与组织选择恢复](./announcement-draft-recovery.md)：页面返回、刷新暂存、取消选择、账号隔离及保存期间恢复。
- [公告发布、下架与删除恢复](./announcement-action-recovery.md)：操作锁、失败后刷新、结果不确定提示和版本冲突处理。
- [公告列表筛选与加载范围恢复](./announcement-list-history.md)：地址参数、历史前进/后退、组织返回和分页竞态保护。

- [GC 与托管堆诊断（2026-09-15）](./gc-diagnostic-2026-09-15.md)：600 秒负载下的 GC、分代堆和内存观察，以及尚未确定的对象归因。
