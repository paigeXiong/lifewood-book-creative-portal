# 后台导出与下载恢复

日期：2026-09-15。项目资料 ZIP、审计 CSV、备份下载和统计 CSV 共用导出控制，支持简体中文和英文。

- 同步拦截重复点击，每个页面同时只处理一个导出；失败后恢复按钮，用户可重新点击原导出入口，不自动重发。
- 项目资料包、审计和备份提供取消。取消立即恢复界面，旧请求即使迟到也不能下载文件或覆盖新请求状态；恢复历史弹窗内也可取消安全备份下载。
- 项目、语言、账号或导出相关权限变化会取消对应请求；审计筛选条件变化也会取消旧导出。审计翻页不改变整份 CSV 范围，因此不取消；备份下载按指定记录执行，列表翻页不改变下载对象。
- 文件响应完成后再次检查账号，防止账号变化后将旧结果交给浏览器。页面离开后丢弃迟到响应。
- 请求错误沿用 API 中英文错误键。创建下载链接或触发下载抛出异常时，显示检查浏览器下载设置的本地化提示；失败及时释放对象 URL，成功触发后延迟 30 秒释放，临时链接均移除。
- 统计 CSV 仍导出当前成功加载的数据，不新增请求；数据正在刷新或读取失败时禁用导出，避免拿旧缓存当成当前成功结果。

浏览器没有提供普通链接下载最终落盘成功的确认；本轮只处理能够捕获的启动异常，不声称能够检测所有静默拦截、磁盘错误或用户取消。取消前已完成的服务端导出、审计记录不会被前端取消回滚。备份与 ZIP 沿用 Blob 下载方式，不计为大文件流式保存优化。

## 验证

5 个测试文件共 20 项通过：包含同步防重、失败后显式重试、取消后立即重试、旧结果不覆盖新请求、切换范围/卸载、账号二次检查、双语启动错误、URL 清理、审计页面真实筛选切换及已有导出 API/恢复历史/i18n 回归。后台 TypeScript 与生产构建通过。

```powershell
npm run test --workspace @lifewood/admin-web -- src/audit-export-recovery.test.tsx src/export-download.test.tsx src/operations-api.test.ts src/restore-history.test.tsx src/i18n.test.ts
npm run build:admin
```

本轮为前端修改，使用模拟响应的组件测试验证失败与恢复，不计为新的服务端负载或真机下载验收。保留现有客户 5173、管理员 5174 和 API 5077 进程；Vite 自动更新前端，无需重启 API。

## English summary

Admin exports share duplicate-click protection, cancellation, explicit retry, scope invalidation, account checks, and object-URL cleanup. Audit filter changes discard old exports, and cached reports cannot be exported while refreshing or in error. Tests cover observable download-start failures, not final file persistence or silent browser blocking.
