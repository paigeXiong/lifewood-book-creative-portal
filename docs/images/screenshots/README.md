# 产品截图 / Product screenshots

截图日期 / Captured: **2026-09-18**。

使用独立空数据库，通过真实 API 建立 Northstar Books 演示组织、Demo Administrator 和 Jamie Chen 两个虚构账号，以及 The Lantern Garden（已提交）、Across the Blue Horizon（草稿）两个虚构项目。未读取、复制或清空现有开发数据库。SMTP 关闭；不发送真实邮件，不复制 OIDC 或 AI 凭据。

Captured from a fresh isolated database using real API operations: one fictional publisher, two fictional accounts and two sample projects (one submitted, one draft). Existing development data was neither copied nor deleted. SMTP is disabled and no real credentials are copied.

| 文件前缀 / Prefix | 内容 / Contents |
| --- | --- |
| customer-projects | 项目列表、创建人和状态 / Projects, creator and status |
| customer-intake | 图书资料录入 / Book intake |
| customer-detail | 提交详情 / Submitted project details |
| customer-overview | 客户活动统计 / Customer activity |
| admin-overview | 管理端统计 / Administrator statistics |

每组包含 `-zh-CN.jpg`、`-en-US.jpg`，帮助中心按当前语言加载。无后缀文件保留为中文 README 的兼容路径。统计仅反映本次演示操作；没有完成样本，不伪造历史、成品或完成耗时。示意封面复用仓库的水彩风格预览图，不代表真实出版物。

Each group has Chinese and English images selected by the help-center locale. Unsuffixed images retain the Chinese README paths. Statistics reflect actual demo operations, with no invented completions or historical activity. The illustrative cover reuses the repository watercolor preview, not a real publication.

## 重新生成 / Regenerate

先构建 API，再执行 `npx playwright test --config playwright.docs.config.ts`。使用独立的 5090 / 5193 / 5194 端口；每次运行生成新的 `artifacts/docs-demo-*` 数据目录，不复用历史测试数据。运行结束自动关闭专用进程，现有 5173 / 5174 本地服务保持运行。

Build the API first, then run the command above. Dedicated ports and a fresh data directory keep captures independent from development and E2E fixtures. Inspect both languages before committing. Embedded help images require rebuilding/restarting the API after replacement.
