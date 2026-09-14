# Book intake / 图书资料录入

本次实现位于 AIGC 工作树。没有修改 Downloads 中的 DerseretBook 演示项目。

- 第 1 步删除原基本信息区，书籍信息、文件资料顺序编号为 1.1、1.2。品牌、项目名称、视频目标、截止日期和目标受众移到第 5 步的 5.1；参考资料和创意方向编号为 5.2、5.3。客户资料自动取创建者信息，不显示在这些输入区。视频目标、目标受众维持必填；品牌和截止日期可选。创建时从账号写入；旧草稿缺失的客户资料从创建者补齐，首次保存后持久化。提交后的快照保持不变。
- 书籍卖点与简介为可选项；前端、完成度和后端提交校验保持一致。
- 文件资料区默认仅有图书封面、全书或节选、补充图片 / 手机照片。封面最多 6 张。已有数据库通过一次性迁移停用三个旧分类，保留历史上传与后台自定义配置。
- 新建项目带七种角色：主角、配角、旁白角色、导师、反派、儿童角色、背景角色。设定支持中英文，按创建请求的语言写入，之后作为客户可编辑内容保存。可逐个删除，全部删除后保存草稿不会自动补回；完成角色步骤时仍需至少一个有效角色，可使用“添加角色”自定义。
- 旁白角色是可选出镜讲述者，与后续是否启用配音分开。默认图为 AI 生成的示意参考，不代表特定图书人物。生成提示词与原图来源见 [character-preset-assets.json](character-preset-assets.json)。

角色预设拥有独立姓名及年龄、性别：米拉 / Mara（青年女性）、西奥 / Theo（成年男性）、诺拉 / Nora（成年女性）、陈文 / Chen Wen（老年男性）、薇拉 / Vera（成年女性）、里奥 / Leo（男童）、克拉拉 / Clara（成年女性）。原有草稿通过一次性迁移替换旧默认类型名、补充空年龄和性别，保留自定义值及已删除角色；已提交项目不变。切换编辑角色时按角色身份重新挂载表单控件，避免上一个角色的值残留。

## Optional multimodal recognition / 可选多模态识别

视觉风格示例支持图片和视频。管理后台的表单选项「视觉风格」可填写示例图片 / 视频封面地址以及可选的视频地址，支持站内绝对路径或 HTTPS 媒体直链。视频静音、内联循环播放，只在指针悬停时启动，移开、离开视口或切到后台时暂停；触屏及键盘提供原生播放控件。视频加载失败时回退图片。当前内置示例仍使用原图片，配置视频后生效。客户页面不展示风格示例来源备注或色彩基调的内部说明。

平台所有者可在管理后台「系统配置 → AI 接入」配置完整 HTTPS Chat Completions 地址、模型、API Key 和启用开关。保存后立即用于后续识别请求，无需重启。默认关闭，关闭时客户页面隐藏识别区域；已打开的客户页面可刷新以更新开关。用户仍需手动点击识别，不会在上传时自动发送照片。

文件资料仅封面默认必传；全书或节选及补充图片可选。不上传手稿不会阻止进入后续步骤或提交。已有分类通过一次性迁移同步为选传，保留已上传文件。

临时项目名可选：第 5 步默认显示书名，保存时空白项目名采用书名，自定义名称保持不变；提交旧草稿时也补全空项目名。客户页面移除了区块内部说明、指定的旁白提示及所有步骤底部说明，中英文保持一致。

| Setting / 配置 | Meaning / 含义 |
| --- | --- |
| `Enabled` | Explicitly set `true` to opt in / 显式开启 |
| `Endpoint` | Full HTTPS Chat Completions endpoint, e.g. `https://api.openai.com/v1/chat/completions` / 完整 HTTPS 请求地址 |
| `Model` | Configured model supporting image input and JSON object output / 支持图片和 JSON 输出的模型 |
| `ApiKey` | Server secret / 仅服务端密钥，不提交到 Git |

可通过服务进程环境变量设置 `Lifewood__BookRecognition__Enabled`、`Lifewood__BookRecognition__Endpoint`、`Lifewood__BookRecognition__Model` 和 `Lifewood__BookRecognition__ApiKey`。不要使用 `VITE_` 前缀。缺任意配置或非 HTTPS 地址时功能保持关闭。

