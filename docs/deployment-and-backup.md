# 正式部署与数据备份

## 部署拓扑

正式环境只运行一个 Lifewood Web 服务端，并使用同一 HTTP 或 HTTPS 来源：

- 根路径：客户门户；
- /admin/：管理中心；
- /api/：页面使用的内部数据接口。

客户门户、管理中心和内部数据接口都由同一个服务端进程提供，不需要另行启动 Vite、Node.js 或静态文件服务器。服务端不会按客户端是否为本机强制限制 HTTP 或 HTTPS：监听地址可达时，远程 HTTP 可直接使用；配置 Kestrel 证书端点或 TLS 终止反向代理后可使用 HTTPS。Cookie 始终为 HttpOnly、SameSite=Strict，并根据当前请求协议自动设置 Secure。可信反向代理应把整个站点转发到该服务端，并仅在明确配置后才允许其转发协议信息。

管理中心的“访问协议”表示 Kestrel 自己监听的协议。选择 `https` 前必须通过标准 Kestrel 配置提供证书，例如设置 `Kestrel__Certificates__Default__Path` 和 `Kestrel__Certificates__Default__Password`；若 HTTPS 在 Nginx、Caddy 等反向代理处终止，平台监听协议应保持 `http`，由代理向客户提供 `https`。

## 构建

开发机首次检出后先运行 npm ci。提交前执行：

    npm run verify
    npm run publish:aot
    npm run smoke:aot

生成正式发布包：

    npm run build:release

Windows 用户也可以双击根目录的 build-release.bat。压缩包与 SHA256 校验文件输出到 artifacts/release/。便携包解压后双击 start-server.bat，即由同一个服务端进程提供客户门户和管理中心。直接运行 `server/Lifewood.BookPortal.Server.exe` 时默认监听 `http://localhost:5000`，同样可以完成登录和首次建号；启动器只负责选择 `5077`、指定便携数据目录并打开浏览器，不再改变认证安全策略。GitHub CI 会在 main 推送和 Pull Request 上执行前后端测试、双前端生产构建、Native AOT 发布、真实 AOT 运行冒烟和发布包内容检查。

需要在单台 Windows 计算机上直接安装时，可以双击 `build-installer.bat`，或运行 `npm run build:msi`。中英文 MSI 与 SHA256 校验文件输出到 `artifacts/installer/`。安装界面可选择本机监听端口和生产数据目录；安装完成后平台作为 Windows 服务自动启动，并从开始菜单打开客户门户或管理中心。

MSI 将程序安装到 Program Files，将生产数据默认保存到 `C:\ProgramData\Lifewood\BookCreativePortal\data`。两者具有独立生命周期：覆盖安装和版本升级只替换程序，不删除或覆盖数据库、上传附件、最终成品、审计待写队列和数据保护密钥；即使卸载，生产数据目录和其位置记录也会保留。再次安装时自动沿用原数据目录，安装界面和无人值守参数都不能在升级过程中改写该目录。如果检测到旧版本但原数据路径记录缺失或损坏，安装会在修改系统前中止，不会回退到新的空目录。安装器不提供“顺便删除数据”选项，如需清理必须在完成备份后由管理员单独处理。

首次安装会在提升权限的执行阶段验证生产数据目录，并在创建目录或授予服务权限前拒绝磁盘根目录、Windows/Program Files、用户目录根、程序安装目录、UNC 或映射网络盘、符号链接、目录联接及无关的非空目录。需要沿用现有数据时，目录中必须包含具有有效 SQLite 文件头的 `platform.db`。此校验同样适用于静默安装，不能只依赖安装界面。

每次 MSI 构建都会检查永久数据组件、禁止覆盖标记、升级路径锁和包内文件清单；如果生产数据库或运行期数据被误放进安装载荷，构建会直接失败。

无人值守安装可传入公共属性，例如：

    msiexec /i Lifewood.Installer.msi /qn LISTENADDRESS=0.0.0.0 PORT=5077 DATAFOLDER="D:\LifewoodData\"

MSI 安装向导可选择仅本机监听 `127.0.0.1`，或监听所有网络接口 `0.0.0.0`。无人值守安装使用 `LISTENADDRESS` 设置同一选项；为避免服务参数注入，安装器只接受这两个值。安装后仍可在管理中心修改监听设置并重启平台。将端口暴露到公网前建议启用 HTTPS，并配置防火墙访问范围。

