# 邮箱验证、找回密码与邮件通知

本功能默认关闭。部署方配置发件服务后，用户可在个人设置验证现有登录邮箱，并主动开启邮件提醒。管理员的个人设置同样通过客户门户访问。客户与管理员登录入口均提供“忘记密码”。界面及邮件正文支持中文和英文。

## 部署配置

### 后台配置（v0.3.16 后续工作区）

平台负责人进入 **系统配置 → 邮件服务 → 配置邮件服务**，可设置启用开关、SMTP 主机、STARTTLS 端口、发件邮箱、用户名、授权码和客户门户域名。说明收在问号中；界面和测试邮件支持中文、英文。普通管理员和客户无权读取或修改这些配置。

首次打开沿用环境变量。保存后立即生效，并写入数据目录 `mail-settings.json`；保存值优先于环境变量，重启后仍然生效。授权码通过 ASP.NET Data Protection 加密，接口仅返回是否已配置。留空保留授权码，更换主机、端口或用户名时必须重填或明确清除旧凭据。备份需连同 Data Protection 密钥保留，不要手工编辑加密文件。

版本校验避免覆盖其他负责人的修改。保存失败不自动重试；后台刷新、切换语言或读取失败不会清除编辑中的草稿。重新读取时先确认放弃草稿。启用会恢复符合条件的待发队列和已订阅通知；停用不撤回已开始发送的邮件。

测试失败时依据异常类型与 SMTP 状态码返回脱敏分类：认证、连接、超时/中断、安全连接、认证要求、收件人拒绝或服务暂不可用；未知情况保持未确认，不根据异常文字猜测原因。中英文处理建议收在问号中，接口不返回原始 SMTP 响应。

“发送测试邮件”使用已保存且启用的配置，仅向发件邮箱自身发送，操作前显示收件邮箱确认，每分钟最多一次。测试不计入通知队列；成功仅表示 SMTP 接受，不保证进入收件箱。保存和成功测试记录审计事件，不记录授权码。接口：负责人专用 `GET/PUT /api/admin/mail/settings`、`POST /api/admin/mail/test`，写入要求 CSRF 和账号一致性校验。

2026-09-16 本地 QQ SMTP 已接入并从页面保存，门户仍为本机域名。此前经用户授权的单封测试已被 SMTP 接受，收件箱实际到达仍待用户确认；本轮自动测试使用替代发送器，没有额外发送真实邮件。正式部署仍需设置公开 HTTPS 域名并验收真实验证/找回流程。

English: Owners can configure email through **System settings → Email service → Configure email**. Settings apply immediately and persist in the data directory, overriding environment defaults. Credentials are encrypted with Data Protection and never returned. Blank keeps the credential; a host, port or username change requires re-entry or explicit clearing. Version checks prevent stale overwrites; background reads and locale changes preserve drafts. Test emails require confirmation, use saved settings, target the sender only, and are limited to one per minute. Test failures expose only typed, redacted categories with bilingual advice in help popovers; raw SMTP responses remain private. SMTP acceptance is not inbox delivery. Queue records remain read-only; saves and successful tests are audited without credentials. Production domain and real verification/recovery acceptance remain deployment tasks.

### 环境变量初始值

通过服务进程的环境变量或受保护的部署配置提供以下值；不要将真实账号和密码提交至仓库。

| 环境变量 | 含义 |
| --- | --- |
| `Lifewood__Mail__Enabled` | `true` 启用；默认 `false` |
| `Lifewood__Mail__Host` | SMTP 主机 |
| `Lifewood__Mail__Port` | STARTTLS 端口，默认 `587` |
| `Lifewood__Mail__From` | 完整发件邮箱，需由服务商授权 |
| `Lifewood__Mail__Username` | SMTP 用户名，按服务商要求配置 |
| `Lifewood__Mail__Password` | SMTP 密码或应用专用密码 |
| `Lifewood__Mail__PublicUrl` | 客户门户根地址，例如 `https://portal.example.com`；不含路由、查询参数或片段 |

