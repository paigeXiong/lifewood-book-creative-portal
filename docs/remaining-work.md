# 剩余工作与待确认事项

核对日期：2026-09-19。发布基准：[v0.3.19](./releases/v0.3.19.md)。本页是继续推进的入口，不把原型设想、建议或已有功能重新列为开发承诺。

会议准备：[中英文验收清单与演示流程](./acceptance-meeting.md)已整理，包含通过标准与记录空表；业务验收尚未执行。 / The bilingual meeting guide is ready; business acceptance has not yet taken place.

## 当前已经具备

2026-09-18 已批准小功能：项目列表支持复制本人项目为独立新草稿，清除附件/期限/提交与工作流记录，限制数量并防止同请求重复创建；后台现有运行区域补充数据库、头像、其他数据和独立备份目录用量，中英文适配。 / Approved additions: copy owned projects into independent drafts, and inspect storage categories within the existing runtime panel.

2026-09-18 注销数据清理补齐：每日登录/活跃日历纳入注销事务，启动时兼容清理此前已注销账号遗留统计；保留临时停用账号及其他成员数据，并验证迟到登录与心跳不会重建记录。 / Account closure now removes daily activity totals, with startup cleanup for legacy closed accounts. Disabled accounts and other members retain their history; late sign-in and heartbeat writes cannot recreate closed-account activity.

2026-09-18 邮件通知范围：个人设置在总开关下增加项目完成、退回修改、成品交付、新回复、其他进度和其他通知的独立选择；既有订阅保留全部类型。人工完成和交付自动完成均产生完成事件，已完成项目重复发布不重复产生完成事件。排队及投递前重新检查类型、未读状态与访问权限，不影响验证及密码安全邮件；邮件仍为不含业务详情的合并提醒。中英文标签随语言切换更新。 / Email preferences now provide six selectable categories, checked at queue and delivery time. Manual and delivery-triggered completion are covered; existing subscriptions keep all categories and security email remains independent.

2026-09-18 成员活跃日历：登录概况新增最近三个月的月历热力图，可悬停、键盘聚焦或点击日期查看登录次数与活跃时段。按 UTC+8 聚合实际登录和发生交互的15分钟时段，同一时段跨标签及设备去重，空闲轮询不计入；采集开始前显示未采集，不从最近登录时间推算历史。支持中英文与窄屏，计数口径收进问号。 / Member profiles now include a three-month activity calendar with daily sign-in and interaction-period totals, deduplicated across tabs/devices. Dates before collection are explicitly unknown; polling does not count as activity. Supports hover, keyboard and touch, with localized help.

2026-09-18 客户成员资料：点击组织列表内其他成员的头像或姓名进入只读资料页，显示头像、姓名、所属组织和角色，点击自己进入个人设置。返回保留搜索与页码；服务端按当前组织校验详情与头像访问，跨组织、已注销或不存在的成员不可查看。页面不显示启停状态、联系方式和账号设置，支持中英文。 / Organization avatars and names now link to scoped, read-only member profiles; self links open personal settings. Returning preserves search and pagination. No contact details or account controls are exposed.

2026-09-18 成员仪表盘：资料页新增在线概况、最近登录和活跃时间、已提交/进行中/待修改或回复/已完成统计及可搜索分页的提交记录。数据仅限当前同组织成员，未提交草稿不展示，退回修改中的名称取最近提交快照；历史首次提交时间缺失时显示暂无记录。详情访问权限保持不变，口径说明收在问号内，中英文适配。 / Member profiles now include presence and sign-in summaries, four request counts and searchable, paginated submitted requests. Same-organization checks apply to every read; drafts remain private, returned requests use submitted snapshot titles, unknown historical dates stay unknown, and project-detail permissions are unchanged.

2026-09-18 客户“我的组织”：顶部导航和个人资料组织名称均可进入只读成员页，显示组织名称、人数、成员头像、姓名、角色及当前账号标记（启停状态仅后台展示），支持服务端搜索和分页、中英文和窄屏。服务端按登录账号的最新组织归属查询，成员头像同样检查组织范围；不返回邮箱、电话、登录记录和已注销成员，未分配组织显示空态。 / Customers can now browse their own organization’s members from navigation or profile, with localized search/pagination and scoped avatars. The directory exposes no contact or sign-in details and excludes closed accounts.

