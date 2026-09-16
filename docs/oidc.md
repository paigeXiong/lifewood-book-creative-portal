# 企业账号登录（OIDC）

平台支持多个由所有者配置、可同时启用的标准 OpenID Connect 身份服务。客户与管理员登录页通过“其他登录方式 / Other sign-in options”展开已启用的入口；未配置时显示明确的空状态。个人资料按服务分别提供企业账号绑定和解绑，均需要当前平台密码。

## 配置和启用

1. 在身份服务中注册 Web 应用，选择 Authorization Code 流程，支持 PKCE S256 和 RS256 或 ES256 签名。
2. 平台所有者进入管理后台 **系统配置 → 登录方式**，点击“添加登录服务”，填写中英文名称、Issuer、Client ID、Client Secret、客户站点地址及管理后台地址。首次保存为关闭状态。
3. 保存后页面会生成此服务专属的回调地址，登记到身份服务后，再检查配置并启用。新服务的回调为各站点的源地址加 `/api/auth/oidc/callback/{providerId}`；旧版单服务迁移后的回调继续使用 `/api/auth/oidc/callback`。管理后台即使在 `/admin`，回调仍在源地址的 `/api` 下，始终以配置页显示的完整地址为准。
4. 可重复添加并同时启用多个服务。相同 Issuer 和 Client ID 不允许重复配置；同一身份服务的不同客户端可分别配置。连接检查验证发现文档和签名公钥，**不代表 Client ID、Client Secret 或服务访问策略已通过实际登录验证**。启用时后端再次校验服务元数据。
5. 用户先使用平台密码登录，在个人资料中分别绑定所需服务，再从登录页“其他登录方式”选择其中一个。管理员也从客户站点个人资料绑定，进入后台时仍检查平台权限。
6. 每个服务可独立编辑、启停或删除。停用保留绑定，删除经确认后清除该服务的绑定和未完成授权，不删除平台账号，也不影响其他服务。对运行中的配置修改即时生效，无需为每次配置重启 API。

密码字段留空会保留已有密钥；更换 Issuer 或 Client ID 时必须重新提供密钥（若服务要求）。密钥使用平台 Data Protection 加密保存，不返回前端。配置采用版本检查，防止覆盖其他管理员已保存的更改。备份和恢复需要保留平台加密密钥；密钥无法解密时企业登录关闭，密码登录仍可使用。

编辑后取消或切换业务页面会询问是否放弃；刷新或关闭标签页使用浏览器原生提醒。检查配置和保存期间阻止业务路由离开。语言路由切换保留输入，列表后台刷新失败也保留编辑器；不在浏览器存储中保存密钥或配置草稿。

版本冲突后，点击“核对最新配置”读取服务器当前值并查看差异。可确认“采用服务器版本”放弃本次填写，或“保留本次改动”：仅把相对开始编辑时修改过的字段合入最新版本，其余采用服务器值。这两种操作都不会自动保存，且会清空尚未保存的密钥；需要时重新填写，再手动保存。保存仍受版本检查保护，再次冲突需重新核对。配置已被删除时保留当前输入并提示返回列表，不自动重新创建服务。

English: Unsaved edits are protected on cancellation, navigation and reload. Conflict recovery compares current input with fresh server values, then explicitly adopts the server version or rebases only locally changed fields. Unsaved secrets are cleared. A separate save still requires the current server version; deleted providers are never recreated automatically.

客户站点地址只允许源地址；后台可使用源地址或 `/admin`。正式站点使用 HTTPS；本地预览允许 loopback HTTP。身份服务及后端访问的元数据、Token、公钥端点必须是公网 HTTPS，拒绝内网地址、重定向和 DNS 返回私网地址的请求。因此本版本不支持仅能通过内网访问的身份服务。

## 账号和安全边界

- 绑定键包含服务 ID、Issuer、Client ID 和 Subject；不根据邮箱自动关联账号，不创建用户、不同步第三方角色或组织。
- 保留平台密码和邮件找回。第三方登录本身不等于双重验证，身份服务是否要求多因素由其策略决定。
- 登录采用 PKCE、state/correlation、nonce 和服务端令牌签名、Issuer、Audience、有效期检查。身份服务令牌不保存到浏览器或平台会话中。
- 授权准备票据绑定发起浏览器，10 分钟失效且只可使用一次。配置更改仅取消该服务的待完成流程；独立认证方案、state 保护和回调路径防止不同服务混用。
- 绑定需要有效的平台会话和密码复核。退出登录、撤销设备会话、重置密码或解绑会阻止旧绑定流程完成。
- 登录准备和绑定弹窗的异步响应仅对当前页面有效。离开或切换路由后，旧响应不再触发第三方跳转或关闭新的弹窗。收到账号切换事件时停止使用原操作结果、清空绑定弹窗中的密码，并显示现有账号变更提示；关闭按钮仍可使用。这不会撤销已经到达服务器的请求，返回页面时仍以服务端状态为准。
- 禁用企业登录不删除已绑定身份，也不主动撤销已创建的平台会话；设备撤销和账号停用使用现有平台管理功能。
- OAuth-only 服务需要单独适配，不接受后台任意填写一个“验证接口”便信任其返回值。普通 GitHub OAuth 登录未包含在此版本中。

## 验证

2026-09-16 登录交互生命周期验证：41 项前端测试通过，客户与管理端 TypeScript 及生产构建通过；覆盖中英文客户/管理员登录入口、离开后返回、同页路由变化、账号切换、迟到的成功/失败响应、绑定密码清空及替换弹窗保护。跳转函数仍只接受平台内部单次 OIDC 票据地址，测试使用替代跳转函数，不连接真实身份服务。

English: Pending OIDC responses cannot redirect or update a replacement dialog after navigation or account change. An account change clears the binding password and disables submission while keeping cancellation available. Requests already accepted by the server are not rolled back; re-entering the page reloads server state.

2026-09-16 配置编辑恢复验证：`oidc-settings.test.tsx` 24 项通过，覆盖中英文未保存取消、刷新拦截、路由和语言切换、保存中离开、冲突读取/确认/保留改动、再次冲突、删除及后台刷新失败。后台全量 34 个文件、180 项测试通过，TypeScript 与生产构建通过。本轮没有接入真实身份服务，浏览器原生刷新提示仍需实际浏览器人工验收。

后端集成测试使用隔离数据库和模拟身份服务，覆盖真实 OIDC 中间件的发现文档、PKCE、签名令牌回调、显式绑定、未绑定身份拒绝，以及错误签名、受众、Issuer、nonce、过期令牌等情况。前端测试覆盖中英文入口、账号绑定、所有者权限、配置冲突和密钥保留。

`tests/oidc-native-smoke` 是独立测试程序，引用生产 OIDC 模块，使用隔离的模拟身份服务验证 NativeAOT 下的绑定、客户及后台登录和错误签名拒绝。测试服务不会编入正式平台程序：

```powershell
dotnet publish tests/oidc-native-smoke/OidcNativeSmoke.csproj -c Release -r win-x64 --self-contained true --artifacts-path artifacts/oidc-native-build -o artifacts/oidc-native-smoke
& ./artifacts/oidc-native-smoke/Lifewood.OidcNativeSmoke.exe
```

上线前仍需使用实际身份服务验证客户端配置、回调地址、反向代理 HTTPS 设置及用户绑定与恢复流程。目前未配置真实身份服务。旧版单服务配置、加密密钥及账号绑定会自动迁移为默认服务，迁移只取消尚未完成的旧授权流程。
