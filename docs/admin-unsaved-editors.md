# 后台表单未保存保护

日期：2026-09-15。本轮补齐备份策略和项目截止日期弹窗，复用现有中英文未保存确认。

- 未修改时直接关闭；修改后通过关闭按钮、取消按钮、Esc、点击外部或返回导航离开，先确认是否放弃。取消确认保留输入。
- 保存过程中拒绝关闭和业务路由离开；确认已打开后才开始保存，也不能因迟到的确认关闭表单。刷新/关闭标签页沿用浏览器原生未保存提示。
- 同一时刻仅处理一个关闭确认，确认失败或编辑器卸载后的迟到结果不执行关闭。
- 路由确认打开期间再次请求导航，沿用当前确认并前往最新请求的目标；不会因第二次导航重置阻塞器而导致确认按钮失效。本地关闭确认与路由确认分别处理。
- 每次打开策略或截止日期弹窗都会挂载新的保护实例；保存成功或确认放弃后卸载，再打开时从未修改状态开始。语言路由切换继续保留当前编辑内容。

共用 hook 的修正同时适用于已经接入的用户、组织、音色等表单。该机制记录是否发生过编辑，不做逐字段差异比较，因此修改后再手动改回原值仍可能询问。浏览器原生离开提示的文字由浏览器决定。

## 验证

专项 3 个文件、19 项通过，包含中英文按钮/Esc/外部点击/路由确认、取消保留、重复导航、保存与确认并发、同一事件内编辑与关闭、确认异常和卸载、语言切换，以及两处实际编辑弹窗关闭后重新打开的状态。后台全量 30 个测试文件、126 项通过，TypeScript 和生产构建通过。

```powershell
npm run test --workspace @lifewood/admin-web -- src/unsaved-editors.test.tsx src/unsaved-confirmation.test.tsx src/unsaved-close-races.test.tsx
npm run test:admin
npm run build:admin
```

这是两处普通编辑弹窗及共用逻辑的修复，不代表所有后台业务弹窗均已统一。公告的组织选择跳转、批量操作和成品上传等具有独立状态恢复语义，应分别核对，不能直接用普通关闭确认替换。真机浏览器的原生离开提示未计入组件自动化验收。

现有 5077/5173/5174 进程保持运行。本轮只有前端修改，Vite 可直接更新，无需重启 API。

## English summary

Backup-policy and project-deadline editors now share localized unsaved-change protection. Closing, Escape, backdrop clicks and navigation preserve edits until confirmed; saving, repeated navigation, late confirmations and reopening are covered. Specialized workflows require separate review.
