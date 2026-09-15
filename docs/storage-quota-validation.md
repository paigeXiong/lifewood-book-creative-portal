# 存储配额触顶与上传恢复验证

日期：2026-09-15。使用独立 5097 服务和 `artifacts/api-benchmark/<UUID>` 数据。客户 5173、管理员 5174、预览 API 5077 保持运行。

## 配额含义与边界

`Lifewood:Limits:MaxStoredBytes` 默认是 10,000,000,000 字节。当前实现统计数据目录内文件的逻辑大小，包括数据库、临时数据库日志和附件，忽略 `platform.lock`。新文件上传在写入前申请空间，文件写入通过同一预留锁串行核算；已有文件的同 ID、相同内容重放无需重新占用空间。

它是上传准入检查，数据库等其他写入仍会增长，不能当作文件系统硬配额。`507 storage.quota`、附件类别数量上限的 `400 too_many`、操作系统磁盘写满是不同场景。本测试仅缩小自己的服务配置，不填满用户磁盘，不修改预览配置。

## 验证方法

1. 两个独立客户各创建测试草稿，使用默认补充图片类别。停止本测试服务，计量初始数据；配额设为初始大小加两张有效 PNG 及 512 KiB 数据库增长余量。
2. 上传首张图片后，预先获取两客户 CSRF，两个项目同时上传不同图片。要求客户端 HTTP 请求区间重叠，且结果恰好为一个 200、一个 507；竞争前后比较被拒项目的完整 GET 快照。
3. 中英文请求分别再次触发 507，核对 `storage.quota`、`errors.storage.quota`、`retryable: true` 和拒绝前后完整快照。满额时重放旧上传并下载旧附件，均须成功。
4. 重启同一测试数据和配额，再次确认拒绝。删除一份未提交附件，确认原 URL 为 404、文件数量减少且磁盘文件消失。
5. 使用原先被拒上传的原 ID、版本和字节重试，要求成功；再次重放不新增文件或版本。重启后再次校验及重放。

各阶段严格核对保留附件元数据、本地文件 SHA-256、HTTP 下载 SHA-256 和上传目录文件数，确保没有额外临时或重复文件。请求区间重叠仅证明客户端上传同时进行；服务端持锁等待、释放后重新计算用量、拒绝及删除后重新预留，由 `StorageQuotaTests.WaitingReservationRechecksUsageAfterTheFirstWriterFinishes` 独立验证。

## 结果与证据

最终运行：`artifacts/api-benchmark/19e4592a-a387-4331-82af-4a8f9e6e89ad/report.json`，使用本轮独立构建的 Release DLL，所有检查通过。

| 项目 | 结果 |
| --- | --- |
| 初始数据 | 2,851,817 字节 |
| 单张有效 PNG | 1,049,476 字节 |
| 本测试配额 | 5,475,057 字节 |
| 同时上传结果 | 507、200，客户端区间重叠 27.37 ms |
| 507 次数 | 5 次，均符合预期 |
| 文件数变化 | 2 → 删除后 1 → 重试后 2 |
| 最终附件逻辑大小 | 2,098,952 字节 |
| 重启与完整性 | 两次重启后校验通过，无额外上传文件 |

客户端 API 回归 20 项通过（含新增双语配额用例 2 项）；服务端配额测试 4 项通过；既有附件校验器的防误报用例 3 项通过。客户端配额用例使用真实词典验证中文“平台存储空间已满，请联系管理员处理。”和英文“Platform storage is full. Contact an administrator.”，并验证不会自动重复请求、显式重试可以成功。

首轮 `231134fa-8d5d-4ac8-8af3-fc6782fd5815` 通过基本拒绝与恢复；复查后补充请求重叠断言和首次竞争拒绝的完整快照，补强运行 `d76fac53-12ae-4b17-99e9-adf881d00000` 通过，最终以本轮新构建 DLL 再验证通过。客户端用例初次放入已有测试文件时触发共享 CSRF 缓存顺序依赖，拆为独立文件后一起运行通过，未修改生产缓存行为。

## 复现

```powershell
dotnet test services/platform-api.Tests/Lifewood.PlatformApi.Tests.csproj -c Release --artifacts-path artifacts/quota-validation-dotnet --filter 'FullyQualifiedName~StorageQuota' --nologo
node scripts/benchmark-api.mjs artifacts/quota-validation-dotnet/bin/Lifewood.PlatformApi/release/Lifewood.BookPortal.Server.dll --storage-quota
npm run test --workspace @lifewood/task-entry-web -- src/api-client.test.ts src/storage-quota.test.ts
```

`--storage-quota` 与负载模式互斥，不接受外部服务 URL 或业务数据目录；仅此模式可向自己的子进程传入最多 64 MiB 的测试配额。退出时只清理本次测试进程，保留报告与数据。报告记录 DLL、执行脚本 SHA-256、Git HEAD 和工作区是否有未提交改动。

## 仍未覆盖

物理磁盘满额、权限错误、历史修订所引用文件的保留、其他上传对象、大文件同时上传、跨进程共享存储和正式环境预算仍须分别验证。删除已被历史修订引用的附件不一定立即释放物理文件，本测试仅覆盖未提交草稿附件。当前提示保持联系管理员，未承诺任意文件删除都能立即恢复空间。双语提示由客户端测试覆盖，没有将本轮计为浏览器弹窗或真机验收。

## English summary

An isolated API with a reduced configured quota verifies overlapping upload admission, localized 507 errors, unchanged rejected drafts, downloads and idempotent replay while full, deletion of an unsubmitted attachment, retry with the original upload identity, and restart durability. This is an application quota check, not physical disk exhaustion or production capacity certification.
