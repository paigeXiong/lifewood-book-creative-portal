# 客户端键盘与浏览器验收

`npm run test:customer-browsers` 使用 Chromium、Firefox、WebKit 的真实测试浏览器，配合独立后端和真实测试账号。首次运行需要 `npm exec playwright install chromium firefox webkit`，以及已构建的 Release 后端。测试端口为 5090 / 5193 / 5194，业务数据位于 `artifacts/e2e-data`，不会访问本地开发服务 5077 / 5173 / 5174 的数据。

验收覆盖中文和英文：

- Tab 到达跳转主内容入口，Enter 将焦点移到正文。
- 纯键盘打开反馈、填写文字、选择图片并提交，关闭后回到入口。
- Tab / Shift+Tab 保持在当前模态弹窗内，异步加载与动态图片按钮纳入循环。
- 反馈关闭后重新打开，保留本次页面内的文字及图片。
- 640 CSS 像素的桌面重排与 320 像素的窄屏布局，无横向溢出。
- 复用手机向导用例，覆盖五个资料步骤、账号菜单、折叠导航、上传选择器取消和必填上传定位。

跳转主内容链接显式设置 `tabIndex={0}`，确保 WebKit 默认键盘策略也可以通过 Tab 到达。测试从主内容反向进入顶部反馈入口，不依赖浏览器在页面末尾自动循环。

共享通知弹窗增加首尾焦点循环，避免 Tab 离开模态内容；卸载时使用已捕获的 dialog 元素关闭弹窗，再恢复仍存在的触发元素焦点。嵌套弹窗仅处理自己的按键和控件。焦点列表保留原生折叠标题 `summary`，中英文单元回归覆盖回复历史、禁用与隐藏控件。

2026-09-14 本地验证：三个引擎的键盘反馈用例与移动填报用例均通过（共 6 项，每项覆盖两种语言），两端单元测试与构建通过。浏览器命令已接入 Windows CI 工作流，CI 结果以实际运行记录为准。

这组测试不等于真实 iPhone/Safari、Android 相机或屏幕阅读器认证。640 CSS 像素检查的是重排布局，不能宣称完成操作系统级缩放或真实浏览器 200% 缩放的人工验收。实际设备及辅助技术仍需另行验收。


## 客户异常恢复与搜索（2026-09-14）

- 账号刷新遇到可重试的网络/服务错误时保留已加载的页面及个人资料输入，显示局部重试提示。首次加载失败仍显示错误页；登录失效、权限撤销和账号切换错误不沿用旧内容。
- 项目详情在后台刷新失败时保留已经加载的资料与交付区域；无缓存、记录不存在或权限错误仍阻止展示。
- 项目搜索停止输入 300ms 后生效，清空立即清除搜索，保留状态和排序并重置页码。输入法组词期间不搜索，回车仍可立即提交；自动搜索替换当前历史项。
- 反馈请求的 30 秒超时包含安全令牌、提交和响应等待。超时保留同一份内容与提交编号供重试；取消的安全令牌等待可被新的请求替代，旧响应不能覆盖新令牌，也不能在超时后补发旧反馈。
- 反馈选图后重置原生文件输入，支持移除后再次选择同一图片；替换图片处理失败时保留此前成功选中的图片。

Refresh failures preserve cached content and unsaved profile edits only for retryable errors. Authentication/access failures continue to block access. Search debounces for 300ms and respects IME composition. Feedback submission has a 30-second deadline and retains its idempotency key for retry, including recovery from a stalled CSRF lookup. Re-selecting the same screenshot works after removal.

验证：客户前端全量 313 项、管理端全量 95 项通过；两端生产构建通过。三浏览器回归初跑 5/6 通过，Firefox 键盘用例在 Vite 热更新时被卸载，跟踪记录确认了更新事件；停止源码变更后该用例单独复测通过（共覆盖 6 项）。初跑跟踪保存在 `artifacts/customer-recovery-firefox-initial-trace.zip`，日志为 `artifacts/customer-recovery-browser-tests.log` 和 `artifacts/customer-recovery-firefox-recheck.log`。新异常场景由单元交互测试覆盖，既有浏览器用例覆盖键盘、反馈选图和双语窄屏操作。


## 项目详情布局（2026-09-14）

详情页压缩进度区和封面摘要，封面可打开原图；提交资料改为浅层级的标签/值排版，保留全部字段。左侧分组导航在桌面随页面滚动保持可见，窄屏重排为按钮组；锚点支持键盘焦点，并为顶部导航预留滚动距离。默认用现有 SVG 图标替代分组编号，中英文入口均已补齐。

客户生产构建及 57 项关联回归通过。隔离浏览器预览使用示例项目数据和服务端双语选项目录，检查 1440、768、390、320 像素的溢出、分组定位与焦点；另检查桌面与 320 像素下有成品、长文件名的布局。已实际查看中文桌面、英文最窄屏与成品状态截图。截图和预览脚本位于 `artifacts/detail-redesign-*.png`、`artifacts/preview-detail-layout.mjs`，没有修改真实项目记录。


## 客户成品下载恢复（2026-09-15）

