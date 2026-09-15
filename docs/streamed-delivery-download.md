# 大文件流式保存

日期：2026-09-15。针对[内存诊断](./transfer-memory-validation.md)中 500 MB 下载约 1.3 GiB 的瞬时私有提交占用，客户交付下载新增直接写入用户所选文件的路径。

## 客户行为

- 文件达到 50,000,000 字节、页面处于安全上下文且浏览器提供 `showSaveFilePicker` 时，点击下载先选择保存位置，再开始传输。小文件及不支持该能力的浏览器继续使用原有 Blob 下载。
- 选择器在点击处理函数中、任何网络等待之前调用。用户关闭选择器不发送下载请求，也不显示错误。
- 传输按块读取并等待每块写入完成，避免在应用层汇集整份文件。传输期间可以取消；全部接收完毕后进入「正在完成文件保存…」，该短暂提交阶段禁用取消，等待写入器关闭成功才显示「文件已保存到所选位置」。
- 登录、权限、撤回和连接错误继续留在页面内。选择位置、写入或提交失败显示中英文保存错误，可重新选择位置后重试，不自动改走另一种方式或重复发送请求。

该浏览器能力并非所有环境都支持，使用功能检测而不依赖浏览器名称。能力与用户点击要求见 [MDN：showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)；文件更改在写入流关闭时提交，见 [MDN：createWritable](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable)。

## 账号和文件安全边界

点击时绑定当前账号，选择器返回和写入器创建后再次核对；每块读取前后以及文件提交前继续校验账号与取消信号。离开页面、切换语言或账号事件会中止未完成操作，迟到的选择器或写入器不再触发下载。

写盘失败同时取消网络读取，异常路径终止写入器并释放流锁，不调用成功提交。覆盖已有文件时，中途失败应保留其原内容；不会删除用户选择的目标作为清理手段。浏览器可能为新建位置留下空文件，不能承诺所有系统都自动移除。`close()` 已开始后不承诺能够回滚，文件成功保存后也无法通过服务端撤回删除用户本地副本。

生产实现不使用 OPFS 暂存、服务工作线程或新增下载令牌。此前仅在隔离诊断中尝试「OPFS 暂存后再生成下载链接」，观测峰值仍约 945 MiB，且无法用固定延时可靠判定何时可删除底层文件，因此没有采用。原型报告为 `artifacts/transfer-stress/7900e65dc5404faf962fa535f59a0398/memory-report.json`。

## 验证与复现

关联测试覆盖逐块背压、取消、连接中断、写入及关闭失败、HTTP 拒绝、提交前取消、读写期间账号变化、选择器取消、写入器迟到、中英文错误与保存状态。既有 Blob 下载回归继续保留。

内存对照使用独立 Chromium、500 MB 文件及取消/重复保存场景。两种方式均通过 `launchPersistentContext("")` 创建测试专属的临时磁盘配置目录，仅复制隔离客户的登录 Cookie，关闭上下文时由 Playwright 清理目录。额外启用：

```powershell
$previousStress = $env:LW_TRANSFER_STRESS
$previousMemory = $env:LW_TRANSFER_MEMORY
$previousStreaming = $env:LW_DOWNLOAD_STREAMING
try {
    $env:LW_TRANSFER_STRESS = '1'
    $env:LW_TRANSFER_MEMORY = '1'
    $env:LW_DOWNLOAD_STREAMING = '1'
    npx playwright test tests/e2e/delivery-workflow.spec.ts
} finally {
    $env:LW_TRANSFER_STRESS = $previousStress
    $env:LW_TRANSFER_MEMORY = $previousMemory
    $env:LW_DOWNLOAD_STREAMING = $previousStreaming
}
```

测试将操作系统保存选择器替换为真实 OPFS 文件句柄，实际执行浏览器写入流与 API 传输。取消和连接中断时核对既有文件原文；成功输出在停止内存采样后才导出到测试进程，核对 500 MB 大小和 SHA-256，避免导出校验污染峰值。外层仍跑双语 Blob 兼容流程及撤回检查。设置 `LW_DOWNLOAD_STREAMING='0'` 可在相同磁盘配置模式下运行 Blob 对照。

