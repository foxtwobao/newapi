# TokenOne 对外视频接口统一参数契约方案

正式公共调用规范已整理至 [TokenONE 标准视频 API](docs/tokenone-video-api.md)。公共契约以该文档为准；本文保留现状差异、实施安排和验证记录。 对客户发布使用 [通用调用文档](docs/tokenone-video-api-public.md)，发布位置为 [ShowDoc 视频教程](https://doc.tokenone.work/web/#/688394820/172712501)。对外不披露提供方、插件映射或未上线型号能力，客户文档同时包含统一接口与上线后逐项补充的模型参数要求，后者按转换后的 TokenONE 公共格式说明；内部规范不直接作为 ShowDoc 发布正文。

状态：适用范围、RollDek Seedance 接口选择原则、生成与下载状态边界、公共响应白名单及 CreativeOne 仅依赖公共规约已确认；已按 2026-10-31 可访问的上游文档、现有插件及用户补充完成逐型号对照，剩余验证项单列；尚未作为上线契约发布。

本方案面向 CreativeOne 等应用，采用“公共参数统一、厂商特有参数受控透传”的方式。供应商转换放在各自插件中，复用现有宿主机制。本文区分目标契约、当前代码行为与待验证事项，不把工作区中的实现草稿或模拟测试结果视为已上线支持。

本次只保存方案，不继续修改实现，不修改 CreativeOne，不部署线上，不发起付费生成。

## 1. 范围与接口

本契约只约束我们维护的自定义视频插件，本期对象为 RollDek、知梦。仓库自带的公共插件（包括 Doubao、Alibaba）保持各自现有协议、参数、默认值及能力，本次不修改，也不要求它们遵守本契约。普通渠道和其他未适配插件继续遵循其原有协议，不为它们新增宿主统一校验或强制转换。

| 对象 | 本期处理 |
| --- | --- |
| RollDek、知梦自定义插件 | 按本契约校验公共参数，只转换与上游有差异的字段 |
| 公共 Doubao、Alibaba 等内置插件 | 保持现状，仅作为协议研究参考，不属于实施对象 |
| 宿主 | 复用现有路由、任务、查询、下载和计费机制 |
| CreativeOne | 升级后新视频调用只遵循 TokenOne `/v1/videos` 公共规约；本次只提供指南，不修改其仓库 |

统一对外请求不意味着必须切换上游协议。上游 `/v1/videos` 已能满足对应型号需求时，采用 `/v1/videos → /v1/videos`；字段一致的保留，存在差异的才转换。仍需校验白名单、能力和计费参数，不能无条件透传整个请求。

同一模型同时配置插件渠道和普通渠道时，普通渠道可能获选并按其原有协议执行；插件声明本身不保证请求一定进入插件。分组、渠道及插件能力差异由 TokenOne 侧处理，CreativeOne 不识别供应商、不维护插件能力表，也不选择供应商协议。若其分组接入不符合本规约的插件或渠道而导致错误，允许请求失败，由应用正常展示错误；不要求应用兼容、降级或自动切换原生接口。这不要求改造所有渠道，也不新增宿主统一校验框架。

| 操作 | 接口 | 应用侧要求 |
| --- | --- | --- |
| 创建 | `POST /v1/videos` | 使用公共模型身份和公共请求结构 |
| 查询 | `GET /v1/videos/{id}` | `id` 为 TokenOne 公共任务 ID |
| 下载 | `GET /v1/videos/{id}/content` | 使用公共任务 ID，携带 TokenOne 用户 API Token |

应用不需要识别供应商、解析供应商结果 URL 或持有渠道密钥。查询、下载失败不能自动触发重新生成。

保留厂商原生入口及请求格式，例如 `/doubao/api/v3/contents/generations/tasks`。原生入口不因公共契约收紧而被强制改成公共请求格式。

当前宿主已有公共任务 ID、标准状态、归属校验、模型权限、渠道筛选、任务用量 hooks 和下载代理，暂未发现必须新增宿主契约的缺口。若后续发现缺口，应先说明具体问题和最小改动范围，不新增公共参数运行时框架。

## 2. 公共请求结构

```json
{
  "model": "wan3.0-video",
  "prompt": "人物缓缓转身",
  "duration": 6,
  "resolution": "720P",
  "ratio": "16:9",
  "metadata": {
    "input": {
      "media": [
        {
          "type": "first_frame",
          "url": "https://example.com/start.jpg"
        }
      ]
    },
    "parameters": {}
  }
}
```

示例面向已适配的自定义插件渠道。扩展参数仅能发送给明确支持它们的模型；例如知梦万相的 `seed: 0`、`audio: false` 需放在 metadata.parameters 中，不能因此推断 RollDek 万相也支持。统一字段含义，不要求全部提供方支持全部字段或能力。

### 2.1 公共字段

| 参数 | 类型 | 对外含义 | 校验与缺省规则 |
| --- | --- | --- | --- |
| `model` | string | TokenOne 公共模型身份 | 必填；插件转换供应商型号，应用不拼供应商后缀 |
| `prompt` | string | 视频生成提示词 | 是否允许省略、长度限制按模型声明；不静默截断 |
| `duration` | number | 请求生成的视频时长，单位秒 | 当前目标模型按整数校验；`0` 非法；`-1` 仅用于明确支持自动时长的模型 |
| `resolution` | string | 输出分辨率档位 | 如 `480P`、`720P`、`768P`、`1080P`、`2K`、`4K`，每个模型接受明确子集 |
| `ratio` | string | 请求的输出宽高比 | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`、`3:2`、`2:3`、`adaptive`，每个模型接受明确子集 |
| `metadata.input.media` | array | 有角色的输入素材 | 可省略；每项只接受 `type`、`url`，不接受客户端填写的计费时长 |
| `metadata.parameters` | object | 当前模型支持的扩展参数 | 可省略；按插件和模型白名单校验，未知字段报错 |

具体语义：

- `720P` 表示模型的 720P 档位，不保证输出文件恰好为 `1280×720`。
- 不把 `768P` 自动降为 `720P`，不把 `2K` 自动解释为 `1080P`。
- `adaptive` 表示允许模型根据输入选择画幅；省略 `ratio` 表示采用该公共模型约定的缺省行为。两者不能随意互换。
- 显式 `0`、`false`、`null` 与未提供参数分别处理；非法值报错，合法零值和布尔 false 必须保留。不能以真假判断代替是否提供字段的判断。
- 根据请求和已确认型号能力即可判断为不支持的字段、组合、取值，必须在提交前明确拒绝，不通过删除参数、改时长或降分辨率接受请求。远程素材实际时长、编码等需要读取文件才能确定的限制，由供应商读取后校验，见第 8 节。
- 普通参考素材 URL 应可供供应商服务端读取。统一示例使用 HTTPS；供应商专用上传地址限制必须单独公布，不能宣称任意 HTTPS 地址都可用。

### 2.2 素材角色

| `type` | 含义 | 通用约束 |
| --- | --- | --- |
| `first_frame` | 指定视频首帧 | 最多一张，不能当普通参考图处理 |
| `last_frame` | 指定视频尾帧 | 最多一张，当前范围内要求同时存在首帧 |
| `reference_image` | 外观、主体或风格参考图 | 保留参考图顺序，数量按模型限制 |
| `reference_video` | 动作、镜头等参考视频 | 数量、时长和组合按模型限制；不信任客户端自报时长 |
| `reference_audio` | 输入参考音频 | 与输出声音开关 `audio` 相互独立 |

首尾帧由角色决定，不由数组位置猜测。例如先出现 `last_frame`，也不能把它当作首帧。转换成供应商分类 URL 数组时，应保留每种素材内部的相对顺序；转换成统一内容数组时，保留参考素材的相对顺序。

首尾帧与普通参考模式是否可以混用、是否支持纯音频参考等，按具体模型能力校验，不制定未经验证的全局放行规则。

### 2.3 兼容别名

| 兼容字段 | 标准含义 | 冲突规则 |
| --- | --- | --- |
| `seconds` | `duration` | `"6"` 与 `6` 可视为等价；与 `duration: 5` 同时出现时报错 |
| `aspect_ratio` | `ratio` | 标准化后不一致时报错 |
| `size: "720P"` | `resolution: "720P"` | 与其他分辨率冲突时报错 |
| `size: "1280x720"` | 已登记的 720P、16:9 组合 | 同时检查 resolution、ratio；不做近似推断 |
| 历史扩展字段位置 | 对应的 `metadata.parameters` 字段 | 仅兼容明确登记的旧写法，不采用“后者覆盖前者” |

新应用使用标准字段。JSON 标准 `duration` 使用数字，字符串兼容限定在明确保留的旧写法中。重复提供等价参数可以接受，冲突必须报错。多个素材来源同时提供时应拒绝歧义，不静默合并或覆盖。

### 2.4 公共缺省值与省略语义

基本字段的下列缺省值是 TokenOne 的公共请求约定，由插件显式构造，不声称全部等于上游默认值。已有值及兼容别名先归一并检查冲突，再只给未提供的字段补默认值。

| 公共模型范围 | duration | resolution | ratio |
| --- | --- | --- | --- |
| wan3.0-video、wan3.0-video-prime | 5 秒 | 1080P | adaptive |
| sd-2.0-ch1、sd-2.5-ch1/ch2/ch3 | 4 秒 | 720P | 16:9 |
| sd-2-c4、sd-2-c5 | 5 秒 | 720P | 16:9 |
| 知梦两款 Seedance 2.5 | 必填，无默认值 | 720P | 16:9 |
| MiniMax-H3 | 4 秒 | 2K | adaptive |
| 六款 Veo/Omni | 不接受该字段，不推断为 8 秒 | 由准确型号确定，见 3.2 | 必填，可由合法旧 size 等价取得 |

同一公共模型在多个自定义插件中采用相同的基本字段缺省语义。候选判断针对**本次归一化后的有效请求**：提供方不支持本次默认组合时拒绝本次请求；用户显式指定该提供方支持的组合时仍可处理，不永久排除该渠道。此规则不改变公共插件，不新增渠道发现或能力配置框架。

**非必填扩展未传就不传上游。** 不自动补 audio、watermark、prompt_extend、seed 等字段，不要求统一供应商内部的默认行为。明确传值时，插件保证同名字段语义一致且支持该值，否则报错；省略表示用户未指定这一选择。影响计费的省略行为仍须有安全预估依据，见 H3 fast_mode 的处理。

## 3. 逐型号能力与现状差异

核对时间：2026-10-31。以下是待实施的对外规则；“代码已有”“文档确认”“用户确认”“模拟通过”“真实验证”分别记录。文档和代码不一致时按文档设计变更；用户明确确认 RollDek WAN3 的时长及用量逻辑正确，相关部分沿用现有插件。表格不代表已上线。

### 3.1 身份、基本参数与提示词

比例集合为便于阅读的静态表记法，不是新增运行时注册机制：

- R3 = `16:9、9:16、1:1`。
- R6 = R3 加 `4:3、3:4、21:9`。
- R8 = R6 加 `3:2、2:3`。
- WAN-R = `16:9、9:16、1:1、4:3、3:4、adaptive`。
- H3-R = R6 加 `adaptive`。用户提供的 H3 界面截图确认“自动、21:9、16:9、4:3、1:1、3:4、9:16”；“自动”映射为 adaptive。

| 插件 / 公共模型 ID | 上游 model | duration 合法值 | resolution 合法值 | ratio 合法值 | prompt |
| --- | --- | --- | --- | --- | --- |
| RollDek / wan3.0-video、wan3.0-video-prime | 目标为同名、不加分辨率后缀 | 整数 2–30；用户确认沿用现有逻辑 | 480P、720P、1080P | R3 + adaptive；沿用插件集合 | 必填非空；文档未给字符上限 |
| RollDek / sd-2.0-ch1 | 同名 | 整数 4–15 | 720P | R8 | 必填非空；未给字符上限 |
| RollDek / sd-2.5-ch1 | 同名 | 整数 4–30 | 720P | R8 | 同上 |
| RollDek / sd-2.5-ch2 | 同名 | 整数 4–30 | 720P | R8 | 同上 |
| RollDek / sd-2.5-ch3 | 同名 | 整数 4–30 | 720P | R6 | 同上 |
| 知梦 / wan3.0-video、wan3.0-video-prime | 同名 | 整数 2–30；有参考视频时输入秒数 + 输出秒数 ≤30 | 480P、720P、1080P | WAN-R | 必填非空；未给字符上限 |
| 知梦 / sd-2-c4 | 同名 | 整数 4–15 | 720P | R3 | 去除首尾空白后 1–10000 字符 |
| 知梦 / sd-2-c5 | 同名 | 整数 4–15 | 720P | R6 | 同上 |
| 知梦 / sd2.5-官链-满参考-受排队影响 | 同名，UTF-8 原样 | 整数 4–30，必填 | 720P | R6 | 非空，网关沿用 7000 字符上限；文档将此上限列为工作台/调试台限制 |
| 知梦 / sd2.5-官转-30图10音频-火山词元 | 同名，UTF-8 原样 | 整数 4–30，必填 | 720P | R6 | 同上 |
| 知梦 / MiniMax-H3 | minimax-h3 | 整数 4–30；2K 仅 4–15 | 480P、768P、1080P、2K | H3-R；代码与用户截图一致 | 必填非空；未给字符上限 |
| 知梦 / 六款 Veo/Omni | 同名，逐项见 3.2 | 不支持请求时长 | 逐项见 3.2 | 16:9、9:16 | 非空，同时 ≤10000 Unicode 字符且 UTF-8 ≤16 KiB |

所有本期型号均不开放 `duration: -1`，也不接受 `0`。公共参数语义一致不表示这些独立 Seedance 型号是同一个官方模型，不把 sd-* 自动映射成 doubao-seedance-*。同名 WAN3 可以按共同能力构造同一请求；超出某插件能力则由 TokenOne 拒绝，不让应用切换私有协议。

依据：[RollDek WAN3](https://www.rolldek.com/docs/wan3.md)、[SD2.0 CH1](https://www.rolldek.com/docs/sd20-ch1.md)、[SD2.5 CH1](https://www.rolldek.com/docs/sd25-ch1.md)、[CH2](https://www.rolldek.com/docs/sd25-ch2.md)、[CH3](https://www.rolldek.com/docs/seedance-ch3.md)；知梦 [WAN3](https://zhimengapi.pages.dev/video/wan3)、[Seedance 2.0](https://zhimengapi.pages.dev/video/sd)、[Seedance 2.5](https://zhimengapi.pages.dev/video/seedance-2-5)、[H3](https://zhimengapi.pages.dev/video/minimax-h3)、[Veo/Omni](https://zhimengapi.pages.dev/video/veo)。本轮已读取上述页面正文。

### 3.2 素材能力、数量与组合

以下数量为每次请求上限；无素材时均可文生视频。I/V/A 分别表示 reference_image/reference_video/reference_audio，不包括将首尾帧当成普通参考图。首尾帧各最多一张；尾帧不能单独提交。

| 插件 / 模型 | 首帧 / 首尾帧 | I / V / A 数量 | 组合约束 |
| --- | --- | --- | --- |
| RollDek WAN3 两款 | 支持首帧；支持首尾帧 | 10 / 5 / 5，参考素材总数 ≤20 | 首尾帧与普通参考模式互斥 |
| RollDek sd-2.0-ch1 | 文档未列，公共入口暂不开放 | 9 / 3 / 3 | 三类参考按对应数组传递；不套用其他 Seedance 的帧能力；仅音频组合未确认，暂不开放 |
| RollDek sd-2.5-ch1 | 仅成对首尾帧，不支持单独首帧 | 30 / 10 / 10 | 首尾帧与参考数组二选一；仅音频组合未确认，暂不开放 |
| RollDek sd-2.5-ch2 | 仅成对首尾帧，不支持单独首帧 | 10 / 10 / 10 | 首尾帧与参考数组二选一；仅音频组合未确认，暂不开放 |
| RollDek sd-2.5-ch3 | 仅成对首尾帧，不支持单独首帧 | 9 / 0 / 0 | 首尾帧与参考图二选一；文档明确不支持参考视频/音频 |
| 知梦 WAN3 两款 | 支持首帧；支持首尾帧 | 10 / 5 / 5 | 首尾帧与所有普通参考互斥 |
| 知梦 sd-2-c4、sd-2-c5 | 支持首帧；支持首尾帧 | 图片含帧合计 ≤9；V ≤3；A ≤3；总数 ≤15 | 当前插件允许帧与参考混用；文档列出角色及合计额度、未禁止混用；保留已有行为，混合组合尚无本轮实测 |
| 知梦 Seedance 2.5 官链 | 不开放首尾帧角色 | 30 / 10 / 10 | 分类参考数组；各类型限额合计最多 50 |
| 知梦 Seedance 2.5 官转 | 不开放首尾帧角色 | 30 / 0 / 10 | 不发送 reference_videos，连空数组也不发送 |
| 知梦 MiniMax-H3 | 支持首帧；支持首尾帧 | 9 / 3 / 3 | 当前统一入口保持 frames 与 references 互斥；文档明确禁止帧 + 参考视频，其他跨模式组合不据此扩大支持 |

Veo/Omni 不支持参考视频、参考音频或帧与参考图混用；不能单凭图片数推断角色：

| 公共及上游 ID | 固定 resolution | 首帧 | 首尾帧 | reference_image |
| --- | --- | --- | --- | --- |
| veo-3.1-lite | 720P | 支持 | 支持 | 不支持 |
| veo-3.1-fast | 720P | 支持 | 支持 | 恰好 3 张 |
| veo-3.1 | 720P | 支持 | 支持 | 不支持 |
| veo-3.1-fast-1080p | 1080P | 不支持 | 不支持 | 不支持 |
| veo-3.1-1080p | 1080P | 支持 | 支持 | 不支持 |
| omni-flash-video | 720P | 不支持 | 不支持 | 1–3 张 |

URL 与文件要求：

| 范围 | URL 要求 | 文档公布的文件/时长限制 |
| --- | --- | --- |
| RollDek WAN3 | 公网可直接下载 HTTPS | 视频、音频各 ≤5 段；每段 1–15 秒；各自合计 ≤15 秒。相同视频 URL 的时长只计一次 |
| RollDek 四款 SD | 公网可直接下载 HTTPS | 文档未枚举文件大小、媒体时长上限；不挪用 WAN3 的 15 秒总量限制 |
| 知梦 WAN3 | 公网 HTTP(S) | 参考视频 MP4/MOV，每段 ≤15 秒且 ≤64 MiB，总视频时长 ≤15 秒，输入加输出 ≤30 秒；含视频的请求中其他素材也须 ≤64 MiB。音频单段 ≤15 秒是工作台要求/API 建议，不能写成已确认的全部 API 硬限制 |
| 知梦 Seedance 2.0 | 公网 HTTP(S) | 文档未列 API 文件大小或媒体时长上限；URL/数量预检不保证远程内容有效 |
| 知梦 Seedance 2.5 | 仅 `https://h3.juheai.club/m/<对象ID>` 的有效 public_url | 图片 JPG/PNG/WebP ≤20 MB；视频 MP4/MOV，单段 2–15 秒且 ≤50 MB；音频 MP3/WAV/M4A/AAC/OGG/FLAC，单段 ≤15 秒且 ≤30 MB；所有素材总计 ≤100 MB。不能套用合计 15 秒规则 |
| 知梦 H3 | 公网 HTTP(S)，可用自有对象存储 | 视频 MP4/MOV，单段 2–15 秒且 ≤50 MB，合计 ≤15 秒。图片 ≤15 MB、音频 ≤30 MB 且合计 ≤15 秒列在工作台上传要求中；音频 3 段为现有插件保留上限，不夸大为独立 API 已验证硬限制 |
| 知梦 Veo/Omni | 已上传到知梦工作台存储的公开 HTTPS 图片 URL；≤4096 字符，无查询参数、无片段 | 不接受任意第三方外链；文档未公布完整存储域名表，URL 格式由插件检查，实际存储归属由上游检查 |

公共素材接口并不意味着新增上传服务。知梦 Seedance 2.5 的 H3 上传需要另一把站点密钥；Veo 的工作台上传需要会话，视频 API Token 不等价。当前 TokenOne 插件没有代上传能力：有效专用链接可传，普通 CreativeOne 签名链接不满足要求时明确失败，不静默转存或让 CreativeOne 新增供应商适配。纯文生视频不受该素材地址障碍影响。远程文件验证仍按第 8 节交给上游，不新增下载探测框架。

### 3.3 当前已有能力与必须补充的实现

| 对象 | 当前代码已有 | 计划中的具体差异 |
| --- | --- | --- |
| RollDek WAN3 | 公共基本字段、五种素材角色、别名、预扣与实测用量结算 | 最新文档 model 不带后缀，修改上游 model 构造，保留公共身份；时长和用量逻辑按用户确认沿用；收紧标准字段类型与未知字段校验 |
| RollDek 四款 SD | 现有工作区草稿声明 doubao-* 并走火山接口，不是本表四款型号 | 新增本表按条型号及 v1/videos 转换、素材校验、按条 profile、查询下载；不把草稿 Token 计费套到这些型号 |
| 知梦 WAN3 | 公共基本字段、素材、四项扩展、参考视频账单读取 | 补 generate_audio/reference_voice 必要别名及冲突校验；代码只接受 HTTPS，按文档允许公网 HTTP(S)；补严格类型等共性回归 |
| 知梦 Seedance 2.0 / 2.5 | 公共基本字段、素材分类转换、独立型号与按条 profile | 补统一别名入口、严格类型、扩展拒绝与角色顺序回归；保留 SD2.5 专用 URL 限制；缺 URL 不反转可信成功状态 |
| 知梦 H3 | 4–15 秒、768P/2K、公共素材及三项计费量 | 扩为四档分辨率、4–30 秒，拒绝 2K + 长视频；补 fast_mode 和对应计费条件；H3 不复用 WAN 输入加输出 ≤30 秒的限制 |
| 知梦 Veo/Omni | size/generation_mode/reference_images 旧结构、型号与模式校验、按条计费 | 补公共 resolution/ratio/角色映射与旧结构冲突检查；文档禁止 URL 查询参数，修正当前允许签名参数的行为及旧模拟断言；缺 URL 不反转可信成功状态 |
| 公共 Doubao、Alibaba | 各自现有原生入口、公共入口适配及模型能力 | 保持各自协议，本期不修改；其能力不构成本表承诺 |

旧行为中确实无效或与上游文档相悖的输入可明确报错，不能为“兼容”继续无条件转发。已有有效原生接口和能力仍须回归，工作区未经定稿的草稿不作为已发布兼容承诺。

## 4. 公共字段与插件映射

### 4.1 WAN3 与 RollDek SD

下表均为通过校验后的构造，禁止展开客户端对象。RollDek 四款 SD 创建、查询、下载均使用 `/v1/videos` 系列路径，无需经过火山格式。

| 公共字段 | RollDek WAN3 | RollDek 四款 SD | 知梦 WAN3 |
| --- | --- | --- | --- |
| model | 同名，不加后缀（文档更新项） | 本表准确 ID 同名 | 同名 |
| prompt | prompt | prompt | prompt |
| duration | seconds，十进制整数字符串 | duration，整数 | duration，整数 |
| resolution | size，大写档位；不必重复发 resolution | resolution，小写 720p | resolution，大写档位 |
| ratio | aspect_ratio | aspect_ratio | aspect_ratio |
| metadata.input.media | 沿用 input.media，保留已验证角色和顺序 | I/V/A → image_refs/video_refs/audio_refs；帧 → first_image/last_image；按型号拒绝不支持角色 | metadata.input.media，同名角色 |
| metadata.parameters | 空白名单 | 空白名单 | 只构造 audio/seed/watermark/prompt_extend |

RollDek 的参考数组按每种角色的相对顺序排列；提示词 @Image1/@Video1/@Audio1 等引用不擅自改写。没有参考素材则省略参考字段；没有帧则不填帧字段。SD2.5 首尾帧同时发送，不能把用户的单首帧偷偷复制成尾帧。

### 4.2 知梦其他型号

| 公共字段 | Seedance 2.0 | Seedance 2.5 | MiniMax-H3 | Veo/Omni |
| --- | --- | --- | --- | --- |
| model | 同名 | 同名 | minimax-h3 | 同名 |
| prompt | input.prompt | prompt | prompt | prompt |
| duration | parameters.duration | duration | duration | 拒绝，不能忽略 |
| resolution | parameters.resolution = 720p | resolution = 720p | 480P→480p；768P→768P；1080P→1080p；2K→2K | 与 ratio 合成 size |
| ratio | parameters.ratio | ratio | aspect_ratio | 720P 横/竖→1280x720/720x1280；1080P 横/竖→1920x1080/1080x1920 |
| 素材 | input.media；reference_audio→reference_voice，其余角色保持 | reference_images/reference_videos/reference_audios 字符串数组 | image_urls/video_urls/audio_urls 字符串数组 | reference_images 字符串数组 |
| 可推导模式 | 不额外填 | 不额外填 | 有参考为 references；帧或无素材为 frames | 无素材 text；首帧 first_frame；首尾帧 first_last；普通参考 reference |
| metadata.parameters | 空白名单 | 空白名单 | fast_mode → 顶层 fast_mode | 空白名单 |

H3/Veo 的首尾帧输出固定首、尾顺序，不能依据输入数组位置猜测；普通参考按原相对顺序输出。Veo 必须显式发送推导的 generation_mode，尤其 Omni 的单张 reference_image 不能被上游默认解释成首帧。知梦 SD2.5 官转没有参考视频能力，不能发送空 reference_videos。

### 4.3 别名与身份边界

- 公共任务始终返回创建使用的公共 model，供应商改名只发生在上游请求/插件私有状态。
- 标准 duration 只接受 JSON 数字；seconds 等登记的历史别名可兼容整数字符串，不能让别名校验比标准字段宽松。
- size 只接受本型号登记的档位或精确像素映射；与 resolution/ratio 一起参与冲突检查。不得将 Seedance 2.5 文档的像素尺寸与旧 WAN 像素表混为同一映射表。
- 知梦 WAN3 的 generate_audio → metadata.parameters.audio，reference_voice → reference_audio；若同时传等价表示可以接受，冲突或多套素材来源则拒绝。
- 已有 H3/Veo 的 generation_mode 和素材数组属于旧请求兼容入口：单独旧结构按原有有效语义转换；与新结构混用拒绝歧义，不用后者覆盖前者。
- metadata.parameters 中已有的 duration/resolution/ratio 等历史位置只能作为登记的别名来源，不是允许扩展覆盖公共字段。新请求不再使用这些位置。
- 公共 Doubao、Alibaba 及各原生入口不被上述自定义插件转换规则重写。未证实等价的 RollDek SD、知梦 SD 与官方 Doubao 模型保持独立身份。

## 5. 扩展参数白名单

| 模型范围 | metadata.parameters 白名单 | 类型、范围与映射 | 省略行为 |
| --- | --- | --- | --- |
| 知梦 WAN3 两款 | audio、watermark、prompt_extend | JSON boolean，映射到同名上游 metadata.parameters 字段 | 不发送，不强行补 false |
| 知梦 WAN3 两款 | seed | JSON integer，沿用插件 -1…2147483647；0 保留；该界限为当前网关校验，文档只声明整数 | 不发送，不替用户选随机种子 |
| 知梦 MiniMax-H3 | fast_mode | JSON boolean，转顶层 fast_mode；false 标准、true 优先；影响价格 | 不发送；沿用旧插件的缺省请求及计费处理，不强行补 false |
| RollDek WAN3、四款 SD；知梦四款 SD、六款 Veo/Omni | 空白名单 | 只能省略或传 {}，其余字段明确拒绝 | 不构造扩展字段 |

H3 新客户端若选择了标准/优先通道，应显式发送 false/true；未选择则省略，不将这个非必填参数改成必填。用户已确认知梦 H3 的旧插件接入和计费逻辑可用，省略请求沿用已有处理，不再将缺省行为或计费响应字段列为资料缺口。新增显式 fast_mode 只需补对应参数校验、转发及计费条件，并回归原有缺省行为。

白名单之外的能力暂不对公共入口开放，不等于断言供应商永远不支持。扩展不能控制 model、prompt、duration、resolution、ratio、素材列表、url/base_url、headers、api_key 或鉴权方式。仅构造已校验字段；拒绝未知字段及非法 null；保留合法 0/false。新增计费扩展必须同时补预估和结算，不能只转发。

## 6. 计费用量、接口及验证依据

### 6.1 各模型计费来源

| 范围 | 预估与条件 | 完成后依据 / 限制 |
| --- | --- | --- |
| RollDek WAN3 | 沿用输出请求秒数 + 每个不同参考视频 URL 预估 30 秒；按冻结 resolution 计价 | 按用户确认保留：优先 body.usage，否则 metadata.usage；output_video_duration 缺省时取 duration，再加 input_video_duration。两项必须是有限非负数字，合计由宿主安全上限检查；不拼接两份不完整 usage |
| 知梦 WAN3 | 无参考视频为请求输出秒数；有参考为 min(输出 +15, 30) | 输出用合法 body.seconds；输入取匹配本任务、模型、消费类型的账单 other.reference_video_charge，核对秒数/分辨率/数量；缺失或非法保留预扣 |
| RollDek 四款 SD、知梦四款 SD、六款 Veo/Omni | video_count=1；Veo 冻结型号分辨率 | 可信生成成功结算一条，失败走现有退款；不按秒或名字中的“词元”推导计费单位 |
| 知梦 H3 | 输出秒数、resolution、fast_mode、输出长短时长档共同确定价格；额外图片 max(I−5,0)；有视频预估输入 15 秒 | 输出、额外图片、输入视频分别计价。输入使用可靠实际秒数；当前插件缺输出秒数时保留冻结请求时长，此为既有估计回退，不能称为上游实测。分辨率、通道等条件冻结为有效提交事实；计费用量使用可靠实际值 |

RollDek 每视频 30 秒是已有**预估保留量**，不是最新文档的素材时长上限；按用户要求沿用预扣再结算，不为本次统一重新设计。最新 model 去后缀不改变这套用量计算。历史日志字段与最新文档的差别不交给 CreativeOne 解释。

用户已确认知梦 H3 已由旧插件接入，计费响应解析、用量来源、预扣和结算沿用已有逻辑，不要求重新提供响应样例或重新研究协议。下面仅列新增参数能力对应的调整，不重建计费链路：

1. 输出 4–15 秒和 16–30 秒分别定价；长视频对整段输出采用长档单价，不是累进地只加价超过 15 秒的部分。
2. 标准/优先分别定价，不能把优先简单乘二；参考视频的秒单价与输出秒单价不同，图片第 6–9 张按相应时长档与通道计价。
3. 复用已有 seconds/reference_video_seconds/extra_image_count；扩充分辨率条件和 fast_mode 条件。时长档在预估时由有效请求秒数判断，结算时由经过校验的输出秒数判断；没有可靠实际输出量时按现有策略保留估计，不能把输入参考秒数算入输出时长档。表达式可直接判断 seconds，不新增冗余档位字段或计费框架，不修改未经授权的实际价格配置。
4. H3 文档没有 WAN3 的“输入 + 输出 ≤30 秒”限制。当前解析和结算共用了该限制，需按模型区分，否则合法的 30 秒输出加参考视频会错误保留预扣。H3 的输出上限改为 30，2K 仍 15，输入参考总时长仍 ≤15。
5. 计费响应和账单读取直接复用旧插件已接入的字段及匹配逻辑，不再列为待确认事项。保留已有用量校验、缺失或非法用量处理及预扣/结算策略；新增能力只做相应边界回归，不要求额外付费生成来重新证明已有接入。

### 6.2 上游查询与下载

| 范围 | 创建 / 查询 | 下载依据与策略 |
| --- | --- | --- |
| RollDek WAN3、四款 SD | POST /v1/videos；GET /v1/videos/{上游ID} | 文档明确 GET 同任务 /content + Bearer；固定可信 API 地址；签名存储直链无渠道鉴权 |
| 知梦 Seedance 2.5、Veo/Omni | 同上 | 文档明确受保护 /content 与公开结果地址两种；API Bearer 与 H3 公共 URL 不能混用 |
| 知梦 WAN3、Seedance 2.0、H3 | 同上 | 文档提供查询结果 URL，现有插件另有固定 API /content 下载回退；此回退为代码/历史依据，不写成每个文档已保证。分别验证公开/签名 URL 和 API Bearer 分支 |

所列上游 ID 只存服务端；应用仍用 TokenOne 公共 ID。所有页面列出 queued/in_progress/completed/failed，插件映射到宿主任务状态后按第 7 节对外呈现。生成完成与内容缺失分别处理。不能照抄供应商 curl -L 示例而向跨源目标发送密钥，也不承诺工作台的保存时长/下载次数等于直接 API 的服务保证。

### 6.3 验证记录与剩余事项

| 项目 | 文档 / 用户依据 | 代码与模拟 | 真实验证 |
| --- | --- | --- | --- |
| RollDek WAN3 | 文档确认无后缀 model、素材和价格维度；用户确认沿用现有时长/用量逻辑 | 当前公共转换、预扣/实际结算已有模拟覆盖；新 model 构造待实施 | WAN3_FOLLOWUP_HANDOFF.md 有 2026-10-18 旧后缀协议验证记录；不代表新 model 构造已实测 |
| RollDek 四款 SD | 本轮逐型号文档已读取 | 本表 v1/videos 映射未实现，火山草稿测试不能代替 | 未进行 |
| 知梦 WAN3 | 本轮文档已读取，省略扩展不发上游也已明确 | 现有字段、素材和账单结算模拟通过；别名/HTTP 差异待实现 | 同一历史交接记录有参考视频计费验证；不能覆盖本轮新别名或全部素材组合 |
| 知梦四款 SD | 本轮两份文档已读取 | 现有转换模拟通过；并未验证本表全部组合与新契约 | 本轮未进行 |
| 知梦 H3 | 文档确认四分辨率、4–30 秒、fast_mode 及费用组成；用户截图补齐比例 | 当前旧范围模拟通过；长视频、四分辨率、fast_mode 和计费分支未实现 | 用户确认旧插件已接入且可用，计费响应沿用现有逻辑；本轮未新增真实调用 |
| 知梦六款 Veo/Omni | 本轮文档已读取 | 当前旧结构测试通过；公共映射、URL 收紧及成功状态修正未实现 | 本轮未进行；存储域名归属最终由上游校验 |

本轮已执行（均为本地模拟，不含生成或下载真实上游结果）：

```bash
node --test zhimeng/plugin.test.mjs
# 15/15 通过；覆盖的是现有实现，不是尚未实现的新方案。
go test ./plugins -run '^(TestWAN3SharedRequests|TestWAN3RejectsConflictsBeforeSubmission|TestWAN3ChannelCapabilities|TestWAN3RollDekMediaOrderAndIdentity|TestWAN3CompletionAndDownloads|TestZhimengTaskContract|TestZhimengWAN3Media|TestZhimengSeedanceRequests|TestZhimengSeedanceMedia|TestWAN3RollDekReferenceVideoSettlement|TestRollDekNestedCompletionUsage|TestZhimengReferenceVideoBilling|TestZhimengMinimaxH3)$' -count=1
# 通过。断言旧限制的用例需随实现有针对性地更新，不能把通过当作文档映射已正确。
```

剩余事项不再笼统要求“补所有上游文档”：RollDek SD 的未公布文件限制及纯音频组合、知梦 SD2.0 的复杂混合素材、H3 新参数对应的校验和计费边界回归（响应读取沿用旧插件），以及新协议的查询/下载/凭证隔离，都按明确用例验证。未公布能力不能擅自开放；未提供可选扩展则直接省略，**不再把供应商扩展默认值一致作为定稿前置条件**。本轮不索要或使用生产密钥，不付费生成。

仓库依据：[Task Plugin API v1](docs/plugin-api/v1.md)、[计费规则](.agents/rules/billing.md)、[历史 WAN3 交接记录](WAN3_FOLLOWUP_HANDOFF.md)、rolldek/plugin.js、zhimeng/plugin.js 及其现有测试。公共 Doubao、Alibaba 保留为现状参考，不纳入本期实施保证。

## 7. 查询、下载与错误处理

### 7.1 复用现有宿主响应（review 第 5 项）

不设计新响应协议、错误码体系或包装层。创建回执使用宿主 `Task.ToOpenAIVideo()`；插件查询沿用现有 renderer，宿主覆盖公共身份、状态、进度和时间字段。插件无需各自重建这些标准字段。

自定义插件的公共查询 renderer 改为明确构造允许输出的字段，不能直接返回整个 `task.data`。宿主标准字段继续由宿主生成；本期插件可额外提供经审查的 `error.code`、`error.message`，没有可靠内容时省略。其他扩展默认不返回，确需保留时须逐字段说明用途、类型和脱敏规则，再加入输出白名单。供应商私有 ID、原始响应、上游 URL、签名查询参数、请求头和凭证不进入公共响应，错误文本也不能夹带这些内容。私有结果继续供服务端查询、下载与结算使用；原生入口保持原格式。

这是插件 renderer 的最小改动，不新增宿主清洗框架。现有宿主只替换已知 ID 字段，不会清理 URL 或其他字符串中的私有 ID；因此不能把宿主覆盖标准字段当成完整脱敏。下表区分现有宿主固定字段与本期插件输出约束，白名单收紧尚未实现。

创建返回的 id、后续查询和下载使用的 id 均为 TokenOne 公共任务 ID。供应商私有任务 ID 仅在服务端转换。

| 字段 | 类型/必填性 | 现有行为及应用用法 |
| --- | --- | --- |
| id | string，固定字段 | 公共任务 ID，后续查询和下载使用此值 |
| object | string，固定字段 | video |
| model | string，固定字段 | 创建任务的公共模型身份 |
| status | string，固定字段 | 以此判断生命周期，不能用 progress 推断完成 |
| progress | integer，固定字段 | 百分数整数，正常进度为 0–100，不带百分号；来自保存的任务进度，宿主转换不是范围校验器，不保证单调或实时；异常范围不能触发完成判断 |
| created_at | integer，固定字段 | Unix 时间戳，单位秒 |
| completed_at | integer，可选 | 成功且时间非零时存在；优先使用完成时间，否则使用任务更新时间；处理中、失败时省略 |
| error | 查询中可选，不保证 | 本期插件只输出经审查的 code/message，宿主不统一补齐；缺失时应用仍按 failed 显示通用失败提示 |
| 其他字段 | 默认不输出 | 仅限逐字段明确批准的安全扩展；应用不依赖供应商私有状态、URL 或计费用量字段控制流程 |

创建与正常查询成功返回 HTTP 200。创建回执不保证一定为 queued：立即完成的任务可能直接返回 completed 或 failed。创建回执由宿主生成，不保证携带失败详情；需要时查询同一个公共任务 ID。

应用使用统一状态：

| 状态 | 应用行为 |
| --- | --- |
| queued | 等待并轮询同一任务 |
| in_progress | 继续轮询同一任务 |
| completed | 请求网关 content 接口下载 |
| failed | 展示失败原因，不自动重新生成 |
| unknown 或其他未知值 | 防御性处理为无法确认状态，记录异常并查询同一任务，不当作 completed，也不重新生成 |

供应商未知状态不能伪装成正常处理中，按现有宿主轮询失败策略处理。应用不依赖 task.data 中的供应商私有状态、URL 或字段。

生成状态与内容可用性分别处理：

| 上游事实 | 公共任务状态与处理 |
| --- | --- |
| 有可信依据确认生成完成 | 映射为 completed，按现有成功结算流程处理 |
| 已确认生成完成，但缺少结果 URL、URL 失效或下载接口暂不可用 | 仍为 completed；由 content 接口报告内容问题，不能改为 unknown/failed 或触发生成失败退款 |
| 上游状态未知、响应无效或成功标记与明确错误相冲突，无法确认生成完成 | 沿用未知状态与查询异常策略；不能只凭 URL 存在就认定成功 |
| 有可信依据确认生成失败 | 映射为 failed，沿用现有失败结算/退款流程 |

当前知梦 Seedance/Veo 在成功响应缺少 URL 时会改为 UNKNOWN，实施时应在插件内修正。结果地址提取失败与内容下载失败放在内容处理链路，不反转已经确认的生成成功。内容接口沿用第 7.3 节现有错误；具备现有刷新手段时可恢复同一任务的内容，否则明确报告不可用，不新增生成或下载状态体系。缺少实际用量仍遵循第 8 节安全策略，与是否能下载无关。

### 7.2 JSON 示例

以下为现有宿主格式示例，ID、时间、进度和错误文案为示意值，不是新增固定常量。示例省略不应依赖的供应商扩展字段。

创建成功（HTTP 200）：

```json
{
  "id": "task_public",
  "object": "video",
  "model": "wan3.0-video",
  "status": "queued",
  "progress": 0,
  "created_at": 1793400000
}
```

查询处理中（HTTP 200）：

```json
{
  "id": "task_public",
  "object": "video",
  "model": "wan3.0-video",
  "status": "in_progress",
  "progress": 40,
  "created_at": 1793400000
}
```

查询完成（HTTP 200）；随后请求 `/v1/videos/task_public/content`，不需要响应提供供应商下载 URL：

```json
{
  "id": "task_public",
  "object": "video",
  "model": "wan3.0-video",
  "status": "completed",
  "progress": 100,
  "created_at": 1793400000,
  "completed_at": 1793400060
}
```

查询到任务失败（仍为 HTTP 200，表示本次查询成功）；下例展示插件结果含有 error 时的形态：

```json
{
  "id": "task_public",
  "object": "video",
  "model": "wan3.0-video",
  "status": "failed",
  "progress": 0,
  "created_at": 1793400000,
  "error": {
    "code": "provider_error",
    "message": "provider rejected request"
  }
}
```

error 的内容由插件在白名单内提供，此示例不是所有任务失败都具备 code/message 的保证。应用读取可用的错误消息；没有可用消息时展示通用失败提示，不能解析供应商私有状态来覆盖宿主 status。

### 7.3 下载与 HTTP 错误

下载策略：

- 官方签名存储 URL 使用无渠道凭证请求，保留合法签名查询参数。
- 需要 Bearer 的供应商下载接口，只向受信任的明确下载地址发送渠道凭证。
- 不向任意返回 URL 或跨源重定向发送渠道密钥。
- 保留宿主任务归属、有效用户、模型权限及渠道约束。
- 下载失败保留任务，不调用 POST /v1/videos；可恢复下载或重新查询同一任务。

普通完整下载返回媒体字节，不包装为 JSON；支持范围请求时可能返回 206，按实际 HTTP 状态及 Content-Type 处理。下面记录 `/content` 当前普通 Bearer 请求路径的错误，不将其他 artifact 接口的状态混用进来：

| 场景 | 当前 HTTP 状态/错误形态 | 应用处理 |
| --- | --- | --- |
| 任务尚未成功 | 400，error.type = invalid_request_error，message 包含当前任务状态；可能没有 code | 重新查询同一任务，未完成前不下载 |
| 任务不存在或不属于当前用户 | 404，error.type = invalid_request_error | 按不可访问处理，不重新生成 |
| 结果 URL 缺失、内容失效或上游下载返回 404/410 | 410，error.type/code = artifact_gone | 报告资源不可用，不重新生成 |
| 上游 JSON 内容操作尚未完成（使用相应内容提取机制时） | 409，artifact_not_ready | 这是该上游内容分支的错误，不是所有未完成任务的通用返回 |
| Token 校验失败 | 401，沿用鉴权中间件现有 error 结构 | 检查 TokenOne 用户 Token |
| IP 等访问约束不满足 | 403，沿用鉴权中间件现有 error 结构 | 检查权限及访问约束 |
| 其他上游、代理或网络错误 | 沿用宿主实际状态和错误，不新增统一错误码 | 对可重试 GET 退避重试，不重提生成 |

任务尚未完成时 `/content` 的示例（HTTP 400）：

```json
{
  "error": {
    "message": "Task is not completed yet, current status: IN_PROGRESS",
    "type": "invalid_request_error"
  }
}
```

内容已失效的示例（HTTP 410）：

```json
{
  "error": {
    "message": "Artifact content is no longer available",
    "type": "artifact_gone",
    "code": "artifact_gone"
  }
}
```

应用优先检查 HTTP 状态，再读取现有错误消息；不能假定所有错误都有相同 code/type 字段。查询接口的请求错误同样沿用现有实现，不承诺与 `/content` 完全一致，例如当前任务查询构建路径的 task_not_exist 使用 400。本方案不为了文档整齐而改变这些响应。

实现依据：`model/task.go` 的 `ToOpenAIVideo`、`relaykit/dto/openai_video.go`、`relay/channel/task/jsplugin/adaptor.go` 的 `ConvertToOpenAIVideo`、`controller/relay.go` 的创建呈现、`controller/video_proxy.go`、`controller/task.go`、`relay/relay_task.go` 和 `router/task-plugin-protocol-router.go`。响应示例基于代码核对，未据此声称真实上游验证完成。

错误处理建议：

CreativeOne 与 TokenOne 各自负责所在一跳的重试策略和配置，不共享重试次数、不通过公共参数控制对方重试，也不根据对方内部尝试次数选择行为。以下应用建议不要求修改 TokenOne 的重试机制。review 发现的重复提交风险来自 TokenOne 宿主已有重试路径，并非插件主动重发；`common/constants.go` 的 `RetryTimes` 默认值为 0，只有配置启用重试且错误满足重试条件时才可能发生。提交已到上游但响应丢失/解析失败等结果未知情形不能证明未受理。这作为独立宿主可靠性问题记录，不扩入本次参数契约实现，也不据此承诺创建具备幂等或恰好一次语义。查询、下载恢复不得重新生成的要求仍然成立。

- 参数类型、别名冲突、不支持能力、计费边界：提交前返回明确的 400 错误，应用提示用户调整参数，不自动换参数再提交。
- 401/403：检查 TokenOne 用户凭证与权限，不切换到供应商密钥。
- 404：按不存在或无权访问处理，不通过暴露私有 ID 帮助定位他人任务。
- 查询或下载的限流、网络错误和临时服务异常：退避重试同一 GET；遵守返回的 Retry-After（如有）。
- 创建请求超时且受理结果不明：保留“提交结果未知”状态，不盲目重试 POST；本方案不新增幂等键保证。
- 完成后下载资源过期或不可用：报告下载问题，不自动重新生成视频。

## 8. 计费与安全约束

### 8.1 沿用现有预扣与结算（review 第 4 项）

沿用“安全预估并预扣 → 完成后按可信实际用量结算、多退少补”的现有流程，不为参数统一新增媒体下载、时长探测、转码或另一套计费机制。预扣用于处理用量预估，不能代替请求参数校验，也不表示供应商一定接受素材。

校验职责分开：

| 校验对象 | 责任与处理 |
| --- | --- |
| 请求里能够确定的类型、取值、别名冲突、素材数量和角色组合 | 自定义插件提交前校验，不支持则明确拒绝 |
| 远程素材实际时长、编码、实际内容等需要读取文件才知道的属性 | 由供应商读取后校验；不新增网关素材探测流程，不承诺全部能在提交前发现 |
| 客户端填写的素材时长、tokens、charge 等计费信息 | 不作为可信依据，不允许绕过校验或降低预扣 |
| 完成后返回的实际用量或已有账单读取结果 | 沿用各插件现有校验、宿主用量边界和结算机制 |

逐型号能力记录中说明已有预估依据、实际用量来源和异常处理即可，不要求所有供应商采用相同估算公式。未知输入量沿用对应插件现有安全预估；缺失或非法实际用量保留现有预扣/告警策略，不自行置零。任务失败沿用现有退款规则；生成已完成但下载失败，不重新生成，也不把下载失败误判为生成失败。

### 8.2 必须保留的约束

1. 解码、提交、用量提取使用同一套有效参数，预估必须对应最终发往上游的请求。
2. 标准字段、兼容别名、扩展字段、multipart 与素材条目都不能成为计费校验旁路。
3. 客户端不可通过素材中的 duration、tokens、charge 等信息决定用量。
4. 自动时长按模型最大时长预估；参考视频提交时沿用插件安全预估，完成后的实际用量依据供应商可靠统计，不能根据金额反推。
5. 成功后使用可靠上游实际用量结算，多退少补；缺失、非法用量沿用宿主保留预估/记录告警等现有安全策略，不自行降为零。
6. 不同提供方可以使用不同计费单位：秒、Token、条数等。公共模型身份相同不要求计费表达式相同。
7. 继续使用 usageSchema、usageProfiles 和现有 usage hooks，不引入另一套计费框架。
8. 新增用量元数据的 description 使用“计费对象 + 单价”，单位放在 unit；描述审查与程序测试分别进行。
9. 任何涉及鉴权或下载凭证的修改应遵循 OWASP ASVS 5.0.0 及适用的 Authentication、Session Management 指南，验证归属、凭证隔离和服务端授权；本方案不宣称已完成全面 ASVS 合规认证。

参考：[OWASP ASVS](https://asvs.owasp.org/)、[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

## 9. CreativeOne 迁移

配套交付：[CreativeOne 视频接口升级指南](CREATIVEONE_VIDEO_UPGRADE_GUIDE.md)（review 第 6 项）。指南覆盖能力配置、具体改动位置、请求转换、创建/查询/下载示例、错误与任务恢复、切换条件和验收；当前为待实施指南，不代表应用已升级。

只读检查发现：CreativeOne 当前 Seedance 走 contents/generations/tasks 原生路径，其他视频主要走 videos，但 H3/Veo 仍有专用请求格式。当前服务端已经统一使用 TokenOne 公共 ID 和 content 接口鉴权下载，可直接复用；查询和应用结果呈现仍保留原生/公共路径分支。仅改创建 URL 不足以完成迁移。

CreativeOne 升级后的新视频创建统一使用本规约，不按插件、供应商或分组选择请求格式。公共模型的产品选项可以复用应用现有配置；具体插件能力差异、候选筛选和最终校验由 TokenOne 处理。分组接入不兼容插件导致错误时正常报错，不自动兼容其私有协议。已有历史任务继续使用保存的查询路径与 ID；这是历史恢复兼容，不是新请求的供应商分支。TokenOne 公共 Doubao、Alibaba 插件和原生入口保持现状，供其已有客户端使用。

| CreativeOne 文件/位置 | 计划调整 |
| --- | --- |
| shared/video-models.ts、web/src/lib/video-settings.ts | 仅维护公共模型的产品选项与默认值，不建立插件能力或分组兼容表；工作台/画布一致 |
| shared/video-request.ts | 新视频调用统一构造公共字段和素材角色；输出声音开关放 metadata.parameters.audio |
| shared/video-tasks.ts | 新任务统一使用 videos；历史任务沿用已保存路径 |
| web/src/services/api/video.ts | 统一创建和轮询，按 queued/in_progress/completed/failed 判断 |
| server/src/model-capabilities.ts | 校验公共结构、产品开放参数及应用权限，不复制供应商限制；最终插件能力校验由 TokenOne 执行 |
| server/src/video-tasks.ts | 复用已有 TokenOne content 鉴权下载与文件落库，保留恢复语义，不读取供应商 URL |
| server/src/tokenone.ts | 新视频请求统一使用 /v1/videos；原生路径重写仅保留历史任务查询所需部分 |
| server/src/ai.ts、generation-executor.ts | 公共结构校验和素材签名保持一致，保留素材归属验证 |
| shared/canvas-request.ts、server/src/agent/tools.ts、server/src/agent/site-tools.ts 及画布任务调用 | 与工作台共用公共请求构造和路径选择，覆盖全部生成入口 |
| 现有提交确认、任务恢复与下载恢复逻辑 | 保留公共任务 ID；恢复查询/下载不得重新提交生成 |

TokenOne 用户 API Token 继续只放在 CreativeOne 服务端，不下发浏览器。供应商渠道密钥只保留在 TokenOne 服务端。

### 9.1 创建示例

```bash
curl --request POST "$TOKENONE_BASE_URL/v1/videos" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "wan3.0-video",
    "prompt": "人物缓缓转身",
    "duration": 6,
    "resolution": "720P",
    "ratio": "16:9",
    "metadata": {
      "input": {
        "media": [
          {"type": "first_frame", "url": "https://example.com/start.jpg"}
        ]
      },
      "parameters": {}
    }
  }'
```

该示例面向已适配的自定义万相插件渠道，不代表公共 Alibaba 插件承诺相同契约。保存返回的公共 id。示例地址需替换为可读取的实际素材；只在获准真实生成后执行。RollDek Seedance 可使用公共模型 sd-2.0-ch1 或 sd-2.5-ch1/ch2/ch3，映射与示例见第 3–4 节及升级指南；不使用豆包型号代替它们。

### 9.2 查询示例

```bash
curl "$TOKENONE_BASE_URL/v1/videos/$PUBLIC_TASK_ID" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN"
```

只按统一 status 判断任务是否完成，不读取供应商私有状态或把上游 ID 当作公共 ID。

### 9.3 下载示例

```bash
curl --fail-with-body \
  "$TOKENONE_BASE_URL/v1/videos/$PUBLIC_TASK_ID/content" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN" \
  --output output.mp4
```

由应用服务端执行。网关负责上游签名 URL 或 Bearer 下载协议，不要求应用跟随供应商重定向。应用实现应先检查 HTTP 状态和 Content-Type，再把响应保存为视频；下载失败仅重试此步骤。

## 10. 实施与验收

实施顺序：

1. 先定稿公共参数、默认值、别名规则和逐模型能力矩阵，补齐待验证事项。
2. 仅在本期自定义插件中实现校验与必要字段转换；RollDek Seedance 优先 `/v1/videos → /v1/videos`。保持各插件可独立上传，不跨插件导入源码，不修改公共 Doubao、Alibaba 插件。
3. 进入插件执行路径后，复用宿主候选筛选：插件解码器拒绝不支持的请求，宿主在符合既有约束的插件候选中选择可处理的渠道。普通渠道保持原有路由和协议行为，不纳入本次统一契约保证。
4. 复用任务查询、下载、归属和计费机制；确需修改宿主时先说明缺口。
5. 扩展自定义插件相关现有测试，回归其已有能力和必要别名，确认不改变公共插件行为。
6. 交付最终契约、能力矩阵、实际执行的测试记录和 CreativeOne 迁移说明。
7. 真实上游验证、付费生成和线上部署在另行授权后进行。

验收用例至少覆盖：

- 相同公共请求在支持能力的供应商之间保持时长、分辨率、画幅和素材角色语义一致。
- 公共模型到上游型号映射正确，公共任务模型身份不被改写。
- 首尾帧倒序输入、参考素材顺序、数量上限和非法组合。
- 默认值只补缺省字段；不能处理缺省组合的候选仍可处理显式合法组合。显式 seed 0、布尔 false、缺省与 null 的区别；未传扩展不写入上游。
- seconds/size/aspect_ratio 等别名等价与冲突，扩展字段覆盖和未知字段。
- 超大、负数、零、非整数、非法类型及素材伪造计费信息。
- 解码重复执行稳定，预估用量与实际提交参数一致。
- 请求中可确定的非法参数在提交前拒绝；远程素材不符合供应商限制时沿用上游失败与退款链路，不为测试新增媒体探测框架。
- 成功实际用量、缺失用量、非法用量、失败退款与下载失败不重新生成。H3 覆盖 15/16/30 秒、2K 长视频拒绝、fast_mode 两种显式值及省略、参考视频与第 5/6/9 张图片的计费边界；RollDek SD 按条而非 Token 计价。
- 可信生成成功但缺少 URL、URL 失效或下载暂不可用时保持 completed，不能进入生成失败退款链路；无法确认生成成功的响应仍按查询异常处理。
- 公共响应白名单与错误脱敏：原始供应商字段、非标准位置的私有 ID、上游 URL、签名及凭证不外泄；原生呈现保持既有兼容。
- CreativeOne 新调用不按插件或分组切换格式；分组含不兼容插件时正常呈现错误，不重写参数或自动改走原生入口。
- 公共创建回执、统一查询状态、任务归属、无效凭证、模型权限和渠道选择约束。
- 现有响应固定字段和可选字段、立即完成回执、缺少 error 的失败任务、下载未完成的 400 与内容失效的 410；不新增响应包装或错误码体系。
- 签名存储下载、Bearer 下载、跨源重定向、任意返回 URL 的凭证隔离。
- 已有原生接口和插件能力不回退；有意收紧公共入口的行为需逐项说明。

模拟测试与真实验证分别报告。工作区已有实现草稿和部分测试执行记录，但未按本方案完成全部验收；方案定稿后应重新审查草稿，不直接把它作为最终实现。此前公共 Doubao、Alibaba 插件相关草稿不属于本期最终变更；RollDek Seedance 强制走火山格式的草稿也需按本次接口选择结论重新审查。本次仅更新方案，未清理或继续修改这些实现草稿。