修改环境变量需重启 API 服务，且仅在尚未保存后台配置时生效。当前适配要求 STARTTLS，不支持隐式 TLS 的 465 端口或仅允许 OAuth 的 SMTP；服务接口可后续适配其他提供商。生产门户地址必须使用 HTTPS，本机测试允许 HTTP loopback。链接仅使用配置的地址，不使用请求 Host。配置完整只表示可尝试发信，不表示凭据、DNS 或实际投递已验证。

端口未填写时默认 587；已填写但不能解析或不受支持时，配置不就绪，不再静默回退到默认端口。SMTP Host 只接受主机名或 IP，不含协议、端口、路径和前后空格。用户名与密码应同时提供，或同时留空供无认证中继使用；中继是否接受连接仍需真实服务验收。

本机已使用 QQ 邮箱；正式部署的发信服务商、域名及 SPF/DKIM/DMARC 策略仍需部署方确认。真实收信验收独立进行，自动测试只使用替代邮件发送器。

## 用户行为与安全边界

- 登录后的用户主动申请验证邮件；链接有效期 10 分钟、单次使用。打开网页不会直接验证，须点击确认，避免邮件扫描器消耗链接。
- 邮箱验证与邮件通知分开：验证成功不会自动订阅，默认关闭邮件通知。现有账号不会自动标记为已验证。
- 个人设置中的验证申请与通知偏好共享当前前端实例内的账号操作锁，保存和随后刷新期间不接受重复操作，离开再返回也保留未完成操作的锁。响应失败后仍重新读取服务端状态，不自动重发写请求；离线暂停刷新时保持锁定，刷新失败只提供读取重试，恢复后按实际状态允许继续操作。账号切换后丢弃旧操作的页面提示，并阻止其刷新新账号数据。
- 忘记密码仅向活跃、未注销、事先验证过的邮箱发送链接。邮箱不存在、未验证、禁用或处于冷却期均返回相同结果。不提供邮箱是否注册的查询。
- 同一账号、同一种链接 60 秒内仅可申请一次；接口同时受 IP 与全局写入限流保护。
- 重置密码需要 8–128 字符；成功后撤销旧登录会话，发送必要的密码变更告知邮件，不自动登录。该安全邮件不受普通通知开关控制。
- 链接绑定邮箱、用途和会话版本；修改邮箱或密码后，原链接失效。注销账号会移除邮件设置、令牌和发送队列。
- 令牌使用 32 字节随机数，数据库只保存摘要；待发正文由 ASP.NET Data Protection 加密。链接令牌位于 URL 片段，页面读取后移除，不进入服务器 URL 日志。
- 同一标签页打开另一条邮件链接时，重新初始化验证/改密表单，清除上一条链接的密码、结果和等待状态；旧请求迟到不覆盖新表单。只有页面自身移除片段的替换导航保留内存中的令牌，普通无片段访问或刷新不能恢复它。浏览器历史状态只记录非敏感导航标记，不保存令牌或密码。
- 这是邮箱验证与账号恢复方案，并非登录双重身份验证。未验证或失去邮箱访问权的账号仍需由平台负责人协助处理；所有者不能由普通管理员通过原后台接口改密。

## 邮件提醒与发送队列

