# 头像与密码操作恢复

## 头像

头像裁剪使用同步锁避免重复生成。裁剪输出异步完成时验证本次编辑仍有效；弹窗已卸载时不再上传，并继续释放临时图片 URL。客户个人页面的上传和恢复默认头像使用同步提交锁，等待响应期间不重复写入，也不自动重试上传。

裁剪失败或上传失败后保留当前图片和裁剪位置，可手动重试。重新生成时清除旧的本地错误，避免遮盖最新接口错误。现有格式、像素和文件大小限制保持适用。

## 修改密码

提交时锁定三项密码输入，阻止重复提交；请求前后校验页面生命周期及账号。切换账号时移除密码表单，迟到的旧响应不会清除替换账号的缓存或触发登录跳转。弹窗卸载后同样忽略旧结果。

确认成功后继续清除当前查询缓存并返回登录页面。请求失败不自动重发，可手动重试；不能仅凭网络错误判断服务端是否已完成密码修改。密码只保留在当前页面内存和请求中，不增加浏览器持久化。失去观察者的已结束密码 mutation 立即回收。

## 验证范围

2026-09-16：新增 16 项中英文用例，加上已有头像工具与个人资料恢复测试，共 34 项通过。覆盖异步裁剪卸载、重复点击、裁剪及上传错误恢复、密码提交锁、失败后手动重试、跨标签页账号变化、卸载后的响应及确认密码不一致。使用替代接口，没有修改真实头像或密码。

English: Avatar encoding ignores results after unmount and guards repeated export. Failed encoding or upload preserves the crop for an explicit retry. Password changes lock input while pending and validate account and component lifetime before applying results. Stale responses cannot clear another account's cache or redirect its page. Writes are not automatically retried; network failure alone does not establish whether a password change reached the server.