成品下载通过现有鉴权 API 客户端获取文件，成功后再交给浏览器保存。文件已撤回、登录失效、权限错误和网络中断显示为页内的中英文错误，不会把项目详情替换为接口响应。请求携带账号校验、语言和取消信号，禁止缓存；下载中阻止重复请求并提供取消操作，离开页面、切换项目/语言或刷新后发现文件不可用时中止未完成请求。失败后可再次点击原下载按钮重试。浏览器保存仍使用服务端记录的文件名，旧请求的迟到结果不能在取消后触发保存。

验证：客户前端 323 项、管理端 95 项测试通过；客户生产构建通过。`tests/e2e/delivery-workflow.spec.ts` 在隔离数据库中跑通中英文提交、退回修改、发布成品、模拟下载 404、恢复下载及撤回流程（1 项用例包含两种语言）。恢复后的下载与上传字节一致，错误期间保持项目路由；英文窄屏截图已检查，未出现横向溢出。独立代码审查无严重/重要发现。

原有 Blob 路径会在响应体接收完成后交给浏览器下载管理器。本机 Chromium 的 [500 MB 上限文件、取消与连接中断恢复专项](./large-transfer-validation.md)已通过双语大小及 SHA-256 校验；历史非持久上下文的两轮[内存诊断](./transfer-memory-validation.md)观测到约 1.3 GiB 的私有提交峰值和短时回落差异。后续新增[大文件流式保存](./streamed-delivery-download.md)：文件达到 50 MB 且安全上下文支持保存选择器时，直接按块写入所选文件；否则保留 Blob 路径。真实移动设备及持续弱网仍未验收，500 MB 服务端限制保持不变。

Delivery failures stay on the project page with localized feedback, retry and cancellation. Unit and integration checks passed in both languages, including exact downloaded bytes and revocation. The subsequent streaming path writes deliveries of at least 50 MB to a user-selected file when supported; other cases retain Blob downloads. Historical nonpersistent Chromium diagnostics recorded peaks around 1.3 GiB, which must not be directly compared with the newer disk-profile results. Real mobile networks, native save dialogs and low-memory devices remain separate acceptance work.


## 通知跳转异常恢复（2026-09-15）

通知详情中的关联事项跳转失败、标记已读失败，会在当前弹窗显示本地化错误，避免被模态遮罩挡住。请求期间禁用重复打开，失败后可使用原入口重试。关闭详情、离开路由、切换语言或缓存账号时取消未完成请求；跨标签页触发 `lw-account-changed` 也立即取消，即使旧账号缓存尚未刷新。迟到响应不再触发后续标记已读或导航。未保存表单的离开确认继续生效。

新增 15 项交互测试覆盖两种语言、客户和管理员、目标查询失败、已读请求失败、重复点击、关闭详情、账号变化、跨标签页事件以及取消未保存确认。连同通知筛选、通知详情恢复、多选、表单焦点、填报恢复和 API 回归，共 108 项关联检查通过；两端生产构建通过。独立复审无剩余问题。

隔离环境的交付端到端用例新增「通知详情 → 模拟断网 → 弹窗内错误 → 重试进入对应项目」，中英文完整流程通过（单用例覆盖两种语言，53.5 秒）。保留服务端返回的通知来源参数；同时重新验证下载内容一致及撤回。实际查看 `artifacts/notification-target-error-zh-CN.png` 和 `artifacts/notification-target-error-en-US.png`，中文桌面与英文窄屏错误均在弹窗内可见。本轮未发现表单报错定位的新缺陷，未修改其实现。

Notification navigation now reports localized errors within the active dialog and ignores cancelled or stale requests, including cross-tab account changes. Both locale/role combinations, unsaved-form cancellation, production builds and the bilingual browser workflow passed. Real-device and assistive-technology acceptance remains separate.


## 草稿恢复取消（2026-09-15）

恢复对比的「应用并继续编辑」会先再次读取服务器版本。本轮修复该读取卡住时无法取消的问题：按钮和 Esc 均可取消等待、关闭对比，并保留当前表单输入。读取请求带取消信号；取消后重新发起对比时，旧响应不会应用内容或清除新请求的加载状态。切换项目/语言、卸载及跨标签页账号变更也取消未完成的读取。既有版本、输入快照及可恢复字段校验保留。

验证：9 项草稿恢复测试通过（新增 4 项，含中英文等待期间按钮/Esc 取消、取消后立即重试及账号事件）；连同填报、文件选择与上传进度，共 69 项关联检查通过。客户生产构建通过。隔离端到端用例 `tests/e2e/draft-recovery.spec.ts` 中英文通过（19.2 秒），覆盖挂起读取、取消、保留原文、重新对比和保存最终合并内容；已查看英文窄屏对比截图。独立代码审查无剩余问题。本轮对上传队列进行了关联回归，未新增上传业务能力。

Draft conflict recovery can now be cancelled while its server recheck is pending. Cancellation preserves form input and suppresses late responses. Both locales, button/Esc cancellation, account-change cleanup, existing upload/form regression checks, production build and bilingual browser recovery passed.
