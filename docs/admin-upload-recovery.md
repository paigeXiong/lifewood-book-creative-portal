# 后台文件上传错误与恢复

日期：2026-09-15。本轮沿用试听音频、预设角色图片和单份最终成品的现有接口与权限，不增加生产审批流程。

## 行为

- **试听音频**：上传失败后显示目标音色、文件名和本地化错误；网络或配额等可恢复错误提供“重试上传”，使用原音色及原 File。用户可取消保留的选择，或选择有效文件替换。误选空文件、格式不符或超限文件时，原失败文件仍可重试。成功后清除错误和重试入口。
- **操作保护**：不自动重发，同步锁拦截重复点击；权限等不可恢复错误不提供重试按钮。保留文件携带账号检查，切换账号后不能将旧选择发到新账号。文件仅保存在当前页面，刷新或离开后需重新选择。
- **角色预设图片**：继续保留已保存的角色 ID、版本和选择的图片。图片上传失败后重试不创建重复角色；补充中英文 507 回归。
- **最终成品**：服务端 507 现在返回 `retryable: true`，与其他配额上传错误一致。前端保留原文件、说明、上传标识，并先查询服务端是否已记录；空间释放后可手动重试。权限、格式和内容冲突等错误保持不可恢复标记。

试听音频重试是再次执行该音色的替换操作，不声称具备最终成品的上传标识去重协议；成功响应丢失后的再次上传可能再次替换音频。错误提示使用共享中英文词典，文件名和音色名称按文本呈现。

## 验证

- 后台前端 7 个测试文件、38 项通过，覆盖双语音频配额提示、原文件重试、取消、重复点击、无效替换、账号变化、权限错误、图片网络/配额恢复、成品恢复及已有音频控件/API/i18n 回归。
- 服务端 7 项通过，涵盖双语真实 507 错误的可恢复标记、拒绝后没有交付记录和文件，以及原有成品幂等重放和存储锁测试。新增接口测试使用独立 WebApplicationFactory 和临时数据库；通过直接设置测试项目为已提交来隔离上传接口行为，不计为完整客户提交链路验收。
- 后台 TypeScript 检查与生产构建通过。

```powershell
npm run test --workspace @lifewood/admin-web -- src/voice-upload-recovery.test.tsx src/delivery-recovery.test.tsx src/character-presets.test.tsx src/voice-sample-control.test.tsx src/admin-api.test.ts src/account-session.test.ts src/i18n.test.ts
npm run build:admin
dotnet test services/platform-api.Tests/Lifewood.PlatformApi.Tests.csproj -c Release --artifacts-path artifacts/admin-upload-recovery-dotnet --filter 'FullyQualifiedName~DeliveryQuotaFailure|FullyQualifiedName~DeliveryUploadReplay|FullyQualifiedName~StorageQuota' --nologo
```

保留现有 5077/5173/5174 预览进程。前端由 Vite 更新；本轮成品接口修改已经在独立服务验证，运行中的旧 API 进程需下次正常重启后载入。未发布 Release。原生文件选择器和错误面板的真机视觉验收不计入本轮自动化结果。

## English summary

Admin voice uploads now retain failed selections for explicit retry, protect against duplicate clicks and account changes, and preserve the original file when a replacement is invalid. Character-image recovery is covered in both languages. Delivery quota errors are retryable while retaining the existing status-check and idempotency flow. The existing preview processes remain running; the backend change takes effect on the next normal API restart.
