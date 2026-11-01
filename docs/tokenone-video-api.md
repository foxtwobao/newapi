# TokenONE 标准视频 API 调用规范

规范版本：1；更新日期：2026-10-31。本文为仓库内部的公共契约与自定义视频插件开发规范。

对客户发布使用 [TokenONE 视频 API 客户文档](tokenone-video-api-public.md)，不发布本文的提供方信息、插件映射和未上线型号能力。客户文档同时维护通用契约与已上线模型的 TokenONE 参数要求；型号条目只展示转换后的公共字段、取值、限制和调用示例，具体型号要求在上线后逐项补充。

本规范定义统一调用契约。**规范发布不等于所有部署中的插件已经升级**：模型是否开放、具体能力是否已适配，以当前账号和部署版本为准。未适配的请求可以明确失败，应用不得自动删参数、降级或改走供应商私有协议。下列型号表是适配标准，其中 RollDek SD、H3 新档位及 Veo 公共参数映射等仍需插件实现后才能使用。

本文约束 TokenONE 自行维护、声明遵守此规范的视频插件（当前包括 RollDek、知梦，后续新增自定义视频插件同样遵守）。公共 Doubao、Alibaba 等历史插件及其原生入口保留原协议，不因本文被强制改造。统一采用公共参数，供应商差异由插件转换；不要求各模型支持相同的能力全集。

## 1. 接口、鉴权与任务 ID

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 创建视频 | POST | `/v1/videos` |
| 查询任务 | GET | `/v1/videos/{id}` |
| 下载成片 | GET | `/v1/videos/{id}/content` |
| 获取下载响应头 | HEAD | `/v1/videos/{id}/content` |

- API 根地址不包含 `/v1`。例如 `https://token.agentone.work`；自建部署使用其实际地址。
- 所有请求携带 `Authorization: Bearer <TokenONE 用户 API Token>`；创建请求使用 `Content-Type: application/json`。
- `id` 始终是创建响应中的 **TokenONE 公共任务 ID**。不要使用供应商内部任务 ID，也不要依赖旧字段 `task_id`。
- TokenONE 用户 Token 保存在应用服务端；供应商渠道密钥仅保存在 TokenONE 服务端。客户端不识别供应商、不解析供应商结果 URL、不持有渠道密钥。
- 查询与下载必须有权访问原任务，不能通过更换账号或渠道绕过任务归属、模型权限和渠道约束。

流程：创建一次 → 保存 `id` → 查询同一任务 → `completed` 后下载并保存。下载失败只能恢复原任务的查询或下载，不能自动重新生成。

