# 公告发布、下架与删除的恢复

日期：2026-09-15。本轮只修改管理端交互，沿用服务端版本校验和现有中英文公告流程。

- 发布按“获取当前版本收件估算—确认—提交—刷新列表”执行。下架和删除按“确认—提交—刷新列表”执行。确认期间就锁定操作，避免重复弹框或重复请求。
- 操作锁覆盖请求与刷新阶段。同一账号在页面内离开再返回时，进行中的请求仍会阻止新操作。确认结果回来时若原页面已经卸载或账号变化，不再提交。
- 只有收到服务端成功响应，才显示对应的发布、下架或删除成功提示。网络中断可能发生在服务端提交之后，因此提示结果尚未确认，并刷新列表供管理员核对；不自动重发操作，也不把记录消失直接认定为本次删除成功。
- 版本冲突和记录不存在分别提示，并刷新列表。后续发布会重新获取收件估算和确认，使用新列表里的版本；不会自动提高旧请求的版本。
- 列表刷新失败时暂停行内编辑、复制、发布、下架与删除，提供刷新入口。重新加载成功后再开放操作，避免继续使用无法核实的旧状态。
- 操作错误标明公告标题与动作，保留通用 API 错误信息；确认取消或确认框异常会释放锁。标题作为普通文本渲染。

## 验证

后台全量 32 个文件、148 项测试通过；TypeScript 与生产构建通过，限定代码复核无剩余必须修复项。

专项 14 项：中英文发布/下架/删除响应丢失但服务端状态已改变；重复点击与确认等待；冲突后使用新版本重新预览；页面卸载、账号改变和保存中重挂载；预览时公告不存在；刷新失败后的暂停和恢复；确认取消或异常后的继续操作。

```powershell
npm run test --workspace @lifewood/admin-web -- src/announcement-actions.test.tsx
npm run test:admin
npm run build:admin
```

网络响应丢失和服务端结果由组件测试模拟。本轮没有新增服务端操作回执或幂等接口，因此不能在所有结果未知的情况下自动确认某一次请求是否成功。真正刷新浏览器会销毁页面内的进行中状态；后续仍依靠服务端版本校验和最新列表核对。现有 5077/5173/5174 进程保持运行。

## English summary

Announcement actions now lock the complete preview/confirmation/request/refresh sequence. Errors refresh the list and distinguish conflicts, missing records and uncertain network outcomes. Only acknowledged server success produces a success message. Failed refreshes pause stale row actions; retries require a new selection and confirmation. Account changes and unmounted confirmations cannot trigger late writes. No automatic replay or new server-side receipt protocol was added.
