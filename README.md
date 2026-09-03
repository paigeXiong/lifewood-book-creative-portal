# Lifewood Book Creative Portal

Lifewood Book Creative Portal 是面向客户的书籍视频项目资料提交平台。客户可以保存草稿、上传真实素材并提交不可变的项目资料包；内部人员通过管理中心维护账号和业务选项、跟进已提交项目，并上传最终成品。平台不执行 AI 分析或视频生成。

## 了解当前产品范围

当前版本包含客户门户、管理中心和完整服务端。一个生产进程同时托管两套网页、认证、业务接口、SQLite 数据库和本地文件存储。

客户门户支持：

- 使用真实账号登录，修改密码和头像
- 从账号资料预填组织、联系人、邮箱和电话，不覆盖已有草稿内容
- 创建、自动保存、恢复和删除项目草稿
- 分步填写书籍资料、故事角色、旁白配音、视觉风格、参考素材和创意方向；旁白可选，需要时才展开具体声音配置
- 上传书籍封面、手稿、角色参考图和其他真实文件
- 使用后台维护的双语业务选项、视觉示例和参考音色
- 校验并幂等提交项目资料包
- 查看只读提交记录、跟进状态和最终成品
- 通过 `/zh-CN/*` 和 `/en-US/*` 使用中文或英文界面

管理中心支持：

- 创建、编辑、启用和停用账号
- 管理组织并为账号分配一个组织
- 维护双语业务选项、文件限制和参考音色
- 查询已正式提交的项目，不读取客户草稿
- 分配负责人，更新状态和优先级，记录内部备注
- 上传或撤回最终成品
- 查询管理员写操作的审计记录

当前版本不包含：

- AI 文案、图片、配音或视频生成
- 详细的内部制作节点和团队调度
- 在线脚本编辑、场景审阅或时间点评论
- 客户修改、删除、撤回或重新提交已冻结的资料包
- 站内通知、邮件通知、支付或订阅

当前范围与验收优先级见[产品需求基线](docs/scope-registration-platform.md)。字段细节见[客户详细需求](docs/product-requirements.md)和[管理中心需求](docs/admin-center-requirements.md)。

## 查看系统架构

生产发布不需要 Node.js、Vite 或独立网页服务器。Native Ahead-of-Time（AOT）编译后的服务端直接提供客户门户、管理中心和 `/api` 路由。

```text
浏览器
├── /                 客户门户
├── /admin/           管理中心
└── /api/             同源业务接口
        │
        ▼
Lifewood.BookPortal.Server
├── ASP.NET Core Minimal API
├── SQLite
└── 数据目录：附件、成品、审计队列和数据保护密钥
```

主要技术：

- React 19、TypeScript、Vite 和 i18next
- C#、.NET 10 和 ASP.NET Core Minimal API
- Microsoft.Data.Sqlite 和显式 SQL
- Windows x64、Linux x64 与 Linux arm64 Native AOT 发布

架构约束和 AOT 开发规则见[技术架构](docs/technical-architecture.md)。

## 在 Windows 启动开发环境

准备 Node.js 22 或更高版本和 .NET 10 SDK，然后双击 `启动本地环境.bat`。脚本会启动完整服务端和两套 Vite 开发页面，并自动打开客户门户。

开发地址：

- 客户门户：`http://127.0.0.1:5173/zh-CN/tasks`
- 管理中心：`http://127.0.0.1:5174/zh-CN/projects`
- 服务端：`http://127.0.0.1:5077`

双击 `停止本地环境.bat` 停止本地进程。英文文件名脚本 `start-local.bat` 和 `stop-local.bat` 执行相同操作。

也可以在仓库根目录运行：

```powershell
npm install
npm run start:local
```

开发日志保存在 `artifacts/dev-logs/`。启动脚本检测到健康的现有进程时会复用服务；检测到失效记录时会清理记录并重新启动。

## 创建首个平台账号

新数据目录没有默认账号或密码。首次打开平台时，必须从服务端所在机器的回环地址创建负责人账号；远程客户端不能抢先完成初始化。

无桌面的 Linux 服务器不需要安装浏览器。通过 Secure Shell（SSH）端口转发，可以在自己电脑的浏览器里完成初始化：

1. 确保 Linux 服务器上的平台服务已经启动。以下示例假设服务监听 `5077` 端口。
2. 在**自己电脑的终端**中执行，将 `user@server` 替换为服务器的 SSH 用户名和地址：

