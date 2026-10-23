# WAN3 多渠道统一接入方案

更新日期：2026-10-18（Asia/Shanghai）

> 发布版本校正：当前交付版本为知梦 1.0.0、RollDek 1.1.0。下文历史记录中的知梦 1.1.x、RollDek 1.2.x 是本地开发阶段编号，不代表正式发布序列。本次仅调整版本元数据，不改变功能，也未部署到 lab 或线上。

状态：知梦 1.0.0、RollDek 1.1.0、内置 Alibaba 保持 1.4.2；本轮复审修正提示词原文保留与空白校验、公共素材 HTTPS 校验，以及 Seedance 缺失提示词和成片 URL 的处理，不新增 Seedance 功能。Seedance 已在先前知梦 1.1.0 阶段接入，同插件模型为 sd-2-c4／sd-2-c5；WAN3 参考视频仍未开放，待可信输入计费用量。真实生成与账单仍待验收；本轮未新增宿主、线上或既有 lab 改动，工作区已有宿主图片响应改动保持不动，详见第 3、6、7 节

以 New API 内置 Alibaba Bailian 插件的 WAN3 模型名、公共请求格式和用量字段为统一约定。新增知梦插件，并给现有 RollDek 插件增加统一模型入口，使渠道可以在同一分组中提供 WAN3 服务。

RollDek 保留旧模型入口及已有定价，新入口单独适配。百炼内置插件保持仓库原状，不增加公共解码校验，也不要求上传更新。本方案不要求购买或配置百炼官方渠道，有官方渠道时可加入同组。知梦的两个 Seedance 模型单独声明，不与 WAN3 或其他厂商的 Seedance 型号混同。

> 2026-10-18 范围收敛：按用户要求撤回内置百炼插件及其原测试的接入改动。下方历史实施记录中 Alibaba 1.4.4／1.4.5 和“三家严格统一校验”的描述仅为已撤回方案，不代表当前状态。当前仅更新知梦和 RollDek；三家候选测试继续使用未修改的内置百炼验证兼容性。

## 1. 统一模型与入口

实施完成后，对新客户端只发布一套调用规范：同一网关地址、同一组创建/查询/下载接口、同一套模型名和参数结构。客户端不需要指定供应商，也不需要随渠道切换修改请求；各插件负责上游协议转换，同一分组负责选择符合请求能力的渠道。查询和下载始终跟随任务创建时使用的渠道。

统一接口不代表各供应商能力完全相同。特殊参数只允许路由到能完整支持的渠道；没有符合条件的可用渠道时明确报错，不能静默删除参数。旧 RollDek 模型名及百炼专属入口保留兼容，但不作为新的统一接入文档中的另一套推荐调用方式。以下公共转换与候选筛选已实现，供应商真实验证范围见第 6 节。

统一对外提供两个模型：

- `wan3.0-video`
- `wan3.0-video-prime`

画质通过 `resolution` 指定，取值为 `480P`、`720P`、`1080P`。两种模型分别定价，每种模型包含三个画质档位。官方模型名称和画质参数定义见[百炼官方文档](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)。

公共入口使用宿主协议 `openai_video`：

| 操作 | 网关接口 |
| --- | --- |
| 创建任务 | `POST /v1/videos` |
| 查询任务 | `GET /v1/videos/{task_id}` |
| 下载成片 | `GET /v1/videos/{task_id}/content`，并兼容 `HEAD` |

`/ali/api/v1/...` 属于百炼插件专属原生入口，不作为三家共享路由。百炼现有 `/v1/responses` 能力也不自动扩展到另外两个插件；第一阶段只统一 `/v1/videos`，不复制注册宿主已拥有的 URL。

### 公共请求示例

```json
{
  "model": "wan3.0-video",
  "prompt": "小猫在窗边眨眼",
  "duration": 2,
  "resolution": "480P",
  "ratio": "16:9"
}
```

以下首帧结构已通过知梦、RollDek、百炼公共解码回归，URL 是占位符；知梦首帧真实生成仍待验证：

```json
{
  "model": "wan3.0-video",
  "prompt": "人物缓缓转头，镜头保持稳定",
  "duration": 2,
  "resolution": "480P",
  "ratio": "16:9",
  "metadata": {
    "input": {
      "media": [
        {
          "type": "first_frame",
          "url": "https://example.com/start.jpg"
        }
      ]
    }
  }
}
```

以 `ratio` 作为公共画幅字段；三个 WAN3 公共解码器也已统一接受 `aspect_ratio` 别名并拒绝冲突。素材规范写法使用 `metadata.input.media`，顶层 `media` 仍作为兼容写法；附加生成参数使用 `metadata.parameters`，具体由各插件验证是否支持。

这里的统一规范是 New API 的 WAN3 接入约定，不承诺所有 OpenAI 视频 SDK 的参数、文件上传、编辑或其他操作均可直接使用。首期公共创建请求采用 `application/json`；百炼现有 multipart 支持不等于三家公共支持。知梦和 RollDek 素材 URL 校验为 HTTPS，但公网可抓取性由供应商侧决定；百炼保留原有校验。

WAN3 新统一入口的缺省行为对齐现有百炼插件：5 秒、1080P、`adaptive`。客户端示例和测试始终显式填写这三项，避免意外采用高画质或不同默认值。旧 RollDek 入口继续按原有规则运行。

### 参数对齐表

下表记录当前 WAN3 公共入口；Seedance 的独立规则见下文。文档未列出某参数表示尚无支持依据，不等于已经证实供应商拒绝该参数。

| 参数 | 百炼现有公共入口 | 知梦上游 | RollDek 上游与现有插件 | 统一方案 |
| --- | --- | --- | --- | --- |
| `model` | 无画质后缀的两个模型 | 同名 | 上游需要画质后缀；插件同时保留新旧入口 | RollDek 公共分支按最终归一化的画质拼接后缀，不改任务身份 |
| `prompt` | 可来自顶层或 `metadata.input.prompt`；WAN3 有素材时可以省略 | 文档要求非空顶层字符串 | 文档及插件要求非空顶层字符串 | 默认使用顶层；纯素材无 prompt 的请求排除知梦和 RollDek 候选 |
| `duration` / `seconds` | 数值或数值字符串，冲突拒绝 | 文档规定 2–30 秒整数 | 公共入口 2–30 秒，旧入口不改 | 知梦发送整数 duration，RollDek 发送字符串 seconds |
| `resolution` | 支持顶层及 `metadata.parameters.resolution` | 独立画质字段，支持大小写归一化 | 后缀强制覆盖请求画质 | 新入口统一大写画质后再映射；旧后缀入口保留原规则 |
| `size` | 支持画质档位和已知像素尺寸，例如 `1280x720` | 文档只承诺画质档位别名 | 作为画质字段且受后缀覆盖 | 在网关按百炼现有尺寸表解析为画质及可推导画幅，不直接透传像素字符串 |
| `ratio` / `aspect_ratio` | 公共入口接受两个别名，冲突拒绝 | 支持两者和嵌套 ratio；另有 auto 别名 | 支持两者；范围较窄 | 公共字段为 ratio，auto 归一为 adaptive；按候选实际画幅筛选 |
| `metadata.input.media` | 已读取 | 首帧／首尾帧、普通参考图／音频及图音混合 | 公共分支按原顺序转换为 `input.media` | 角色、顺序、重复 URL 和 prompt 保留；知梦参考视频仍因计费用量缺口拒绝 |
| `audio` | 顶层或嵌套参数，必须布尔值 | 嵌套 audio；顶层兼容名为 generate_audio | 文档未声明，现有构造器未发送 | 公共使用嵌套 audio；未确认支持前排除 RollDek，不能丢弃 false |
| `seed` / `prompt_extend` / `watermark` | 顶层或嵌套参数 | 嵌套参数 | 文档未声明，现有构造器未发送 | 显式传入时仅选择能完整传递的候选；零值和 false 保留 |
| `reference_voice` | 当前不在媒体类型枚举中 | reference_audio 的兼容别名 | 当前不在媒体类型枚举中 | 公共只使用 reference_audio；不宣称知梦专用别名天然跨渠道兼容 |
| `image` / `images` / `input_reference` | 当前 WAN3 公共分支拒绝；其他既有入口另行处理 | 所给文档未承诺这些快捷字段 | 与现有 reference_images 写法不同 | 使用统一素材数组；快捷字段不能在共享入口中静默丢弃 |

