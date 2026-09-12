---
meta:
  contentType: Reference
  title: 当前实现与继续开发基线
  navLabel: 开发基线
  category: 工程
---

# 当前实现与继续开发基线

本页说明平台当前已经实现的范围、工程约束和下一阶段入口。新开发必须连接真实服务端，保持 Native AOT、双语路由和生产数据兼容。

## 当前交付范围

当前版本支持客户提交书籍视频项目资料，并由管理员人工跟进和交付最终成品：

- 本机首次创建平台负责人、管理员创建客户账号、密码登录、Cookie 会话、退出和密码修改
- 中英文客户门户，路由前缀为 `/zh-CN` 和 `/en-US`
- 项目草稿、真实文件上传、服务端校验和幂等提交
- 提交记录、受理状态和最终成品下载
- 管理员账号、用户、组织、动态选项、项目跟进和最终成品上传
- SQLite 数据库、审计记录、容量限制和数据保护密钥
- Windows x64 与 Linux x64/arm64 Native AOT 发布
- 书籍资料 AI 辅助识别、模型服务商及业务绑定配置
- 定向退回、双方沟通、重新提交及管理员历史追溯
- 预设角色和图片、配置引用保护与音色试听管理
- 公告发布、定向收件、关闭记忆和个人历史
- 已发布：公告公示天数、单份内容及完整站内通知（见 [通知说明](./notifications.md)）
- v0.3.13 已发布：平台反馈与通知回复、客户上传及提交恢复、逐字段草稿恢复（见 [发布说明](./releases/v0.3.13.md)）

平台不依赖外部登录或测试 API。正式发布物不包含默认账号、假头像、Mock Token 或测试控制台。

## 固定技术基线

| 模块 | 技术 |
| --- | --- |
| 客户门户 | React 19、TypeScript、Vite、React Router |
| 管理中心 | React 19、TypeScript、Vite |
| 数据请求 | TanStack Query |
| 表单与校验 | React Hook Form、Zod |
| 国际化 | i18next、locale 路由前缀 |
| 服务端 | C#、.NET 10、ASP.NET Core、Native AOT；同进程托管客户门户与管理中心 |
| 数据存储 | Microsoft.Data.Sqlite、显式 SQL |
| JSON | System.Text.Json 源码生成 |
| 自动化验证 | Vitest、Playwright、xUnit、Native AOT 冒烟 |

运行时代码必须兼容 Native AOT。不要引入运行时反射扫描、动态代理、运行时生成序列化元数据或依赖即时编译的库。

## 仓库结构

```text
apps/
  task-entry-web/       客户门户
  admin-web/            管理中心
  test-console/         可移除的真实服务端验收工具
services/
  platform-api/         正式服务端源码
  platform-api.Tests/   服务端集成测试
packages/
  api-client/           HTTP 客户端与 DTO
  domain/               领域模型与业务规则
  i18n/                 locale 与格式化
  ui/                   共享设计令牌与组件
linux/                  Linux 安装器与 systemd 单元
scripts/                测试、发布、安装和备份脚本
```

`apps/test-console` 只读取真实服务端数据，不得拥有独立账号、业务数据或认证降级路径。

## 客户路由

```text
/:locale/login
/:locale/tasks
/:locale/tasks/new/project
/:locale/tasks/:taskId/edit/project
/:locale/tasks/:taskId/edit/characters
/:locale/tasks/:taskId/edit/style
/:locale/tasks/:taskId/edit/voice
/:locale/tasks/:taskId/edit/references
/:locale/tasks/:taskId/edit/review
/:locale/tasks/:taskId
/:locale/tasks/:taskId/submitted
/:locale/notifications
```

首期 locale 为 `zh-CN` 和 `en-US`。语言切换必须保留项目 ID、当前步骤、查询参数和未保存表单状态。

## 数据与配置原则

页面不得硬编码业务枚举。书籍类型、目标受众、视频目标、投放平台、视觉风格、文件类别和参考音色均由服务端返回。

业务记录保存稳定 ID 或代码。接口按 locale 返回显示文案。没有真实头像时，服务端返回根据昵称生成的实际图片。

已提交项目保留不可变快照。客户默认查看提交记录、受理状态和最终成品；管理员定向退回后，客户可处理指定单元并重新提交。管理员可以修改内部跟进状态并上传最终成品，但不能改写客户提交的快照。

## 修改后的最低验证

在仓库根目录运行：

```powershell
npm run verify
```

涉及 Windows 发布时继续运行：

```powershell
npm run publish:aot
npm run smoke:aot
```

涉及 Linux 安装或发布时，必须让 GitHub Actions 的 `linux-x64` 与 `linux-arm64` 任务通过。

## 继续开发优先级

按以下顺序处理后续工作：

1. 保持客户登记、管理员跟进和最终交付链路稳定
2. 补充真实 Linux 安装、覆盖升级和故障回滚演练
3. 根据业务确认结果调整组织共享、授权和大文件上传
4. 继续修复移动端、键盘操作、错误恢复和双语布局问题

完整上线条件见 [发布就绪检查](./release-readiness.md)。业务开放问题见 [产品需求](./product-requirements.md#21-待确认事项)。