## 2. 标准创建请求

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
        {"type": "first_frame", "url": "https://example.com/start.jpg"}
      ]
    },
    "parameters": {}
  }
}
```

示例素材地址必须替换为真实可访问文件。只在获得真实生成授权的环境中执行创建示例；创建可能产生费用。

### 2.1 公共字段

| 字段 | JSON 类型 | 含义与规则 |
| --- | --- | --- |
| `model` | string | 必填，公共模型身份，准确 ID 见第 4 节。不要拼供应商名称或分辨率后缀 |
| `prompt` | string | 必填非空提示词；长度按模型限制，不能静默截断 |
| `duration` | number | 输出视频秒数；当前可控时长的型号均要求整数。Veo/Omni 不接受此字段 |
| `resolution` | string | 输出分辨率档位，如 480P、720P、768P、1080P、2K；只接受对应型号的集合 |
| `ratio` | string | 输出宽高比，如 16:9、9:16、adaptive；只接受对应型号的集合 |
| `metadata` | object | 可省略；仅包含约定的 input、parameters，不是任意透传容器 |
| `metadata.input` | object | 可省略；素材放在 media 中 |
| `metadata.input.media` | array | 可省略或空数组；每项仅含 type、url |
| `metadata.parameters` | object | 可省略或 {}；按模型扩展白名单校验，未知字段报错 |

`720P` 表示分辨率档位，不承诺输出恰好为 1280×720；像素尺寸还取决于画幅。不得把 768P 近似为 720P，或把 2K 改成 1080P。`adaptive` 表示允许模型自动选择画幅，与“未提供 ratio”不同。

一次创建对应一个任务。本规范不默认开放 `n`、`fps`、`width`、`height`、任意 `headers`、文件上传、视频编辑或其他 OpenAI SDK 字段。需要扩展时必须明确型号、语义、限制和计费影响，不能假定接口路径相同即全部兼容。

### 2.2 省略、零值与默认值

- 基本字段缺省值见第 4 节。先处理别名及冲突，再只为未提供字段补默认值，不覆盖用户选择。
- 显式 `0`、`false`、`null` 与未提供不是同一回事。合法的 `seed: 0`、布尔 `false` 必须保留；非法 null、错误类型、超界值必须报错。
- 当前型号均不接受 `duration: 0` 或 `duration: -1`。不把 -1 当成省略或默认时长。
- 非必填扩展未传就不传上游，不统一补 false，也不强求不同供应商内部默认值相同。要求关闭某能力时应明确传 false，并由插件检查是否支持。
- 同一公共模型使用相同的基本字段缺省语义。提供方不支持本次默认组合时拒绝本次请求；用户显式选择该提供方支持的组合时仍可处理，不永久排除该渠道。

### 2.3 兼容别名

新应用仅使用标准字段。插件可以保留明确登记的旧写法，但必须归一后检查冲突：

| 兼容写法 | 标准字段 | 规则 |
| --- | --- | --- |
| seconds | duration | 历史整数字符串 "6" 与数字 6 可等价；标准 duration 仍须数字 |
| aspect_ratio | ratio | 标准化后不一致则拒绝；已登记的 auto 等价于 adaptive |
| size: "720P" | resolution | 与标准字段比较，冲突则拒绝 |
| size: "1280x720" | resolution + ratio | 只接受本型号登记的精确映射；不能近似猜测其他尺寸 |
| 历史扩展或素材位置 | 对应标准字段 | 必须逐项登记；不能让扩展覆盖公共字段，不能合并多套有歧义的素材来源 |

例如同时提交 `duration: 6` 与 `seconds: "5"` 必须报错；同时提交等价的 6 可以接受。别名不能绕过数量、范围或计费校验。

## 3. 统一素材结构

| type | 含义 | 规则 |
| --- | --- | --- |
| first_frame | 指定首帧 | 最多一张；只有型号支持时可用 |
| last_frame | 指定尾帧 | 最多一张；本期型号必须同时提供首帧 |
| reference_image | 主体、外观、风格参考图 | 不得自动改成首帧 |
| reference_video | 动作、镜头等参考视频 | 不能携带客户端自报的计费时长 |
| reference_audio | 输入参考音频 | 与输出声音开关 audio 独立 |

每项为 `{"type":"reference_image","url":"https://example.com/image.jpg"}`。角色决定语义；即使 last_frame 在数组中先出现，也必须正确转换为尾帧。普通参考素材保留相对顺序；转为分类数组时保留每类内部顺序。首尾帧与参考模式是否可混用，以具体型号规则为准。

素材必须是上游可读取的公网文件地址，不是展示网页、相对路径、本地路径、Base64、data URL、blob URL 或需要浏览器 Cookie 的页面。普通模型推荐 HTTPS；明确支持 HTTP 的提供方可接受公网 HTTP。不要将 TokenONE Token 放在 URL 中。

签名 URL 有效期需覆盖排队和处理过程，但**并非所有模型接受任意签名链接**：知梦 Seedance 2.5 要求 H3 专用 public_url；Veo/Omni 要求知梦工作台存储图片且不允许查询参数或片段。当前统一接口不提供代上传服务，应用不需要新增供应商密钥或上传协议；不符合素材要求时明确报错。纯文生视频不受素材地址限制影响。

URL 格式、数量与组合由插件预检；实际格式、文件大小、真实时长和可读性由上游读取文件后校验。不能将“通过 URL 校验”解释为必然生成成功。客户端自报 duration、tokens、charge 等素材字段不接受、不作为计费依据。

## 4. 模型参数与能力

下面是标准适配范围，不是上线清单。同一公共模型在不同提供方的能力可以不同；应用构造公共请求，TokenONE 负责最终校验。分组接入未适配插件而导致错误时，应用正常展示错误，不自动换格式或修改参数。

### 4.1 基本参数

为简化表格：R3 = `16:9、9:16、1:1`；R6 = R3 加 `4:3、3:4、21:9`；R8 = R6 加 `3:2、2:3`。

| 公共 model | duration | resolution | ratio | 缺省：秒 / 分辨率 / 画幅 |
| --- | --- | --- | --- | --- |
| wan3.0-video、wan3.0-video-prime | 2–30 整数 | 480P、720P、1080P | 16:9、9:16、1:1、4:3、3:4、adaptive；具体提供方可为子集 | 5 / 1080P / adaptive |
| sd-2.0-ch1 | 4–15 整数 | 720P | R8 | 4 / 720P / 16:9 |
| sd-2.5-ch1、sd-2.5-ch2 | 4–30 整数 | 720P | R8 | 4 / 720P / 16:9 |
| sd-2.5-ch3 | 4–30 整数 | 720P | R6 | 4 / 720P / 16:9 |
| sd-2-c4 | 4–15 整数 | 720P | R3 | 5 / 720P / 16:9 |
| sd-2-c5 | 4–15 整数 | 720P | R6 | 5 / 720P / 16:9 |
| sd2.5-官链-满参考-受排队影响 | 4–30 整数，必填 | 720P | R6 | 无时长默认值 / 720P / 16:9 |
| sd2.5-官转-30图10音频-火山词元 | 4–30 整数，必填 | 720P | R6 | 无时长默认值 / 720P / 16:9 |
| MiniMax-H3 | 4–30 整数；2K 最长 15 秒 | 480P、768P、1080P、2K | R6 + adaptive | 4 / 2K / adaptive |
| 六款 Veo/Omni（下表） | 不支持，不能传入 | 由型号固定 | 16:9、9:16 | 不传时长 / 型号固定 / 画幅必填 |

SD 独立型号不自动等价于官方 Doubao 型号，不应互相替换。MiniMax-H3 使用上述公共大小写；供应商的 minimax-h3 由插件转换。Veo/Omni 不能根据工作台的“8 秒”展示文字推导可控或保证时长。

提示词限制：sd-2-c4/c5 去除首尾空白后为 1–10000 字符；两款知梦 Seedance 2.5 沿用 7000 字符上限；Veo/Omni 同时限制 10000 Unicode 字符和 UTF-8 16 KiB。其他表列型号要求非空，未公布的字符上限不擅自编造，也不截断用户内容。

### 4.2 素材能力

I/V/A 分别指普通参考图片/视频/音频数量上限。首尾帧各至多一张，普通参考限额不能用来推断支持首尾帧。

| 型号 / 提供方 | 首帧与首尾帧 | I / V / A | 组合规则 |
| --- | --- | --- | --- |
| WAN3 两款 / RollDek、知梦 | 单首帧、首尾帧 | 10 / 5 / 5 | 首尾帧与普通参考互斥；RollDek 参考素材总数 ≤20 |
| sd-2.0-ch1 / RollDek | 未开放 | 9 / 3 / 3 | 分类参考；仅音频组合尚未确认，暂不开放 |
| sd-2.5-ch1 / RollDek | 仅成对首尾帧 | 30 / 10 / 10 | 帧与参考互斥；仅音频组合尚未确认，暂不开放 |
| sd-2.5-ch2 / RollDek | 仅成对首尾帧 | 10 / 10 / 10 | 帧与参考互斥；仅音频组合尚未确认，暂不开放 |
| sd-2.5-ch3 / RollDek | 仅成对首尾帧 | 9 / 0 / 0 | 帧与参考图互斥，不支持参考视频/音频 |
| sd-2-c4、sd-2-c5 / 知梦 | 单首帧、首尾帧 | 图片含帧合计 9 / 3 / 3；总数 ≤15 | 沿用已有帧与参考混用能力，不套用 WAN3 的互斥规则 |
| sd2.5-官链-满参考-受排队影响 / 知梦 | 不支持角色映射 | 30 / 10 / 10 | 仅分类参考，使用 H3 public_url |
| sd2.5-官转-30图10音频-火山词元 / 知梦 | 不支持角色映射 | 30 / 0 / 10 | 不支持参考视频，使用 H3 public_url |
| MiniMax-H3 / 知梦 | 单首帧、首尾帧 | 9 / 3 / 3 | 统一入口保持 frames 与 references 互斥 |

Veo/Omni 均支持文生视频，仅支持图片输入，不支持帧与普通参考混用：

| 公共型号（知梦） | 固定分辨率 | 单首帧 | 首尾帧 | 普通参考图 |
| --- | --- | --- | --- | --- |
| veo-3.1-lite | 720P | 支持 | 支持 | 不支持 |
| veo-3.1-fast | 720P | 支持 | 支持 | 恰好 3 张 |
| veo-3.1 | 720P | 支持 | 支持 | 不支持 |
| veo-3.1-fast-1080p | 1080P | 不支持 | 不支持 | 不支持 |
| veo-3.1-1080p | 1080P | 支持 | 支持 | 不支持 |
| omni-flash-video | 720P | 不支持 | 不支持 | 1–3 张 |

提供方差异留在 TokenONE 侧。RollDek WAN3 的画幅集合为 R3 + adaptive；知梦 WAN3 另支持 4:3、3:4。应用不维护渠道能力交集或并集，不因为某分组不兼容就切换到供应商原生接口。

### 4.3 文件限制

| 提供方 / 家族 | 地址与文件限制 |
| --- | --- |
| RollDek WAN3 | 公网 HTTPS；视频、音频均每段 1–15 秒，各自合计 ≤15 秒；相同参考视频 URL 的时长只计一次 |
| RollDek 四款 SD | 公网 HTTPS；文档未枚举文件大小或时长上限，不能套用 WAN3 限制 |
| 知梦 WAN3 | 公网 HTTP(S)；参考视频 MP4/MOV，单段 ≤15 秒、≤64 MiB，视频总时长 ≤15 秒且输入加输出 ≤30 秒；含视频的请求中其他素材也须 ≤64 MiB |
| 知梦 Seedance 2.0 | 公网 HTTP(S)；数量预检不保证远程文件可读、格式有效 |
| 知梦 Seedance 2.5 | 有效的 `https://h3.juheai.club/m/<对象ID>` public_url；图片 JPG/PNG/WebP ≤20 MB；视频 MP4/MOV，单段 2–15 秒、≤50 MB；音频 MP3/WAV/M4A/AAC/OGG/FLAC，单段 ≤15 秒、≤30 MB；素材总计 ≤100 MB，不套用总时长 15 秒限制 |
| 知梦 H3 | 公网 HTTP(S)；视频 MP4/MOV，单段 2–15 秒、≤50 MB，总视频时长 ≤15 秒；不套用 WAN3 的输入加输出 ≤30 秒限制 |
| 知梦 Veo/Omni | 知梦工作台存储的公开 HTTPS 图片 URL，≤4096 字符，无查询参数、无片段；存储归属由上游校验，不接受任意第三方图片链接 |