Windows MSI 会为所有用户创建客户门户桌面快捷方式，并在开始菜单中创建客户门户和管理中心入口。卸载会移除这些入口，但不会删除生产数据目录。

管理中心生产包已使用 /admin/ 作为资源和路由基址。本地开发仍使用独立的 5174 端口。

## Linux 安装与配置

Linux 正式包是对应架构的 Native AOT `tar.gz`，支持 `linux-x64` 和 `linux-arm64`，但必须在相同 CPU 架构的 Linux 主机上构建。Native AOT 不通过本脚本跨架构编译。构建机需要 Node.js 22、.NET 10 SDK、Clang、zlib 开发包、GNU tar 和 sha256sum：

    npm ci
    npm run build:linux

脚本默认根据当前 Linux 主机架构选择 `linux-x64` 或 `linux-arm64`。也可以显式指定并校验目标架构，例如：

    npm run build:linux -- linux-arm64

解压发布包后运行：

    tar -xzf lifewood-book-creative-portal-linux-x64-*.tar.gz
    sudo ./linux/install.sh --lang zh-CN

安装器优先使用 `dialog`，其次使用 `whiptail`；两者都没有时使用普通终端问答。配置内容包括监听端口、生产数据目录和可选的可信反向代理 IP。服务器自动部署可以使用无人值守参数：

    sudo ./linux/install.sh \
      --non-interactive \
      --lang zh-CN \
      --port 5077 \
      --data-dir /var/lib/lifewood-book-portal \
      --trusted-proxy 127.0.0.1

安装后的固定路径：

- `/opt/lifewood-book-portal`：程序与两套前端静态资源；
- `/etc/lifewood-book-portal/portal.env`：仅 root 可读的运行配置；
- `/etc/lifewood-book-portal/custom.env`：可选的高级环境变量覆盖文件；
- `/var/lib/lifewood-book-portal`：默认生产数据目录；
- `/etc/systemd/system/lifewood-book-portal.service`：systemd 服务。

重新配置端口或可信代理时运行：

    sudo lifewood-portal-configure --lang zh-CN

首次安装后，生产数据目录会被锁定。覆盖安装如果找不到原配置中的数据目录记录会直接中止；命令行不能把升级重定向到新的空目录。安装器先暂存并校验新程序，停止旧服务后切换版本，再通过 `/api/health` 检查启动结果；失败时恢复上一版程序和配置。首次启动已经写入数据库或文件时，即使启动检查失败，安装器也会保留数据目录记录，确保重试继续使用同一份数据。整个过程不会删除生产数据目录。

首次负责人账号只能从服务端回环地址创建。Windows 可直接在安装服务器上打开快捷方式；使用默认端口的无桌面 Linux 服务器应先建立 SSH 端口转发，例如 `ssh -L 5077:127.0.0.1:5077 user@server`，再通过本机浏览器访问 `http://127.0.0.1:5077` 完成初始化。使用自定义端口时应同时替换命令中的两个 `5077`。反向代理转发的远程客户端不能执行首次建号。

常用运维命令：

    systemctl status lifewood-book-portal.service
    journalctl -u lifewood-book-portal.service -f
    sudo systemctl restart lifewood-book-portal.service

默认服务仅监听 `127.0.0.1`。如需远程直连，可把监听地址改为 `0.0.0.0` 或指定网卡地址；平台将接受 HTTP 请求。若使用 Nginx、Caddy 或其他 HTTPS 反向代理，应把代理实际连接服务端时使用的 IP 配置为可信代理。`dialog`、`whiptail` 和安装器只负责平台配置，不负责签发 TLS 证书或自动修改现有反向代理。

容量限制等高级设置写入 `/etc/lifewood-book-portal/custom.env`，然后重启服务。安装器管理的 `portal.env` 在后加载，因此自定义文件不能覆盖监听地址、数据目录、Web 根目录和基础安全开关；覆盖安装不会修改 `custom.env`。

## 服务要求

- 根据使用场景选择本机、内网或公网监听地址，并同步配置操作系统和云防火墙。
- HTTP 和 HTTPS 均可使用；公网或其他不可信网络建议启用 HTTPS。使用反向代理时，把可信代理地址写入 `Network:TrustedProxies`。
- 服务端的工作目录必须固定；账号数据库、上传资料、最终成品和数据保护密钥均位于其 data/ 目录。
- 更新程序时不得覆盖或删除 data/。
- 运行账号只应拥有程序读取权和 data/ 写入权。
- 正式发布物不得包含 apps/test-console、本地日志、测试账号或开发数据库。

