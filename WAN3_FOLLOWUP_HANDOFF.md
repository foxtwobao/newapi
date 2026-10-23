# WAN3 后续开发交接

更新日期：2026-10-18（Asia/Shanghai）

> 当前交付版本：知梦 1.1.1、RollDek 1.1.1。知梦已由用户上传并完成参考视频验收；RollDek 本次修正尚未上传。下方早期“尚未上线／尚未实测”属于历史阶段，最新 RollDek 核验及修正见第 3.4 节。

交接对象：继续在 `/home/hulei/projects/newapi` 开发的 session。

目标：在现有统一视频接口上补齐知梦素材能力，再扩展知梦 Seedance；保持 RollDek 旧入口和计费兼容。交付可评审的插件代码、回归测试、准确的能力清单和部署说明。文件上传及其他协议入口明确不做，线上部署不包含在本次交接授权中。

本轮进度：当前插件版本为知梦 1.1.1、RollDek 1.1.1、内置 Alibaba 保持 1.4.2。知梦 WAN3 普通参考图／音频及图音混合在 1.1.1 开放；Seedance c4／c5 是此前 1.1.0 阶段加入同一 `zhimeng` 插件的既有能力，本轮没有新增 Seedance 接入。此次复审修正提示词原文保留与空白校验、公共素材 HTTPS 校验，以及 Seedance 缺少 prompt 和成片 URL 的处理；WAN3 参考视频已接入供应商核验后的消费记录，详见第 3.3 节；不新增宿主生产改动，也不直接上线。详细验证、能力表和部署步骤见原方案第 3、6、7 节。

> 2026-10-18 范围收敛：按用户要求撤回内置百炼插件及其原测试的接入改动。下方历史实施记录中 Alibaba 1.4.4／1.4.5 和“三家严格统一校验”的描述仅为已撤回方案，不代表当前状态。当前仅更新知梦和 RollDek；三家候选测试继续使用未修改的内置百炼验证兼容性。

## 1. 已确定的边界

- 公共入口保持 `POST /v1/videos`、`GET /v1/videos/{id}`、`GET /v1/videos/{id}/content`，下载支持 HEAD 与 Range。
- 使用 JSON 和 HTTPS 素材 URL；插件只校验 HTTPS，素材还必须能被供应商公开抓取。公共参数为 `model`、`prompt`、`duration`、`resolution`、`ratio`；规范写法使用 `metadata.input.media`，高级参数使用 `metadata.parameters`，顶层 `media` 仅作为兼容写法。
- WAN3 公共模型为 `wan3.0-video`、`wan3.0-video-prime`，分辨率独立传递。通过同一分组调度符合请求能力的渠道，不静默丢参数；已创建任务仍由原渠道查询和下载。
- 插件按供应商组织，key 保持 `rolldek`、`zhimeng`、`alibaba`。Seedance 扩展同一个 `zhimeng` 插件，不新建每模型家族一个插件。
- 不做文件上传、对象存储、文件托管，以及新的公共或供应商原生协议入口；不扩展 `/v1/responses`。未来公共入口和文件处理属于宿主职责，插件只承担协议适配。
- 本轮不再新增宿主生产代码、插件 API／运行时、公共路由、重试、下载代理或核心计费逻辑；工作区已有的图片响应大小、内联图片处理及其测试／API 文档改动保持不动。此前视频防重复提交和完成用量异常诊断改动保持撤回，不再列入待办。第 5 节仅说明沿用现状的限制。
- 不修改现有服务、线上数据库、线上渠道、售价、全局重试设置或发布链接。可使用现有隔离 lab；先核实实例身份，不能把 lab 配置复制到线上。
- 用户要求节约费用。先做离线验证，真实生成只做最小必要用例；使用供应商允许的最短时长和最低合适画质。没有可用测试凭据时先完成离线部分，不重用会话历史中曾提供的临时 Key，不自行购买或充值。

## 2. 当前代码基线

