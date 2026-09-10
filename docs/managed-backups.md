# 后台备份管理 / Managed backups

## 当前能力

入口：系统配置 → 备份。只有平台负责人（`admin.runtime.manage`）能查看、创建、下载、删除备份或修改策略。界面支持中英文、来源/状态筛选和服务端分页，不显示内部标识、服务器路径或文件清单。

- 手动创建：排队 → 快照 → 压缩 → 校验 → 完成；失败记录保留。
- 每日/每周调度：可配置小时、星期、北京时间或 UTC，显示下次执行时间。默认关闭。服务停机错过时间时启动后补执行一次，失败不会无限立即重试。
- 保留策略：限制成功自动备份的天数和份数，至少保留最新一份；手动备份和恢复前安全备份不自动删除。正在下载导致无法删除的文件会留待后续清理，不能改变新备份的成功状态。
- 完整性：ZIP 根目录包含数据库及原始文件目录，同时保存文件大小、SHA-256 和版本清单。创建后逐文件校验；每次下载前再次核对整个 ZIP 的 SHA-256。
- 审计：记录手动创建、完成、下载、删除、策略变更和自动清理。审计/清理失败单独写入服务器日志，不把已校验完成的归档改成失败。

## 一致性边界

备份不重启进程。`BackupGate` 首先阻止新业务请求进入，等待既有 API 操作及通知后台写入结束，再通过 SQLite Backup API 复制包含已提交 WAL 数据的数据库，并复制整个数据目录。快照阶段会短暂影响业务；最长等待与复制时间为 5 分钟，超时释放限制并报告失败。获得快照后立即恢复业务，压缩与校验在独立临时目录继续。

仅健康检查、备份状态查询和通知 SSE 被列为只读例外。这些请求禁止会话活动更新时间、旧会话迁移和滑动续期。正常 API 请求的业务处理、文件操作及审计均在同一个请求租约内；通知 worker 也持有租约。新增后台写入任务必须接入同一 gate，不能用未经保护的 fire-and-forget 写入绕过快照。

不归档 `platform.lock`、SQLite WAL/SHM/journal 临时文件。备份目录必须位于数据目录外，不能是数据目录的祖先，也不能复用含无关内容的目录；拒绝符号链接/目录联接。进程中断的任务在启动后标记失败并清理对应临时快照/压缩文件；清理失败记录日志。

## 存储及恢复

默认存储在数据目录旁的 `<数据目录>.backups`。可在服务部署配置中使用 `Lifewood:BackupDirectory` 指定专用目录，必须避免任何 Web 静态资源目录。Windows 目录权限限定当前服务账号、SYSTEM 和 Administrators；Unix 目录模式为 0700。ZIP 尚未加密，不自动复制异地；备份包含客户及账号资料，下载后应另行妥善保管。

新格式保持现有停机恢复脚本的根目录结构，可使用 `scripts/restore-platform.ps1 -Archive ... -DataDirectory ...`；覆盖已有数据需遵循既有 `-Replace` 安全备份流程。独立进程现已支持下述后台恢复流程；恢复演练必须使用隔离目录。备份清单不会替代恢复前的数据库校验，跨 Windows 主机恢复仍须处理机器绑定的数据保护密钥。

## Validation

`BackupTests` covers draining/cancellation, committed SQLite WAL content, file checksums and tampering, timezone scheduling, interrupted scratch recovery and retention of manual copies. HTTP integration tests cover owner-only access, snapshot maintenance responses, backup status availability, archive download and deletion. `tests/e2e/backups.spec.ts` exercises both languages and mobile layout and saves downloaded fixture archives for isolated restore verification.

The snapshot pauses business operations rather than restarting the process. Compression and verification run after operations resume. Scheduling is off by default. Only successful scheduled copies participate in automatic retention; manual copies require explicit deletion. Managed restore is available for standalone processes. Encryption and off-site replication remain outside this phase.

## 后台恢复 / Managed restore

每条完成的备份提供恢复图标。只有平台负责人可以预检、确认和查询结果，接口使用现有 Cookie、CSRF 与权限检查。

1. 预检在私有临时目录进行：核对归档整体 SHA-256、清单中的逐文件 SHA-256、路径安全、可用空间、SQLite quick_check 和外键完整性。拒绝高于当前程序版本的备份；备份中必须存在当前有效的负责人账号。预检最长 5 分钟，成功令牌绑定账号及归档哈希，10 分钟后过期。
2. 输入 `RESTORE` 后排队。执行前重新校验归档，然后暂停业务与后台写入，生成并校验一份来源为“恢复前安全备份”的完整备份。安全备份失败就停止，不替换当前数据。
3. 保留**当前保存的**监听设置和备份策略，避免恢复旧配置；其他项目、附件、账号及配置回到备份状态。清除恢复数据中的保存账号会话和在线状态，所有人重新登录，使用备份时的账号密码。存在尚未应用的监听修改时，会先禁用恢复入口；请先应用或撤销修改。
4. 独立辅助进程取得恢复协调锁后，等待原进程退出。将当前目录移动到同一文件系统的回退目录，再将准备好的目录移入原路径。
5. 启动恢复后的服务，最长等待 90 秒。服务完成初始化和端口绑定后发送就绪信号；在辅助进程确认前，业务和通知后台仍暂停写入。确认成功后开放业务并清理回退目录，安全 ZIP 继续保留。
6. 恢复后启动失败时，停止新进程，将原数据目录移回并重启原服务。若回退本身失败，记录 `recoveryRequired` 并拒绝后续自动启动，防止在不完整目录上继续写入。