知梦 H3 工作台另列图片 ≤15 MB、音频 ≤30 MB 且音频总长 ≤15 秒；知梦 WAN3 工作台建议音频单段 ≤15 秒。这些工作台要求不能直接当作独立 API 全部已验证的硬限制。具体文件的最终接受结果由上游返回，失败时展示原因。

## 5. 扩展参数

仅按下表发送，不支持的扩展必须报错。扩展不能改变公共模型、时长、分辨率、画幅、素材、鉴权、请求头或请求目的地。

| metadata.parameters 字段 | 类型 / 范围 | 开放范围 | 含义 |
| --- | --- | --- | --- |
| audio | boolean | 知梦 WAN3 | 是否生成输出声音；不是输入参考音频 |
| prompt_extend | boolean | 知梦 WAN3 | 是否扩写提示词 |
| watermark | boolean | 知梦 WAN3 | 是否添加水印 |
| seed | integer，-1…2147483647 | 知梦 WAN3 | 随机种子；0 是合法值，不保证逐次结果完全一致 |
| fast_mode | boolean | 知梦 MiniMax-H3，需完成相应适配 | false 标准、true 优先，影响计费；未选择时省略 |

RollDek WAN3、四款 RollDek SD、四款知梦 SD、六款 Veo/Omni 的扩展白名单为空，只能省略或传 `{}`。未开放不表示供应商永久没有此能力，而是公共入口没有明确支持和校验。

