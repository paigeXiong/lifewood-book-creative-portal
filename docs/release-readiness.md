---
meta:
  contentType: How-to
  title: 验证并发布平台
  navLabel: 发布就绪
  category: 部署
---

# 验证并发布平台

本页说明如何验证代码、生成 Windows 与 Linux 发布包，并确认正式上线所需的外部配置。只有自动化检查和人工检查都通过后才能向客户开放。

## 运行完整代码验证

在仓库根目录运行：

```powershell
npm run verify
npm run publish:aot
npm run smoke:aot
```

这些命令验证两套前端、完整服务端、生产构建和 Windows x64 Native AOT 可执行程序。验证范围包括建号、Cookie 会话、跨站请求伪造（CSRF）防护、管理员写操作和审计查询。

## 检查 GitHub Actions

推送 `main` 或创建 Pull Request 后，确认以下任务通过：

- **Windows verify**：单元测试、端到端测试、Windows x64 Native AOT 冒烟和可复现发布包
- **Linux x64**：安装器安全检查、systemd 单元验证、Native AOT 发布包和运行冒烟
- **Linux arm64**：与 Linux x64 相同的原生架构验证

不要在 Linux 矩阵尚未完成时把本机 Bash 语法检查当作实机验证。

## 生成 Windows 发布包

双击根目录的 `build-release.bat`，或运行：

```powershell
npm run build:release
```

脚本在 `artifacts/release/` 生成以下文件：

- `lifewood-book-creative-portal-win-x64-revision.zip`
- 对应的 `.sha256` 校验文件

压缩包包含客户门户、管理中心、Windows x64 服务端和 `release-manifest.json`。文件名使用提交短标识；脏工作区产物会增加 `dirty` 和内容指纹。

需要 Windows 安装界面时，双击 `build-installer.bat` 或运行 `npm run build:msi`。覆盖安装不得删除 `C:\ProgramData\Lifewood\BookCreativePortal\data` 或安装时选择的其他生产数据目录。

推送 `vMAJOR.MINOR.PATCH` 标签时，GitHub Release 必须同时上传 Windows ZIP、中英文 MSI 及各自的 SHA256 校验文件。MSI 文件名包含版本与 `zh-CN`/`en-US` 后缀，避免两个本地化安装包相互覆盖。

## 生成 Linux 发布包

在目标 CPU 架构的 Linux 构建机运行：

```bash
npm ci
npm run build:linux
```

脚本按当前架构生成 `linux-x64` 或 `linux-arm64` 的 `.tar.gz` 与 SHA256 文件。Native AOT 不支持使用本脚本跨架构编译。

解压后运行中英文安装向导：

```bash
sudo ./linux/install.sh --lang zh-CN
```

安装器只替换程序与托管配置。覆盖安装保留生产数据，并在启动检查失败时恢复旧程序、配置和服务状态。

## 检查发布包内容

发布脚本必须拒绝以下内容：

- 测试控制台和测试账号
- 开发日志、开发数据库和本地服务状态
- 源码、源码映射和临时构建目录
- 环境文件、备份文件和生产数据

发布包必须包含前端静态文件、Native AOT 服务端、提交标识、运行时标识和 SHA256 校验文件。

## 完成上线前人工检查

正式开放前确认：

1. 确认部署协议与访问范围；公网使用建议配置 HTTPS 域名、TLS 终止代理和 `Network:TrustedProxies`
2. 创建首个真实管理员账号，确认发布物不含默认密码
3. 确认组织与账号共享边界
4. 确认授权形式、文件限制和大文件上传方式
5. 确认正式字体授权
6. 设置受控且加密的备份存储
7. 完成一次数据库、附件、最终成品和数据保护密钥的恢复演练
8. 使用手机和桌面设备检查中文、英文、上传、提交和最终成品下载
9. 如启用邮件，由负责人在“系统配置 → 邮件服务”的发件状态问号中检查配置；再完成真实验证邮件、密码找回、通知订阅/退订及失败恢复验收。格式检查或 SMTP 接收均不能代替收件箱验收，见[邮件说明](./email.md)
10. 如启用 OIDC，分别核验每个服务的正式域名回调、绑定与解绑、客户和管理员权限、停用后密码登录及账号恢复。发现文档检查不等于客户端凭据验证，见[企业登录](./oidc.md)

邮件和 OIDC 均是可选接入；暂不启用时记录“未启用”，不需要为通过上线检查填入虚构服务或打开开关。实际服务未选定或测试账号未提供时，真实联调应保持待验收状态。

部署路径、覆盖安装和恢复步骤见 [正式部署与数据备份](./deployment-and-backup.md)。业务决策见 [产品需求](./product-requirements.md#21-待确认事项)。