`POST /api/projects/{id}/recognize-book` 接收 `{ "assetIds": ["已上传的封面文件 ID"] }`。只读取当前用户草稿中的封面文件，支持 1–6 张，每张最多 10 MB，合计 20 MB。不接受客户端传来的任意远程图片地址。需要登录、写权限和 CSRF；每用户每分钟最多 6 次调用。请求超时 60 秒，拒绝重定向，响应最多 64 KB。第三方返回错误时不向客户泄露服务商响应或密钥。

接口返回 `title`、`authorName`、`subtitle`、`genreId`、`sellingPoint`、`synopsis`。看不清或缺失的资料留空；类型匹配现有启用目录。只填入请求前为空且请求期间未改变的字段，保留已有内容；切换任务、语言或照片后取消旧请求。识别不会直接保存到数据库，复用现有表单自动保存流程。

多图请求格式依据 [OpenAI 官方图像输入文档](https://developers.openai.com/api/docs/guides/images-vision?api-mode=chat)。其他兼容服务需提供相同消息、JSON 输出及 `choices[].message.content` 响应格式。未配置真实密钥，因此验证使用模拟提供商，尚未测真实模型识别质量。


### Admin API configuration / 后台 API 配置

后台保存优先于环境变量，配置持久化到数据目录的 book-recognition.json。密钥通过 ASP.NET Core Data Protection 加密，API 仅返回是否已配置，不回显原文。备份/迁移时需要同时保留数据目录及 Data Protection 密钥目录。留空保留已有密钥；清除密钥需关闭识别。更换 API 地址时需重新填写密钥，避免将已有密钥发送到新的服务地址。配置保存记入操作审计，不记录密钥内容。

Owner-only administration is available under System settings → AI integration. Saved settings override environment configuration and apply to subsequent recognition requests without restarting. Keys are encrypted at rest and never returned in settings responses. Keep the Data Protection key directory when migrating the data. Changing the endpoint requires re-entering the key. Real-provider compatibility and recognition quality still require testing with your selected model.


### Providers and AI features / 服务商与 AI 业务

AI 接入分为两层：「模型服务商」维护名称、接口格式、HTTPS 地址、密钥及可用模型清单（一行一个模型 ID）；「AI 业务配置」只选择服务商及其清单中的模型，并控制业务启用。当前业务目录只有封面识别；以后新增业务时在服务端目录注册，并由该业务的服务读取对应绑定。

支持 OpenAI Chat Completions 与 Anthropic Messages。后者使用 x-api-key、anthropic-version: 2023-06-01、image/source/base64 消息和 max_tokens，解析 content 文本块；前者使用 Bearer、image_url 和 choices 响应。模型必须支持图像理解；没有对真实 Anthropic 账号发起测试。

旧单服务商配置自动映射为一个服务商及封面识别绑定，保留模型、加密密钥和启用状态。被业务引用的服务商和模型不能直接删除，需先更改业务绑定。新增或编辑供应商不会自动切换当前业务。基础地址 / 和 /v1 会根据所选协议补全接口路径，自定义完整路径保持原样。

Providers own their model catalogs; AI features select a provider and a model from that catalog. Both the UI and server enforce this relationship. Settings take effect on the next recognition request. Legacy settings migrate without changing the selected model or exposing the saved key.

## 面向客户的名称调整（2026-09-14）

默认文件类别“全书或节选”调整为“书籍正文 / Book text”，“情绪板”调整为“风格参考拼图 / Visual inspiration board”。表单同步使用“语速 / Speech rate”和“希望观众采取的行动 / What should viewers do next?”。

启动时的一次性升级只替换已知旧默认名称，各语言分别判断；保留管理员自定义名称和说明、是否必填、上传限制、禁用与移除状态。类别 ID `manuscript`、`moodboard` 保持不变，不改动已上传文件和历史提交快照。书籍正文默认选填，可上传全书或部分章节。

Default file labels now use plain language. A one-time startup migration updates recognized legacy defaults independently per language while preserving custom labels/descriptions, limits, required flags and removal state. Stable category IDs, uploaded assets and historical submission snapshots are unchanged.