| 项目 | 当前状态 |
| --- | --- |
| `zhimeng/plugin.js` | 1.1.1；参考视频计费支持见第 3.3 节；两个 WAN3 模型支持文生、首帧／首尾帧、普通参考图／音频及图音混合；此前已在同一插件支持 sd-2-c4／sd-2-c5；新增素材能力通过离线验证，待真实生成 |
| `rolldek/plugin.js` | 1.1.1；修正实际响应的 metadata.usage 读取，详见第 3.4 节；统一模型、旧后缀模型和 Banana 图片能力保留 |
| `plugins/tasks/alibaba/plugin.js` | 保持仓库基线 1.4.2；已撤回本次 WAN3 公共解码与版本修改，无需上传更新 |
| 统一规则 | 同义 size 已按画质和画幅归一化后比较，真实冲突仍拒绝；显式 false、seed 0 保留 |
| RollDek 参考视频结算 | 已删除未经证实的输入 15 秒／总量 30 秒限制。预扣复用旧入口估算及 URL 去重，完整实际用量替换估算，宿主安全上限继续生效 |
| 宿主提交重试 | 新增保护已撤回。原有 `RetryTimes=0` 只能全局关闭自动重试，不能同时提供失败后自动主备 |
| 验证 | 1.1.0 的相关四包、集中回归及 SQLite 3.50.4／MySQL 8.0.46／PostgreSQL 15.18 异步结算和 Seedance 模拟下载测试通过；1.1.1 素材回归与 1.1.2 本轮解码回归分别记录。既有 lab 未更新至 1.1.x，旧报告不覆盖新增能力 |
| 真实供应商测试 | 知梦仅执行过一次标准版、480P、2 秒、无素材直连测试，提交／轮询／成片／同源下载可用，完成响应有 seconds、没有 usage；未核对实际账单 |
| state／计费 | 新 state 冻结 model、duration、resolution、hasReferenceVideo；WAN3 保留 seconds／resolution 和旧价，Seedance 使用独立 video_count 按条 profile |
| 线上 | 未变更；此前集成验证使用模拟 HTTP 服务与临时数据库，本轮复审未新建数据库容器，新增真实付费生成 0 次。本交接不将线上视为已安装这些版本 |

开始前查看 `git status` 和当前源码，防止其他 session 又有更新。当前工作区包含用户原有改动与本轮实现，不能 reset、覆盖或把所有未提交改动都算作自己新增。尤其保留已有 RollDek Banana 和宿主图片响应改动。

原方案含分阶段历史记录，一些早期“未实现”描述已过时。以当前代码、最新实施／评审修复／宿主撤回记录和本交接范围为准；交付时同步清理状态矛盾，不再只向末尾追加记录。

## 3. 知梦 WAN3 素材进度及待验证项

### 3.1 首帧与首尾帧

1.1.0 已将“所有素材一律拒绝”改为接受首帧／首尾帧；1.1.1 又单独开放普通参考图／音频，仍保留帧与普通参考混用校验和参考视频计费保护，不是所有类型无校验透传。

已实现并通过离线回归：

1. 支持单个 `first_frame` 和 `first_frame` 加 `last_frame`。单独尾帧、重复首尾帧、首尾帧与普通参考素材混合，均在选渠道前拒绝。
2. 保持公共数组顺序和素材角色，按知梦要求发到 `metadata.input.media`。沿用 prompt 必填，不自动编造提示词。
3. 解码、构造请求、提取用量使用一致的归一化结果，反复解码稳定且不修改输入；高级参数 false 和 seed 0 保留。
4. 提交时根据实际素材计算并持久化 `hasReferenceVideo`，不再依赖硬编码 false；模型、时长、画质冻结保存，进行中轮询覆盖 task.data 后 state 仍保留。
5. 无参考视频任务继续沿用固定时长用量规则，旧 WAN3 state 没有新增 model 字段时仍兼容。真实素材完成后的 seconds 含义及响应形状待核验，不能把 MP4 容器时长当供应商账单。

离线已验证：有效帧请求保留知梦候选，非法组合在提交前失败，URL／角色／原数组顺序完整发送；旧文生、缺失／非法用量保留预扣、失败退款和重复完成不重复扣退保持正确。真实素材任务的生成、最终查询、同源下载与消费记录仍待新的有效测试 Key 和公网素材，不以历史无素材直连样本代替。

### 3.2 普通参考图、音频及混合素材

用户已要求直接开放，不再以不同文档的提示词示例写法作为候选筛选门槛。1.1.1 已接受普通参考图、参考音频及二者混合：

- 公共类型保持 `reference_image`、`reference_audio`，分别最多 10 张、5 段；只使用 HTTPS URL，且必须能被供应商公开抓取。参考视频另受第 3.3 节约束，不随本次开放。
- 素材按客户端数组原序发送，同类出现顺序及重复 URL 全部保留，不分组、排序或去重。prompt 原文不做“图1”／“视频1”／“音频1”／“@1”替换。
- 输出 `metadata.parameters.audio` 与输入参考音频独立，`audio: false` 不删除参考音频；false、seed 0 仍完整转发。
- 首帧／首尾帧不能与普通参考混用，单独尾帧、超限素材和供应商 `reference_voice` 别名仍拒绝。
- 图音参考不另加计费数量，继续按输出 seconds 和冻结画质结算。没有新增价格、参考视频零输入假设或计费逻辑。

