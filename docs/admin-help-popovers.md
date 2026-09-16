# 后台帮助问号与浮层

2026-09-16：登录方式配置与已有备份、恢复、运行设置页面共用 `HelpPopover`，移除 OIDC 独立实现。说明通过问号按需展开，保持现有中文和英文文案。

- 图标为 14px 细线 SVG，透明点击区域固定为 24×24px；按钮无外框、无整体上浮。
- 采用原生自动 popover，位于浏览器顶层，避免被面板裁切；切换同级帮助时关闭上一项。
- 页面或容器滚动、窗口缩放、可视视口变化、内容尺寸变化时重新定位；触发按钮移出可见视口或滚动容器时收起。长说明在浮层内部滚动。
- Enter/Space 可打开；Esc 先关闭说明并返回问号焦点，不连带关闭外层编辑弹窗；焦点移到外部或点击外部时关闭。
- 按钮仍为 `type="button"`，不会提交配置表单。保留双语可访问名称、展开状态及说明关联。

## 验证方式

```powershell
npm run test:admin-help
```

独立组件测试页位于 `tests/admin-help`，直接引用正式帮助组件、样式与 `ModalFrame`。测试运行临时 5294 端口，不登录、不请求生产业务接口、不修改现有 5077/5173/5174 进程。测试页不在前端发布入口中。

覆盖 Chromium、Firefox、WebKit，中英文、1100px 和 390px 视口、缩小至 340px、图标/点击尺寸、重复开关、切换帮助、外部点击、键盘操作、滚动定位和弹窗 Esc 顺序。此组件验证不代替真机触摸、系统屏幕阅读器或真实手机软键盘验收。

本轮结果：三浏览器 18 项全部通过；OIDC 配置、共用未保存确认及双语检查合计 40 项通过；后台 TypeScript 与生产构建通过。截图保存在本地 `artifacts/help-popover-{locale}-{width}.png`。

## English summary

Admin help uses a shared 14px SVG with a transparent 24px target. Native popovers track scrolling and viewport changes, close when their trigger is clipped, and consume Escape before the surrounding modal. The isolated browser checks cover both languages across Chromium, Firefox and WebKit without changing preview services or business data.
