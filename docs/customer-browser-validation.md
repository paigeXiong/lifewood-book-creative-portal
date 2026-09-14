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