## 6. 创建示例与响应

由应用服务端调用，根地址与 Token 从服务端配置取得：

```bash
export TOKENONE_BASE_URL='https://token.agentone.work'
export TOKENONE_API_KEY='YOUR_TOKENONE_API_KEY'
curl --fail-with-body --request POST "$TOKENONE_BASE_URL/v1/videos" \
  --header "Authorization: Bearer $TOKENONE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"model":"wan3.0-video","prompt":"海浪拍打礁石，镜头缓缓推进","duration":6,"resolution":"720P","ratio":"16:9"}'
```

首尾帧请求使用第 2 节结构，在 media 中同时提供 first_frame 与 last_frame。例如 sd-2.5-ch1 使用 6 秒 / 720P / 16:9，必须提供成对首尾帧，不能只传首帧或同时混入普通参考。

H3 标准通道请求体示例：

```json
{
  "model": "MiniMax-H3",
  "prompt": "海边日落，镜头缓慢推进",
  "duration": 8,
  "resolution": "768P",
  "ratio": "16:9",
  "metadata": {"parameters": {"fast_mode": false}}
}
```

Veo 文生视频请求体示例，不发送 duration：

```json
{"model":"veo-3.1-fast","prompt":"清晨城市全景，镜头平稳推进","resolution":"720P","ratio":"16:9"}
```

