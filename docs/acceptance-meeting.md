# Book Creative Portal：会议验收清单与演示流程
# Acceptance checklist and demo guide

整理日期 / Prepared: 2026-09-16。本文是待执行的会议材料，不是已完成的业务验收报告。Lifewood 是开发公司。

This is a meeting guide awaiting execution, not a completed business acceptance report. Lifewood is the development company.

## 1. 本次要达成什么 / Meeting outcomes

建议预留 50 分钟：范围与环境 5 分钟、业务演示 20 分钟、异常与双语检查 10 分钟、下一阶段决策 10 分钟、结论与责任人 5 分钟。较复杂决策另约专题会议，不现场默认通过。

Suggested agenda: 5 minutes for scope/environment, 20 for the demo, 10 for recovery and language checks, 10 for decisions, and 5 for conclusions/owners. Schedule a separate discussion for unresolved complex decisions.

- 确认现有“资料登记 → 人工跟进 → 定向退回 → 最终交付”是否满足业务使用需要。 / Accept or reject the existing intake, manual follow-up, targeted return and delivery flow.
- 记录缺陷、体验建议和新需求，分别处理；新增需求不自动成为当前版本验收阻塞项。 / Separate defects, usability suggestions and new requirements.
- 确定正式制作工作流仍需拍板的规则和负责人。 / Assign owners to unresolved production-workflow decisions.

## 2. 版本与证据 / Version and evidence