- 每分钟检查一次新增未读且当前仍有权查看的站内通知，按用户汇总为通用提醒，不包含项目名称、反馈正文或其他业务资料。邮件引导用户登录查看。
- 用户在个人设置的邮件通知下选择范围：项目完成、退回修改、成品交付、新回复、其他进度更新、其他通知。新回复包含项目沟通和平台反馈；其他通知包含账号变更及当前角色可见的运营提醒。原有订阅默认保留全部类型，总开关仍默认关闭。项目首次进入完成状态或重新进入完成状态产生独立的完成通知，不与普通进度更新混用。
- 排队和发送前均按当前选择、未读状态与访问权限筛选，不受站内列表每页30条限制。全部类型取消后不发送提醒；关闭总开关保留类型选择，并移除尚未发送的通知邮件。已开始投递的邮件无法撤回。验证、找回密码与密码安全邮件独立于这些通知偏好。
- English: Profile settings offer completion, requested changes, delivery, replies, other progress and other notification categories. Queueing and final delivery both recheck selected types, unread state and access, without the inbox page-size limit. The master switch preserves category choices; verification and password/security email remain independent. Existing subscriptions retain all categories.
- 开启时从当前通知位置开始，不补发历史通知。关闭时取消尚未发送的普通提醒，站内通知照常保留；已经交给 SMTP 服务器的邮件无法撤回。
- 队列持久化，SMTP 单次等待上限 30 秒；失败间隔 60 秒重试，最多 5 次。已发送、已取消、已过期和重试耗尽的正文清空；失败次数及状态继续保留，队列记录到期 7 天后清理。
- 邮件停用或配置不就绪时，后台仍清理过期令牌和到期记录，不发信、不生成提醒，也不清除仍有效的待发正文。清理与发送共用备份互斥保护，备份期间暂停，恢复后继续；服务进程停止时不执行清理。
- “已交给邮件服务器”不代表已进入收件箱，也不包含退信回执跟踪。SMTP 应答丢失或进程在发送后退出时，重试可能产生重复邮件；令牌单次使用仍由数据库事务保证。
- 保留服务数据目录中的 Data Protection 密钥并限制访问。丢失密钥会导致待发正文无法解密；修复配置后重新申请验证或重置链接。

## 后台邮件状态

平台负责人可在 **系统配置 → 邮件服务** 查看当前保留的队列记录。接口 `GET /api/admin/mail/status` 同样校验所有者权限；普通管理员、客户和未登录访问者不能读取。页面支持状态、邮件类型筛选和每页 25 条分页，筛选与页码保留在 URL，刷新失败时保留已有快照及其更新时间。

发件状态旁的问号按需显示六项检查：启用开关、SMTP 主机、STARTTLS 端口、发件邮箱、门户域名和认证字段组合。接口仅返回稳定检查代码和通过/未通过标记，不回显配置值；未登录的 `/auth/email-status` 仍只返回可用与否。检查读取当前进程配置，不连接 SMTP、不发送测试邮件，也不验证密码或域名投递策略。检查通过只表示配置格式满足当前适配器要求。

计数对应当前全部保留记录，不随列表筛选变化，也不是完整发送历史。仅包含发送有效期距今不超过 7 天的记录；验证完成、注销、改密或邮箱变更等已有清理行为可能提前移除记录。待发但已超过有效期的记录按“已过期”展示，即使邮件工作进程未启用也不会显示为等待发送。发件配置不就绪或收件账号暂不可用时按“已暂停”展示，不修改原队列状态。

“已交给邮件服务器”只表示 SMTP 接受；不表示进入收件箱。失败次数是失败尝试的次数，计划尝试时间不是保证送达时间。邮箱在服务端脱敏；接口不返回原始邮箱、主题、正文、令牌、发件配置或异常原文。队列只读，不提供手动重发；发件配置通过负责人专用“配置邮件服务”入口修改。具体规则收在问号说明中，界面适配中英文。

English: Owner-only email status shows masked queue metadata, global retained counts and filtered pages. Expired/paused states are projected without changing the queue. SMTP acceptance is not inbox delivery. Bodies, subjects, tokens, credentials and raw exceptions are never returned; the queue cannot resend mail; owner configuration and explicitly confirmed sender-only tests use separate endpoints.

Retention continues while mail is disabled or misconfigured, but pauses during backups. It removes expired tokens and queue records more than seven days past expiry without sending mail or dropping live pending messages. Terminal messages retain status and attempt counts but no body, including after the fifth failed attempt. Retention requires a running API process.

Opening another email link in the same tab resets the form and its passwords. Late results from the previous link cannot change the replacement form. Tokens remain in memory only; history state contains only a navigation marker. A refresh or plain visit cannot recover a stripped token, and opening a link never submits it automatically.

Verification requests and notification preference writes share a per-account lock within the current frontend instance until server-state reconciliation finishes, including across panel remounts. A failed write response triggers a read, not an automatic write retry. Refresh failures offer read-only recovery. Account changes suppress stale results and cross-account refreshes.

## 自动化验证