创建成功返回 HTTP 200 和任务对象，以下 ID、时间和进度为示意值：

```json
{"id":"task_PUBLIC_ID","object":"video","model":"wan3.0-video","status":"queued","progress":0,"created_at":1793400000}
```

保存 `id`。回执可能立即是 completed 或 failed，不能假定一定先 queued。创建 HTTP 成功只表示收到任务对象，不代表生成一定成功。

## 7. 查询任务与标准状态

```bash
export TASK_ID='task_PUBLIC_ID'
curl --fail-with-body "$TOKENONE_BASE_URL/v1/videos/$TASK_ID" \
  --header "Authorization: Bearer $TOKENONE_API_KEY"
```

| status | 含义 | 应用行为 |
| --- | --- | --- |
| queued | 已受理，等待处理 | 查询同一任务 |
| in_progress | 生成或结果处理进行中 | 查询同一任务 |
| completed | 已确认生成完成 | 下载并保存成片 |
| failed | 已确认任务失败 | 展示原因，不自动重建 |

建议每 10–20 秒查询一次，限流或临时错误时退避并遵守 Retry-After（如有）。progress 只是辅助信息，不保证单调或实时，达到 100 不能替代 status。未知状态或无效响应应记录异常并保留原任务，不当作完成或重新创建。

