# 项目处理效率与个人工作区

本轮功能均适配简体中文和英文。当前工作区已具备可配置邮件通知，真实发件服务仍未接入验收，见[邮件说明](./email.md)。

## 批量处理

运营工作台通过“批量选择”进入选择模式，支持跨页选择，最多 50 个项目。一次操作只调整一个字段：优先级、负责人或内部跟进期限。负责人通过可搜索、可分页的用户目录选择，不一次性载入全部用户；清空负责人表示取消分配，清空期限表示取消跟进期限。

提交前读取所选项目的版本，逐项检查当前账号权限、可见范围和版本；结果逐项显示成功、冲突、无权限或不可访问。部分项目失败不会覆盖其他人的改动。退回中的项目可调整这些内部字段，保持退回流程和客户资料不变；普通未提交草稿不可在后台批量处理。

入口需要 `admin.projects.workflow`，分配负责人另需 `admin.projects.assign`。运营人员仍只能操作分配给自己的项目。批量成功操作沿用项目进度或跟进期限的审计记录。

接口：`GET /api/admin/projects/batch-preview?ids=...`、`POST /api/admin/projects/batch`。

## 趋势报表与导出

从运营工作台进入趋势报表。支持日期范围、当前组织名称、当前负责人姓名或邮箱筛选，并导出相同结果的 UTF-8 CSV。范围最多 366 天，明细每页 20 天；服务端按访问者的项目范围汇总，客户无权访问。

- 首次提交：按项目首次提交时间计数，重新提交不重复计数。
- 有效交付：按当前未撤回交付的发布时间计数。
- 当前逾期：按仍未完成、跟进期限已过的项目计数，归入期限所在日期；不是历史某一天的逾期快照。

日期使用浏览器当前时区偏移。跨越夏令时切换时仍使用当前偏移，页面“统计口径”明确说明。组织和负责人是当前归属，已删除项目不参与统计；报表会随撤回交付、完成项目、人员分配等变化，不是不可变审计报表。

接口：`GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&offset=480&organization=...&assignee=...`。

## 常用筛选和草稿续填

后台项目列表和运营工作台支持常用筛选。客户项目列表已按用户确认移除常用筛选入口，保留普通筛选。每个账号、每个页面最多 20 个，名称 1–40 字；可应用、重命名、移除。筛选由服务端保存，跟随账号。修改和删除检查版本，防止多设备相互覆盖；账号注销同步清理。

进入草稿编辑步骤时记住所在步骤，下次从列表继续填写时跳回该步骤。只记录和读取本人草稿；已退回项目若原步骤不在允许修改范围，会定位到允许修改的首个步骤。该功能记住位置，不代替表单保存，也不保存未提交的输入。

接口：`GET/PUT/DELETE /api/me/views/...`、`GET /api/me/resume?ids=...`、`PUT /api/projects/{id}/resume`。

## 登录设备

客户个人资料和后台账号菜单均提供“登录设备”。显示浏览器类别、系统类别、最近连接、有效期以及当前设备标记，每页最多 20 个；不保存原始 User-Agent 或 IP。最近连接以最多 5 分钟粒度更新，不等同于在线状态。

支持退出指定其他设备或全部其他设备，保留当前设备。退出会同时删除该设备的账号切换凭据和有效登录记录；旧登录 cookie 在下一次请求时失效，重新登录需要密码。只撤销当前账号，不退出该设备保存的其他账号。已开始处理的请求可能完成。

翻页、设备从列表消失或列表刷新失败时清除旧退出确认；列表读取中、离线暂停或失败时不能提交退出。退出请求在当前前端实例内按账号共享操作锁，离开后重开也不能重复提交；无论响应成功或失败，均重新读取服务端设备状态，失败后不自动重发退出请求。账号切换会清除旧确认、屏蔽旧请求的页面结果，弹窗仍可关闭。恢复操作需要重新选择设备并确认。

English: Paging, refresh failure, or disappearance of the target clears its sign-out confirmation. Actions stay blocked while the list is fetching, paused offline, or in error. A per-account lock in the current frontend instance spans revocation and reconciliation, including remounts. Lost responses trigger a read, never an automatic revocation retry. Account changes invalidate stale results while allowing the dialog to close.

活动会话沿用滑动续期，同步延长对应服务端登录记录，已过期或撤销的记录不能通过续期恢复。历史 cookie 仅在仍有匹配有效凭据时升级；旧记录可能显示未知浏览器或无最近连接记录。密码变更、禁用和账号注销继续沿用原有全账号会话失效规则。

接口：`GET /api/me/sessions?page=1`、`DELETE /api/me/sessions/{id}`、`POST /api/me/sessions/revoke-others`；写操作要求 CSRF 校验。

## 验证

2026-09-16 登录设备异常恢复：新增 14 项中英文回归及已有 2 项账号缓存隔离测试通过，覆盖翻页旧确认、列表失败/目标消失、重复点击与重开、响应丢失、离线恢复、账号切换及明确确认后退出其他设备。使用替代接口，未撤销真实设备会话。

`ProductivityTests.cs` 覆盖筛选归属、上限和版本，草稿和退回范围，批量字段更新冲突，趋势时区/范围，以及设备撤销和不可恢复规则。HTTP 集成测试覆盖客户越权、批量部分成功、旧 cookie 失效以及滑动续期。隔离浏览器验证中英文、1366/390 像素布局、筛选应用/移除、续填链接、CSV 下载、批量保存与设备退出。

## 复制项目为新草稿 / Copy to a new draft

客户项目列表的更多操作可复制本人草稿或已提交项目。复制以服务器已保存内容为准，复用项目、书籍、角色、风格及配音选择，清空截止日期、附件及附件引用；生成新的草稿和角色标识，不继承编号、提交快照、授权确认、跟进状态、负责人、沟通、成品或历史记录。旧配置仍须通过当前提交校验，附件需重新上传。说明收在问号中，中英文适配。

复制遵守现有组织要求和草稿数量上限。服务端事务校验所有权和上限；同一请求键只生成一个草稿。网络失败后在当前列表重试沿用请求键；已删除的复制结果不会被重试重建。重新进入列表后发起复制视为新操作。

The existing project menu can copy the current user's saved project content into an independent draft. Attachments, deadline, submission consent, workflow and history are reset. Current validation still applies. Ownership and draft limits are enforced transactionally; retrying the same request does not create another draft or recreate a deleted result.

## 存储分类 / Storage breakdown

现有运行与网络的监控明细增加数据库及日志、账号头像、其他数据文件，与已有附件和成品分类合计为数据目录已用容量。独立备份目录单独计量（包括临时文件），不计入数据目录配额。沿用每分钟采样、最多十万文件和不跟随符号链接的限制；扫描不完整显示未知，不以零代替。 / Existing runtime details now break down data-directory usage and separately measure the managed backup directory. Backup usage is not included in the data quota; partial scans remain unknown.