客户资料登记、草稿与上传恢复、定向退回沟通、人工跟进和最终成品交付已实现；另有账号切换、运营权限、永久注销、通知、平台反馈、批量处理、资料导出及客户数据概览。详细范围以[产品基线](./scope-registration-platform.md)及各专题为准。

v0.3.16 新增[邮箱验证、找回密码和可选邮件提醒](./email.md)，以及[多个 OIDC 服务的配置、登录和账号绑定](./oidc.md)。邮件默认关闭；本地 QQ SMTP 已配置，2026-09-18 经授权发送中英文各一封模板测试，用户确认两封均收到且排版正常。正式域名下的真实验证/找回流程仍待验收，真实身份服务尚未接入验收。邮箱验证与第三方登录本身均不等于登录双重身份验证。

v0.3.14 的[完整验证](https://github.com/paigeXiong/lifewood-book-creative-portal/actions/runs/34821927349)已通过，包含 15 项端到端用例与 6 项三浏览器回归。Windows 安装器生命周期、Linux x64/ARM64 安装及失败回滚已有 CI 验证；[正式发布构建](https://github.com/paigeXiong/lifewood-book-creative-portal/actions/runs/34823771361)已完成。不能据此声称真实手机、目标服务器或生产数据迁移已验收。

v0.3.16 后续工作区：后台已新增负责人邮件服务配置、加密授权码保存、即时启停、发件邮箱自身测试和脱敏失败诊断。已有 QQ 配置已保存；说明和诊断建议收在问号，支持中英文。相关功能已发布，详见[邮件说明](./email.md)。 / Released: owner SMTP configuration, encrypted credentials, immediate activation, sender-only tests and redacted diagnostics are implemented; production acceptance remains open.

## 可以继续推进

2026-09-18 分页布局排查：反馈、操作审计、运营工作台、趋势报表、备份及邮件列表统一分离可滚动内容与底部分页；少量或空数据时分页留在面板底部，多记录列表内部滚动。修正用户/组织列表在手机宽度下多余的最小高度，窄屏邮件面板内容较高时可滚动到分页，避免溢出面板背景。浏览器验证空态、报表翻页、多记录审计及 390px 视口；18 项相关中英文回归测试和后台构建通过。 / Pagination layout now keeps controls at the bottom of six admin list surfaces, with scrollable results and reachable controls on narrow screens. Existing user/organization mobile height constraints were corrected; related bilingual checks passed.

2026-09-18 后台效率概览：新增平均完成历时、中位数、有效样本数、7/30/90 天首次提交与完成趋势、当前在办需求年龄分布及待办工作台入口。总历时从首次提交到首次记录的完成，包含补资料和等待；首次完成事件独立保存，备注、重新分配和再次完成不改变原样本。历史缺失时间不推测，当前未知年龄单列；统计口径收在问号，仅后台可见，支持中英文和键盘选择趋势日期。完成时间为人工标记完成，并非成品发布或客户验收时间；尚不作为 SLA 或绩效承诺。 / Admin-only efficiency analytics now include elapsed mean/median with sample counts, 7/30/90-day submission/completion trends, open-request aging and workload drilldowns. Immutable first recorded completions exclude unreliable legacy timestamps. Completion refers to the manual workflow status, not delivery publication or acceptance; no SLA is implied.

2026-09-18 组织成员管理：点击组织名称在行内展开成员列表，按组织服务端搜索/分页；创建成员复用账号表单并默认填入当前组织，添加已有成员复用用户列表选择未归属账号，预填编辑表单，保存后返回展开的组织并刷新人数。停用组织隐藏添加入口，已有归属账号不可在此直接转移；组织加载期间避免表单漏填，成员数量缩减后修正分页。25 项中英文相关测试及后台构建通过，浏览器验证展开、创建预填和添加入口；未创建或修改真实账号。 / Inline organization members and prefilled create/add flows are implemented with bilingual local checks; existing account data was not changed.

2026-09-18 弹窗动效：客户门户和管理后台共用浮层样式，原生弹窗、普通模态面板、账户菜单及问号/筛选浮层统一淡入与轻微缩放，遮罩淡入；保留在 DOM 中的原生浮层支持关闭过渡。React 卸载式弹窗仍立即关闭，不延迟业务回调；系统减少动态效果时不启用动效。两端构建通过，浏览器检查了反馈弹窗入场、筛选浮层退场及后台配置弹窗，未更改保存和取消逻辑。 / Shared entrance motion now covers both portals; retained native overlays also transition out, while unmounted dialogs close immediately. Reduced-motion preferences are respected.

2026-09-18 客户看板联动：活动趋势的数据点支持点击、Enter/空格选择日期并定位当日活动，重置活动分页；环图片段和状态列表跳转到对应项目进展筛选，列表支持显示、叠加搜索与清除筛选。服务端按看板相同口径区分普通草稿与退回待处理项目，保留原有状态筛选和账号隔离。39 项中英文前端测试、22 项后端相关测试及客户前端构建通过；浏览器验证了不同圆弧点击、键盘跳转、当天记录、数量一致和 390px 模拟视口。服务保持运行，真实手机仍待验收。 / Dashboard points reveal daily activity, and status segments and legends drill into matching project filters; bilingual tests and local desktop/mobile viewport checks passed.

2026-09-18 个人页面：分为联系信息、账户与归属、个人偏好、账号安全；邮箱验证/密码/登录设备/OIDC 归到账号安全，语言/动态背景/邮件通知归到偏好。邮箱组件支持分区布局但仍共用单次读取、请求锁与账号保护，操作反馈留在相应分区；通知开关统一外观并扩大点击区域。69 项相关中英文测试及前端构建通过，浏览器检查覆盖中文桌面和 390px 英文手机布局；未发送真实邮件，真实手机仍待验收。 / Profile settings now separate account security from preferences while sharing email state and recovery; locally verified in both languages.

2026-09-18 客户项目详情：项目/书籍资料默认展开，其余分组与人物详情按需展开，支持全部展开/收起、目录与深链接自动展开并聚焦；数据刷新保留浏览状态。人物信息改为具名字段，完整提交资料仍保留，打印样式展示全部字段，参考图提前加载。61 项相关测试及前端构建通过，已检查中英文 390px 模拟视口和桌面目录交互；未进行真实手机或实物打印验收。 / Customer submission details now support accessible grouped disclosures and labeled character fields, with bilingual local verification; physical-device and print acceptance remain pending.

2026-09-18 客户前端：看板状态分布、最近项目与项目列表统一使用客户侧退回文案（中文“待修改或回复”、英文“Changes or reply needed”）。手机列表合并搜索与筛选、排序与新建所在行，减少重复字段标签；390px 模拟视口工具栏由 218px 降至 168px，保留 44px 操作区域与无障碍表头，隐藏重复的桌面排序焦点。35 项中英文列表/看板回归测试及客户前端构建通过，已检查中英文手机布局、英文桌面布局和筛选浮层；真实手机仍待验收。 / Customer status terminology and compact mobile project controls are locally verified; physical-device acceptance remains pending.

2026-09-18 工作区新增[出站代理](./outbound-proxy.md)：全局默认 + 各 AI/OIDC 接入单独覆盖，HTTP/HTTPS 代理、加密认证、连接检查及中英文设置；保留旧 OIDC 直连行为，SMTP 不受影响。已通过 57 项后端相关测试、9 项界面测试、Native AOT 构建和隔离运行冒烟，尚未发布。部署环境实际代理与真实 AI/OIDC 的端到端验收待接入后进行。 / Unreleased outbound proxy configuration is implemented and locally verified; production proxy and provider acceptance is still pending.

### 本轮代码核对发现的优化项

2026-09-18 运行设置恢复：后台读取不再覆盖编辑中的监听地址、端口和页面配置；检测到已读取的服务器配置变化时保留草稿并阻止旧值保存，可确认后重新读取。保存期间锁定字段并防止重复提交；请求失败不自动重发写操作，离开页面或切换账号后忽略旧提示和重启跳转。18 项中英文恢复测试、4 项入口地址测试、9 项相邻代理界面回归及管理端构建通过；现有本地服务保持运行，未执行真实重启/停服。本项保护前端已观察到的配置变化，不等同于服务端原子版本锁。 / Unreleased: runtime drafts and late asynchronous responses are guarded; production restart/shutdown operations were not exercised.

下列事项来自当前实现核对，按完成状态区分。所有界面及回归均需覆盖中英文。

| 优先级 | 工作 | 当前依据与完成条件 |
| --- | --- | --- |
| 已完成（v0.3.16） | OIDC 配置未保存保护 | 已接入 `useUnsavedClose`，取消、切页及刷新保护；保存期间阻止业务路由离开，保存成功清除保护。列表后台刷新失败不再卸载编辑器；密钥不写入浏览器草稿存储 |
| 已完成（v0.3.16） | OIDC 配置冲突恢复 | 冲突后读取最新值并展示差异，确认后采用服务器版本，或保留相对原版本修改过的字段；清空未保存密钥，仍须手动保存并通过服务端版本检查。覆盖读取失败、配置被删除及再次冲突 |
| 已完成（v0.3.16） | 帮助问号与浮层统一 | 登录配置接入共用 `HelpPopover`，统一 14px SVG 与透明 24px 点击区域；滚动和视口变化时定位，触发按钮不可见时收起，Esc 优先关闭帮助并恢复焦点。见[帮助浮层验证](./admin-help-popovers.md) |
| 已完成（v0.3.16） | 邮件发送状态可查看 | 所有者可查看保留队列的全局计数、状态/类型筛选、分页、脱敏邮箱及失败次数；过期/暂停状态只读推导。无正文、令牌、密钥和手动发信入口；SMTP 接收不等于进入收件箱，见[邮件说明](./email.md) |

本轮列出的四项均已纳入 v0.3.16。下一阶段重点是下表的真实服务与目标环境验收；服务商、域名和测试环境未确定的事项不能用模拟验收代替，也不扩大真实制作工作流范围。

部署准备另已补齐邮件配置的六项只读检查，按需在负责人页面问号中展示；修复无效端口静默回退及不完整认证配置仍显示就绪的问题。[发布就绪检查](./release-readiness.md)已增加邮件与 OIDC 的实际验收条件，可选接入未启用时明确记录状态。

2026-09-16 验证：配置与邮箱流程定向服务端回归 23 项、邮件状态及国际化前端回归 13 项通过；管理端构建、Windows Native AOT 发布和隔离运行冒烟通过。已更新本地 API，并在实际管理页面核对六项检查及问号浮层；客户与管理端预览继续运行。此检查不代表真实 SMTP 连通性、凭据或投递验收。

后续边界修复：邮件停用或配置不完整时仍执行保留清理；有效待发邮件保留，重试耗尽立即清空正文并保留失败元数据。备份期间暂停清理，未就绪时不生成提醒、不发信。41 项邮件定向回归及构建通过，补充工作进程断言后单独复跑通过；本地三个预览服务已恢复并使用最新 API。见[邮件说明](./email.md)。

登录异常恢复：第三方登录与绑定操作增加页面和账号生命周期检查，离开页面、切换路由或账号后，迟到响应不再跳转或操作替换弹窗；账号变化时清空绑定密码并允许关闭。中英文客户/管理员入口及绑定流程共 41 项前端回归通过，见[OIDC 说明](./oidc.md)。

邮件链接恢复：修复同标签页打开新验证/重置链接仍使用旧令牌的问题；同时处理原生片段导航中重复路由标识，新链接独立初始化表单并隔离旧异步结果。26 项中英文前端回归通过，包含密码清空、错误恢复和重复点击保护；真实服务联调仍未完成，见[邮件说明](./email.md)。

邮件偏好恢复：保存失败后读取实际服务端状态，验证申请与通知偏好在当前前端实例内共用账号操作锁，离开后返回仍等待保存及刷新完成；离线刷新暂停时也保持锁定。账号切换隔离旧提示与刷新，读取失败只重试读取。邮件前端回归共 44 项通过（含新增 18 项中英文用例），见[邮件说明](./email.md)。

登录设备恢复：翻页、列表刷新失败或目标消失后清除旧退出确认，读取中及离线暂停时禁止提交；退出响应丢失后重新核对服务端列表，重开弹窗仍保留账号操作锁。16 项中英文与账号缓存回归通过，未撤销真实设备；见[个人工作区说明](./productivity-tools.md)。

个人资料恢复：完整捕获本次编辑的姓名和电话，后台刷新保留输入；成功保存后清除旧草稿，浏览模式不再误报未保存。响应丢失后读取实际资料，账号切换隔离旧请求；资料、头像与偏好响应只合并对应字段，取消旧后台读取以避免覆盖新保存结果。23 项相关回归通过，见[个人资料恢复](./profile-edit-recovery.md)。

### 已完成的专项与后续验收

v0.3.16 后续工作区：通知偏好保存已补齐重复提交、保存期间关闭与编辑保护、跨弹窗账号操作锁，以及旧请求和后台读取隔离。失败后读取服务器状态并保留编辑；断网不排队重发保存，Esc 不关闭底层窗口。两端及中英文回归见[通知说明](./notifications.md)。此项尚未包含在 v0.3.16 发布包内。

反馈图片与提交恢复：处理中允许取消并忽略旧图片结果，切换账号清除旧草稿，重复点击仅发送一次；保留截图和原提交编号供超时后手动重试。36 项相关回归通过，未创建真实反馈，见[平台反馈](./platform-feedback.md)。

头像与密码恢复：异步裁剪卸载后不再上传，头像提交与密码修改增加同步重复提交保护；密码请求隔离账号切换及卸载后的旧结果，失败保留手动重试入口。34 项中英文及相关回归通过，未修改真实头像或密码，见[头像与密码恢复](./avatar-password-recovery.md)。

最新完成：[大文件流式保存](./streamed-delivery-download.md)，按浏览器能力直接写入所选文件，保留账号校验、双语错误及取消。独立磁盘模式下，500 MB 下载观测峰值从 Blob 的 767.8 MiB 降至两轮 357.0 / 379.6 MiB；双语中断、原文件保留和重试哈希校验通过。此前[大文件与传输中断专项](./large-transfer-validation.md)继续覆盖上传及兼容下载。此结论限于本机 Chromium 和测试文件句柄，不代替原生保存对话框、真机、持续弱网或生产代理验收。

另已完成[20 分钟读写与 2 分钟空闲观察](./sustained-load-validation.md)：一万条背景记录下的双语操作、冲突与权限校验、重启后数据和附件一致性均通过。该固定场景不等于生产最大容量验收。

后续[持续新增附件验证](./attachment-growth-validation.md)也已通过：四项目共创建 44 个文件、删除 8 个，最终 36 个文件的元数据与哈希在重启前后一致；类别上限拒绝、满额重放、删除释放名额及补传均覆盖。该场景验证逻辑文件增长，不代表实际磁盘满额或无限数据增长验收。

| 工作 | 完成条件 | 依赖与边界 |
| --- | --- | --- |
| 文档持续对齐 | 主需求、当前实现、专题说明与发布记录一致；后续改动同步更新入口 | 本轮已纠正主文档的角色、必填、步骤、通知、注销和测试设施冲突；原图未决规则见下表 |
| 真实邮件接入验收 | 验证邮件、密码重置、订阅与退订、发送失败恢复在实际发件服务中通过 | 本地 QQ 中英文模板实收与排版已确认；正式发件服务、门户域名及真实链接流程仍需验收，见[邮件说明](./email.md) |
| 真实 OIDC 接入验收 | 至少两个实际服务分别完成绑定、客户与后台登录、停用和恢复；检查正式域名回调 | 多服务实现与模拟身份服务测试已有；需实际应用配置和测试账号，见[OIDC 说明](./oidc.md) |
| 大文件保存的真机验收 | 原生保存对话框、新建与覆盖、权限拒绝、慢盘及低内存设备完成双语操作 | 流式实现、磁盘模式峰值对照及自动化恢复已完成；需要实际设备和用户目录，兼容浏览器仍走 Blob 下载 |
| 长时间与容量验证 | 在约定数据规模和资源预算下验证更长运行、存储配额耗尽及恢复 | 已完成 20 分钟读写与空闲观察，以及[有限附件增长、删除补传](./attachment-growth-validation.md)和重启完整性，以及[配置配额触顶、删除释放及上传恢复](./storage-quota-validation.md)；仍未验证最大容量、实际磁盘耗尽、持续新增项目、生产预算及对象类型归因，见[负载验证](./sustained-load-validation.md)与 [GC 诊断](./gc-diagnostic-2026-09-15.md) |
| 真机与辅助功能验收 | 实际 iPhone/Safari、Android 相册/相机、键盘、屏幕阅读器与浏览器缩放完成中英文核心操作 | 需要对应设备或测试人员；已有 Playwright 三引擎回归仅覆盖[记录范围](./customer-browser-validation.md) |
| 实际 AI 服务验收 | 使用已选图像模型验证识别质量、错误恢复、成本与兼容性 | 需要负责人选择服务商/模型及提供受控配置、可测试资料；已实现接入不等于真实模型已验收，见[图书录入](./book-intake.md) |
| 目标环境部署演练 | 新装、覆盖升级、备份恢复、访问权限、上传及下载在目标机器成功 | 需要目标环境和部署参数；保留数据库、上传文件、最终成品及数据保护密钥，见[部署与备份](./deployment-and-backup.md) |

## 业务确认后才能开发

| 决策 | 需要明确的问题 | 当前行为 |
| --- | --- | --- |
| 真实生产工作流 | 制作节点、负责人职责、推进条件、审片、返修及多版本交付如何组织 | 人工跟进、定向退回资料、单一当前最终成品；[生产协作](./production-workflow-annotations.md)暂不开发 |
| 组织与项目权限 | 成员邀请、多组织、项目归属转移与组织变更后的历史归属 | 已确认：同组织共享查看草稿及已提交项目，仅创建人编辑、提交、回复和删除；一个账号最多一个组织，成员变更后按当前组织检查访问权限；运营后台仍只看分配给自己的项目 |
| 客户主动变更 | 是否允许主动撤回、追加材料或正式需求变更；是否保留原版本 | 已提交项目默认只读，仅在管理员定向退回后处理允许的资料单元 |
| 授权和必填文件 | 勾选声明或签署文件；正式运营的必传类别、格式、大小及数量 | 文件类别由后台配置；默认仅封面必传，书籍正文选传 |
| 大文件存储 | 是否采用分片、对象存储直传；容量、成本及恢复目标 | 普通上传，支持进度、取消和重试；未完成文件刷新后需重新选择 |
| 外部通知 | 邮件发送服务、发件域名和上线启用时间；是否另需短信或系统推送 | 站内通知已具备；v0.3.16 已发布默认关闭的邮件验证、找回和用户自选提醒，含有限重试，真实发件服务待定；短信和系统推送未实现 |
| Linux 配置体验 | 现有中英文安装向导是否足够，是否需要全屏终端配置界面 | 现有安装、覆盖升级和回滚路径继续维护 |

## 原始需求图片仍待细化的四项

这四项是决策缺口，不是已授权的新功能。原图出处和判断见[需求图片核对](./requirements-image-audit-2026-09-14.md)。

| 项目 | 需要确认 | 当前约束 |
| --- | --- | --- |
| 角色发现与筛选 | 是否采纳热门、性别和安全筛选；热门的统计口径、安全标注依据及责任人 | 已有预设与自定义角色；不能凭空生成热门榜或安全承诺 |
| 标签必填口径 | 受众、基调、用途、市场、敏感度是否每组必选，历史草稿如何兼容 | 保持当前服务端校验；“必选标签”原图标题不能直接扩大必填范围 |
| 制作限制交接 | 内容限制如何结构化、由谁确认、在制作交接与导出中如何呈现 | 已有创意方向与规避内容；授权确认和制作内容限制分别处理 |
| 正式项目命名 | 是否新增内部正式名称、由谁修改、客户可见范围、导出名称和审计 | 临时项目名可选，空白采用书名；不能据此授权管理员覆盖客户提交快照 |

## 正式上线前需要提供

- 访问范围、域名、HTTPS 与可信代理配置。
- 正式字体授权，以及授权声明和必传材料规则。
- 备份存储位置、访问权限、加密和保留策略。
- 目标服务器与实际设备测试条件，并完成一次完整恢复演练。

## 已明确排除

平均交付耗时统计已由用户决定不做，不计入待办。自动视频生成、自动分镜、自动配音、支付订阅及通用聊天不在当前开发范围。客户平台反馈继续通过站内通知回复，不增加独立聊天框。

## Language and implementation boundary

All customer and admin changes must support `zh-CN` and `en-US`, use stable identifiers and enforce server-side access rules. User-entered content is not automatically translated. Existing automated checks do not replace real-device, real-provider or target-deployment acceptance. Production workflow and the unresolved business rules above require confirmation before implementation.

2026-09-18 邮件模板与预览（已发布）：验证、重置、通知及安全提醒统一中英文 HTML 排版并保留纯文本；后台负责人可在独立页面按类型和语言编辑与预览，帮助说明收于问号。旧队列兼容、预览权限、HTML 转义、MIME 备选正文、语言切换和键盘关闭已验证。后续经用户单独授权发送两封示例邮件，QQ 实收与中英文排版已确认；外部域名及真实链接仍待验收。见[邮件说明](./email.md)。

2026-09-18 本地邮件流程验收：正式域名未定，按用户确认使用临时数据和内存收件器。中英文验证、一次性链接、订阅不补历史、退订取消待发且保留站内通知、改密撤销会话及重启后的登录/安全邮件恢复均通过；2 条 HTTP 综合用例、44 项前端检查通过。本轮不改真实账号、不发额外邮件，正式域名验收仍待开展。见[邮件说明](./email.md)。

2026-09-18 组织项目共享：客户项目列表增加创建人头像及资料链接。同组织成员可只读查看项目、附件、成品和退回意见；待处理仅统计本人需操作的项目，复制与所有写入仍限创建人。组织移除或变更后重新检查访问权限。数据概览支持个人与组织口径切换。 / Organization project sharing: members can read drafts and submitted projects, attachments, deliveries and return feedback; creator-only editing and writes remain enforced. Pending actions remain personal; the dashboard supports personal and organization scopes. Creator avatars link to member profiles; membership changes revoke shared access.

2026-09-18 后续完善（v0.3.19 已发布）：邮件模板增加不保存、不发信的正文预览与换行支持，类型/语言保存在路由；仅实际修改才阻止离开。模板修改、恢复默认和测试接入既有操作审计，帮助文档与功能搜索已同步。 / Released in v0.3.19: unsaved template preview, preserved line breaks, URL selections, dirty-only navigation protection, template audit events and updated help/search.

2026-09-18 邮件发送额度（v0.3.19 已发布）：现有配置增加滚动每分钟及24小时上限，SMTP尝试统一扣额，计数持久化；限速不消耗重试，队列保留原有效期。邮件服务展示使用量和预计恢复时间，中英文及隔离并发测试覆盖。 / Released in v0.3.19: persistent rolling minute/day quotas cover SMTP attempts, preserve queued message expiry and retry counts, and expose usage/resumption in the mail service panel.

2026-09-19 本地完善（未发布）：定时任务支持服务端标题搜索、状态筛选、URL 分页和关联公告精确跳转；公告编辑增加顶部滚动条与弹窗效果预览，不会保存或发布。三浏览器反馈键盘验收改为操作可见的选择图片按钮。 / Local follow-up (unreleased): server-filtered task history, persistent URL filters, exact announcement links, placement previews and keyboard tests targeting the visible image-selection button.

### 2026-09-19 邮件记录检索（本地未发布）

- 邮件记录支持按收件邮箱或域名搜索，可组合状态、类型筛选；分页和浏览器历史保留条件，结果地址继续脱敏，顶部数量保持全局口径。
- 已同步中英文界面和邮件排障帮助；12 项前端测试、25 项邮件后端测试与后台构建通过，并在本地页面验证搜索及清除筛选。

### 2026-09-19 组织邀请注册（本地未发布）

- 保留管理员创建账号，新增后台“主体管理 → 邀请码管理”和客户登录页邀请注册入口。
- 邀请码绑定启用中的组织，默认 7 天 / 1 人，可配置 1–90 天和 1–100 人；支持搜索、组织与状态筛选、分页、查看/复制、停用及注册成员记录。过期自动失效，不删除历史。
- 客户先验证邮箱，再设置姓名和密码；创建客户账号、邮箱验证、名额占用在 SQLite 写事务内完成。已有账号不迁移组织，邮件通知默认关闭。
- 邀请码加密保存，验证令牌仅存哈希；注册邮件复用现有队列、限速、重试、取消与过期处理。公开发信接口统一响应，避免泄漏账号存在性。
- 中英文帮助、后台功能搜索、邀请码操作审计已接入。真实页面检查完成；客户前端 637 项、后台前端 277 项、API 505 项全量测试通过，两端构建通过；独立安全审查问题已修复并复审通过。
- 正式门户 HTTPS 域名仍待确定；生产发信与跨设备邀请注册需使用正式域名验收。本次只使用隔离测试数据库和模拟邮件，未创建真实客户账号或发送真实邮件。

2026-09-19 邀请注册衔接（本地未发布）：邀请码查看窗口增加复制邀请链接，使用服务器配置的客户门户地址和当前语言，邀请码放在 URL 片段中并在页面读取后移除；不会自动发信或注册。成功注册后返回登录自动填入已验证邮箱，密码不传递、不持久保存。