离线回归覆盖两个 WAN3 模型、多图／多音频／交错混合、重复 URL、10 图＋5 音频上限及越界拒绝、重复解码、原数组和 prompt 不变、候选筛选及输出用量不变。不声称已经完成真实知梦素材生成或跨供应商语义等价验收。

### 3.3 参考视频及输入时长计费（2026-10-18 更新）

线上复测修正：1.1.0 的账单路径误写为带尾斜杠的 `/api/log/token/`，供应商返回 301 到 `/api/log/token`。Python 实测自动跟随重定向，插件 `utils.fetch` 则不跟随，导致提交前失败。1.1.1 改用无尾斜杠的规范路径；已在供应商接口禁用重定向验证 HTTP 200，并在既有生命周期测试中模拟旧路径 301。此修正不改变预扣、结算或数据库逻辑。

知梦插件 1.1.0 已实现参考视频及图／音／视频混合参考，代码和回归验证已完成，尚未上传或激活到线上。503 的错误返回链路按用户要求不处理。

实际用量来源已经核实：使用渠道令牌调用供应商 `GET /api/log/token`，按上游 `task_id`、模型和消费类型匹配记录，读取 `other.reference_video_charge.seconds`、`resolution` 和 `video_count`。仅使用数量，不使用金额反推秒数，不修改已有价格表达式。供应商任务查询的顶层 `seconds` 仍只表示输出计费时长。

- 提交前检查账单接口可访问；按 `min(输出秒数 + 15, 30)` 预扣。参考视频由供应商下载并核验，客户端提交的媒体时长字段被拒绝。
- 最多 5 个参考视频项，素材原序和重复 URL 均保留。供应商对相同视频 URL 去重计费，插件信任其核验后的数量，不自行按数组累加。
- 从首次可取得的供应商消费记录保存输入时长到私有 plugin state，避免任务完成时记录已滚出最近记录窗口；同一次轮询直接完成也能使用返回的新 state。
- 最终 `seconds` 为实测输入加输出；核验正数、输入最多 15 秒、总量最多 30 秒、画质、任务 ID 和视频数量。
- 缺失、非法或冲突的账单保留预扣，私有 state 写入 `referenceVideoBillingError`；非终态后续轮询会重查。任务完成后不会自动重查缺失账单，需要人工对账。这是当前账单接口仅提供最近记录的限制。
- 生成失败沿用宿主退款；已生成成功的视频不会因账单读取失败被错误退款；重复完成不会重复扣退。
- 未修改宿主生产代码、插件 API、数据库结构或已保存价格。元数据仍使用“视频生成单价”，计费单位为 second。

真实供应商验证（普通模型、480P、输出 2 秒；直接上游测试，未经过线上新插件）：

| 任务 | 结果 | 核验后的输入 | 计费总秒数 | 供应商 quota |
| --- | --- | --- | --- | --- |
| `task_pwmpPtxXUvVWVzUldA6ThchLvCexT5KQ` | completed | 3.019 秒、1 个视频 | 5.019 | 627375 |
| `task_fAffkj1CPnoW10bTDt6DaElPE7Nhtx7y` | completed | 同 URL 提交两次，仅计 2.02 秒、1 个视频 | 4.02 | 502500 |

两笔最终状态均已核对为 completed。供应商日志价格显示标签与文档币种不一致，因此此处只记录原始 quota 和秒数，不做币种换算。

验证命令和结果：

- `go test ./plugins -run 'Test(WAN3|Zhimeng)' -count=1`：通过；覆盖混合素材原序、重复解码、上限预扣、任务／画质匹配、小数用量、缺失／非法／重复账单、前置查询失败、输入时长注入、首次完成和私有 state 复用。
- `go test ./plugins ./relay/channel/task/jsplugin ./controller -count=1`：三个包均通过。
- `go test ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1 -v`：分别在 SQLite 3.50.4、MySQL 8.0.46、PostgreSQL 17.10 通过。后两次设置 `TEST_TASK_DB_DIALECT=mysql` / `postgres` 及相应 `TEST_MYSQL_DSN` / `TEST_POSTGRES_DSN`，使用独立临时容器和唯一表前缀，未使用 lab、dev 或线上数据库。
- 三库集成覆盖预扣到实际用量的差额、账单窗口滚出后的 state 持久化、首次轮询完成、缺失用量保留预扣、失败退款和重复完成不重复扣退。没有数据库模型或迁移变更。