标准任务字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | TokenONE 公共任务 ID |
| object | string | video |
| model | string | 公共模型身份 |
| status | string | 上述四种状态 |
| progress | integer | 正常为 0–100，不带百分号；异常值不能触发完成判断 |
| created_at | integer | Unix 秒时间戳 |
| completed_at | integer，可选 | 成功且有有效时间时存在；缺失时不自行推断失败 |
| error | object，可选 | 经脱敏的 code/message；缺失时显示通用失败提示 |

完成示例：

```json
{"id":"task_PUBLIC_ID","object":"video","model":"wan3.0-video","status":"completed","progress":100,"created_at":1793400000,"completed_at":1793400060}
```

公共响应不要求提供结果 URL，应用始终使用 content 接口。标准插件不得直接暴露原始供应商响应、私有任务 ID、上游 URL、签名或凭证。

**生成状态与内容可用性分别处理**：可信生成完成后，即使结果地址缺失、过期或下载失败，仍是 completed。应用显示下载/保存问题并恢复同一任务，不能把它改成生成失败或据此触发退款。供应商未知状态也不能伪装成正常处理中。

## 8. 鉴权下载与播放

```bash
curl --fail "$TOKENONE_BASE_URL/v1/videos/$TASK_ID/content" \
  --header "Authorization: Bearer $TOKENONE_API_KEY" \
  --output result.mp4
```

下载成功返回媒体字节，不是 JSON 地址。应用先检查 HTTP 状态、Content-Type 和非空内容，再保存成片；curl 失败产生的文件不得当作视频使用。

可以使用 HEAD 查询响应头，也可按需发送 `Range: bytes=0-1023`。返回 206 时检查 Content-Range；返回 200 可能是完整文件，不能当作请求片段。

TokenONE 代理两种上游下载：签名/公开存储地址不携带渠道密钥；受保护的供应商 API 下载只向可信地址发送凭证。不得向任意返回 URL 或跨源重定向发送密钥，合法的结果 URL 签名参数应保留。应用不需要知道采用哪一种。

示例不使用 `curl -L`。应用服务端应拒绝未经校验的重定向，避免将 TokenONE Token 发送到其他域名。浏览器 `<video src>` 无法自动附加 Bearer Header，应用应通过自己的后端下载、保存，再由自己的文件服务提供播放。

完成后尽快保存到自有存储。任务记录存在不保证成片永久可下载；不将供应商工作台保存时长或下载次数当作统一 API 保证。

## 9. 错误、重试与计费

| 场景 | 处理 |
| --- | --- |
| 类型错误、别名冲突、不支持参数或组合 | 按错误提示修改输入；不能自动删参数、改素材或降级 |
| 分组没有兼容渠道或选中未适配插件 | 正常展示错误；应用不选择供应商私有协议 |
| 创建超时、连接断开，未拿到 ID | 保留提交结果未知状态，查询平台任务记录或联系支持；不能盲目重发 POST |
| 查询或下载的 429、网络错误、临时 5xx | 退避重试同一任务的 GET，不能回到创建 |
| 401/403 | 检查 TokenONE 用户 Token 与权限，不尝试他人 Token 或供应商密钥 |
| 下载返回 404 | 任务不存在或不可访问；不通过私有 ID 绕过归属检查 |
| 下载前任务未完成 | 当前普通 content 路径通常返回 400 invalid_request_error；先查询原任务，不将所有 400 当临时错误 |
| 内容尚未就绪 | 特定上游内容提取分支可返回 409 artifact_not_ready；可恢复同一任务下载 |
| 内容缺失、过期或不可恢复 | 410 artifact_gone；停止无限重试，不自动重新生成 |
| failed | 展示原因；用户明确另行生成才创建新任务 |

