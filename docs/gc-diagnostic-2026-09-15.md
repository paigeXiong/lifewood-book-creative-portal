# GC 与托管堆诊断（2026-09-15）

## 结论与下一步

针对[前一轮 600 秒回归](./sustained-load-validation.md)中的私有内存均值上升，使用相同服务端 DLL 和负载脚本增加运行时计数器采样。全部业务校验通过，采集期间观察到两次 Gen 2 回收，Gen 2 堆未持续增大；各代已观测堆中 POH 增长最多，约后四分钟保持稳定。

这些结果没有证实业务对象持续泄漏，也没有证明不存在泄漏。没有采集对象类型、引用链或堆快照，不能确定 POH 增长来自哪一类缓冲区；更不能用 POH 的增量解释全部进程私有内存变化。本轮不据此修改 GC 配置或业务代码。后续如继续出现增长，应在隔离环境采集不同阶段的堆快照，分析固定对象类型及保留路径，并增加空闲回落观察与更长时长验证。

后续已完成[20 分钟负载和 2 分钟同进程空闲观察](./sustained-load-validation.md)：分段私有内存均值未持续上升，空闲末约 50 MiB，业务与重启一致性校验通过。该后续运行没有重新采集 GC 对象类型，因此仍不能完成 POH 保留来源归因。

## 方法与范围

- 先完成 10 秒工具冒烟，再运行 600 秒同负载诊断。正式诊断使用一万条合成背景记录、四个写入项目和四条读取流程，保持默认限流，覆盖中文及英文数据。
- 沿用提交 `936e72ab583fa7e37f8abede2b66c3e706140100` 的托管 Release DLL，SHA-256 为 `c26cbe2ab773f4dacdc1edcb966d762e76f85f710668fc899828f9898538dbe1`。此前文档修订未改变业务代码；不是 Native AOT 性能测试。
- 使用 `dotnet-counters` `10.0.745401+cef304c50763bf24f99566cb31d55540842e7ae9`，只安装在 `artifacts/diagnostic-tools`。编排脚本先确认新启动压测进程的唯一 dotnet 子进程及其 DLL、隔离数据目录，再按 PID 附加。
- 只收集 `System.Runtime` 的 GC 次数、分配量、回收后分代堆大小、碎片、GC 已提交内存、停顿及工作集；刷新间隔 1 秒。未请求强制 GC，也未抓取包含对象内容的堆转储。
- 计数器范围从附加开始，到首次测试服务为重启校验而停止为止，包含负载前后少量操作；原有 Windows 资源采样主要覆盖持续负载。这两个采样区间不完全相同。
- 计数器会带来诊断开销，不能把本轮与未插桩数据的延迟差直接归因于平台回退。计数器及压测客户端自身资源不计入目标服务的 CPU/私有内存统计。

微软文档说明：回收后的堆大小包含碎片，GC 已提交内存还包括为未来分配准备的空间；分配总量不包含原生分配。这些指标不等于进程全部私有内存。指标口径见 [.NET runtime metrics](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/built-in-metrics-runtime)，采集参数见 [dotnet-counters](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters)。

## 请求与采样校验

- 持续负载 600.21 秒，21,846 条计时业务请求样本（包含准备及故障检查，不含 CSRF 等辅助请求）；非预期失败 0，HTTP 429 为 0。
- 保存版本、上传与提交幂等、同版本竞争、跨账号访问、数据库完整性，以及重启后的项目与四个文件哈希全部通过。
- 草稿保存 P95 20.71ms，客户列表 5.50ms，客户统计 7.46ms，管理员列表 16.91ms。只代表本机回环和本轮负载。
- 必需的 17 组指标/标签组合齐全，每组 600–601 个事件，最短覆盖约 598.01 秒，最大相邻间隔 2.02 秒；检查数值有限且非负、时间递增、有效覆盖不少于设定时长的 80%、单组最大采样间隔小于 5 秒，全部通过。
- Windows 资源样本 593 个，平均 CPU 约占整机 1.87%。私有内存首/末/峰值为 41.02 / 59.79 / 88.99 MiB。
- 业务测试、计数器进程均以 0 退出，最终数据文件正常闭合。测试端口与诊断进程结束后检查释放。

## GC 观察

导出工具将累计计数器转换为名义 1 秒增量/速率。本次导出增量合计为 Gen 0 916 次、Gen 1 0 次、Gen 2 2 次；代标签表示本次回收的最高代，不能把 Gen 1 为 0 解读为 Gen 1 从未被回收。两次 Gen 2 事件位于北京时间 08:59:38、09:02:38。