公开规则依据：[知梦 WAN3 文档](https://zhimengapi.pages.dev/video/wan3)。`reference_video_charge` 来自上述实际账单响应，公开文档尚未声明该字段；上线前需接受对该供应商账单接口的依赖。线上仍是旧插件，参考视频仍被拒绝。

### 3.4 RollDek 实际用量响应修正（2026-10-18）

实际查询历史任务及一次最小参考视频生成，确认用量位于 `metadata.usage`，旧实现仅读取顶层 `usage`，因此漏掉完成用量。1.1.1 同时修正公共模型和旧分辨率后缀模型，保留顶层兼容及优先级，不合并两个位置的部分字段。视频模型继续按输入加输出结算，旧 image 后缀模型仅按输出结算；没有修改价格、预扣规则、宿主生产代码或数据库结构。元数据“视频生成单价”与单位 second 保持符合插件 API 约定。

真实上游任务 `task_hzDr62oV2DdL8rvxKmwbaSR40hu0Dezb` 已 completed：`wan3.0-video-480p`，请求输出 2 秒，返回 `metadata.usage.input_video_duration=3`、`output_video_duration=2`、`duration=5`。此次直连用于核实供应商，不代表修正版已经部署到 New API。任务响应总量为 5 秒，而相邻消费记录展示 5.02 秒；该记录没有任务 ID 或结构化输入时长，不能可靠套用知梦账单匹配。插件采用任务响应的明确用量，不从金额反推秒数，供应商精度差异仍存在。

本次执行的验证：

- `go test ./plugins -run 'Test(WAN3|RollDek|Zhimeng)' -count=1`：通过，覆盖真实嵌套结构、小数、顶层兼容及优先级、缺失／不完整／非法用量和新旧模型。
- `go test ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1 -v`：SQLite 3.50.4 通过；同命令设置 `TEST_TASK_DB_DIALECT=mysql`、`TEST_MYSQL_DSN` 后在 MySQL 8.0.46 通过；设置 `TEST_TASK_DB_DIALECT=postgres`、`TEST_POSTGRES_DSN` 后在 PostgreSQL 17.10 通过。凭据仅从临时私有配置加载。
- 生命周期测试改为模拟 RollDek 的真实 `metadata.usage` 结构，验证预扣差额结算、缺失用量保留预扣、失败退款和重复完成不重复扣退。MySQL、PostgreSQL 使用独立临时容器，未连接 lab、dev 或线上业务库。
- `git diff --check`：通过。

供应商规则依据：[RollDek WAN3 Markdown 文档](https://www.rolldek.com/docs/wan3.md)。用量嵌套位置来自实际响应。待用户上传并激活 `rolldek/plugin.js` 1.1.1 后继续真实链路测试。

## 4. Seedance 进度与其他限制

### 4.1 在同一个知梦插件接入 Seedance

已在 WAN3 首尾帧主线之后独立实现，通过离线适配和集成测试，未进行真实供应商生成。模型在插件元数据中声明，但本轮没有将其加入任何生产渠道或安装至既有 lab。

- 已支持知梦公布的 `sd-2-c4`、`sd-2-c5`，不等同于其他渠道或官方 Seedance 型号。
- 公共仍用 `/v1/videos` 和既定参数布局。知梦 Seedance 上游只接受顶层 `model`、`input`、`parameters`：prompt／media 放 input，duration／resolution／ratio 放 parameters。
- 独立默认 5 秒／720P／16:9，支持 4–15 秒整数、720P；c4 画幅为 16:9／9:16／1:1，c5 另支持 4:3／3:4／21:9；不继承 WAN3 的 1080P／adaptive 或高级参数。
- 公共 `reference_audio` 在 Seedance 驱动中转换为上游 `reference_voice`；WAN3 的公共别名拒绝规则不因此取消。素材数量和组合按 Seedance 文档单独校验。
- 已按模型选择独立 `usageProfiles`：Seedance `video_count: 1` 按条，WAN3 仍为 seconds／resolution。旧按次路径不乘视频时长；表达式可用 `tier("base", u("video_count") * P)`，P 是管理员确定的美元每条售价，不能使用 `fixed()`，不自动改已有售价。
- 已复用任务状态和错误处理；Seedance 从最新成功快照选择直链，使用宿主现有 credentialless 描述，不携带任何请求头。GET／HEAD／Range 与凭据不外传已用 HTTP 模拟服务验收；未假定 Seedance `/content` 存在，真实成片可达性及有效期仍待验证。
- 图片总计最多 9 张（含帧），视频／音频各最多 3 段，总计 15 项；帧各最多 1 张，尾帧必须有首帧。按 Seedance 文档单独校验，不沿用 WAN3 的帧／普通参考混用禁令。素材顺序和重复 URL 完整保留，公共音频只在发往上游时转换为 reference_voice。
- 已验证 profile 隔离、WAN3 老 state／查询／结算兼容、旧定价及 Seedance 成功／失败／重复轮询行为；未适配的其他模型不加入声明。新增能力在真实验收前不加入生产渠道列表。

### 4.2 RollDek 高级参数、更多画幅和自动时长

这些是待确认能力，不保证供应商一定支持。核对供应商文档或取得明确响应证据后再扩展：

- RollDek 的 `audio`、`seed`、`prompt_extend`、`watermark` 及 `4:3`、`3:4` 目前仍拒绝；未确认支持前保持候选筛选，不静默忽略。
- 知梦与 RollDek 的自动时长目前未开放。只有确认模型支持且能以实际用量结算后，才考虑声明宿主自动时长 capability；否则保持百炼独有能力。
- 缺少供应商能力时由其他支持的候选承接。这属于正确的能力限制，不为追求“全部通过”强行透传。

## 5. 宿主保持原样

用户已明确要求不改宿主。以下事项不实施、不恢复、不作为本轮验收必须补齐的功能；插件只使用宿主现有能力，不能通过隐式网络调用绕过宿主提交和计费流程。遇到确实依赖新增宿主能力的功能，保留关闭状态并说明限制，继续其他插件工作。

| 事项 | 保持的行为与限制 |
| --- | --- |
| 提交不确定时防重复生成 | 沿用既有重试行为，不恢复新增保护；不能宣称有重试预算时具备安全自动主备 |
| 下载失败后切换直链 | 沿用现有下载代理；供应商 `/content` 请求失败后不新增自动直链回退 |
| 完成用量异常诊断 | 沿用当前结算和日志行为，不恢复新增诊断调用 |

若部署采用原有 `RetryTimes=0`，必须说明这是实例全局设置，会关闭其他请求重试和失败后的自动主备。隔离 lab 已按该方式验证，不意味着线上已采用。本轮不得自行修改线上全局配置。

## 6. 测试与交付

### 开始前

完整阅读仓库 `AGENTS.md`、Task Plugin API v1、计费规则和表达式说明。插件涉及凭据传输时遵循仓库要求核对适用 OWASP 指引。本轮不新增前端、数据库迁移或插件 API 类型，不修改宿主契约。允许扩展现有测试以验证插件与宿主现有接口的集成，不借测试之名修改宿主生产行为。

优先扩展 `plugins/wan3_channels_test.go`、`plugins/rolldek_test.go`、`plugins/alibaba_responses_test.go` 和 `controller/relay_task_plugin_test.go` 中合适的现有用例，不按调用层重复铺设测试文件。

### 必须保留的回归

- 新旧 RollDek 入口分别运行；公共型号只在上游请求体拼后缀，不通过 rewriteModel 改任务计费身份。
- 参考视频估算按旧规则去重；模拟用量 16＋2→18、16＋20→36 正确结算。不得重新引入其他供应商的 15／30 秒限制。
- 同义 size、像素 size 与画质档位可共存；实际冲突拒绝，重复解码结果稳定。
- 候选过滤在提交前完成；不支持参数的渠道不会被选中。知梦新增素材支持不能误改百炼、RollDek 的能力。
- 成功、失败、缺失用量、非法用量及重复完成的扣退行为正确，冻结画质和表达式保持一致。
- 下载、日志和持久化 state 不泄露渠道 Key；外部成片直链不携带凭据。
- 数字用量字段描述是“计费对象＋单价”，例如 `Video generation unit price`／`视频生成单价`；单位放 unit。描述人工审查，不能以测试通过代替。

建议先运行相关用例，再运行受影响包；命令按实际改动缩放：

```bash
go test ./plugins ./controller ./relay/channel/task/jsplugin ./middleware -run 'WAN3|Wan3|AlibabaWan|RollDek|Zhimeng|VideoSubmitWithoutRetries' -count=1
go test ./plugins ./controller ./relay/channel/task/jsplugin ./middleware -count=1
git diff --check
```

涉及异步结算时运行 `TestWAN3AsynchronousLifecycle`；涉及数据库行为必须按仓库规则使用真实 SQLite、MySQL、PostgreSQL 验证，不能只引用之前 session 的结果。对实际并发改动运行合适的 race 测试。

现有 lab 位于忽略目录 `data/tokenone-lab/wan3-lab/`，历史报告包括 `test-report.json`、`review-report.json`、`withdrawal-report.json`；容器名 `codex-wan3-lab`。使用前确认当前二进制、插件版本、网络隔离及配置，不假设旧报告对应最新代码。不要把私有 credentials 文件内容复制进交接、日志、提交或最终回答。

### 本轮验证与后续交付

本轮集中回归、受影响包测试、根模块构建及 diff 检查结果见 `WAN3_CHANNEL_INTEGRATION_PLAN.md` 的 2026-10-18 复审记录。三数据库历史版本、脱敏命令和结果保留在此前实施记录；本轮没有改数据库行为，也没有声称重跑数据库矩阵。

待真实验收能力：WAN3 两模型首帧／首尾帧、普通参考图／音频及图音混合，以及 Seedance 两模型的文生、首尾帧、普通／混合参考、真实直链下载和按条消费记录。未开放能力：WAN3 参考视频可信输入结算，RollDek 未公开高级参数／更多画幅，知梦及 RollDek 自动时长。creative 调用旧 RollDek 可正常生成视频是用户确认的既有链路基线，不扩大表述为知梦实测。继续遵守以下交付约束：

1. 插件版本更新、代码差异及集中回归测试。
2. 按模型和素材类型列出“已实现并验证／已实现待真实验证／未开放及原因”。模拟用例通过不能写成供应商实测通过。
3. 记录实际运行的命令、结果、必要时的数据库版本；真实生成记录次数、参数和费用证据，不写 Key 或可用签名 URL。
4. 同步原方案中的过时状态和能力表，参考资料保留在最后章节。
5. 准备具体部署步骤：插件安装／升级、渠道绑定、同组模型列表、正式售价及旧客户端参数变化。部署前保留已有任务的插件和原渠道查询下载能力；本交接不授权直接上线。
6. 对无法完成的供应商验证写清缺少什么字段、资料或测试条件，继续完成不依赖该条件的任务，不虚构能力或账单。

## 7. 参考资料

| 资料 | 用途 |
| --- | --- |
| [原 WAN3 接入方案](WAN3_CHANNEL_INTEGRATION_PLAN.md) | 总体设计、历史验证和最新宿主撤回记录 |
| [知梦 WAN3 文档](https://zhimengapi.pages.dev/video/wan3) | 素材、参数、状态和计费说明 |
| [知梦 Seedance 文档](https://zhimengapi.pages.dev/video/sd) | 后续模型、请求结构、素材类型及按条计费 |
| [RollDek WAN3 文档](https://www.rolldek.com/docs/#/wan3) / [Markdown 原文](https://www.rolldek.com/docs/wan3.md) | 旧模型兼容、参考视频计量和下载 |
| [百炼 WAN3 官方文档](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference) | 官方模型与能力；不将其限制自动套给第三方供应商 |
| [知梦插件](zhimeng/plugin.js) / [RollDek 插件](rolldek/plugin.js) / [百炼插件](plugins/tasks/alibaba/plugin.js) | 当前实现与能力拒绝位置 |
| [Task Plugin API v1](docs/plugin-api/v1.md) / [类型](docs/plugin-api/v1.d.ts) / [Schema](docs/plugin-api/v1.schema.json) | 宿主协议、持久化 state、下载和用量契约 |
| [计费规则](.agents/rules/billing.md) / [表达式说明](pkg/billingexpr/expr.md) | 必读约束、预扣、结算和定价单位 |
| [集中插件回归](plugins/wan3_channels_test.go) / [异步链路测试](controller/relay_task_plugin_test.go) | 后续测试优先扩展位置 |
| [宿主任务提交](relay/relay_task.go) / [重试决策](controller/relay.go) | 当前仍沿用的重试路径 |
| [插件适配器](relay/channel/task/jsplugin/adaptor.go) / [内容代理](controller/video_proxy.go) | 用量验证、下载描述和回退边界 |

供应商参数以实施时复核的文档和真实证据为准。本交接不包含凭据，也不要求重新执行所有收费组合。