供应商参数依据：[知梦请求参数](https://zhimengapi.pages.dev/video/wan3)、[RollDek 请求参数](https://www.rolldek.com/docs/#/wan3)。百炼公共参数以项目 `convert` 和 `protocols.openai_video.decodeRequest` 为准。

### 参数归一化与冲突规则

1. 知梦和 RollDek 的 WAN3 公共解码器遵循以下公共规则，并在候选筛选前完成；百炼保留既有字段优先级和校验时机，不承诺三家对冲突请求行为一致；上游请求构造和用量提取必须使用同一份归一化结果。
2. 时长、画质、画幅、prompt 及可配置布尔参数在多个受支持位置出现时，归一化后相同可接受，不同则在提交前拒绝。不要依赖供应商覆盖顺序解决冲突。
3. `duration: 2` 加 `seconds: 3`，或顶层 2 秒/480P 加嵌套 7 秒/720P，三个公共解码器均已拒绝。旧 RollDek 入口不随之改行为。
4. 公共调用以文中的单一写法为准。供应商专用别名 `generate_audio`、`reference_voice` 不属于首期公共契约；共享入口应明确拒绝或在所有候选中先统一转换，不能只让某一家识别。方案首期采用明确拒绝，提示使用公共字段。
5. 已知像素 size 可推导画质和画幅；推导值与显式值冲突时拒绝。`auto` 画幅别名统一成 `adaptive` 再筛选。非法枚举、空白数字、非有限数字、错误布尔类型不能静默回退默认值。
6. 素材只使用一个入口。新公共分支不合并混用的 `metadata.input.media`、顶层 media、`input.media` 和 `reference_*`；出现多份素材源时要求客户端保留一份，以免重复生成或引用错位。百炼已有单一顶层 media 快捷写法可在一致转换后兼容。
7. 未列入支持范围的生成参数，在对应候选解码器中明确拒绝；嵌套 input、parameters 也要检查，不能通过透传绕过。百炼独有但已支持的扩展参数可保留为百炼能力，由其他候选拒绝。普通业务 metadata 若允许保留，应明确其仅用于记录，不当作上游生成参数。
8. 渠道映射不能把新公共模型固定映射到某个画质后缀，否则会破坏动态画质选择；第一阶段不为这两个模型配置此类映射。

这里的“统一默认值”只覆盖时长、画质、画幅。百炼现有构造器会默认写 `prompt_extend: true`，知梦文档表示相关可选参数省略时交由上游决定，RollDek 未说明该参数；不能承诺省略所有高级参数时三家生成效果相同。显式高级参数必须转换并保留，否则该候选退出。

## 2. 各插件的适配职责

### Alibaba Bailian

保留内置 `alibaba` 插件的上游驱动。它已经声明两个统一模型，并把公共请求转换为百炼原生的 `model`、`input`、`parameters`。

其 WAN3 用量结构已经是 `seconds` 与 `resolution`，可作为其他插件的对齐目标。无需把知梦或 RollDek 的供应商分支加入百炼插件。

已撤回为本次接入添加的百炼公共解码器和版本变更，内置插件及原测试恢复仓库基线。百炼的 `duration: 31` 仍由既有上游请求构造校验拒绝，不保证在候选筛选阶段排除。

百炼既有冲突字段覆盖顺序、素材协议和入口行为保持不变。新插件以无冲突的规范请求对齐，不为统一新渠道而收紧内置插件。

### 知梦

新增独立插件，建议 key 为 `zhimeng`，默认 Base URL 为 [知梦 API 服务地址](https://movie.zmoapi.cn)，不含 `/v1`。使用类型 61 的 Task Plugin 渠道绑定该插件。

主要实现内容：

- 声明两个统一模型和 `openai_video` 协议，不占用百炼的渠道类型 17。
- 接受公共字段，将最终画幅写为 `aspect_ratio`，时长写为整数 `duration`，画质写为 `resolution`，素材写为 `metadata.input.media`；去掉重复别名。高级参数写入 `metadata.parameters`。
- 实现创建、查询、状态解析和宿主公共响应呈现。
- 优先读取 `content.url`，按已确认格式兼容其他成片 URL 字段。
- 下载优先构造渠道 Base URL 下的 `/v1/videos/{id}/content`，该路径已实测可用；如选用成片直链，使用宿主支持的 `credentialless: true` 下载描述，且不设置请求头或请求体；由宿主处理 Range 等客户端下载头。本次返回的 `content_url` 指向另一个域名，不能把它直接当成可携带渠道 API Key 的地址。
- 无参考视频的成功任务，在校验后把顶层 `seconds` 转换为内部计费用量；缺失的画质沿用提交时冻结的值。

当前宿主只在无法取得插件下载描述时回退到结果 URL，不会在已请求供应商 `/content` 并收到错误后自动切换直链。因此首期以已验证的同源 `/content` 为主，不承诺网络错误时自动切换；直链下载如需启用，须单独验证描述选择、失效处理和 GET/HEAD/Range 行为。

按[知梦文档](https://zhimengapi.pages.dev/video/wan3)校验参数；未验证或不支持的功能在解码阶段排除该插件候选，不能先提交再依靠上游报错筛选。

### 知梦后续模型扩展

插件按供应商组织：稳定 key 为 `zhimeng`，1.1.0 在同一插件增加 `sd-2-c4`、`sd-2-c5`，不另建模型家族插件。既有渠道绑定与历史 WAN3 任务继续使用相同 key。

知梦 Seedance 文档中的 `sd-2-c4`、`sd-2-c5` 与 WAN3 共用 Base URL、Bearer 鉴权以及 `POST /v1/videos`、`GET /v1/videos/{task_id}`，适合复用连接、任务状态处理和公共响应框架。相同 URL 不代表相同请求结构：Seedance 上游顶层只接受 `model`、`input`、`parameters`，需要单独的模型转换和参数校验，不能复用 WAN3 请求体直接透传。

Seedance 已使用同一宿主 `openai_video` 公共布局，并单独转换为上游 `model`、`input`、`parameters`。默认 5 秒、720P、16:9；仅支持 4–15 秒整数、720P。c4 支持 16:9、9:16、1:1；c5 另支持 4:3、3:4、21:9。prompt 必填，去空白后最多 10000 个 Unicode 字符。未公开的 audio、seed、watermark、prompt_extend 和自动时长均拒绝，不套用 WAN3 默认值或高级参数。

Seedance 独立 profile 为 `video_count`（`count`），每次提交和成功完成均为 1；旧按次定价不再乘时长，表达式使用 `tier("base", u("video_count") * P)`，其中 P 是管理员确定的美元每条售价。WAN3 的 `seconds`、`resolution` schema 及旧表达式不变。不配置内置价格，不自动修改任何已保存售价。

保留知梦公布的模型名，不与其他渠道或官方 Seedance 共用身份。公共素材仍使用 `reference_audio`，仅在 Seedance 上游构造时转换为 `reference_voice`；公共别名拒绝规则不变。图片合计最多 9 张（含首尾帧），视频、音频各最多 3 段，数组最多 15 项；尾帧须有首帧，各帧最多 1 张，不沿用 WAN3 的帧与普通参考混用禁令。完整保留数组顺序、重复 URL 与 prompt 原文，不承诺跨供应商引用语法等价。

Seedance 未假定 `/content` 可用：从最新成功查询快照选择成片直链，返回宿主已有的 `credentialless: true` 描述，无请求头和请求体；GET、HEAD、Range 与凭据不外传已用模拟服务验证，真实可达性和链接有效期仍待供应商验证。宿主下载上下文不包含模型字段，因此新任务把模型身份存入 `state.model`；旧 WAN3 state 没有该字段时仍走原同源 `/content`。

同一知梦渠道可以启用插件支持的多个模型；如需分别配置分组、权重、密钥或启停，可建立多个渠道并绑定同一个 `zhimeng` 插件。只有后续能力需要独立发布维护、运行隔离或插件接口无法容纳时，再评估拆分插件。

### RollDek

扩展现有 `rolldek` 插件，保持 key `rolldek` 和显示名称 RollDek 不变，新增两个统一模型入口。新入口按请求画质决定上游实际模型：

| 公共模型 | 画质 | RollDek 上游模型 |
| --- | --- | --- |
| `wan3.0-video` | `480P` | `wan3.0-video-480p` |
| `wan3.0-video` | `720P` | `wan3.0-video-720p` |
| `wan3.0-video` | `1080P` | `wan3.0-video-1080p` |
| `wan3.0-video-prime` | `480P` | `wan3.0-video-prime-480p` |
| `wan3.0-video-prime` | `720P` | `wan3.0-video-prime-720p` |
| `wan3.0-video-prime` | `1080P` | `wan3.0-video-prime-1080p` |

该转换依赖请求参数，需在插件内部完成，不能只配置静态模型映射。渠道分发、日志和对外响应保留公共模型身份；只在上游请求体中使用 RollDek 模型名。不要通过请求描述顶层 `rewriteModel` 或渠道映射把任务身份改为旧后缀模型，否则宿主可能选中旧用量 schema，失去新入口的 resolution 字段。需要留存实际发送型号时写入插件 state。

公共素材数组优先转换为 RollDek 支持的 `input.media`。如沿用现有归一化函数拆分为 `reference_*`，必须用逐项断言证明角色、同类素材顺序和重复 URL 行为未改变。提示词原文不做“图1”“视频1”“@1”替换；按用户最新要求，不再把引用示例写法不同作为知梦图音参考的关闭条件。RollDek 上游格式参考其 [WAN3 文档](https://www.rolldek.com/docs/#/wan3)。

新增模型不能只扩展 `meta.models` 或 `profile` 的正则：原 `normalize` 不读取公共 metadata，且当前完成用量逻辑也会调用 `profile(task.upstreamModel || task.model)`。新入口需要贯通解码、上游模型选择、预扣、后台完成用量和旧任务兼容，不能在提交成功后因无后缀模型名导致结算钩子失败。

新增统一模型的用量 profile 包含 `seconds` 和 `resolution`；原有带后缀模型继续沿用现有用量 schema 和定价。`wan3.0-image-*` 等旧模型保留，不在本次迁移中改名或映射到知梦；Banana 图片能力也不属于本次改造范围。

## 3. 能力边界与结果呈现

同一模型名表示共同服务入口，不代表供应商支持完全相同的参数。每个候选插件应验证自身能否完整表达请求，不能静默丢弃用户要求。

| 请求能力 | 当前状态 |
| --- | --- |
| WAN3 固定时长文生视频 | 三方适配及回归已完成；知梦仅标准版 480P、2 秒有一次真实样本，未核对账单 |
| WAN3 首帧、首尾帧 | 知梦 1.1.0 首次实现，当前 1.0.0 通过离线验证，待真实素材生成；非法组合在选渠道前拒绝 |
| WAN3 普通参考图、音频及图音混合 | 知梦 1.1.1 开放，当前 1.0.0 通过离线验证；原序转发素材与 prompt，不转换引用文本，其他候选保持原能力 |
| Seedance c4 / c5 文生、首尾帧、多参考 | 知梦 1.1.0 首次实现，当前 1.0.0 保留并通过离线验证；待真实供应商验收，不与 WAN3 共用计费 profile |
| `4:3`、`3:4` 等画幅 | 当前 RollDek 插件不接受这些画幅；未经验证不扩大其候选范围 |
| `audio`、`seed`、`prompt_extend`、`watermark` 等参数 | 只进入已确认能传递其语义的插件；显式 `false`、`0` 必须保留 |
| 参考视频 | 百炼和 RollDek 保持各自既有能力；知梦等待实际用量来源验证 |
| `duration: -1` 自动时长 | 百炼已有支持；知梦与 RollDek 新统一入口未经确认不声明支持 |
| 文件、网页、上传文件等扩展输入 | 不列入首期三方公共能力，不因百炼支持就向其他供应商透传 |

知梦按模型／素材划分的验收状态如下。“离线通过／待真实”不是供应商实测通过，也不表示已安装到线上：

| 模型 | 文生视频 | 首帧 | 首尾帧 | 普通参考图／音频及二者混合 | 参考视频及含视频混合 |
| --- | --- | --- | --- | --- | --- |
| wan3.0-video | 离线通过；仅 480P、2 秒有一次真实样本，未核账单 | 离线通过／待真实 | 离线通过／待真实 | 1.0.0 已开放，离线通过／待真实 | 未开放：还缺可信实际输入／输出计费用量与账单 |
| wan3.0-video-prime | 离线通过／待真实 | 离线通过／待真实 | 离线通过／待真实 | 1.0.0 已开放，离线通过／待真实 | 未开放：还缺可信实际输入／输出计费用量与账单 |
| sd-2-c4 | 离线通过／待真实 | 离线通过／待真实 | 离线通过／待真实 | 离线通过／待真实；不承诺跨供应商语法等价 | 离线通过／待真实；按条计费，无输入秒数附加费 |
| sd-2-c5 | 离线通过／待真实 | 离线通过／待真实 | 离线通过／待真实 | 离线通过／待真实；不承诺跨供应商语法等价 | 离线通过／待真实；按条计费，无输入秒数附加费 |

公共请求优先使用 JSON 与公网 HTTPS 素材 URL。默认值、重复别名及未知字段处理均须纳入适配测试，防止请求在不同渠道上改变语义。

### 素材语义与限制不能只做字段改名

- 提示词引用：文档示例的“图1”／“视频1”／“音频1”与“@1”／“@2”写法不同，不等于已证明供应商不兼容。按用户最新要求，知梦普通参考图／音频进入共享候选，素材数组全局顺序、同类出现顺序、重复 URL 与 prompt 原文全部保留，不替换、不重排。不额外承诺跨供应商语义等价；参考视频的实际计费用量是单独限制。
- 素材组合：WAN3 知梦和百炼不允许单独尾帧，也不允许首尾帧与普通参考混用，公共分支已在提交前校验。Seedance 单独遵循其数量和首尾帧规则，不复制 WAN3 混用限制。
- 提示词：百炼接受仅素材无文字，知梦文档和 RollDek 要求非空 prompt；这类请求必须保留为百炼能力，不能补一条虚构提示词再转发。
- 数量与时长：知梦文档列出最多 10 张普通参考图、5 段参考视频、5 段参考音频，参考视频总时长最多 15 秒、输入加输出最多 30 秒；引用视频上限 64 MiB。RollDek 文档未完整给出对应时长和文件限制，不能用插件的 3600 秒防溢出上限代替业务能力表。知梦参考视频未来开放前须验证这些边界。
- URL：RollDek 文档要求公网 HTTPS，知梦接受公网 HTTP(S)。首期公共素材采用 HTTPS；仅某供应商可用的 HTTP、OSS、Base64 等输入不自动升级成公共能力。
- 去重：RollDek 文档说明相同视频 URL 只计一次，知梦没有给出相同承诺。不得把一家的计量去重规则推广到另一家，也不能为了去重改写客户端素材引用位置。
- 音频：输入 `reference_audio` 和输出 `audio` 开关是两个独立维度。不能因为有参考音频就强制生成声音，或因 `audio: false` 就删除输入参考音频。

限制与引用语法依据：[知梦参考素材说明](https://zhimengapi.pages.dev/video/wan3)、[RollDek 参考素材说明](https://www.rolldek.com/docs/#/wan3)。其中跨语法兼容、重复 URL 在知梦的处理均为待验证项。

公共任务 ID、状态和模型字段由宿主维护。三方至少保证公共查询与 `/content` 下载一致可用，不要求所有供应商附加字段完全一致。依赖 `metadata.url` 等 RollDek 扩展字段的旧客户端继续使用旧入口；新客户端以公共任务接口为准。

知梦需要兼容 `error.message` 与顶层 `code` / `message` 两类错误来源，不能直接照搬 RollDek 单一错误字段。只有明确成功状态才交付成片；`progress: 100` 不作为成功依据，未知状态返回 `UNKNOWN` 交给宿主轮询失败策略。下载地址、`output` 结构及 `size` 的含义也不跨供应商直接套用。

## 4. 计费和统计

### 统一内部用量

```json
{
  "seconds": 2,
  "resolution": "480P"
}
```

`seconds` 表示计费秒数，`resolution` 表示价格档位。无参考视频时按输出计费时长处理；有参考视频时，只有取得可信的输入和输出计费时长后才能得到总量。

费用规则为：计费秒数 × 对应模型和画质的单价 × 生效分组倍率。任务表达式直接返回美元金额，不采用 token 的百万单位换算，也不使用任务表达式禁止的 `fixed()`。具体语法和覆盖优先级遵循[计费表达式说明](pkg/billingexpr/expr.md)。

建议两个公共模型分别配置包含三个画质档位的统一对外售价。供应商成本与客户售价分开核算；只有确实需要按供应商区别收费时，才配置 `<pluginKey>::<model>` 形式的插件级表达式覆盖。上游价格若以人民币公布，配置美元单价前必须明确换算，不能直接照抄数字。

数字用量字段声明 `unit: "second"`，描述为 `Video generation unit price` / `视频生成单价`；画质字段使用枚举和 `Output video resolution` / `输出视频分辨率`。单位、边界和技术结算细节遵循 [Task Plugin API v1](docs/plugin-api/v1.md)，不塞进用户价格标签。

### 上游没有 usage 时的处理

New API 接收插件提取出的内部用量事实，不要求上游 JSON 必须存在名为 `usage` 的对象。知梦无参考视频任务可在完成后校验 `seconds` 并报告 `{ "seconds": 2 }`，由宿主与提交时冻结的画质合并结算、记录消费日志。

必须把“按约定秒数计费”与“获得供应商全部计费明细”分开：本次返回的 `seconds` 与请求相同，尚不能证明它在所有场景都代表实测输出时长，更不能代表参考视频总时长或供应商实际扣款。

| 提供方 | 完成用量来源 | 处理方式 |
| --- | --- | --- |
| 百炼 | 现有 WAN3 逻辑读取 `usage.input_video_duration` 与 `usage.output_video_duration` / `usage.duration` | 两部分齐备时计算总秒数；不完整时保留预留用量 |
| RollDek | 现有插件的已工作结算逻辑 | 保留旧入口行为；新入口补充画质事实并验证结算身份 |
| 知梦，无参考视频 | 本次响应的顶层 `seconds` | 校验后用于固定时长任务结算；画质来自提交快照 |
| 知梦，有参考视频 | 未验证 | 第一阶段不开放，不能把输出 `seconds` 当作总计费秒数 |

百炼对参考视频或自动时长会预扣 30 秒，再依赖完成用量结算。知梦尚无对应的可靠回调用量证据，不能直接复制这一策略后就声称参考视频结算完成。

插件需要跨轮询保存的请求语义，例如是否含参考视频，应放入持久化 `state`；查询钩子没有原始 `requestBody`，也不能依赖每轮会被替换的 `task.data` 保留请求参数。

知梦应保存最终发送的时长、画质和是否含参考视频。`seconds` 只在成功的无参考视频路径按明确约定解释；缺失、类型非法或超出该供应商业务边界时保留预留事实并记录异常，不通过 `Number(null)` 等转换把异常变成零。仅有输出 seconds 时不得覆盖已经包含参考视频的总量预留。

用量必须是有限、非负且符合业务边界的数字。无效或缺失的完成事实不得伪造为零；遵循宿主保留预留值的机制。参考视频客户端时长提示不能充当最终可信用量。完整链路需覆盖校验、预扣、成功结算、失败退款和重复轮询不重复扣费。

## 5. 分组与调度配置

示例分组名为 `wan`，部署时沿用实际业务分组。

| 渠道 | 插件绑定 | 对外模型 | 分组 |
| --- | --- | --- | --- |
| 百炼官方，可选 | 现有 `alibaba`，通常为类型 17 | 两个统一模型 | `wan` |
| RollDek | 现有渠道绑定 `rolldek`，更新插件后增加统一模型 | 两个统一模型，旧模型可继续保留 | `wan` |
| 知梦 | 类型 61，绑定 `zhimeng` | 两个统一模型 | `wan` |

同分组、同模型、同协议且通过请求能力检查的渠道才可共同参与选择。用户或令牌也需具备该分组和模型的访问资格。

- 主备：主渠道优先级更高，符合现有重试策略且仍有重试预算时尝试备用渠道。
- 分流：相同优先级，使用渠道权重控制分配。
- 任务已创建：继续由原渠道轮询和下载，不在生成失败后自动跨供应商重建。
- 提交结果不确定：当前没有专用防重复保障，客户端不得盲目重提；不能把“已有 NoRetry 字段”视为所有 JSON 视频提交都受保护，本轮不改宿主。

当前宿主的缺口：普通 JSON 视频提交收到 2xx 后，响应体读取失败或插件解析失败可能返回可重试的 502；发送过程中的传输错误也可能包装为可重试的 500。`controller/relay.go` 的 `decideTaskRetry` 在有预算时会重试这类状态。现有显式保护主要覆盖 SSE 和图片提交，不能据此保证视频不会重复生成。按用户要求，本次插件交付不修改宿主提交/重试路径，专用保护另行处理。使用现有 `RetryTimes=0` 可关闭网关自动重试，但这是全局设置，也会关闭其他请求的重试及失败后自动主备；部署前须验证实际配置。供应商文档未确认幂等能力，不自行添加一个请求头后就认定能够去重。本次未修改线上重试配置。

建议先验证单渠道，再以备用方式接入同组，最后按需要开启分流。回退时停止新任务选择新渠道或新模型，但保留已有任务所需的插件、渠道及查询能力，直到任务结束且约定的成片查询/下载保留期结束；任务完成后也不能立即删除渠道或卸载插件。

## 6. 验证记录

前面的直连、初始方案检查、实施与 lab 记录是历史证据，不代表知梦 1.1.x 的新能力已经真实生成或安装到 lab。当前新增验证见本节最后的版本实施记录，素材开放状态以第 3 节为准。

### 知梦直连测试

2026-10-17 仅发起一次生成请求，使用标准版、480P、2 秒、无参考素材。实际发送字段为：

```json
{
  "model": "wan3.0-video",
  "prompt": "固定镜头，一只小猫坐在窗边轻轻眨眼，自然光。",
  "duration": 2,
  "resolution": "480P",
  "aspect_ratio": "16:9"
}
```

这里的 `aspect_ratio` 是本次直连知梦使用的上游字段；方案公共入口使用 `ratio`，由知梦插件转换。

| 检查项 | 观测结果 |
| --- | --- |
| 提交 | HTTP 200，返回任务 ID |
| 轮询 | `queued` → `in_progress` → `completed` |
| 供应商回包时间戳之差 | 134 秒 |
| 成片 | MP4，854×480，容器时长 2.02 秒，1,020,180 字节 |
| 顶层时长字段 | `seconds: 2` |
| 顶层 size | `16:9`，是画幅，不能用作计费画质 |
| usage | 本次完成响应未返回 |
| 视频直链 | HTTP 200，可下载 |
| 知梦 `/v1/videos/{id}/content` 的 HEAD | HTTP 200，`video/mp4` |
| 同端点的 Range GET | HTTP 206，前 1024 字节与直链文件一致 |

这证明基础提交、查询和下载链路可用。尚未验证知梦参考视频、图片参考、Prime、其他画质、失败退费、实际账单，以及接入本地 New API 后的完整扣费与日志。2.02 秒容器时长不直接替代响应中的 2 秒作为供应商计费依据。

测试 Key 的本地临时文件已删除。本方案不保存 Key、可用签名 URL 或其他凭据，也不依赖临时测试目录长期存在。

### 已运行的项目测试

在仓库根目录执行：

```bash
go test ./plugins -run '^(TestAlibabaWan3|TestAlibabaWanMediaInputs|TestAlibabaWanCompletionFactsAndArtifacts)$' -count=1
```

观测结果：

```text
ok  github.com/QuantumNous/new-api/plugins  0.077s
```

这些是初始方案阶段的百炼测试；知梦及 RollDek 新入口后续测试另列，不用本条历史记录证明其验收。

### 参数复核的离线观测（适配前历史行为）

2026-10-17 使用 `node --input-type=module` 读取当前两个插件源码并作为模块加载，直接调用 `protocols.openai_video.decodeRequest` 和 `buildSubmitRequest`，以 Node 严格断言核对以下 8 组行为，全部符合表中的观测结果。构造器只生成请求描述，不执行发送；新增生成请求数为 0。

| 输入或场景 | 当时代码行为，不代表当前公共入口 |
| --- | --- |
| 百炼收到 `aspect_ratio: "9:16"`、`generate_audio: false` | 发出默认 ratio `adaptive`，audio 未写入，prompt_extend 默认 true |
| 顶层 `duration: 2` 与 `seconds: 3` 冲突 | 百炼选择 2；RollDek 在解码时拒绝 |
| 顶层 2 秒/480P，嵌套 7 秒/720P | 百炼按嵌套 7 秒/720P 构造请求 |
| 百炼收到 `duration: 31` | 解码成功，构造上游请求时才拒绝 |
| 旧 RollDek 收到公共 metadata 中的首帧与 audio false | 上游描述中两者均未发送 |
| 百炼收到 `size: "1280x720"` | 生成 resolution `720P`、ratio `16:9` |
| 只有首帧，没有 prompt | 百炼可构造；RollDek 解码拒绝 |
| RollDek 720p 后缀模型带 `resolution: "480P"` | 仍发 720P，seconds 为字符串 |

这些检查复现的是适配前 JS 转换差异；当前公共冲突校验已修复，旧 RollDek 后缀入口保持旧行为。历史检查不替代当前回归或供应商实测。

### 本轮方案复核

2026-10-17 再次下载知梦 WAN3、Seedance 与 RollDek WAN3 文档，三份内容均与此前核对版本一致。对照宿主代码补充了普通 JSON 视频提交的不确定结果重试风险、下载回退的实际触发条件、百炼公共校验的兼容影响，以及 RollDek 上游型号与宿主用量 profile 的身份边界。明确 `rolldek` 不改名，`zhimeng` 按模型扩展，Seedance 不默认继承 WAN3 的能力和计费规则。

本轮只修改方案并检查文档结构、JSON 示例与本地链接；上述宿主风险依据代码审查，尚未通过故障注入测试复现或修复。本轮没有新增付费生成请求，也没有重新运行此前列出的 Go 测试。

### 2026-10-17 实施记录

已实现以下代码，保留工作区原有的 RollDek Banana 图片和宿主图片响应改动：

- 初始版本新增可独立上传的 `zhimeng/plugin.js`，key 为 `zhimeng`。当时仅支持 WAN3 文生视频；当前 1.1.0 的首尾帧及 Seedance 能力见后续实施，不以本条历史范围为准。
- RollDek 更新为 1.2.1，公共模型按照归一化后的画质拼接上游后缀，新增 `seconds` / `resolution` profile。旧后缀模型、旧用量 schema、旧计费和 Banana 图片入口保留。公共素材原样按顺序发送到 `input.media`。参考视频预扣复用旧入口逻辑：输出时长＋去重后的参考视频估算时长；缺少输入时长信息时，每个唯一视频 URL 暂估 30 秒。这是预扣估算，不是供应商业务上限。最终以完整、合法的上游输入和输出用量之和结算。
- Alibaba 更新为 1.4.4，两个 WAN3 模型的公共视频解码在选渠道前验证冲突、参数类型、范围及素材组合，并执行既有 `convert` 校验。原生入口和其他模型沿用原逻辑。独立上传插件不能导入内置插件，因此公共规则在三个插件中分别保存，并由集中跨供应商回归校验一致性。
- 三家公共入口默认 5 秒、1080P、adaptive，统一时长/画质/画幅/prompt 冲突处理；保留显式 false 和 seed 0。仅有对应能力的候选接受高级参数、自动时长、画幅和素材。普通业务 metadata 保留在规范请求中，仅 `input` / `parameters` 用于生成转换。
- 本次新增的普通 `openai_video` 提交不确定结果保护已按用户要求撤回，宿主使用原有重试行为。插件不提供传输层防重提保障；`RetryTimes=0` 时只尝试一次，有重试预算时仍存在重复生成风险。
- 本次新增的轮询完成用量钩子异常诊断已撤回；缺失或非法完成用量仍沿用宿主既有的保留预扣行为。知梦以持久化 state 判断请求语义，拒绝用输出秒数覆盖含参考视频或语义不明的预留。完成画质沿用冻结快照，不将响应 `size` 的画幅误作价格档位。

兼容性变化：两个 WAN3 模型的 `/v1/videos` 不再接受冲突字段的覆盖顺序，也不再静默忽略未知生成参数或未转换的素材快捷字段。客户端应使用 `metadata.input.media`；原生百炼入口及 RollDek 旧模型保持原行为。新公共模型不能静态映射为 RollDek 画质后缀模型。

#### 离线与数据库验证

已执行并通过：

```bash
go test ./plugins ./relay/channel/task/jsplugin ./relay ./middleware ./pkg/jsplugin -count=1
go test ./controller ./service ./router -count=1
go test -race ./controller -run '^(TestVideoSubmitWithoutRetries|TestWAN3AsynchronousLifecycle)$' -count=1
go build ./...
git diff --check
```

`TestWAN3AsynchronousLifecycle` 使用真实插件、HTTP 模拟上游、宿主提交、持久化 state、冻结表达式、后台轮询、钱包及日志，覆盖成功差额结算、缺失和无效用量保留预扣、失败退款及重复完成不重复扣退。定价数字仅为测试断言使用的虚构美元单价。

| 数据库 | 实际版本 | 命令与结果 |
| --- | --- | --- |
| SQLite | 3.50.4 | `go test ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1 -v`：通过 |
| MySQL | 8.0.46 | `TEST_TASK_DB_DIALECT=mysql TEST_MYSQL_DSN='<隔离测试数据库 DSN>' go test ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1 -v`：通过 |
| PostgreSQL | 17.10 | `TEST_TASK_DB_DIALECT=postgres TEST_POSTGRES_DSN='<隔离测试数据库 DSN>' go test ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1 -v`：通过 |

MySQL 与 PostgreSQL 分别运行在临时容器 `codex-wan3-test-mysql`（127.0.0.1:32772，库 wan3_test）和 `codex-wan3-test-pg`（127.0.0.1:32773，库 wan3_test），仅创建带唯一前缀的测试表，测试后删除表并停止容器。本次没有修改生产数据库代码、模型或迁移。

计费元数据已人工核对：数值字段为 `Video generation unit price` / `视频生成单价`，单位为 `second`；枚举为 `Output video resolution` / `输出视频分辨率`，无价格数字、技术说明或句末标点。没有改变插件 API 元数据类型、钩子签名或 Schema 契约。

凭据处理参考 [OWASP ASVS 5.0.0](https://owasp.org/projects/asvs)、[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) 和 [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)：默认供应商地址为 HTTPS，API Key 仅进入同源 API 请求头，state 与日志不保存凭据，外部成片 URL 不携带渠道凭据。回归覆盖同源内容描述及日志无渠道 Key。本次不修改登录、会话或凭据存储机制，不声明完成整个系统的 ASVS 合规认证。

#### 本地 lab 与尚未完成的供应商验收

按用户要求不动线上。使用独立容器 `codex-wan3-lab`、独立 SQLite、独立测试账户及假密钥；网络 `codex-wan3-lab-net` 为 internal，容器没有外网默认路由。未重启已有 `tokenone-newapi-local.service`，未修改其数据库、渠道、定价或 current 发布链接。

lab 入口为 `http://127.0.0.1:55220`，模拟上游仅在容器内 `127.0.0.1:3010` 提供服务。测试生成接口不接触供应商。为下载本地模拟文件，仅在该隔离实例允许私网地址和 3010 端口；测试编译触发 CPU 阈值时，仅该实例关闭 CPU 阈值，以免测试主机负载干扰协议验收。

撤回宿主改动前，lab 完整 HTTP 验收共 13 项通过，历史结果保存在 `data/tokenone-lab/wan3-lab/test-report.json`：两家分别通过 Prime 720P 创建、公共查询、计费、HEAD/GET/Range、缺失用量保留预扣、失败退款和不确定提交只请求一次；非法公共参数的 3 组输入均返回 400 且上游提交次数为 0；显式 429 在重试预算 2 下恰好提交 3 次。上述数量按报告中的检查项计数，HEAD/GET/Range 合为一项。不确定提交与重试次数的历史结果不能作为撤回后宿主的保障。

实际执行：

```bash
CGO_ENABLED=0 go build -o data/tokenone-lab/wan3-lab/new-api .
docker exec codex-wan3-lab python /lab/test_lab.py
docker exec codex-wan3-lab python /lab/check_retry.py
```

首次下载检查因隔离实例默认禁止私网下载返回 502，配置该实例的本地模拟地址权限后 HEAD/GET/Range 通过；并发 race 编译触发测试主机 CPU 保护返回 503，调整该实例的 CPU 阈值后续跑通过。成功项目逐项持久化到报告，可在相同 lab 里复跑未完成部分。这些均为 lab 设置调整，没有改变生产安全策略。

本地目录为忽略目录，不作为插件发布文件或供应商真实联调证据。容器保持运行供检查，私有测试登录资料仅存于同目录 `credentials.json`。停止此 lab 可执行 `docker stop codex-wan3-lab`；本地 55220 转发由 `forward.py` 提供。

该阶段未新增供应商付费生成或账单对账。当时知梦全部素材关闭；当前已完成首尾帧、普通参考图／音频及图音混合适配，参考视频仍因计费用量缺口关闭。真实售价、实际供应商成本及业务边界仍待联调，不能把模拟上游通过视为供应商验收。

### 2026-10-17 评审修复

RollDek 公共入口继续支持参考视频，不关闭该能力。本次复核 [RollDek 文档](https://www.rolldek.com/docs/wan3.md) 未取得输入 15 秒或总量 30 秒的业务上限依据，因此已删除新入口完成结算中的这些限制。预扣复用旧入口的输入时长估算及重复 URL 计量规则，最终费用以上游完整有效的 `usage.input_video_duration` 加 `usage.output_video_duration` / `usage.duration` 为准；宿主的有限、非负及 second 单位安全校验继续有效，3600 秒是宿主安全阈值，不声明为供应商能力。

请求“输出 2 秒＋1 段没有时长信息的参考视频”暂估 32 秒，上游实际回传“输入 16 秒＋输出 2 秒”时结算 18 秒；“输入 16 秒＋输出 20 秒”结算 36 秒。已创建的公共任务也能使用完整上游用量结算，不再因上述未经确认的上限保留较高预扣。缺失或非法完成用量保留预扣，失败退款，重复轮询不重复扣退。旧后缀入口及旧价格不作迁移。

三家公共解码器均在比较 `size` 之前将其解析为画质与可推导的画幅，再合并各来源的事实。`size: "720"` 与嵌套 `size: "720P"`、像素写法 `1280x720` 与 `1280*720`、画质档位与一致像素尺寸均可共存；画质或画幅真实不同仍拒绝。修复版本为 Alibaba 1.4.4、RollDek 1.2.1、知梦 1.0.1；未改变计费 schema 或描述。

扩展现有 `plugins/wan3_channels_test.go` 和 `controller/relay_task_plugin_test.go`，覆盖三家候选筛选、重复解码、预扣与旧入口一致、16＋2→18、16＋20→36、参考视频缺失用量、失败退款及重复完成。SQLite 3.50.4、MySQL 8.0.46、PostgreSQL 17.10 的完整异步链路均通过。

本轮验证命令：

```bash
go test ./plugins ./controller ./relay/channel/task/jsplugin ./middleware -count=1
go test -race ./plugins -run '^(TestWAN3|TestRollDek)' -count=1
go test -race ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1
go test ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1 -v
TEST_TASK_DB_DIALECT=mysql TEST_MYSQL_DSN="$TEST_MYSQL_DSN" go test ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1 -v
TEST_TASK_DB_DIALECT=postgres TEST_POSTGRES_DSN="$TEST_POSTGRES_DSN" go test ./controller -run '^TestWAN3AsynchronousLifecycle$' -count=1 -v
CGO_ENABLED=0 go build -o data/tokenone-lab/wan3-lab/new-api.next .
docker exec codex-wan3-lab python /lab/check_review.py
git diff --check
```

本轮 MySQL 与 PostgreSQL 分别使用 `codex-wan3-review-mysql`（127.0.0.1:32774）和 `codex-wan3-review-pg`（127.0.0.1:32775）内的 wan3_test 数据库，测试表使用独立前缀并在结束后删除；命令中的 DSN 已脱敏，不能直接复制执行。

独立本地 lab 已重建当前代码并显式激活 RollDek 1.2.1、知梦 1.0.1；新增 5 项 HTTP 检查全部通过，报告为 `data/tokenone-lab/wan3-lab/review-report.json`，包含两种参考视频用量结算、钱包差额，以及 RollDek/知梦的同义 size 创建与计费。三家同义 size 的公共候选筛选均由 Go 集中回归覆盖。lab 仍只使用无外网默认路由的模拟上游，新增付费生成次数为 0，既有服务及线上保持未变更。

### 2026-10-17 宿主改动撤回

按用户要求尽量保持上游原样，撤回本次 WAN3 开发附带的两处宿主通用改动：

- `relay/relay_task.go` 撤回视频提交不确定结果的专用不可重试标记和连接跟踪，文件与本次开发前的 Git HEAD 一致。
- `relay/channel/task/jsplugin/adaptor.go` 仅撤回新增的 `extractUsageOnComplete` 异常诊断调用。此前已有的图片响应大小、内联图片处理及其测试和 API 文档改动完整保留。
- 三份插件、参考视频计费修复、同义 `size` 归一化以及异步结算回归均保留。`TestVideoSubmitRetryBoundaries` 改为 `TestVideoSubmitWithoutRetries`，验证原有 `RetryTimes=0` 配置下，响应解析失败、响应截断、发送后断连、5xx、429 和连接拒绝均只尝试一次；不再声称有重试预算时具备专用防重提保障。

本轮 Go 回归、race 检查和本地 lab 构建已通过：

```bash
go test ./plugins ./controller ./relay/channel/task/jsplugin ./relay ./middleware -count=1
go test -race ./controller -run '^(TestVideoSubmitWithoutRetries|TestWAN3AsynchronousLifecycle)$' -count=1
CGO_ENABLED=0 go build -o data/tokenone-lab/wan3-lab/new-api.next .
```

本轮不修改数据库实现、模型或迁移；上文三数据库结果为此前执行的验证记录。

已用撤回后的代码重建独立 `codex-wan3-lab`。仅该隔离实例配置 `RetryTimes=0` 并通过管理 API 读回确认；RollDek、知梦的异常 JSON 响应和显式 429 共 4 项 HTTP 检查均只提交一次，结果保存在 `data/tokenone-lab/wan3-lab/withdrawal-report.json`。该设置为实例全局设置，同样关闭其他请求的自动重试与失败后自动主备；本次不修改既有服务或线上配置。

重建后另有 5 项 HTTP 复验通过：参考视频 32→18 秒及 50→36 秒结算、钱包差额、RollDek 与知梦同义 `size` 创建和计费，结果保存在 `data/tokenone-lab/wan3-lab/review-report.json`。本轮新增付费生成次数为 0。

```bash
docker exec codex-wan3-lab python /lab/check_withdrawal.py
docker exec codex-wan3-lab python /lab/check_review.py
git diff --check
```

### 2026-10-17 知梦素材与 Seedance 后续实施

本轮仅新增 `zhimeng/plugin.js`、集中插件测试、已有宿主集成测试及两份根目录交接／方案文档；不再新增宿主生产代码、插件契约、数据库模型、路由、重试、下载代理或核心计费。工作区原有 RollDek Banana、宿主图片响应及此前改动均保留。

- 知梦升级为 1.1.0。两个 WAN3 模型支持首帧、首尾帧，保留原数组顺序及 prompt；重复帧、单独尾帧、与普通参考混用仍在候选筛选前拒绝。高级参数的 false 和 seed 0 不丢失。
- 新增同插件 Seedance c4 / c5 的模型专属归一化、请求构造、素材数量与组合校验、按条 profile、成功／失败结算和无凭据直链下载。重复解码稳定，不在公共请求中接受供应商 `reference_voice` 别名。
- state 保存模型、时长、画质与实际素材得出的 `hasReferenceVideo`，经一次不含模型／素材的进行中响应覆盖 `task.data` 后仍保持；旧 WAN3 state 和定价继续兼容。
- 1.1.0 当时未开放 WAN3 普通参考图／音频；此限制已按用户要求在 1.1.1 移除。WAN3 参考视频仍缺完整、可信的输入及输出计费时长字段／查询接口、重复 URL 计量约定和消费记录对账，不能用输出 seconds 或媒体探测代替。没有假设输入为零，没有新增估算后不可结算的收费路径。

实际执行并通过的命令（所有生成请求仅指向测试 HTTP 服务）：

```bash
go test ./plugins ./controller ./relay/channel/task/jsplugin ./middleware -run 'WAN3|Wan3|AlibabaWan|RollDek|Zhimeng|VideoSubmitWithoutRetries' -count=1
go test ./plugins ./controller ./relay/channel/task/jsplugin ./middleware -count=1
go test -race ./plugins ./controller -run '^(TestZhimeng.*|TestWAN3AsynchronousLifecycle)$' -count=1
go build ./...
git diff --check
```

三数据库针对 `TestWAN3AsynchronousLifecycle` 和 `TestZhimengSeedanceContent` 再次运行，不引用之前 session 的结果：

| 数据库 | 实际版本 | 命令及结果 |
| --- | --- | --- |
| SQLite | 3.50.4 | `TEST_TASK_DB_DIALECT=sqlite go test ./controller -run '^(TestWAN3AsynchronousLifecycle|TestZhimengSeedanceContent)$' -count=1 -v`：通过 |
| MySQL | 8.0.46 | `TEST_TASK_DB_DIALECT=mysql TEST_MYSQL_DSN="$TEST_MYSQL_DSN" go test ./controller -run '^(TestWAN3AsynchronousLifecycle|TestZhimengSeedanceContent)$' -count=1 -v`：通过；变量值已脱敏 |
| PostgreSQL | 15.18 | `TEST_TASK_DB_DIALECT=postgres TEST_POSTGRES_DSN="$TEST_POSTGRES_DSN" go test ./controller -run '^(TestWAN3AsynchronousLifecycle|TestZhimengSeedanceContent)$' -count=1 -v`：通过；变量值已脱敏 |

外部数据库仅使用本轮创建的临时容器 `codex-wan3-followup-mysql-20261017`、`codex-wan3-followup-pg-20261017` 中的 `wan3_followup` 库，端口仅绑定回环地址；测试使用唯一前缀并清理表，结束后停止并删除本轮容器。没有迁移或 ORM／驱动改动，未修改线上或既有 lab 数据库。本表只证明这三个实际版本的插件集成，不声称覆盖所有历史数据库版本或发布升级迁移。

回归覆盖 WAN3 素材候选、顺序与角色、成功／缺失／非法用量、失败退款；Seedance 短／长任务按条收费、混合素材、音频类型转换、模型 profile 隔离；进行中 state 持久化、冻结预扣／画质／表达式、完成后重复查询不重复扣退；外部直链 GET／HEAD／Range 不带渠道 Key、客户端 Authorization 或 Cookie。原 RollDek 16＋2→18、16＋20→36 和旧入口回归仍通过。

计费描述已人工审阅：两个 profile 的数值标签均为 `Video generation unit price`／`视频生成单价`，单位分别为 second／count；画质为 `Output video resolution`／`输出视频分辨率`。没有数字价格、单位说明或句末标点。计费测试中的 0.1、0.2 是虚构美元断言，不是售价。

本轮新增真实供应商生成 **0 次、支出 0**，没有使用历史临时 Key、购买或充值；未取得新测试凭据与消费记录，新增能力均为“已实现并通过离线验证，待真实验证”，不是供应商验收完成。未更新既有 lab 二进制或插件，旧 lab 报告不覆盖 1.1.0；未修改既有服务、线上渠道、售价、全局重试或发布链接。

### 2026-10-17 知梦 1.1.1 直接开放图音参考

按用户最新要求取消 WAN3 普通参考图／音频的“引用语义未验证”拒绝条件；不尝试推断或替换自然语言引用。两个 WAN3 模型均接受多图、多音频及交错图音混合，素材全局顺序、同类出现顺序、重复 URL、类型与 prompt 原文完整保留。输出 audio false 不删除输入参考音频，seed 0 仍保留。数量上限继续为 10 张普通参考图、5 段参考音频；超限、帧与普通参考混用及 reference_voice 别名仍拒绝。

WAN3 参考视频没有随本次开放：现有响应缺乏可信的实际输入计费用量，属于独立的收费结算条件，不是引用文本顺序问题。混合请求中含 reference_video 时明确拒绝，不静默丢弃该素材，也不假设输入时长为零。RollDek 的既有参考视频和多图能力不变。用户确认 creative 调用旧 RollDek 能正常生成视频，此事实不扩大为知梦已真实验证。

本轮 1.1.1 仅改动知梦插件、现有集中插件回归及两份根目录文档；未新增宿主生产代码改动，也未改变 RollDek、Seedance 行为、state 结构、用量公式、数据库查询／模型／迁移或任何已保存价格。工作区已有宿主图片响应改动保持不动。图音参考仍按输出秒数和冻结画质计费，不按素材数量加收。元数据用量描述未变，仍遵循“计费对象＋单价”规范。

实际运行并通过：

```bash
go test ./plugins -run '^(TestWAN3ChannelCapabilities|TestZhimengWAN3Media)$' -count=1
go test ./plugins ./controller ./relay/channel/task/jsplugin ./middleware -count=1
go test -race ./plugins -run '^(TestWAN3|TestZhimeng|TestRollDek)' -count=1
go build ./...
git diff --check
```

集中回归覆盖两个 WAN3 模型的多图／多音频／交错图音、重复 URL、不改提示词和数组、10 图＋5 音频及越界拒绝、重复解码、audio false、seed 0、候选筛选和输出用量不变；另外保护 reference_video 仍由独立计费限制拒绝。现有四包回归包含异步结算、失败退款和重复完成。1.1.0 的三数据库版本与结果保留为历史记录，本次未重跑外部数据库矩阵，不将历史结果冒充本次专项验证。

本轮新增真实生成 0 次、支出 0；没有使用历史临时 Key，没有更新线上或既有 lab。1.1.1 表示代码已开放图音参考，不表示供应商实测、账单对账或部署已完成。

### 2026-10-18 代码复审与文档校正

本轮没有重新接入 Seedance；它已在 2026-10-17 的知梦 1.1.0 实施阶段加入，本轮仅继续检查既有实现。复审修正如下：

- 知梦和 RollDek 的 WAN3 解码器保留有内容 prompt 的原文，包括前后空格，并拒绝空白 prompt；素材 URL 要求 HTTPS。百炼对应改动已按用户要求撤回，沿用原行为。
- Seedance 缺少 prompt 时返回明确的参数校验错误，不再因对 `undefined` 调用 `trim()` 暴露运行时异常；有内容 prompt 的前后空格不改变，空白裁剪只用于必填和长度校验。已完成但缺少成片 URL 的 Seedance 任务保持 `UNKNOWN`，不被误报成功。
- 将素材校验错误从“public HTTPS”改为“HTTPS”，避免让文案暗示插件验证了公网可达性。插件仅校验协议形式；供应商是否能访问 URL 仍需单独确认。
- 对应插件版本分别更新为知梦 1.1.2、RollDek 1.2.2、内置 Alibaba 保持 1.4.2；没有变更计费字段、价格、数据库或宿主生产代码。

本轮实际运行并通过：

```bash
go test ./plugins ./controller ./relay/channel/task/jsplugin ./middleware -count=1
go test -race ./plugins -run '^(TestWAN3|TestZhimeng|TestRollDek)' -count=1
go build ./...
git diff --check
```

本轮未做真实供应商生成或重跑三数据库矩阵；本次只改插件请求校验、结果判定和测试，没有变更数据库行为，不将此前实施记录中的数据库结果冒充本轮复验。

## 7. 实施步骤与验收

1. 已完成：公共字段、默认值、冲突校验、百炼候选筛选、RollDek 新旧入口和知梦 WAN3 首尾帧离线适配。
2. 已完成：同一个知梦插件接入 Seedance c4 / c5，独立参数／素材能力、按条 profile 和无凭据下载，通过集中回归及三数据库异步链路。
3. 待供应商验证：用新提供且有效的测试 Key 与公网素材，先做最短时长／最低合适画质的必要首帧及首尾帧请求；分别记录模型、参数、生成次数和消费记录，不记录 Key 或可用签名 URL。
4. 待供应商验证：Seedance 从 4 秒、720P 的必要用例开始，核对实际按条扣费、失败退款、成片 URL、HEAD／Range；不因离线矩阵包含多个档位就全量付费生成。
5. 待另行授权部署：确认正式美元售价、每提供方覆盖配置及分组资格，再将通过真实验收的模型加入目标渠道；本交接不直接上线。
6. 按用户最新要求保持宿主原样，不再实施提交不确定场景的专用重试保护。部署时说明既有重试行为和风险；若采用禁用重试的配置，需验证配置并说明其全局影响，不自行修改线上设置。
7. 已按用户要求开放知梦普通参考图／音频及图音混合，按原序和原 prompt 转发，不再以引用示例差异排除候选。参考视频仍需可信的实际计费时长来源及账单核验，在此之前由其他支持该请求的渠道承接。

关键验收项：

- 同一公共请求经不同插件转换后，模型等级、画质、时长、画幅和素材角色保持一致。
- RollDek 上游模型后缀正确，旧模型请求和现有计费回归不变。
- 嵌套 metadata 中的首帧、时长、画质和显式 false 不会丢失；模型选择、价格档位、实际发送画质始终一致。
- 不同来源的时长/画质冲突、像素 size 推导冲突有统一拒绝结果；`duration: 31` 等非法请求在候选解码阶段就被拒绝。
- 无 prompt 的素材请求只选择实际支持的候选；多参考素材的全局顺序、同类顺序及提示词指代分别验证。
- 不支持的参数不会被静默丢弃；显式零值和布尔值保留；冲突别名与越界时长有确定行为。
- 知梦插件与 RollDek 新统一模型分支都能使用相同的 `seconds`、`resolution` 用量约定，日志保留公共模型及执行渠道信息。
- 无参考视频的成功、失败、缺失用量、无效用量和重复完成查询有确定结算行为。
- 同组候选选择和原渠道任务查询符合宿主既有机制。提交不确定场景沿用既有重试策略，不将新增防重复生成保护列为本轮验收项；不能承诺有重试预算时绝不重复生成。
- 公共查询、HEAD、GET 与 Range 下载在已覆盖的模拟服务中可用；第三方成片 URL 不携带渠道凭据，供应商真实直链可达性仍按第 6 节待验收。
- 费用日志与配置单价、画质、分组倍率相符；供应商实际成本另行核对。

优先扩展现有测试文件；若必须新增测试文件，集中到一个新文件，避免按调用层重复铺设相同用例。元数据中英文描述需人工核对，测试通过不能替代描述规范检查。

本次变更集中在新增知梦插件、RollDek 插件及集中回归测试；内置百炼改动已撤回；宿主视频提交重试保护与完成用量异常诊断已撤回。不需要数据库迁移、核心计费重写或新增前端页面。实际实施若涉及数据库行为或插件契约变化，必须另行完成仓库规定的数据库验证或契约一致性检查，不能以本方案代替。

### 部署操作清单（待授权，不在本轮执行）

1. 先在隔离测试实例确认宿主支持 API v1 `usageProfiles` 与 `credentialless`，备份当前插件版本、渠道绑定、模型列表及定价。不要用旧 lab 报告证明新版本；更新 lab 也须先核实实例身份和网络隔离。
2. 管理员通过任务插件上传入口 `POST /api/plugin/task` 上传 `zhimeng/plugin.js`，核对 key `zhimeng`、版本 `1.0.0` 及四个声明模型，使用正常版本激活操作。不能新建一个不同 key 替换旧插件。RollDek 同步上传 1.1.0，内置 Alibaba 保持原版本，无需上传或更新；保持原 key 和所有旧模型，原有 Banana 功能不迁移。
3. 知梦使用类型 61 渠道，绑定 `setting.task_plugin_key="zhimeng"`，Base URL 为 `https://movie.zmoapi.cn`，配置新的有效 Key。已有渠道仅在授权后升级，不删除其任务／插件历史版本。目标 WAN3 分组示例为 `wan`，模型列表加入 `wan3.0-video`、`wan3.0-video-prime`，不设置画质后缀映射；RollDek 同组保留原有后缀模型，百炼可选。
4. Seedance 若通过真实验收，在相同知梦渠道或另一个同 key 渠道启用 `sd-2-c4`、`sd-2-c5`，按实际业务配置分组／权重；不把它们登记为其他厂商 Seedance 的别名。未验收时不加入生产渠道模型列表，即使插件元数据已声明。
5. 正式售价尚未提供，须由管理员确认后保存：WAN3 每个公共模型分别配置三个画质的美元每秒价格（`seconds`／`resolution`）；Seedance 各自配置美元每条价格（`video_count`），可用 `tier("base", u("video_count") * P)`。P 必须替换为明确的美元价格，不能直接执行占位表达式；不要复制测试 0.1，也不要把供应商人民币报价不换算直接保存。保留全部旧价；确需提供方差异时才保存 `<pluginKey>::<model>` 覆盖。
6. 新客户端使用 JSON、可被供应商公开抓取的 HTTPS 素材 URL、公共 model／duration／resolution／ratio 以及规范写法 `metadata.input.media`；顶层 `media` 仅作为兼容写法。WAN3 显式填默认值以免意外 1080P，Seedance 不接受 WAN3 的 2 秒／1080P／adaptive。冲突别名、未知参数、`reference_voice`、上传文件和新的原生入口均不支持。旧 RollDek 后缀客户端无需改参数或售价。
7. 先单渠道核验创建、原渠道查询、GET／HEAD／Range、日志和钱包，再按授权同组调度。保持现有重试设置，说明不确定提交可能重复生成；若另行采用 `RetryTimes=0`，须强调实例全局影响和失去自动主备，不在本轮自行设置。
8. 回退只停止新任务选择新增模型／渠道；不要卸载知梦或删除原渠道。Seedance 历史任务依赖 1.1.0 的 profile、持久化模型与下载逻辑，不能直接回滚到不识别 Seedance 的 1.0.1，须保留兼容实现直到既有任务和成片查询／下载保留期结束。

## 8. 参考资料

### 各家公开文档

| 提供方 | 参考链接 | 用途 |
| --- | --- | --- |
| 阿里云百炼官方 | [万相 3.0 视频生成 API 参考](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference) | 官方模型名称、原生请求结构、素材类型、任务查询与用量定义 |
| RollDek | [WAN 3.0 视频 API](https://www.rolldek.com/docs/#/wan3) | 带画质后缀的模型名、参考素材写法、下载接口与计费口径 |
| RollDek | [上述页面使用的 Markdown 原文](https://www.rolldek.com/docs/wan3.md) | 页面无法加载时备查；为同一文档，不作为另一份独立证据 |
| 知梦 | [Wan 3.0 视频生成 API 对接手册](https://zhimengapi.pages.dev/video/wan3) | 知梦模型名、参数限制、任务状态、视频地址及计费说明 |
| 知梦 | [SD / Seedance 2.0 视频生成 API 对接文档](https://zhimengapi.pages.dev/video/sd) | 后续模型扩展依据；共用接口、不同请求结构、能力限制及按条计费 |

文档核对日期为 2026-10-17。供应商价格、限制和接口可能更新，实施时应复核。知梦模型名与官方一致，但其 `/v1/videos` 封装不是百炼原生协议。官方原生格式与 New API 公共格式之间由插件转换。

### 项目实现与规范

以下为仓库相对链接，便于在其他检出目录或代码托管平台中查看。

| 资料 | 重点位置或用途 |
| --- | --- |
| [内置 Alibaba Bailian 插件](plugins/tasks/alibaba/plugin.js) | `WAN_MODELS`、`wanVideoUsageSchema`、`convert`、`extractUsage`、`extractUsageOnComplete`、`protocols.openai_video` |
| [现有 RollDek 插件](rolldek/plugin.js) | 模型列表、`normalize`、素材转换、用量提取、任务与内容查询 |
| [Task Plugin API v1](docs/plugin-api/v1.md) | 共享模型、渠道绑定、用量事实、持久化状态、宿主协议及描述翻译规则 |
| [插件接口类型](docs/plugin-api/v1.d.ts) / [接口 Schema](docs/plugin-api/v1.schema.json) | 实施时核对插件钩子及元数据契约 |
| [计费强制规则](.agents/rules/billing.md) | 数量边界、预扣、结算、退款及异常用量处理 |
| [计费表达式说明](pkg/billingexpr/expr.md) | 任务用量表达式、美元单位、插件级定价覆盖 |
| [协议候选路由](pkg/jsplugin/routing.go) | `LookupEndpointCandidates`：同一协议和模型的多个插件候选 |
| [请求预处理](middleware/task_plugin.go) | `PrepareTaskPluginEndpoint`：执行候选插件解码 |
| [渠道选择后的插件绑定](middleware/distributor.go) | `pinnedEndpointCandidateForChannel` |
| [任务日志与结算](service/task_billing.go) | `LogTaskConsumption`、`EvaluateTaskCompletionUsage` |
| [任务提交与重试决策](controller/relay.go) / [提交链路](relay/relay_task.go) | `decideTaskRetry`、传输失败与已受理任务的重试边界 |
| [插件宿主适配器](relay/channel/task/jsplugin/adaptor.go) / [视频内容代理](controller/video_proxy.go) | JSON 提交解析失败处理、下载描述、无凭据直链及实际回退条件 |
| [后台任务轮询](service/task_polling.go) | 按原渠道查询任务、完成结算和失败退款 |
| [WAN3 回归测试](plugins/alibaba_wan3_test.go) | 默认值、自动时长、模型映射、尺寸及输入约束 |
| [百炼素材与结算测试](plugins/alibaba_responses_test.go) | `TestAlibabaWanMediaInputs`、`TestAlibabaWanCompletionFactsAndArtifacts` |
| [RollDek 现有测试](plugins/rolldek_test.go) | 保留旧入口、旧计费及 Banana 图片能力的回归覆盖 |

本方案依据当前工作区代码，包括尚未提交的修改；上线实例必须具备对应插件 API 和共享模型路由能力。
