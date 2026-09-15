# 大文件下载内存诊断

日期：2026-09-15。该诊断接续[大文件与传输中断验证](./large-transfer-validation.md)，只检查现有客户下载机制的资源表现，不改变上传上限或生产工作流。

## 两轮结果

以下为历史非持久（隐私）上下文结果。后续发现该模式的 OPFS 文件系统使用内存，现已将对照测试统一改为独立临时磁盘配置目录；历史数字不与新模式直接计算优化比例。最新实现及测试方法见[大文件流式保存](./streamed-delivery-download.md)。

测试机为 Windows 11（10.0.26200），系统可见物理内存约 15.9 GiB，Chromium `151.0.7922.34`。两轮完整端到端命令均通过，分别耗时约 5.6 和 6.2 分钟，包含外层中英文传输恢复检查。专项报告的 `passed` 均为 `true`，没有采样或清理错误；URL 创建与撤销均为 3 次，最后没有存活的下载 URL。

| 私有提交内存（MiB） | 首轮 | 复跑 |
| --- | ---: | ---: |
| 进入完整下载阶段前，空闲均值 | 182.1 | 186.1 |
| 第一次完整下载，URL 释放后空闲均值 | 190.8 | 185.0 |
| 第二次完整下载，URL 释放后空闲均值 | 719.6 | 186.5 |
| 第三次完整下载，URL 释放后空闲均值 | 723.1 | 187.7 |
| 最后导航至项目列表，空闲均值 | 186.5 | 184.0 |
| 全过程观测到的最大值 | 1290.4 | 1299.4 |

首轮各下载后的空闲为 10 秒；复跑第三次延长为 60 秒，其稳定样本在 187.4–188.2 MiB 之间。两轮的短时回落表现有差异，不能选取复跑的低值就宣布回收时机完全稳定。首轮高占用进程没有退出，内存在导航附近回落；其保留来源仍未归因。

复跑有 174 个样本，剔除 5 个跨阶段采样后使用 169 个稳定样本，没有缺失进程 ID。完整下载后 JavaScript 堆均值约 9.1–9.3 MiB，峰值时主要占用来自 CDP 标识为 `browser` 的进程，不能用较小的 JS 堆推断整个下载过程低内存。采样的 Working Set 合计最大值为 1528.7 MiB，仅保留作诊断数据，不作为独占物理内存结论。

报告路径：

- 首轮：`artifacts/transfer-stress/9c78baabe0684e79a9a75d3d1df9d49c/memory-report.json`。
- 复跑：`artifacts/transfer-stress/e805b0090e1047c3bf47a90f41f3c1fc/memory-report.json`。

首轮阶段标签曾过早进入 idle，表中已按 `urls.liveCount === 0` 筛选；复跑已修正阶段切换，并记录 `stablePhase` 和 `missingProcessIds`。汇总时仅取阶段一致且进程计数完整的样本。测试设施的最终报告失败也会使端到端命令失败，避免关闭或最后一次采样错误被忽略。TypeScript 检查和独立代码复审通过。

这轮确认了取消、导航中止和临时链接释放机制，但没有证据把短时保留判定为持续泄漏。该历史诊断提出了降低瞬时私有提交占用的优化方向；后续已新增[大文件流式保存](./streamed-delivery-download.md)，并用同一磁盘配置模式重新对照两种路径。历史诊断本身没有为了改善数字而强制垃圾回收、降低文件限制或修改业务下载实现。

## 测量方法

`tests/e2e/transfer-memory.ts` 启动独立的无头 Chromium，仅导入隔离测试客户的登录状态。当前代码使用 Playwright 管理的临时磁盘配置目录，历史两轮使用非持久上下文。通过浏览器 CDP 获取自身进程 ID，再由 Windows 读取这些进程的 Private Bytes 和 Working Set；同时采集页面 JavaScript 堆、DOM 计数及临时 Blob URL 数量。不会统计日常使用的浏览器、平台服务端、Vite 或 Playwright 控制进程。

探针包装浏览器原生 `URL.createObjectURL` / `revokeObjectURL`，只记录 URL 字符串和字节数，不保留 Blob 对象。记录的 URL 字节数表示仍可通过链接访问的文件大小，**不等于物理内存占用**；浏览器可能采用内部缓存或磁盘存储。

- 起始空闲 10 秒。
- 500,000,000 字节文件限速至每秒 2,000,000 字节，收到响应头后等待 4 秒；两次点击取消，一次通过 SPA 导航离开详情。每次确认对应网络请求确实取消，再空闲 10 秒。
- 重新进入详情后空闲 10 秒，然后连续完成三次 500 MB 下载，每次检查文件大小、临时 URL 创建及 30 秒释放机制；前两次观察释放后的 10 秒空闲，第三次观察 60 秒。
- 最后通过 SPA 导航离开详情，观察 15 秒。
- 不主动触发垃圾回收，不强制清空浏览器缓存。原始样本保留阶段、时间、各进程值、堆/DOM 和 URL 状态。

每次采样完成后再等待 1 秒，因此实际间隔还包含 PowerShell、CDP 等操作耗时。样本最大值只是**观测到的峰值**，可能漏掉短暂尖峰。Private Bytes 表示进程私有提交内存；多个进程 Working Set 相加可能重复计算共享页，不等于该浏览器独占的物理 RAM。JavaScript 堆无法覆盖全部下载缓冲区或浏览器原生内存。

## 复现

使用 Windows、已安装的 Playwright Chromium 和已构建的 Release API，端口要求与大文件专项相同。在项目根目录执行：

```powershell
$previousStress = $env:LW_TRANSFER_STRESS
$previousMemory = $env:LW_TRANSFER_MEMORY
$previousStreaming = $env:LW_DOWNLOAD_STREAMING
try {
    $env:LW_TRANSFER_STRESS = '1'
    $env:LW_TRANSFER_MEMORY = '1'
    $env:LW_DOWNLOAD_STREAMING = '0'
    npx playwright test tests/e2e/delivery-workflow.spec.ts
} finally {
    $env:LW_TRANSFER_STRESS = $previousStress
    $env:LW_TRANSFER_MEMORY = $previousMemory
    $env:LW_DOWNLOAD_STREAMING = $previousStreaming
}
```

两项环境变量需同时启用。报告写入 `artifacts/transfer-stress/<测试项目编号>/memory-report.json`；外层用例仍验证中英文交付和传输中断。内存诊断本身使用中文客户页面，相同下载实现的英文错误与恢复行为由外层双语用例验证。

## 结论边界

本机短程测试不能证明没有内存泄漏，也不能替代低内存手机、其他浏览器引擎、长时间多用户并发或生产代理验收。URL 释放与进程内存回落是不同指标：链接已释放不代表 Windows 计数立即回到原值；内存暂未回落也不能单独归因于业务代码泄漏。合成 MP4 用于传输，不能据此判断真实视频的播放或解码内存。

## English summary

The opt-in Windows diagnostic uses a separate test-owned Chromium browser, records its process memory plus page heap/DOM metrics, and observes Blob URL lifetime without retaining Blob references. It covers cancellation, SPA navigation, and three complete 500 MB downloads with natural idle periods. Sampled peaks are not continuous maxima; summed working sets may double-count shared pages. This is a bounded local diagnostic, not proof of leak freedom or low-memory-device acceptance.

Both historical nonpersistent-context runs passed, with sampled private-commit peaks around 1.3 GiB and variable short-term retention. All three Blob URLs were revoked in both runs. The new streaming implementation and fresh disk-profile comparison are documented separately in [streamed delivery downloads](./streamed-delivery-download.md); historical numbers must not be used to calculate its percentage improvement.
