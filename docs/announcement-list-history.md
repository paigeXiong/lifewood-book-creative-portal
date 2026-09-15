# 公告列表筛选与加载范围恢复

日期：2026-09-15。

公告列表将已提交的搜索词、状态、展示位置和已加载页数分别记录为 `q`、`status`、`placement`、`pages`。搜索通过按钮或 Enter 提交，输入过程不改写历史；提交搜索或切换筛选会回到第一页。浏览器后退/前进时，表单显示与列表请求均以地址中的条件为准。

“加载更多”成功取得新页后才增加地址中的页数。返回之前的历史记录时，列表只显示该记录对应的页数，即使查询缓存已经包含更多数据。冷刷新会从第一页开始，按服务端返回的真实游标顺序补回目标页数；到达末尾或遇到错误就停止。失败后可以刷新恢复。

编辑器记录来源列表条件；组织选择取消或完成时，回到同一语言的固定公告路径并恢复条件与加载范围。返回地址不接受任意 URL，仅提取已知查询参数。新建、关闭、另建草稿等历史替换保留当前列表参数。

查询缓存按账号和筛选条件区分。搜索词最多 160 字符，状态与展示位置使用白名单，非法页数回到第一页。最多显示 50 页（服务端每页 20 条，最多 1,000 条），超过时提示缩小搜索或筛选范围，避免地址参数触发无限补页。

## 并发处理

- 分页被刷新取消后，即使返回成功结果，也要确认数据页数确实增加，才写入新的页数。
- 每次路由位置变化都会更新导航代次。离开原位置后再后退回来，也不能让旧分页结果改写历史或截断“前进”记录。
- 离开页面后的分页结果可以进入对应查询缓存，但不会主动把用户导航回来。
- 搜索与页面状态恢复继续沿用服务端搜索和游标查询，不在浏览器筛选完整公告库。

## 验证和边界

后台全量 33 个文件、156 项测试通过；TypeScript、生产构建及限定代码复核通过。

专项 8 项覆盖：中英文搜索/状态/展示位置与 Back/Forward；组织选择取消/完成；清空缓存后顺序补页；参数归一化；加载失败和刷新恢复；离开页面后的迟到结果；分页与刷新竞争；切换筛选再返回原历史记录的竞争。

```powershell
npm run test --workspace @lifewood/admin-web -- src/announcement-list-state.test.tsx
npm run test:admin
npm run build:admin
```

恢复的是筛选条件与加载范围，不记录像素滚动位置。刷新后的公告顺序、内容及条数仍以服务端当前数据为准，不能保证其他管理员修改后还是原来的行。旧历史里没有 `pages` 时按第一页处理；尚未提交的搜索文本不作为已生效的筛选保存。全程保持 5077/5173/5174 预览进程运行。

## English summary

Committed filters and loaded-page count now follow the URL. Back/Forward restores the matching view, and cold reloads rebuild pages using server cursors. Organization selection returns to the original filtered list. Paging failures and stale completions cannot advance history. Restoration is bounded to 50 pages and does not preserve pixel scroll position or a historical snapshot of server data.