方法修正：早期诊断使用非持久上下文，Chromium 的隐私模式文件系统在内存中实现，不能用其中的 OPFS 作为真实磁盘保存的替代物。原型及失败报告保留为排查记录，不用于计算优化比例。报告 `ca5a06f2d58549e0b182cee49ea44fb2` 记录到保存错误，存储估计仍低于配额，因此不能将其具体原因认定为配额耗尽。有关实现差异见 [Chromium 文件系统说明](https://chromium.googlesource.com/chromium/src/+/main/storage/browser/file_system/README.md)；临时配置目录生命周期见 [Playwright 持久上下文说明](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)。

这可以验证流式传输和取消逻辑，但不能宣称完成原生保存对话框、真实磁盘权限、杀毒扫描、慢盘或不同系统文件替换语义的人工验收。测试 OPFS 的内存结果也不能直接等同于所有用户目录和设备。完整结果以相应 `memory-report.json`、`report.json` 及 Playwright 命令为准。

## 磁盘模式对照

同一台 Windows 测试机、Chromium `151.0.7922.34`，每轮使用新的临时磁盘配置目录并顺序运行，未同时启动构建或其他负载。汇总只采用 `stablePhase=true` 且没有缺失进程 ID 的样本；不会强制垃圾回收。

| 指标（私有提交内存，MiB） | Blob 兼容方式 | 流式保存首轮 | 流式保存复跑 |
| --- | ---: | ---: | ---: |
| 观测峰值 | 767.8 | 357.0 | 379.6 |
| 完整下载前空闲均值 | 217.8 | 274.9 | 275.4 |
| 第一次完整下载后空闲均值 | 227.4 | 262.7 | 292.1 |
| 第二次完整下载后空闲均值 | 208.0 | 304.1 | 225.0 |
| 第三次完整下载后 60 秒空闲均值 | 210.7 | 234.0 | 220.5 |
| 最后导航后空闲均值 | 210.1 | 224.5 | 219.1 |
| 有效／全部样本 | 180／186 | 147／151 | 120／128 |

Blob 报告：`artifacts/transfer-stress/d88ed3b76b1b4e4eb40f409b62957a29/memory-report.json`；流式首轮：`artifacts/transfer-stress/d8d82b6c7c284757b3b03b82d8dc7dfd/memory-report.json`；流式复跑：`artifacts/transfer-stress/ddcb29b823594db2b5d5e45afec24ad0/memory-report.json`。三个完整端到端命令均通过，分别约 6.0、6.3、5.2 分钟，采样及关闭错误为零，各次传输阶段均有有效样本。各目录外层 `report.json` 也均通过。

两轮流式保存观测峰值比同配置 Blob 低约 51%–54%，但部分空闲均值仍较高，不能据此声称所有阶段内存都降低。Blob 空闲阶段在临时 URL 释放后开始，流式空闲在文件提交后开始，两者实际经过时间不同。这里比较的是有界场景的观测峰值，不是连续采样的绝对最大值或全部设备的内存预算。

复跑已修正故障服务的跨请求计数：每种语言分别确认新请求写出 262,144 字节后断开，验证已有目标文件原文未变，随后重试并核对完整文件哈希。三次正常保存及两种语言重试共五份 500 MB 输出，SHA-256 均为 `802445ade49f7e23f7c2533073a24c969cbc5f7810a07342be829703087ae125`。测量期间流式路径没有创建任何 Blob URL；测试校验导出在采样停止后进行。双语断网截图已查看，错误保留在交付区域，下载入口可重试。首轮英文故障未证明部分响应体传输，只保留为历史记录，不单独作为该项验收证据。

客户及管理端全量单元测试、两端生产构建均通过；其中流式/API/交付组件关联测试 34 项通过。测试设施 TypeScript 检查与独立代码复审通过。原生系统保存对话框及实际用户目录权限仍待人工验收。

## English summary

Large deliveries (at least 50 MB) use a user-selected writable file when the browser supports the secure save picker. Data is read and written incrementally; authentication, account binding, localized errors and cancellation remain in place. Small files and unsupported browsers retain Blob downloads. Saving is reported complete only after the writable stream closes. Fresh disk-profile diagnostics observed peaks of 767.8 MiB for Blob versus 357.0 and 379.6 MiB for streaming; some idle averages remained higher. The corrected bilingual interruption/retry checks and all five 500 MB output hashes passed. Automated diagnostics substitute real OPFS handles for the OS picker, so native-dialog and real-device acceptance remains separate.
