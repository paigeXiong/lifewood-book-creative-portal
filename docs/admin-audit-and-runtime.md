# 审计增强与运行状态 / Audit and runtime health

## 审计

列表保留操作人、操作、业务对象和时间，详情按钮固定在行末。技术编号仅在详情的“技术信息”中展开。新增记录保存当时的中英文对象名称；旧记录没有名称快照时使用当前关联名称，并在详情中标记来源，不回填或伪造历史快照。已删除项目、用户或交付对象保留已有名称，但不生成失效详情链接。项目链接限已提交项目；组织入口复用用户管理的组织筛选。

搜索覆盖操作人、邮箱、目标编号、请求编号及新增记录的名称快照。旧记录的当前名称只是显示补全，不能用于名称快照搜索。操作和日期过滤由服务端执行；每页 30 条，地址栏保存筛选和页码，支持前进后退。

“导出 CSV”导出当前全部筛选结果，每次最多 2,000 条，超限要求缩小筛选范围，不悄悄截断。导出包含操作人、操作名称、对象、名称来源和 UTC 时间，不含技术编号、密钥或请求原文。CSV 使用 UTF-8 BOM，并转义可触发表格公式的内容。下载请求沿用账号绑定和权限检查；离开页面或切换账号后不继续下载。

## 配置变化

从本次版本开始，表单选项和通知规则/保留期限记录变更前后值。表单选项包含双语名称与说明、启用、排序、自定义、移除、色调及公开预览设置；通知规则包含双语标题、级别、接收范围、启用及允许静音。使用明确字段白名单，不记录请求体、用户密码或 AI 密钥。相关配置写入串行采集快照，冲突/失败请求不记成功变更。其他审计类型仍记录操作与对象，不虚构字段明细。

原审计持久化与待补写文件继续保留。新数据库字段 `audit_events.context_json` 以增量方式添加；旧行和旧待补写记录兼容。可选对象信息失败不阻断核心审计的持久化兜底。

## 运行状态

仅 `admin.runtime.manage`（平台负责人）可读取 `/api/admin/runtime-health`。显示数据库连接、数据目录占用/配额、磁盘可用空间和运行时长；附件、交付文件、失败通知事件数及待补写审计记录放入折叠详情。

后台每 60 秒采样，前端每 30 秒读取缓存；不会在每次请求时遍历文件。占用包含数据库和数据目录内其他文件，不含目录之外的备份。每次最多扫描 100,000 个文件，跳过符号链接/目录联接；发生权限、文件变化或扫描上限时显示未知，不以不完整结果冒充完整占用。数据库只检查连接，不等于完整性校验。界面不暴露服务器文件路径或原始异常。

## 验证与限制

- 服务端测试覆盖历史名称不被后续改名覆盖、旧记录补全、删除目标、配置差异、客户越权、导出公式注入和实际文件采样。
- `tests/e2e/admin-tools.spec.ts` 覆盖中英文、桌面/390px 手机、详情、CSV、组织联动和监控数据。
- Windows 隔离升级：`node scripts/test-upgrade-recovery.mjs <旧版 server 目录> <新版原生 server 目录>`。使用独立端口 5097、UUID 数据和协调目录，保留结果在 `artifacts/upgrade-recovery`。
- 2026-09-10 已以 v0.3.11 的正式 Windows ZIP 和当前原生程序完成真实账号、草稿、HTTP 附件下载、交付文件夹具、备份、增量迁移、重复启动和恢复后哈希验证。演练不操作用户当前数据。
- 恢复失败、锁冲突及中断恢复继续由 `npm run test:ops` 验证。本次演练针对 Windows；没有将其算作新的 Linux 覆盖升级实测，也没有通过浏览器增加远程恢复入口。

2026-09-10 验证结果：服务端完整回归 245 项、后台回归 82 项、完整端到端 2 项通过；两端生产构建、Windows Native AOT、运维回归及最终升级恢复演练通过。代码审查提出的关联、未知数据、翻译、来源与协调目录问题均已修复。

## English summary

Audit rows now show readable targets with on-demand details and explicit historical/current name provenance. Filtered UTF-8 CSV exports are permission checked, formula safe and limited to 2,000 rows. Allowlisted form-option and notification configuration changes are recorded from this version onward; legacy changes are not invented.

Owner-only runtime monitoring samples storage and connectivity every minute and serves a cached snapshot. Incomplete metrics remain unavailable, and host filesystem paths are not exposed. Both applications retain Chinese/English support.

The isolated Windows upgrade/recovery exercise uses the released v0.3.11 server and a current native binary, validates accounts/projects and downloaded file hashes across upgrade, restart and restore, and writes a retained result artifact. Linux upgrade validation remains separate.


## 页面监听配置 / Portal listeners

运行设置提供后端、客户页面、管理后台三组协议、监听地址和端口。旧版配置继续默认共用后端；发布版可取消共用，重启后增加独立页面监听。独立页面端口不能重复，后端 API 端口仍提供受权限保护的管理 API，因此独立页面监听不等同于网络安全隔离。反向代理部署继续支持共用监听；后台路径保持 `/admin/`。

本地开发通过 `scripts/start-local.ps1` 启动时，会读取同一数据目录的 `runtime-settings.json`，向后端报告实际前端地址，并设置两个 Vite 服务及 API 代理。保存设置后重新运行脚本，会检测配置变化并重启三个服务；当前地址在实际重启前保持不变。开发模式不允许仅通过后台按钮重启或关闭后端。直接运行独立 Vite 命令时，应同时给后端配置 `Lifewood:CustomerUrl` 和 `Lifewood:AdminUrl`。

HTTPS 不自动签发证书：发布版使用 Kestrel 的证书配置，本地 Vite 使用 `LIFEWOOD_DEV_TLS_CERT` / `LIFEWOOD_DEV_TLS_KEY` PEM 文件。证书应包含所访问的主机名并受本机信任；API 代理和启动就绪检测不绕过证书校验。

The runtime page provides backend, customer and admin listeners. Published portals share the backend by default, or use separate listeners after restart. The backend API remains permission-protected and accessible on its own configured listener; separate page ports are not a network security boundary. Shared deployments behind a reverse proxy retain relative portal navigation.

The local launcher reads saved settings, reports actual Vite listener addresses to the backend, and restarts all three services when settings change. HTTPS needs configured, trusted certificates; the launcher and API proxy do not bypass TLS validation.

Validation: `node scripts/test-runtime-listeners.mjs` uses isolated data, a separate service-state directory and free ports to verify published listeners, static assets, local Vite services, saved-port changes, restart and portal redirects. `RuntimeSettingsTests` covers compatibility, conflict validation, desired/active state, IPv6 and mixed shared/independent navigation.