```bash
ssh -N -L 127.0.0.1:15077:127.0.0.1:5077 user@server
```

3. 保持 SSH 连接，在**自己电脑的浏览器**打开 [http://127.0.0.1:15077](http://127.0.0.1:15077)，按页面提示创建首个负责人账号。
4. 创建完成后，在终端按 `Ctrl+C` 关闭隧道。之后通过已配置的站点地址正常登录。

访问路径为：自己的浏览器 → SSH 加密隧道 → Linux 服务器的 `127.0.0.1:5077`。平台收到的是服务器回环地址发起的连接，因此符合首次建号的本机访问要求。

`15077` 是自己电脑临时使用的端口；若被占用，可以换成其他空闲端口，并同步修改浏览器地址。末尾的 `5077` 是服务器上平台实际监听的端口，使用自定义端口时需要替换。`-N` 表示只建立隧道、不打开远程命令行，连接后终端保持等待是正常现象。

初始化后，服务端可以直接提供远程 HTTP，也可以通过 Kestrel 证书端点或反向代理提供 HTTPS；公网使用仍建议启用 HTTPS。具体步骤见[正式部署与数据备份](docs/deployment-and-backup.md)。

## 验证代码

运行前端测试、服务端测试和两套前端生产构建：

```powershell
npm run verify
```

生成并启动 Windows x64 Native AOT 产物：

```powershell
npm run publish:aot
npm run smoke:aot
```

运行浏览器端到端测试：

```powershell
npm run test:e2e
```

发布前还需要完成目标 Linux 架构的构建和运行验证。完整清单见[验证并发布平台](docs/release-readiness.md)。

## 生成发布包

生成 Windows x64 自包含压缩包：

```powershell
npm run build:release
```

生成 Windows Installer（MSI）安装包：

```powershell
npm run build:msi
```

在目标 Linux 架构的构建机生成自包含发布包：

```bash
npm ci
npm run build:linux
```

Windows MSI 默认将生产数据保存到 `C:\ProgramData\Lifewood\BookCreativePortal\data`。Linux 默认使用 `/var/lib/lifewood-book-portal`。覆盖安装和程序升级不会删除数据库、附件、最终成品或数据保护密钥。

## 处理生产数据

生产数据独立于程序目录。升级前执行备份并定期完成恢复演练；不要把数据库、上传文件或密钥复制进源码和发布包。

Windows 可以使用：

- `backup-platform.bat`
- `restore-platform.bat`

跨 Windows 机器恢复时，需要删除恢复出来的 `data-protection-keys` 目录再启动服务。这会使现有登录会话失效，但不会影响账号密码和业务数据。Linux 恢复应保留数据保护密钥及其文件权限。

## 阅读项目文档

- [文档索引](docs/README.md)：本地启动、设计资料和开发基线
- [产品需求基线](docs/scope-registration-platform.md)：当前范围、角色、流程、配置、交付和验收标准
- [客户详细需求](docs/product-requirements.md)：客户流程、字段和历史决策细节
- [管理中心需求](docs/admin-center-requirements.md)：账号、组织、项目跟进和系统配置
- [UI 设计规范](docs/ui-design-specification.md)：紧凑布局、品牌样式、响应式和国际化
- [技术架构](docs/technical-architecture.md)：服务边界、Native AOT 和数据访问规则
- [正式部署与数据备份](docs/deployment-and-backup.md)：安装、首次设置、升级、备份和恢复
- [发布就绪检查](docs/release-readiness.md)：自动化验证和上线前人工检查

需求原图保存在 `需求图片/`。这些图片同时包含当前登记范围和远期制作流程；实施范围以产品需求文档中的已确认决策为准。

## 关注尚未定稿的业务规则

正式交付客户前仍需确认以下事项：

- 提交时如何冻结可配置选项的双语名称和媒体引用，避免后台改名影响历史资料包
- 客户填写的临时项目名与内部正式项目名如何同时展示
- 是否向客户展示项目负责人及其外部联系方式
- 授权确认采用勾选声明、签署文件，还是同时要求两者
- 正式环境的大文件采用普通上传、分片上传，还是对象存储直传
- 跨设备续填和多窗口编辑发生冲突时采用哪种产品提示

这些事项不能通过前端硬编码决定。确认后应先更新产品需求和数据模型，再修改实现。