2026-09-16 测试邮件失败诊断增量：50 项服务端定向测试和 38 项前端测试通过；覆盖固定错误分类、嵌套异常、原始错误脱敏、失败后的发送限频，以及中英文建议默认折叠。测试均使用模拟发送器，没有发送真实邮件。

2026-09-16 SMTP 后台配置：52 项后端定向测试、22 项前端测试通过，后台生产构建通过。覆盖加密持久化与重启加载、版本冲突、换服务器禁止沿用旧凭据、负责人权限和 CSRF、测试收件人及限频、双语说明、重复提交、后台刷新及切换语言失败时保留草稿。代码审查发现的草稿恢复问题已修复并复核。实际本地页面已保存既有 QQ 配置，未新增真实测试邮件。

2026-09-16 偏好恢复验证：邮件相关前端回归 44 项通过（新增 18 项中英文用例），覆盖保存响应丢失、离开/重开期间锁定、离线刷新暂停和恢复、刷新失败后只读重试、账号切换与旧请求隔离、验证申请失败后核对队列状态。使用替代接口，未修改真实账号偏好或发送邮件。

2026-09-16 邮件链接恢复验证：26 项中英文前端测试通过，覆盖同标签页替换链接、BrowserRouter 原生片段导航、密码及结果重置、迟到成功/失败隔离、无效链接、普通无片段访问、重复提交锁和失败后重试。片段清除不把令牌转存到 history state。测试使用替代接口，不发送邮件、不修改真实账号。

2026-09-16 保留规则修复：41 项邮件服务端定向测试通过，Debug 构建通过。新增覆盖停用/配置不完整时清理过期数据且保留有效待发邮件、恢复后仍可完成验证、第五次失败清空正文但保留失败次数、备份互斥下暂停和恢复清理；补充未就绪时不生成通知邮件的工作进程回归并单独复跑通过。使用隔离测试数据库与替代发送器，未发送真实邮件。

2026-09-16 邮件状态增量验证：18 项邮件服务端测试通过（另复核普通管理员拒绝访问）；页面与双语检查 11 项通过，后台生产构建通过。Native AOT 构建及运行冒烟已实际请求新接口，确认空队列、所有状态计数与分页序列化正常。本地已登录负责人页面验证了未配置状态、筛选与清除筛选；未发送真实邮件。

`EmailTests` 覆盖验证、用途隔离、过期、改密/邮箱变更后失效、加密队列、重试、通知 opt-in/out、历史跳过、当前权限与并发发送；`EmailApiTests` 使用替代发送器验证 HTTP、CSRF、旧会话撤销和通用找回结果；前端测试覆盖中英文个人设置及邮件链接流程。