错误结构沿用现有接口，不保证每个响应都有相同的 code/type。例如查询不存在任务可能返回 400 task_not_exist，下载不存在或他人任务返回 404。HTTP 200 的任务对象也必须检查 status。

应用与 TokenONE 的重试独立配置，互不读取或覆盖。此契约不提供幂等键或恰好一次提交保证；页面刷新、查询失败、下载失败均不得触发自动重建。

价格以 TokenONE 账号配置和消费明细为准。不同模型可按秒、Token 或条计费，不能只根据 duration 推导价格；参考视频、H3 额外参考图片、分辨率、时长档和 fast_mode 都可能影响费用。创建按有效参数预扣，完成按可靠用量结算；缺失或非法用量遵循现有安全策略，不自行计零。生成失败沿用退款流程，生成成功但下载失败不等于生成费应退款。

## 10. 自定义插件开发要求（强制）

开发、修改或审查 TokenONE 自定义视频插件时，必须先完整阅读本文，再阅读仓库 `docs/plugin-api/v1.md` 中的 hook/runtime 约定；涉及计费必须完整阅读 `.agents/rules/billing.md`。本文是公共调用契约的规范来源，实施计划和迁移指南不另行定义一套公共字段。

1. 使用公共模型身份。不同提供方确为同一模型时复用身份；无法确认等价的独立型号不得强行合并。解码返回 ctx.model，型号规则使用 ctx.upstreamModel || ctx.model，私有上游名称不改变公共任务身份。
2. 在插件内校验并构造有效请求，拒绝未知字段、不支持能力和冲突。decodeRequest 可被重复调用，须稳定且不进行网络调用；原生入口保留原格式。
3. 上游已支持 v1/videos 时直接做必要的字段转换，不强制经过火山格式。插件独立上传，不跨插件导入源码；不新增宿主公共参数校验层、能力注册中心或运行时框架。
4. 基本默认值仅补缺省字段，可选扩展未提供则不发上游。保留显式 0/false；别名、扩展、multipart、素材字段均不能绕过计费校验。
5. 复用宿主模型权限、渠道候选和任务归属。解码拒绝仅影响本次请求；不保证普通渠道或未适配插件会自动遵守本规范。
6. 查询 renderer 明确构造安全输出字段，不能返回整个 task.data。宿主生成标准字段；插件仅输出批准的安全扩展，错误内容也须脱敏。原始结果供服务端查询、下载和结算使用。
7. 驱动将已知状态映射到宿主状态，公共接口呈现第 7 节四种状态。可信成功缺少 URL 不反转为失败；未知供应商状态沿用宿主查询异常策略。下载恢复不能发起创建。
8. 复用现有 usageSchema、usageProfiles 和 usage hooks。预估、提交、结算依据同一有效请求；保留用量边界、缺失/非法用量安全策略，不由金额反推数量。知梦 H3 计费响应、账单读取和预扣结算沿用已接入的旧插件，不重复建立或要求重新证明整套链路。
9. 供应商密钥只在服务端使用。签名存储下载不带渠道凭证；受保护 API 下载验证目的地与重定向边界。保留现有鉴权、SSRF 及任务访问控制，不通过公共扩展改变目的地。
10. 新增型号必须同步登记准确 ID、默认值、范围、素材角色与顺序、数量/组合/URL 限制、扩展白名单、计费影响及验证状态。未知能力明确标注，不把模拟通过写成真实上游验证完成。

以上为插件作者规范，不改变 API v1 的 manifest、hook、schema 或 TypeScript 类型，不要求重写公共 Doubao、Alibaba 等历史插件。

### 10.1 字段映射参考

这些映射仅属于对应插件，上游字段不成为应用参数：