导出的分配增量合计约 3.90 GiB，停顿增量合计约 0.959 秒。它们仅覆盖实际导出窗口，不是进程启动以来的精确累计值；分配量也不等于最终保留量。

| 最近一次回收后的分代堆 | 首样本（MiB） | 末样本（MiB） | 峰值（MiB） | 末样本碎片（MiB） |
| --- | ---: | ---: | ---: | ---: |
| GEN0 | 2.22 | 0.29 | 4.28 | 0.10 |
| GEN1 | 0.46 | 1.67 | 1.67 | 0.38 |
| GEN2 | 3.35 | 3.29 | 3.35 | 0.27 |
| LOH | 0.09 | 0.47 | 0.47 | 0.25 |
| POH | 3.00 | 7.55 | 7.55 | 0.47 |

GC 已提交内存首/末/峰值为 17.37 / 20.10 / 42.84 MiB。分代堆数据是最近回收时的观测值，并非每秒重新遍历所有存活对象。

以下按首个计数器事件开始划分两分钟区间；区间均值用于观察变化，不代表跨指标完全同时的堆快照。

| 时间段 | Gen 2 均值（MiB） | LOH 均值（MiB） | POH 均值（MiB） | GC 已提交内存均值（MiB） |
| --- | ---: | ---: | ---: | ---: |
| 0–120 秒 | 3.35 | 0.45 | 5.05 | 19.01 |
| 120–240 秒 | 3.34 | 0.47 | 5.83 | 17.26 |
| 240–360 秒 | 3.33 | 0.47 | 6.31 | 16.48 |
| 360–480 秒 | 3.29 | 0.47 | 7.55 | 19.89 |
| 480–600 秒 | 3.29 | 0.47 | 7.55 | 19.35 |

POH 从约 3.00 MiB 升至 7.55 MiB，最后两个区间均值相同。Gen 2 末样本低于首样本，GC 已提交内存出现过上升与回落；目前应继续做对象类型归因，而不是直接认定泄漏或强行触发回收。

## 复查与记录

先独立构建服务端并运行[持续负载命令](./sustained-load-validation.md)。若需要复采，仅从本轮压测父进程的子进程中确认隔离服务 PID，检查命令行中的 DLL 与独立数据目录；不要根据通用进程名附加到开发或生产服务。首次安装与采集命令如下（PID 替换为已确认的本轮隔离服务）：

```powershell
dotnet tool install dotnet-counters --version 10.0.745401 --tool-path artifacts/diagnostic-tools
artifacts/diagnostic-tools/dotnet-counters.exe collect --process-id <隔离服务PID> --refresh-interval 1 --format json --output <本轮目录>/gc-counters.json --duration 00:00:11:00 --counters 'System.Runtime[dotnet.gc.collections,dotnet.gc.heap.total_allocated,dotnet.gc.last_collection.heap.size,dotnet.gc.last_collection.heap.fragmentation.size,dotnet.gc.last_collection.memory.committed_size,dotnet.gc.pause.time,dotnet.process.memory.working_set]'
```

- 正式诊断目录：`artifacts/api-benchmark/2466be03-97d2-4f8b-9365-040337d8bd98`，包含 `report.json`、`resources.json`、`gc-counters.json`、`gc-analysis.json`、`gc-session.json` 和采集日志。
- 短时冒烟目录：`artifacts/api-benchmark/b86e2f55-bc79-43f7-8509-189ac3c6fb33`。
- 原始编排与分析脚本为本地诊断产物 `artifacts/run-gc-diagnostic.mjs`、`artifacts/summarize-gc-diagnostic.py`，已另存于正式诊断目录。它们未进入正式发布物；编排脚本包含本次本机构建路径，复用时需核对。
- 计数器 JSON SHA-256：`599aa63bb942cd1919ab688dc3ed71ed33d866b85868db61403e7143acae24ef`。
- 分析 JSON SHA-256：`474c4b8f3a5c0c5fcae727e3e066f193f3f5e2050d3e64a0ded98fbec35307fe`。
- 编排脚本 SHA-256：`47cb2136b61170d04ab26e214ce390c5de9a47772056fb28309526600f92c805`。
- 分析脚本 SHA-256：`981a4e4318f53d9752fb551451a88151827b838faef7968cb6f3d0a04dcce11c`。

## English summary

The 600-second instrumented regression passed request, authorization, idempotency and restart-integrity checks. Runtime counters observed two Gen 2 collections without sustained Gen 2 heap growth. POH increased and then remained stable for approximately the final four minutes. Object types and retention paths were not captured, so neither a leak nor a specific buffer-pool cause is established. Diagnostics add overhead; this managed-runtime loopback run is not a Native AOT or production-capacity certification.
