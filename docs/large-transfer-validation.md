# 大文件与传输中断验证

验证日期：2026-09-15。使用 Windows 本机、Playwright Chromium 和隔离的测试账号、数据库及上传目录；没有改动正在使用的平台项目。测试入口为 `tests/e2e/delivery-workflow.spec.ts`，专项逻辑为 `tests/e2e/transfer-stress.ts`。

## 本轮结果

最终运行通过：1 项完整端到端用例包含双语交付流程及 9 项专项检查，用例耗时约 1.6 分钟，命令总耗时约 1.8 分钟。Chromium 版本为 `151.0.7922.34`。报告为 `artifacts/transfer-stress/15a9b2feee344c2c9c87b0c5740f6f47/report.json`，`passed: true`，清理错误为空。

500 MB 文件的上传和两次恢复下载全部成功，SHA-256 均为 `802445ade49f7e23f7c2533073a24c969cbc5f7810a07342be829703087ae125`。两种语言的上传和下载取消都观察到真实请求终止；8 MB 素材恢复后各只有一个附件且哈希一致。已检查双语错误截图，错误留在对应下载区域或上传队列内，原入口可重试。独立代码复审的网络取消与初始化清理问题已修正并包含在最终复跑中；没有发现需要修改业务实现的新缺陷。

## 验证范围

| 场景 | 检查方式 |
| --- | --- |
| 管理员上传上限大小文件 | 浏览器文件选择器上传 500,000,000 字节的合成 MP4，真实服务端接收并返回相同大小 |
| 客户取消下载 | 限速后等待响应头，点击取消；确认对应请求收到 Chromium 的 `loadingFailed.canceled` 事件，且没有触发浏览器保存 |
| 下载连接中断与重试 | 仅将目标请求转到本机故障服务，写出部分响应后主动断开连接；检查页内错误，再恢复真实接口下载，核对 500,000,000 字节和 SHA-256 |
| 客户取消素材上传 | 选择 8,000,000 字节的合成 PDF，在进度大于 0 且小于 100 时取消；同时检查进度条退出及对应网络请求取消 |
| 上传连接中断与重试 | 本机故障服务收到至少 131,072 字节的请求体后断开连接；检查文件仍可重试，再恢复真实接口上传，确认最终只有一个同名附件，下载大小及 SHA-256 一致 |

下载与素材上传场景分别运行 `zh-CN` 和 `en-US`。取消场景采用 120ms 延迟、下载 512,000 字节/秒、上传 256,000 字节/秒。连接截断及完整重试使用本机正常网络，不把本地传输时间当作生产性能指标。故障服务的计数表示服务端写出/收到的字节，上传计数包含 multipart 开销，不表示浏览器已接收的有效文件字节。

主动截断连接与简单开启浏览器离线模式不同：诊断中发现离线开关未可靠中止已建立的响应，所以使用实际 socket 断开来验证响应体接收失败。初期测试脚本的选择器、活动交付数量假设和网络观测方式已修正，不将这些测试设施问题列为平台故障。

## 复现

先按仓库说明安装依赖及 Playwright Chromium，并构建 Release 服务端。测试自动使用 API 5090、客户页面 5193、管理页面 5194；这些端口需空闲。

在项目根目录的 PowerShell 执行：

```powershell
$previousStress = $env:LW_TRANSFER_STRESS
try {
    $env:LW_TRANSFER_STRESS = '1'
    npx playwright test tests/e2e/delivery-workflow.spec.ts
} finally {
    $env:LW_TRANSFER_STRESS = $previousStress
}
```

普通端到端测试不会执行这项 500 MB 专项。每次运行会在 `artifacts/transfer-stress/<测试项目编号>/` 留下合成文件、四张双语错误截图和 `report.json`；测试数据目录保留测试记录和素材，正常撤回会删除对应交付文件，失败时可能残留。请预留数 GB 空间。报告记录字节数、哈希、各检查结果和清理错误。只有专项检查及清理均成功，`passed` 才为 `true`；完整命令还会继续执行原有双语交付及撤回流程。

## 边界

- 合成 MP4 只用于文件结构和传输验证，不是真实可播放视频；PDF 同样是传输夹具，不验证阅读或 AI 识别质量。
- 本专项的兼容下载路径先完整接收响应体，再交给浏览器保存。后续[内存专项](./transfer-memory-validation.md)记录了历史非持久上下文中两轮约 1.3 GiB 的私有提交峰值；现已新增[按能力启用的大文件流式保存](./streamed-delivery-download.md)，其磁盘模式对照另行记录，不能据此保证所有低内存设备处理 500 MB 的体验。
- 尚未验收真实移动设备、持续蜂窝弱网、生产反向代理和长时间多用户大文件并发。
- 重试验证的是唯一附件和内容一致，不声称支持分片、断点续传或刷新后自动恢复本地文件。
- 真实生产工作流、对象存储方案和更改上传上限不属于本轮。

## English summary

This opt-in Chromium diagnostic transfers a real 500,000,000-byte synthetic file through the browser and API, verifies download size and SHA-256, and exercises cancellation and actual socket interruption in both supported locales. Customer source-upload recovery uses an 8 MB synthetic PDF and verifies one identical final attachment. Throttling applies to cancellation scenarios; complete retries use normal loopback networking. These checks do not certify playable media, peak memory usage, real devices, production proxies, sustained mobile networks, or resumable/chunked uploads.
