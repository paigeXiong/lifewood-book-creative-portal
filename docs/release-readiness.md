# 发布就绪检查

## 一次性验证

在仓库根目录运行：

~~~powershell
npm run verify
npm run publish:aot
npm run smoke:aot
~~~

以上命令依次验证客户前端、管理中心、平台 API、生产构建、Native AOT 编译以及真实 AOT 可执行程序中的建号、Cookie 会话、CSRF、管理员写操作和审计查询。

GitHub 的 .github/workflows/verify.yml 会在 main 推送和 Pull Request 上执行相同等级的验证，并上传 Windows x64 正式发布包。

## 生成正式发布包

Windows 用户可双击根目录的 build-release.bat，或运行：

~~~powershell
npm run build:release
~~~

输出位于 artifacts/release/：

- lifewood-book-creative-portal-win-x64-*.zip
- 同名 .sha256 校验文件

压缩包结构：

- customer/：客户门户静态文件，部署到 /。
- admin/：管理中心静态文件，部署到 /admin/。
- api/：Windows x64 Native AOT 平台 API。
- release-manifest.json：提交版本、运行时和路径信息。

文件名包含 Git 提交短标识。干净工作区使用提交标识；存在未提交改动时会明确增加 `dirty` 与发布内容指纹，清单也会记录 `sourceState` 和 `contentId`，避免把本地产物误标成干净提交。同一来源状态、运行时和前后端产物会使用提交时间作为固定时间戳，按与系统语言无关的稳定顺序生成相同字节与 SHA256；需要指定其他可复现时间时可设置 `SOURCE_DATE_EPOCH`。

脚本会自动清理暂存目录、剥离调试符号，并拒绝包含测试控制台、开发日志、开发数据库、源码、环境文件、备份文件、源码映射或本地服务状态文件的发布内容。

## 上线前仍需人工确认

代码验证通过不代表业务与基础设施决策已经完成。正式上线前仍需确认：

- 正式 HTTPS 域名、TLS 终止代理和 Network:TrustedProxies；
- 组织与账号共享边界；
- 授权确认形式；
- 最终文件限制和大文件传输方式；
- 正式字体授权；
- 备份存储、加密和恢复演练责任人。

完整业务决策清单见 [产品需求第 21 节](./product-requirements.md#21-待确认事项)。