## 容量与写入保护

以下配置可通过 `Lifewood__Limits__...` 环境变量覆盖，修改后重启服务端生效：

- `MaxDraftsPerUser`：每个客户最多保留的草稿数，默认 20；
- `MaxStoredBytes`：数据库、上传资料、参考音色和最终成品合计容量，默认 10 GB；
- `WriteRequestsPerMinute`：每个登录用户或来源地址每分钟写请求数，默认 60。

达到容量上限时，平台会在写文件前拒绝新上传。容量告警和清理策略应纳入正式环境监控，不要通过删除数据库记录以外的文件来人工腾挪空间。

## 备份

服务端运行期间会独占 `data/platform.lock`。任何平台的备份都必须覆盖整个生产数据目录，并确保服务在归档期间不能写入；只复制 `platform.db` 会丢失附件、最终成品和登录 Cookie 密钥。

### Windows

先停止平台，再双击根目录的 `backup-platform.bat`。备份脚本会持有与服务端相同的锁；备份默认写入 `backups/`，该目录不会提交到 Git。正式环境设置 `Lifewood__DataDirectory` 后，脚本会自动备份同一目录；也可传入 `-DataDirectory` 和 `-Destination` 指定路径。

### Linux

先从 `/etc/lifewood-book-portal/portal.env` 确认实际的 `Lifewood__DataDirectory`。默认数据目录可按以下方式一致性备份：

    sudo install -d -m 0700 /var/backups/lifewood-book-portal
    sudo systemctl stop lifewood-book-portal.service
    sudo tar --one-file-system --acls --xattrs -C /var/lib -czf /var/backups/lifewood-book-portal/portal-data.tar.gz lifewood-book-portal
    sudo systemctl start lifewood-book-portal.service
    curl --fail http://127.0.0.1:5077/api/health

若使用自定义数据目录，必须相应调整 `tar` 的 `-C` 父目录和最后一个目录名。不要在服务仍运行时直接打包，也不要把备份写入生产数据目录内部。备份命令失败时仍须立即重新启动服务并检查日志。

备份包同时包含：

- SQLite 数据库；
- 客户上传的书籍与参考资料；
- 管理员上传的最终成品；
- Cookie 数据保护密钥。

Windows 服务使用本机 DPAPI 加密 Cookie 数据保护密钥：同一台 Windows 计算机上的覆盖安装和原机恢复可继续使用旧会话；把备份迁移到另一台计算机或其他操作系统时，旧密钥不可解密。跨机器恢复必须在服务停止状态下删除恢复目录中的 `data-protection-keys` 子目录，再启动服务生成新密钥。这样会让所有现有登录会话失效，但不会改变账号密码、项目、附件或最终成品。Linux 密钥依靠数据目录权限保护，可随同相同权限的备份恢复。

备份包含客户资料和账号数据，必须放在受控存储中并加密。建议至少每日备份，并定期把副本复制到另一台设备。

## 恢复演练

Windows：

1. 停止平台服务。
2. 执行 `restore-platform.bat 备份文件.zip -Replace`。脚本会先为当前数据创建安全备份，再完整替换 `data/`；不要手动混合两个备份中的文件。
3. 如果恢复目标不是原 Windows 计算机，在服务仍停止时删除恢复后数据目录中的 `data-protection-keys` 子目录；原机恢复不要删除。
4. 启动服务端，检查 `/api/health`、重新登录、项目附件和最终成品下载。
5. 确认无误后再开放客户访问。

Linux：

1. 在隔离主机解压备份并确认根目录结构、`platform.db`、附件和数据保护密钥完整；不要直接把未知归档解压到生产目录。
2. 停止 `lifewood-book-portal.service`，再次归档当前生产数据作为即时回退副本。
3. 在与生产数据相同的文件系统中准备恢复目录，完整替换数据目录，不要混合两个版本中的文件。
4. 把恢复目录及内容的所有者设置为 `lifewood-portal:lifewood-portal`，目录权限不高于 `0750`，然后启动服务。
5. 检查 `/api/health`、登录、项目附件和最终成品下载；失败时停止服务并完整恢复即时回退副本。
6. 确认无误后再开放客户访问。

至少每季度执行一次恢复演练；只有实际恢复成功的备份才算可用备份。
