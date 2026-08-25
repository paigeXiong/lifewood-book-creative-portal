# 正式部署与数据备份

## 部署拓扑

正式环境建议使用同一 HTTPS 域名：

- 根路径：客户门户 apps/task-entry-web/dist
- /admin/：管理中心 apps/admin-web/dist
- /api/：反向代理到 Lifewood.PlatformApi

同域部署可以继续使用当前的 SameSite=Strict、Secure、HttpOnly Cookie。两个前端都必须配置 SPA 回退：客户路径回退到客户 index.html，/admin/* 只回退到管理中心 index.html。禁止把 /api/* 回退到前端。

## 构建

    npm ci
    npm run build:web
    npm run build:admin
    dotnet publish services\platform-api\Lifewood.PlatformApi.csproj -c Release -r win-x64 --self-contained true -p:PublishAot=true

管理中心生产包已使用 /admin/ 作为资源和路由基址。本地开发仍使用独立的 5174 端口。

## 服务要求

- 只让反向代理对公网开放，API 监听本机或内网地址。
- 必须启用 HTTPS，并把可信反向代理地址写入 Network:TrustedProxies。
- API 的工作目录必须固定；账号数据库、上传资料、最终成品和数据保护密钥均位于其 data/ 目录。
- 更新程序时不得覆盖或删除 data/。
- 运行账号只应拥有程序读取权和 data/ 写入权。
- 正式发布物不得包含 apps/test-console、本地日志、测试账号或开发数据库。

## 备份

API 运行期间会独占 data/platform.lock；备份脚本也会持有同一锁，因此即使服务不是由本地启动脚本启动，也不会在数据仍被写入时生成备份。

先停止平台，再双击根目录的 backup-platform.bat。备份默认写入 backups/，该目录不会提交到 Git。

备份包同时包含：

- SQLite 数据库；
- 客户上传的书籍与参考资料；
- 管理员上传的最终成品；
- Cookie 数据保护密钥。

备份包含客户资料和账号数据，必须放在受控存储中并加密。建议至少每日备份，并定期把副本复制到另一台设备。

## 恢复演练

1. 停止平台服务。
2. 另外保存当前 data/ 目录。
3. 将选定备份完整解压为新的 data/，不要混合两个备份中的文件。
4. 启动 API，检查 /api/health、登录、项目附件和最终成品下载。
5. 确认无误后再开放客户访问。

至少每季度执行一次恢复演练；只有实际恢复成功的备份才算可用备份。