| 范围 / Scope | 当前依据 / Evidence | 会议如何表述 / Meeting treatment |
| --- | --- | --- |
| 发布版 / Release | [v0.3.16](https://github.com/paigeXiong/lifewood-book-creative-portal/releases/tag/v0.3.16)，应用提交 `98b4914`；[发布构建](https://github.com/paigeXiong/lifewood-book-creative-portal/actions/runs/35065744728)最终成功 | 已发布，可作为验收基准；Windows 恢复演练曾失败一次，重跑通过。 / Released baseline; the Windows restore drill passed on retry after one failure. |
| 发布后测试修正 / Test follow-up | `f4dd3dd` 只修改测试和验证记录；[完整 CI](https://github.com/paigeXiong/lifewood-book-creative-portal/actions/runs/35067796638)通过 | 应用代码与发布版一致；修正导航数量及归档筛选的测试等待方式。 / Application code unchanged; corrected navigation-count and archive-filter assertions. |
| 本地后续改动 / Unreleased local changes | [通知偏好保存恢复](./notifications.md)：104 项相关前端回归及两端构建通过 | 不在 v0.3.16 包内，单独演示、单独记录。 / Demonstrate and record separately from the release. |
| 邮件、OIDC、封面识别 / External integrations | 本地 QQ 中英文示例邮件实收与排版已确认；真实链接、OIDC 及识别接入仍待验收 | 可展示已确认的邮件模板效果；其余未验收项如实说明。 / QQ delivery and bilingual sample layout are confirmed; production email links, identity login and recognition still require acceptance. |

自动化结果不代替客户确认、真实设备检查或目标环境部署验收。 / Automation does not replace business, real-device or deployment acceptance.

## 3. 会前准备 / Preparation

- [ ] 记录实际演示版本、提交、环境、浏览器、日期、演示人及业务验收人。若使用本地工作区，注明未发布改动。 / Record version, revision, environment, browser, date, presenter and business reviewer; identify local changes.
- [ ] 使用隔离演示环境和虚构资料。准备客户 A、同组织客户 B、运营 O、管理员及平台负责人账号，密码单独保管。 / Use isolated demo data and customer A/B in one organization, operator, admin and owner accounts; keep passwords out of this document.
- [ ] A、B 各有项目；准备一份可填写草稿、一份已提交项目及小体积封面、参考文件、有效成品文件。文件遵循演示环境当前类别限制。 / Prepare separate customer projects, draft/submitted examples and valid small cover/reference/delivery files within configured limits.
- [ ] 提前确认所有会演示的变更仅影响演示账号和项目。备份恢复、永久注销、停服和压力测试不在日常预览或业务数据上现场执行。 / Limit writes to demo accounts/projects; perform destructive and operational drills only in dedicated environments.
- [ ] 若包含真实邮件、OIDC 或 AI 演示，另备已配置的测试服务和受控账号；否则记“未启用/待外部验收”。 / Prepare configured test providers if included; otherwise record disabled or awaiting external validation.
- [ ] 确认参会人能访问演示环境。本机 `127.0.0.1` 链接不能直接给其他电脑访问。 / Confirm attendee access; loopback URLs are local to each machine.

| 环境记录 / Session record | 填写 / Value |
| --- | --- |
| 日期、参会人 / Date and attendees | 待填写 / To fill |
| 版本、提交、未发布改动 / Version, revision, local changes | 待填写 / To fill |
| 客户与后台入口 / Customer and admin URLs | 待填写 / To fill |
| 演示账号别名与项目编号 / Account aliases and project references | 待填写；不记录密码 / To fill; no passwords |
| 浏览器、实际手机设备 / Browsers and physical devices | 待填写；模拟视口单独标注 / To fill; label emulated viewports separately |

## 4. 主演示流程 / Core demo

所有结果初始均为“未执行”。逐项记录通过、失败或阻塞，并附实际证据；演示失败不可用预置结果代替通过。

All results start as Not run. Record Pass, Fail or Blocked with evidence. A prepared example must not replace a failed demonstration.

| ID | 操作 / Action | 通过标准 / Pass criteria | 结果、证据 / Result and evidence |
| --- | --- | --- | --- |
| A01 | 客户 A 创建项目、填写资料、上传封面，等待保存后刷新继续。 / Customer A creates a draft, enters data, uploads a cover and reloads after saving. | 已保存内容和附件保留；必填校验明确；选填项不被误判必填，按后台当前规则执行。 / Saved data and files persist; validation follows configured requirements. | 未执行 / Not run |
| A02 | 完成并提交项目，再打开详情和后台列表。 / Complete and submit; reopen details and the admin list. | 提交有明确结果，不产生重复项目；客户提交内容默认只读，后台可查看资料。 / Clear submission outcome without duplicates; submitted content is read-only to the customer and visible to authorized staff. | 未执行 / Not run |
| A03 | 管理员分配运营 O；O 查看并更新进度、备注。 / Admin assigns operator O, who reviews and updates progress/notes. | O 只能处理分配项目；客户不能看到内部备注；A、B 同组织也不自动共享项目。用 B 打开 A 的详情与附件验证无权访问。 / Assignment limits apply, internal notes stay private, and customer B cannot access A's project/files. | 未执行 / Not run |
| A04 | 退回一个资料单元并填写原因；A 修改或回复后重新提交。 / Return one intake section with a reason; A edits/replies and resubmits. | 仅退回单元可修改；原因可见、重新提交成功，授权内部人员可追溯退回记录。此处不是成片返修。 / Only returned sections are editable, and authorized staff can trace the return. This is intake correction, not video revision. | 未执行 / Not run |
| A05 | 后台发布有效最终成品；A 查看并下载，核对文件。 / Publish a valid final deliverable; A views and downloads it. | 入口、文件名及下载文件正确；无权限账号不可下载。当前仅管理单一当前最终成品。 / Correct entry, filename and file; unauthorized download is denied. Current delivery is a single current final artifact. | 未执行 / Not run |
| A06 | A 提交带截图的平台问题；后台回复；A 从通知查看。 / A submits platform feedback with a screenshot; staff replies; A opens the notification. | 截图与内容正确、回复送达对应用户；按通知回复，不出现独立聊天流程。 / Content and screenshot persist; the intended user receives the reply through notifications. | 未执行 / Not run |
| A07 | 查看客户概览、通知筛选及个人设置；负责人展示登录方式和邮件状态。 / Review customer overview, notification filters and profile; owner shows login and mail settings. | 数据符合演示项目及权限；筛选可恢复；说明在问号中按需查看；未配置服务如实显示状态，配置页不暴露密钥。 / Data respects access, filters restore, help is on demand, and provider status is truthful without exposing secrets. | 未执行 / Not run |

## 5. 异常、语言及设备检查 / Recovery, language and device checks

| ID | 操作 / Action | 通过标准 / Pass criteria | 结果、证据 / Result and evidence |
| --- | --- | --- | --- |
| B01 | 将账号偏好设为英文后打开中文路由，再通过语言入口切回。 / Set English preference, open a Chinese route, then switch through the language control. | 两端按账号偏好跳转，显式切换可用；通知、错误和日期语言一致。核心提交与下载用两种语言复核。 / Both portals honor preference and explicit switching; core submit/download flows work in both languages. | 未执行 / Not run |
| B02 | 在隔离环境中模拟上传中断，恢复连接后手动重试。 / Interrupt an upload in the demo environment, reconnect and retry explicitly. | 失败可理解，已填写资料保留；未完成附件不伪装成功；重试不重复生成附件。 / Clear failure, retained form data, no false success or duplicate attachment. | 未执行 / Not run |
| B03 | 在测试输入填写无害的标签文本，如 `<b>验收文本</b>`，查看客户及后台。 / Enter harmless markup-like text and inspect both portals. | 按普通文字展示，不变成 HTML 页面内容。 / It remains literal text rather than rendered HTML. | 未执行 / Not run |
| B04 | 使用实际手机检查上传、表单和下载；桌面用键盘操作菜单、问号和弹窗。 / Check upload/forms/download on a physical phone and keyboard navigation on desktop. | 关键操作可达、无横向溢出或焦点丢失；关闭顶层弹窗不误关底层。模拟视口不能替代真机通过。 / Controls are reachable, layouts/focus remain usable, and nested dialogs close correctly; emulation is not physical-device acceptance. | 未执行 / Not run |
| L01 | 仅本地后续版本：保存通知偏好期间重复操作，模拟断网和离开后返回。 / Unreleased local changes only: exercise repeated preference saves, disconnection and reopening. | 保存中防重复和误编辑；失败保留输入且可关闭；重连不自动重发写操作，旧响应不影响新账号或新弹窗。 / Saves are guarded; failures retain edits and allow closing; reconnect does not replay writes or affect another account/dialog. | 未执行；不计入发布版 / Not run; outside release baseline |

本轮未准备的真机或外部服务检查记“阻塞/待外部验收”，不能勾选通过。 / Unavailable devices/providers remain Blocked or Awaiting external validation.

## 6. 正式制作工作流：只讨论未决规则 / Production-workflow decisions

原图中的流程设想不等于本次已经实现或授权开发。已明确的内容不重复询问是否需要；若决定删减原图要求，应明确记录范围调整。

Source diagrams describe proposed workflows, not completed functionality or automatic development authorization. Decide unresolved rules; explicitly record any reduction of source requirements.

原图依据：[第 5 页内部制作](../需求图片/微信图片_20260821133044_101_15.png)、[第 6 页审阅返修](../需求图片/微信图片_20260821133047_102_15.png)、[脚本审阅原型](../需求图片/微信图片_20260821133008_96_15.png)。详情见[生产批注](./production-workflow-annotations.md)。 / Source evidence and detailed annotations are linked here.

| ID | 原图已表达 / Already shown | 会议需决定 / Decision required | 结论、负责人、日期 / Decision, owner, date |
| --- | --- | --- | --- |
| D01 | 第 5 页列出受理、QC、生成组装、精修、回传。 / Intake, QC, production, finishing and draft handoff. | 当前制作在外部完成；平台要记录哪些阶段、哪些成果必须上传、哪些关卡需批准？ / Which external stages need tracking, required artifacts and approval gates? | 待确认 / Open |
| D02 | 经理分配高级编辑、经理审核修改请求、作者最终批准。 / Manager assigns/reviews requests; author gives final approval. | 多人项目权限、发布/撤回权限、内部可见范围、自己制作自己审核是否允许？ / Membership, publish/withdraw powers, visibility and self-review rules? | 待确认 / Open |
| D03 | 第 6 页明确场景评论、时间点备注与局部批准。 / Scene/timecode comments and partial approval. | “场景”是什么？剪辑后如何对应？若先只做时间点评论，是否批准暂缓场景级批准？ / Define scenes and edit mapping; explicitly approve deferral if only timecode comments ship first. | 待确认 / Open |
| D04 | 返修图要求提交意见；脚本原型有 Edit/Add Scene。 / Revision requests coexist with Edit/Add Scene in the prototype. | 客户直接编辑还是提交提案？谁采纳？修改何时成为正式版本？ / Direct editing or proposals, adoption authority and version promotion? | 待确认 / Open |
| D05 | 版本历史、更新稿、循环返修、最终批准。 / History, revised drafts, revision loops and approval. | 旧评论、局部批准如何随新版处理？批准能否撤回？多人意见以谁为准？ / Carry-over of comments/approvals, withdrawal and final decision authority? | 待确认 / Open |
| D06 | 首稿可低清；最终母版、社交短版、归档。 / Low-resolution first draft, master/social cuts and archive. | 最终规格、交付数量、是否交工程文件、保存期限和访问权限？ / Final specifications, quantities, source projects, retention and access? | 待确认 / Open |
| D07 | 原图描述成果返修，未完整说明范围变更和异常。 / Revision is shown; scope changes and exceptions are not fully defined. | 客户变更目标/材料后如何批准？暂停、取消、重新打开、旧项目迁移如何处理？ / Scope-change approval, pause/cancel/reopen and legacy migration rules? | 待确认 / Open |

另将授权材料规则、正式命名、制作限制交接及组织共享等问题按需带入专题讨论，见[剩余工作](./remaining-work.md)。邮件、OIDC、AI 供应商和目标部署环境属于接入/上线准备，可并行确认；不重复开发已有配置功能。

Use the remaining-work list for rights documents, formal naming, constraints and organization sharing. Provider and deployment decisions can proceed separately; existing configuration features do not need rebuilding.

## 7. 会议记录与结论 / Findings and conclusion

| 编号 / ID | 对应用例、实际与预期、证据 / Case, actual vs expected, evidence | 类型 / Type | 负责人、期限、复验结果 / Owner, due date, retest |
| --- | --- | --- | --- |
| 待填写 / To fill | 待填写 / To fill | 缺陷 / 建议 / 新需求 / 外部阻塞；Defect / Suggestion / New scope / External blocker | 待填写 / To fill |

- 当前版本业务结论：□ 未验收 □ 通过 □ 附条件通过 □ 不通过。 / Business outcome: Not reviewed / Accepted / Conditionally accepted / Rejected.
- 若附条件通过，必须列明条件、影响范围、责任人与复验时间；权限越界、数据丢失等核心缺陷需解决后复验。 / Conditional acceptance must list scope, owners and retest dates; core access/data-loss defects require resolution.
- 正式上线结论单独记录：□ 未评估 □ 条件未满足 □ 已完成目标环境验收；依据[发布就绪](./release-readiness.md)。 / Record deployment readiness separately using the release-readiness checklist.
- 下一阶段开发授权：□ 尚未授权 □ 已确认范围，附决策文档及业务负责人确认。会议讨论不自动代表授权。 / Development authorization: Not granted / Explicit scope confirmed and signed off.
- 业务确认人、日期、遗留项链接：待填写。 / Business reviewer, date and remaining findings: To fill.

本文未创建演示账号、未修改业务数据、未替业务方签署验收结论。 / This document creates no demo accounts, changes no business data and records no acceptance on behalf of the business.