恢复日志位于专用备份目录的 `.backup-restore.json`，与被替换的数据分离。后续正常启动会检查未完成的目录切换：有可信的就绪记录则提交，否则恢复原目录。后台展示最近一次恢复状态，并通过工具栏的“恢复记录”查看完整执行历史。历史请求同时记录在操作审计中。不要在恢复进行时手动删除日志、临时目录或回退目录。

Windows 服务（SCM）和 systemd 部署目前使用停机恢复脚本，不提供后台重启恢复。独立运行的发布程序及本地开发进程支持后台恢复；本地启动器通过带启动标识的进程记录跟踪恢复后的新 PID。

### 人工恢复

若状态为“需要人工恢复”，先停止服务及相关辅助进程，确认 `platform.lock` 已释放。保留当前目录、同级 `.rollback-<任务标识>` 目录和恢复日志。优先由运维完整移回原回退目录，或使用日志中的 `safetyBackupId` 对应 `backup-<标识>.zip`，按照部署文档的停机恢复流程恢复。确认数据库、附件和目录权限后，将 `.backup-restore.json` 移至运维留档目录再启动；不要仅删除阻止启动的状态后直接使用未验证的数据。安全备份不可用时，不覆盖原回退目录。

### Restore validation

`RestoreTests` covers extraction, rejected unsafe paths, active-owner checks, session revocation, retained listener configuration, locked live data, interrupted directory switches, readiness commit and fail-closed manual recovery. `scripts/test-managed-restore.mjs` runs actual standalone processes against a new directory under `artifacts/managed-restore`: a successful restore, preservation of the pre-restore safety archive and policy, expired sessions, and a deliberately broken restored database that forces startup rollback. It never selects the live data directory. `tests/e2e/backups.spec.ts` checks preflight and confirmation controls in both languages and at mobile width without submitting a live restore.

### 恢复记录与失败提示 / Restore history and diagnostics

恢复记录按任务保存在专用备份目录的 `.backup-restores` 中，独立于业务数据库。后台提供服务端结果筛选、每页 20 条的分页、操作人和恢复目标时间；点击问号查看最后更新时间及失败原因，可以下载该次恢复前的安全备份。安全备份未生成或已删除时，下载按钮禁用。历史记录目前不自动清理。

历史只存任务状态、时间、备份关联和操作账号标识，不复制账号姓名、邮箱、命令参数或服务器路径。展示姓名时从当前有效账号读取，账号已注销或不可用时显示双语占位。旧格式日志可以直接查看；仅有最后更新时间时以该时间作为记录时间，缺失的目标备份日期或账号信息显示“未记录 / 账号不可用”。新恢复开始前先保存上一次结果，避免覆盖唯一旧日志。

历史写入属于辅助记录，写入失败不能回退已经成功的恢复；主恢复日志仍是启动恢复的依据。历史损坏时尽量展示其余可读记录，并提供提示，不允许通过历史界面跳过启动保护。恢复由执行中转为结束时会立即刷新记录，避免停留在旧阶段。

预检提示区分文件校验、版本、磁盘空间、数据库完整性、当前负责人不存在、文件已删除、任务忙碌和监听变更等情况；执行准备阶段还区分安全备份失败与交接进程失败。接口只返回稳定的错误类别及 i18n key，不发送异常文本、SQL 或服务器路径。

`RestoreHistoryTests` covers journal replacement, legacy compatibility, pagination/filtering, minimal metadata and degraded-history behavior. API tests cover owner-only access, resolved display names and deleted safety archives. UI tests cover refreshing terminal status, and browser tests exercise both languages, pagination, result filters, click-to-open details, safety downloads and mobile layout. Real process drills also verify that completed and rolled-back attempts remain visible after another restore.

### 独立备份校验 / Independent verification

备份列表的盾牌图标可重新检查已完成的备份。平台负责人发起后，任务在后台依次验证整包 SHA-256 和清单中的逐文件摘要，复用同一个只读文件句柄，不暂停业务访问。与备份创建及恢复任务串行运行；正在校验的归档不能删除。请求和校验结果写入操作审计。

列表按服务端提供的校验类别筛选，每页 20 条。结果区分通过、内容损坏、文件缺失或无法读取、检查中断；结果保存失败时明确显示“结果未保存”，不能作为校验通过，修复存储后可重新检查。问号中显示最近检查时间和说明。结果保存在备份目录的侧车元数据中，不改变原归档的创建状态。检查最长 10 分钟，服务停止后未完成的检查标记为中断，可以重新发起。旧备份没有记录检查时间时如实显示未记录。

校验通过只说明检查时的文件完整性，不能替代恢复预检中的数据库、版本和账号检查，也不表示已建立异地副本。此入口不修改或恢复业务数据。`BackupVerificationTests` 和 HTTP 测试覆盖正常、损坏、缺失、中断、重启、任务互斥、业务访问及权限；双语浏览器测试覆盖发起校验和结果筛选。
