# 公告编辑与组织选择的草稿保留

日期：2026-09-15。

公告标题、正文、展示天数和受众设置在当前标签页暂存。进入组织选择后返回、取消或完成选择，仍可继续编辑；刷新公告页可恢复同一编辑流程的最新暂存。组织页的候选勾选独立保留，搜索、分页和刷新不会清空，只有点击“完成”才应用到公告。取消选择保留进入选择器之前的公告受众。

输入先更新 React 状态，再写入按账号与编辑流程区分的 sessionStorage；不逐字调用浏览器 history，避免高频输入触发浏览器历史写入限制。路由状态携带编辑流程和初始快照，返回同一流程时优先读取最新暂存。组织候选仍保存在对应历史记录中，再次主动进入选择器会从公告当前受众重新开始。

保存成功或确认放弃后删除该流程暂存，并留下已关闭标记，旧历史不能重新打开该草稿。切换账号后不会读取其他账号的暂存。保存期间通过查询缓存跟踪同一流程的请求，页面内返回和重新挂载仍保持只读，直到请求成功或失败；成功后关闭编辑器，失败后保留可编辑内容与错误。

## 验证与边界

专项 4 项、后台全量 31 个文件共 130 项测试通过；TypeScript 与生产构建通过。代码复核未发现本轮范围内剩余必须修复项。

- 中英文实际公告页与组织页的返回、候选取消/完成、搜索后重新挂载、提交字段、保存中重挂载及旧历史失效。
- 连续修改两个字段、连续勾选两个组织，以及同一批次 150 次输入均保留最后内容；正文输入不改写路由历史。
- 暂存写入失败时保留当前页面内存中的输入；重新加载模块后可从可用的 sessionStorage 恢复最新正文。
- 外部账号、非法历史数据与已关闭流程均被拒绝。
- 保存中通过浏览器 Back/Forward 回到历史组织选择页时，勾选和完成保持禁用；处理函数还会同步检查请求状态，防止界面更新前的重复操作。

```powershell
npm run test --workspace @lifewood/admin-web -- src/announcement-draft.test.tsx
npm run test:admin
npm run build:admin
```

这属于当前标签页的暂存，不是服务端自动保存。关闭标签页、清除浏览器数据或存储不可用后刷新，不能保证恢复；未主动保存的内容也不会跨设备同步。浏览器在保存请求期间真正刷新后，无法延续原页面的请求状态，仍需遵循服务端版本冲突校验。组织在选择期间被其他管理员修改、停用等情况，以保存时服务端校验为准。

组件重挂载与模块重新加载用自动化测试模拟，未将其表述为所有浏览器的真机刷新验收。所有提示复用现有中英文翻译。本轮仅修改前端，5077/5173/5174 预览进程保持运行。

## 保存失败与版本冲突（2026-09-15 补充）

后台全量 31 个文件共 134 项通过；最终竞态修正后，公告专项 8 项再次通过，生产构建与静态复核通过。中英文用例覆盖原请求重试、取消/确认复制、新草稿刷新恢复、旧双语字段保留，以及保存中重挂载后迟到的冲突不会被后续编辑清除。

- 可重试的网络或服务端错误会保留输入，显示“重试保存”，使用原公告 ID 与原版本再次提交，不自动创建另一条公告。
- 服务端返回 `announcement.conflict` 时，当前流程记为冲突并暂存；刷新后也不能继续向同一旧版本重复保存。列表会刷新，编辑器内提供在新标签页核对公告的入口，当前输入继续保留。
- 冲突可能来自其他管理员修改、公告已发布/撤回/删除，或上一次保存成功但响应丢失。界面不把所有冲突都认定为其他人修改，也不自动提高版本覆盖服务端。
- “用当前内容新建草稿”经过明确确认后生成新 ID、编辑流程和版本 0，保留标题、正文、受众与天数；此时只创建本地待保存内容。用户仍需点击保存，之后发布也仍需原有发布操作。确认文案说明重复公告的可能性。
- 新流程会替换当前历史入口，旧冲突流程关闭；取消确认不改变原草稿。原公告不被覆盖。
- 旧双语公告只修改受众或公示天数时保留两份原文，只有修改标题或正文才归一化为当前界面显示的内容。

此轮没有新增服务端详情/合并接口，也没有改变版本校验或实现自动合并。请求结果不确定时应核对列表，不能把新建副本当成已确认的保存结果。

## English summary (save recovery)

Retryable failures keep the original announcement ID and version. Version conflicts retain edits across refresh, offer a separate tab for reviewing announcements, and allow an explicitly confirmed new unsaved draft without overwriting or publishing the original. Legacy bilingual content is preserved when only audience or duration changes. No automatic version rebasing or server-side merge is performed.

## English summary (draft navigation)

Announcement drafts now retain text and audience settings while navigating to the organization picker. Candidate selections remain separate until confirmed. Tab-scoped recovery is isolated by account and editing flow; saved or discarded drafts cannot reopen from old history. Typing does not write browser history, and pending saves remain read-only during SPA remounts. This is local recovery, not server autosave or cross-device synchronization.
