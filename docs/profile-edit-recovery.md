# 个人资料编辑与异常恢复

联系人信息进入编辑时，从当前账号资料复制姓名和电话；本次编辑期间的后台刷新不会自动替换尚未手动修改的字段。保存请求使用点击提交时的值，等待期间阻止重复提交。

保存成功后清除本次输入，离开编辑状态；再次编辑读取最新账号资料。只有编辑内容与当前资料不同时提示未保存，浏览模式下的后台资料变化不会产生未保存提示。

保存响应失败时保留输入，并读取服务端当前资料，以处理服务端已保存但响应丢失的情况。不自动重发保存请求。读取中、离线暂停或读取失败时禁用保存；已有页面刷新恢复入口继续可用。若重新读取的值已与输入一致，允许取消编辑且无需未保存提醒。

个人资料内容按账号 ID 分隔。账号切换清除旧表单；跨标签页账号变化会停止旧页面操作。资料、头像和偏好请求在前后检查账号与页面是否仍有效，响应只更新对应字段，避免旧的完整账号响应覆盖其他已完成的设置更新。

确认保存成功时，取消正在进行的旧资料读取，防止旧读取稍后返回覆盖新数据；取消不会回滚此期间已完成的其他偏好更新。如果取消的是保存失败后的恢复读取，会重新读取，并保持保存禁用直到恢复完成。

本轮没有增加后台编辑冲突版本，也没有把个人资料输入持久化到浏览器存储；服务端权限与现有未保存离开保护继续适用。

## 验证

2026-09-16：新增 16 项中英文个人资料恢复测试及已有 7 项页面刷新恢复测试通过。覆盖完整编辑快照、保存后重新编辑、响应丢失后读取、重复提交、账号替换与跨标签页变化、并发偏好更新、旧后台读取晚于保存返回、并发设置取消恢复读取后继续核对，以及临时读取失败时保留输入、权限失效时移除页面。使用替代接口，未修改真实账号。

English: Editing captures both contact fields. Background refreshes preserve the draft; successful saves clear it so the next edit starts fresh. Failed save responses trigger reconciliation without automatic write retry. Saving stays disabled while the read is pending, paused or failed. Account changes discard stale form state and results. Profile, avatar and preference responses update only their own fields. Confirmed saves cancel older reads without rolling back other completed settings.