设计参考：[OWASP 密码找回指南](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)、[.NET SMTP STARTTLS 行为](https://learn.microsoft.com/en-us/dotnet/api/system.net.mail.smtpclient.enablessl?view=net-10.0)。

## 邮件模板与预览（2026-09-17，未发布）

验证邮箱、重置密码、通知提醒及密码重置安全提醒采用统一的中英文 HTML 排版，同时携带纯文本正文。验证与重置仍使用原有一次性链接和 10 分钟有效期；通知邮件不包含项目正文。队列正文继续加密保存，新版正文封装兼容原有纯文本记录，终态清空正文规则不变。

负责人可在“系统配置 → 邮件服务 → 邮件预览”切换四种模板、邮件语言及排版/纯文本。该接口只读，使用固定示例域名及无效示例令牌，不读取真实邮件、生成令牌或发送邮件。模板主体与正式发信共用渲染器，预览操作按钮不带链接。格式预览在禁止脚本、表单和网络加载的 iframe 中展示，父页面负责滚动和键盘焦点；模板说明收在问号中。

验证：82 项邮件相关后端测试及追加 1 项新旧加密正文队列兼容测试通过；42 项管理端邮件/国际化测试通过，构建通过。实际浏览器已核对中英文切换、英文安全提醒纯文本，以及点击预览后 Esc 关闭并恢复入口焦点。未新增真实发信，QQ 等收件软件的最终呈现仍需真实邮件验收。

English: Verification, password reset, notification and password-reset security emails share localized HTML templates with a plain-text alternative. Encrypted outbox bodies retain backward compatibility with legacy text. The owner-only preview is read-only and uses inactive sample links; it never sends mail or issues tokens. Real mailbox rendering remains an acceptance item.

## QQ 实收验收（2026-09-17）

经用户明确授权，使用已保存的 QQ SMTP 配置向发件邮箱自身发送中文、英文各一封验证模板示例，两封均被 SMTP 接受。用户随后确认：“两封都收到，排版正常”。主题标有“模板测试 / TEST”，正文说明示例用途，链接使用无效示例令牌且按钮无跳转，不创建真实验证记录或修改账号。测试次数为两封，无自动重试。

本次确认覆盖 QQ 实收和双语模板显示；不代表所有邮箱软件兼容性，也不代表正式门户域名、真实验证/找回链接、订阅投递及退订已经完成上线验收。正式环境仍需确认公开 HTTPS 门户域名、发件服务和受控测试账号。

另增加离线 MIME 序列化回归：由正式邮件构造器生成 `.eml`，核对 `multipart/alternative`、UTF-8 纯文本及 HTML 部分；不访问网络。模板相关 10 项服务端测试通过。

English: Two explicitly authorized Chinese/English sample emails were accepted by QQ SMTP. The user confirmed both arrived with correct layout. They contained inactive sample links and created no verification tokens. Production-domain recovery/verification and other email clients remain unaccepted.

Windows Native AOT 发布构建及隔离运行检查通过：在独立临时数据目录启动原生服务，确认负责人接口可返回中英文四种完整模板、示例按钮无链接、默认邮件队列为空；检查进程明确禁用发信。未改动本地正式数据，现有 5077/5173/5174 服务继续运行。 / Native AOT publication and isolated runtime smoke checks passed for all four templates in both locales, with sending explicitly disabled.

## 本地隔离流程验收（2026-09-17）

正式门户域名尚未确定，本轮按用户确认先完成本地验收。使用独立临时数据目录和内存收件器；真实接口处理验证、改密及订阅请求，通知使用隔离业务事件触发正式分发逻辑。没有读取现有账号、修改真实密码或向 SMTP 发信。

| 验收项 | 本地结果 |
| --- | --- |
| 中英文验证邮件 | 正确语言路由及主题，HTML 与纯文本包含同一令牌；申请后仍未验证 |
| 验证链接单次使用 | 明确提交后验证成功，重复提交被拒绝；验证不会自动开启邮件提醒 |
| 订阅通知 | 订阅前历史通知不补发，订阅后的新通知产生邮件提醒 |
| 退订 | 取消待发提醒，站内未读通知仍保留 |
| 密码找回 | 未知邮箱与有效邮箱返回相同结果，重复申请不新增邮件 |
| 密码重置 | 成功后旧登录会话失效，链接再次使用被拒绝 |
| 重启后的账号与邮件 | 重开隔离服务后旧密码不可登录、新密码可登录；未发安全提醒仍可解密并发送至内存收件器 |
| 安全提醒 | 普通提醒关闭后仍发送必要安全通知，正文不包含新密码或重置令牌 |

验证命令：

```powershell
dotnet test services/platform-api.Tests -c Debug --no-restore --filter "FullyQualifiedName~EmailVerificationRecoveryAndPreferencesWorkOverHttpWithoutRealMail"
npm run test --workspace @lifewood/task-entry-web -- src/email.test.tsx src/email-preferences-recovery.test.tsx
```

结果：2 条双语 HTTP 综合用例及 44 项前端邮件/偏好恢复检查通过。前端用例包含打开链接不自动提交、移除地址栏令牌、替换链接隔离旧结果、断网与失败恢复。该结果为自动化隔离验证，不等同于真实浏览器访问正式域名、生产代理或第三方邮箱服务全流程验收。

English: Isolated Chinese/English HTTP workflows passed verification, single-use links, notification opt-in/opt-out, password reset, revoked sessions, login after restart and persisted security-mail delivery to an in-memory mailbox. Two integrated server cases and 44 frontend checks passed. No live accounts or additional SMTP deliveries were used. Production-domain end-to-end acceptance remains pending.
