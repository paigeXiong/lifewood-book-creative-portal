# 客户端说明浮层

补充性说明默认收在相应字段或操作旁的问号中，不在表单下方常驻铺开。当前客户与管理端复用 `packages/ui/src/HelpPopover.tsx`，问号为 14px SVG，点击区域为透明 24px 正方形。

本轮已接入：

- 反馈截图的格式、大小、压缩说明和反馈页面路径。
- 项目上传卡片的类别说明、文件大小和数量限制。
- 邮件通知范围说明。
- 找回密码流程说明。
- 其他登录方式的使用说明。
- 旁白设置、参考链接、首次初始化账号与密码规则、邮箱验证/重置步骤、添加账号、第三方账号绑定和通知静默说明。
- 后台创建用户的密码与组织说明、公告范围/语言/正文/展示期限、通知规则、跟进日期、成品文件要求、参考音色与预设角色说明。

错误、读取/处理状态、字段实际值、未验证导致操作不可用的原因，以及破坏性操作的确认内容仍直接显示。说明浮层使用按钮，独立于文件输入和偏好开关的 label，避免打开帮助时误选文件或修改设置。

点击展开，按 Escape 优先收起帮助并恢复问号焦点；不会同时关闭所在弹窗。浮层进入浏览器顶层并随滚动重新定位。触发按钮离开可见范围时收起，内容在小屏幕中可滚动。

2026-09-16：110 项已有相关中英文回归通过，客户和管理端构建通过。客户反馈页实际浏览器已核对默认折叠、点击展开、小尺寸图标与 Escape 仅关闭说明。服务继续运行。

后续排查另通过 87 项客户与 34 项后台相关回归，覆盖迁移涉及的邮箱、OIDC、通知、旁白校验、公告与上传行为。参考音色的帮助入口保留在移动端也可见的工具栏，避免随窄屏表头隐藏。后台用户表单已实际检查问号位置和字段名称。

English: Supplementary help belongs in a compact question-mark popover beside the relevant field or action. Errors, progress, actual values and consequential confirmations remain visible. The customer and admin portals share one component; triggers remain outside input labels to avoid accidental file selection or preference changes.