| 插件 / 型号 | model 与基本字段 | 素材 | 扩展 |
| --- | --- | --- | --- |
| RollDek WAN3 | model 同名不加分辨率后缀；duration→seconds 字符串；resolution→size；ratio→aspect_ratio | metadata.input.media→input.media | 空白名单 |
| RollDek 四款 SD | model 同名；duration 整数；resolution→720p；ratio→aspect_ratio | 按型号转 image_refs/video_refs/audio_refs 或 first_image/last_image | 空白名单；按条计费，不套用火山 Token 计费 |
| 知梦 WAN3 | model/prompt/duration/resolution 同名；ratio→aspect_ratio | metadata.input.media | 仅四项已登记扩展；兼容 generate_audio→audio、reference_voice→reference_audio |
| 知梦 sd-2-c4/c5 | prompt→input.prompt；duration/resolution/ratio→parameters，分辨率 720p | input.media；reference_audio→reference_voice | 空白名单 |
| 知梦两款 Seedance 2.5 | model/prompt/duration/ratio 顶层；resolution→720p | reference_images/reference_videos/reference_audios；官转不发送视频字段，空数组也不发送 | 空白名单 |
| 知梦 MiniMax-H3 | model→minimax-h3；ratio→aspect_ratio；480P→480p、768P→768P、1080P→1080p、2K→2K | image_urls/video_urls/audio_urls；由角色推导 generation_mode=frames 或 references | fast_mode→顶层 fast_mode |
| 知梦 Veo/Omni | model/prompt 同名；720P+横/竖→1280x720/720x1280；1080P+横/竖→1920x1080/1080x1920，写入 size | reference_images；无素材 text，首帧 first_frame，首尾帧 first_last，参考图 reference，显式写 generation_mode | 空白名单；拒绝 duration |

首尾帧按角色排序后输出；参考数组按每类相对顺序输出，不改写用户提示词。Omni 单张普通参考必须明确传 reference，不能依赖上游按图片数猜测为 first_frame。

### 10.2 必须覆盖的回归

- 相同公共请求在支持该能力的插件之间语义一致；公共 model 与上游映射正确。
- 各模型合法边界、默认值、显式 0/false、非法 null、标准数字类型、别名等价/冲突和未知字段。
- 首尾帧倒序输入、普通参考顺序、数量上限、角色冲突、专用 URL 限制与缺省 input。
- 预估对应实际发送参数；影响计费的扩展、别名及素材无法绕过校验。
- 实际用量、缺失/非法用量、失败退款、生成成功但下载失败；H3 新参数覆盖长短时长、2K 边界、fast_mode 和额外图片计费。
- 公共创建与查询字段、立即完成/失败、未知状态、缺 URL 仍保持可信成功状态。
- 有效用户鉴权、任务归属、模型权限、渠道限制、签名下载、Bearer 下载及跨源凭证隔离。
- 下载失败后没有新增创建请求；旧原生入口及已有有效能力不回退。

优先扩展现有适合的测试，不为同一行为在各层重复造测试。分别记录本地模拟命令/结果、授权真实上游验证和未验证事项。真实生成与线上部署须另行授权，发布本文不代表授权执行。

## 维护依据

本文基于 TokenONE / New API 的视频接口、已确认的统一契约及提供方文档整理。后续插件开发以本文定义的公共调用方式为准；实际部署进度与验证记录单独维护，不用文档发布替代插件验收。

### H3 可视化时长档位

知梦插件 1.5.3 在 H3 用量中新增 `duration_tier` 枚举 `4-15` / `16-30`，由有效输出时长生成；完成时随可靠输出秒数重新计算，参考视频秒数不参与档位判断。现有价格矩阵可按分辨率和该枚举维护生成秒价、参考视频秒价、额外图片单价，无需修改宿主可视化编辑器。2K 的长时长组合仍由请求校验拒绝，矩阵中的该组合不代表支持生成。

更新插件不会自动重写已保存价格；旧 `seconds <= 15` 表达式需等价改为枚举条件才会被矩阵识别。旧在途任务继续使用其冻结的计费表达式。
