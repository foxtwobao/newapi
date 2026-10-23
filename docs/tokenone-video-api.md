# TokenONE 视频模型调用指南

本文面向通过 TokenONE API 生成视频的开发者。按模型介绍参数与示例，不需要了解供应商接口、插件内部模型名或渠道密钥。

本文目前仅覆盖 `wan3.0-video`、`wan3.0-video-prime` 两个模型。其他视频模型不能直接套用这些参数；模型是否对你的账号开放，以 TokenONE 当前配置为准。

## 1. 接口与鉴权

下文 `TOKENONE_BASE_URL` 是你的 TokenONE API 根地址，**不包含 `/v1`**；`TOKENONE_API_KEY` 是你的 TokenONE API 令牌，不是供应商令牌。

| 用途 | 方法 | 路径 |
| --- | --- | --- |
| 创建视频任务 | POST | `/v1/videos` |
| 查询视频任务 | GET | `/v1/videos/{id}` |
| 下载视频 | GET | `/v1/videos/{id}/content` |
| 查询视频响应头 | HEAD | `/v1/videos/{id}/content` |

所有请求携带 `Authorization: Bearer TOKENONE_API_KEY`，创建任务额外设置 `Content-Type: application/json`。令牌应保存在业务服务端，不要写入网页、移动端安装包、公开仓库或日志。

```bash
export TOKENONE_BASE_URL='https://token.agentone.work'
export TOKENONE_API_KEY='YOUR_TOKENONE_API_KEY'
```

以上地址为 TokenONE API 地址，令牌为占位符，请替换为自己的 TokenONE API 令牌。媒体示例中的 `example.com` 也必须替换为真实可访问的文件地址。

调用流程：**创建 → 保存返回的 `id` → 查询状态 → 完成后下载并自行保存**。创建成功不代表视频生成完成。

TokenONE 负责选择当前账号可用的渠道并转换请求。客户端不指定供应商，也不为模型拼接画质后缀。任务创建后，查询和下载始终使用原任务 `id`，不要按当前选中的模型重新创建任务。

### 参数支持范围

同一模型统一使用本文的请求格式。部分参数并非所有服务渠道都支持：如果你的账号没有可处理该请求的渠道，接口会报错。此时请保留错误信息并联系平台确认，不要自动删除参数或素材后重试，以免生成结果偏离用户要求。

## 2. 模型速查

| 模型 ID | 输出时长 | 分辨率 | 宽高比 | 默认值：时长 / 分辨率 / 宽高比 |
| --- | --- | --- | --- | --- |
| `wan3.0-video` | 2–30 秒整数 | `480P`、`720P`、`1080P` | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`adaptive` | 5 秒 / `1080P` / `adaptive` |
| `wan3.0-video-prime` | 2–30 秒整数 | `480P`、`720P`、`1080P` | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`adaptive` | 5 秒 / `1080P` / `adaptive` |

`4:3`、`3:4` 可以直接填写，无需额外开关；如果账号没有支持该宽高比的渠道，请求会报错。

建议每次填写时长、分辨率和宽高比。`adaptive` 表示由模型自动选择宽高比；需要固定横屏或竖屏时，分别填写 `16:9` 或 `9:16`。`720P` 等表示分辨率档位，实际像素尺寸还取决于宽高比。

## 3. WAN3 标准模型：wan3.0-video

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 固定为 `wan3.0-video` |
| `prompt` | string | 是 | 描述希望生成的画面、动作或镜头；不能是空字符串或只有空格。提供素材时也要填写 |
| `duration` | integer | 否 | 视频时长，2–30 秒，默认 5 秒 |
| `resolution` | string | 否 | 分辨率：`480P`、`720P`、`1080P`，默认 `1080P` |
| `ratio` | string | 否 | 宽高比：`16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`adaptive`，默认 `adaptive` |
| `metadata.input.media` | array | 否 | 参考素材列表；仅通过文字生成视频时省略。素材类型与组合见下表 |
| `metadata.parameters` | object | 否 | 声音、提示词扩展、水印和随机种子设置，见下文；不需要设置时省略 |

### 素材类型与组合

每项仅填写 `type` 和 `url`，例如 `{"type":"first_frame","url":"https://example.com/start.jpg"}`。

| type | 用途 | 数量与限制 |
| --- | --- | --- |
| `first_frame` | 首帧图片 | 最多 1 张，可单独使用 |
| `last_frame` | 尾帧图片 | 最多 1 张，必须搭配首帧 |
| `reference_image` | 供模型参考的图片，不指定为首帧或尾帧 | 最多 10 张 |
| `reference_audio` | 供模型参考的音频文件 | 最多 5 段 |
| `reference_video` | 供模型参考的视频文件 | 最多 5 段；账号须有支持参考视频的渠道 |

- 首帧、首尾帧模式不能与普通参考图、参考视频、参考音频混用。
- 普通参考图和音频可以组合使用；添加参考视频后，仅支持参考视频的渠道可以处理请求。
- 素材文件仍需满足处理服务对格式、大小和时长的要求；未超过数量上限，也可能因文件不符合要求而失败。
- 用 `type` 指定图片用途：首帧填 `first_frame`，尾帧填 `last_frame`，一般参考图填 `reference_image`。不要仅靠数组顺序区分首尾帧。

### 声音、水印等可选设置

以下字段都放在 `metadata.parameters` 中，不是必填项。账号须有支持这些设置的渠道，否则请求会报错。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `audio` | boolean | 是否为生成的视频生成声音：`true` 开启，`false` 关闭；省略则使用模型默认设置 |
| `prompt_extend` | boolean | 是否让模型自动扩展提示词：`true` 开启，`false` 关闭；省略则使用模型默认设置 |
| `watermark` | boolean | 是否添加水印：`true` 添加，`false` 不添加；省略则使用模型默认设置 |
| `seed` | integer | 随机种子，取值 `-1` 至 `2147483647`，可以填 `0`；不指定时省略 |

例如，想生成带声音的视频，填写 `"audio": true`。想提供一段自己的音频作为参考，则在 `metadata.input.media` 中添加 `{"type":"reference_audio","url":"https://example.com/audio.wav"}`。前者设置输出视频的声音，后者提供输入素材。

只填写你需要控制的选项。例如，不设置水印时省略 `watermark`，要求不加水印时才填写 `"watermark": false`。固定 `seed` 不保证每次生成完全相同的视频。

以下示例请求生成带声音、不加水印的视频，并开启提示词扩展：

```json
{
  "model": "wan3.0-video",
  "prompt": "海浪拍打礁石，伴随自然的海浪声，镜头缓缓推进",
  "duration": 5,
  "resolution": "720P",
  "ratio": "16:9",
  "metadata": {
    "parameters": {
      "audio": true,
      "prompt_extend": true,
      "watermark": false,
      "seed": 0
    }
  }
}
```

### 文字生成视频

```bash
curl --fail-with-body -X POST "$TOKENONE_BASE_URL/v1/videos" \
  -H "Authorization: Bearer $TOKENONE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"wan3.0-video","prompt":"海浪拍打礁石，镜头缓缓推进","duration":2,"resolution":"480P","ratio":"16:9"}'
```

### 使用首帧图片生成视频

以下 JSON 作为 `POST /v1/videos` 的请求体：

```json
{
  "model": "wan3.0-video",
  "prompt": "首帧中的人物缓缓转头，镜头保持稳定",
  "duration": 2,
  "resolution": "720P",
  "ratio": "9:16",
  "metadata": {
    "input": {
      "media": [
        {"type": "first_frame", "url": "https://example.com/start.jpg"}
      ]
    }
  }
}
```

### 使用参考图片和参考音频生成视频

```json
{
  "model": "wan3.0-video",
  "prompt": "参考图片中的人物外观和场景，配合参考音频的氛围生成短片",
  "duration": 5,
  "resolution": "720P",
  "ratio": "16:9",
  "metadata": {
    "input": {
      "media": [
        {"type": "reference_image", "url": "https://example.com/person.jpg"},
        {"type": "reference_image", "url": "https://example.com/scene.jpg"},
        {"type": "reference_audio", "url": "https://example.com/ambience.wav"}
      ]
    }
  }
}
```

### 使用参考视频生成视频

账号没有支持参考视频的渠道时，以下请求会报错。

```json
{
  "model": "wan3.0-video",
  "prompt": "参考视频中的镜头运动，生成同样节奏的城市短片",
  "duration": 2,
  "resolution": "720P",
  "ratio": "16:9",
  "metadata": {
    "input": {
      "media": [
        {"type": "reference_video", "url": "https://example.com/motion.mp4"}
      ]
    }
  }
}
```

## 4. WAN3 Prime 模型：wan3.0-video-prime

模型 ID 为 `wan3.0-video-prime`。**请求字段、默认值、时长、分辨率、宽高比及素材组合规则与标准模型相同**。能调用标准模型不代表能调用 Prime；两者的访问权限和价格分别设置。

上一节的示例将 `model` 改为 `wan3.0-video-prime` 即可用于 Prime。以下示例同时提供首帧和尾帧图片：

```json
{
  "model": "wan3.0-video-prime",
  "prompt": "人物从首帧姿态自然过渡到尾帧姿态，动作平滑，镜头保持稳定",
  "duration": 2,
  "resolution": "720P",
  "ratio": "9:16",
  "metadata": {
    "input": {
      "media": [
        {"type": "first_frame", "url": "https://example.com/start.jpg"},
        {"type": "last_frame", "url": "https://example.com/end.jpg"}
      ]
    }
  }
}
```

`model` 固定填写 `wan3.0-video-prime`，不要拼接 `-720p` 等后缀。分辨率通过 `resolution` 单独设置。

## 5. 素材地址与填写注意事项

### 素材 URL

- 使用公网可下载的 **HTTPS 文件地址**，不要填写素材展示网页的地址。
- 本文的创建接口通过 URL 接收素材，不接收直接上传的文件、Base64、`data:`、`blob:`、本地路径或 `/api/files/...` 等相对地址。本地文件需先上传至你自己的文件存储服务，再传入下载地址。
- 私有素材可以使用带有效期的签名下载地址。有效期要覆盖任务排队、素材下载和处理过程。
- URL 不能依赖浏览器 Cookie 或登录态。不要把 TokenONE API Key 拼入素材 URL。
- 创建成功后，任务仍可能因链接过期、无法下载或文件不符合要求而失败。

### 参数不要重复填写

统一使用本文的字段：时长填 `duration`，分辨率填 `resolution`，宽高比填 `ratio`，素材填 `metadata.input.media`。不要同时发送 `seconds`、`size`、`aspect_ratio` 或顶层 `media` 等其他写法，以免参数冲突。

不要发送 `n`、`fps`、`width`、`height`、`images`、`input_reference` 等本文未列出的参数，不要假定 OpenAI 视频 SDK 的所有字段、上传和编辑操作均受支持。每次创建请求对应一个任务。

## 6. 创建响应与状态查询

创建成功的响应是视频任务对象。以下仅为结构示例，不保证进度值和额外字段完全相同：

```json
{
  "id": "task_EXAMPLE",
  "object": "video",
  "model": "wan3.0-video",
  "status": "queued",
  "progress": 0,
  "created_at": 1792324500
}
```

**保存 `id`，不要依赖 `task_id` 字段，也不要使用供应商内部 ID。** 查询时使用原任务所属账号的有效 TokenONE 令牌。

```bash
export TASK_ID='task_EXAMPLE'
curl --fail-with-body "$TOKENONE_BASE_URL/v1/videos/$TASK_ID" \
  -H "Authorization: Bearer $TOKENONE_API_KEY"
```

| status | 含义 | 客户端行为 |
| --- | --- | --- |
| `queued` | 已排队 | 稍后查询 |
| `in_progress` | 生成或处理结果中 | 稍后查询 |
| `completed` | 已完成 | 下载并保存视频，停止轮询 |
| `failed` | 已失败 | 停止轮询，展示返回的错误信息（若有） |

建议每隔 10–20 秒查询一次，遇到限流时延长间隔。任务状态由 TokenONE 后台更新，更频繁查询不会加快生成或状态更新。以 `status` 为准：只有 `completed` 表示完成，不能仅凭 `progress` 为 `100` 判定成功。

完成响应示例：

```json
{
  "id": "task_EXAMPLE",
  "object": "video",
  "model": "wan3.0-video",
  "status": "completed",
  "progress": 100,
  "created_at": 1792324500,
  "completed_at": 1792324620
}
```

无论响应是否包含视频地址，都使用下一节的下载接口获取视频，无需从其他字段查找地址。

## 7. 视频下载与播放

任务 `completed` 后下载：

```bash
curl --fail-with-body "$TOKENONE_BASE_URL/v1/videos/$TASK_ID/content" \
  -H "Authorization: Bearer $TOKENONE_API_KEY" \
  --output result.mp4
```

检查响应头：

```bash
curl --fail-with-body --head "$TOKENONE_BASE_URL/v1/videos/$TASK_ID/content" \
  -H "Authorization: Bearer $TOKENONE_API_KEY"
```

只下载前 1024 字节的请求示例（是否支持以响应为准）：

```bash
curl --fail-with-body "$TOKENONE_BASE_URL/v1/videos/$TASK_ID/content" \
  -H "Authorization: Bearer $TOKENONE_API_KEY" \
  -H 'Range: bytes=0-1023' \
  --output video-part.bin
```

`Range` 用于请求文件的一部分。返回 HTTP `206` 时，查看 `Content-Range` 确认实际范围；如果返回 HTTP `200`，服务可能返回了完整文件，不能当作指定片段处理。

下载接口成功时返回媒体字节，不是 JSON 地址。客户端应同时检查 HTTP 状态、Content-Type 和文件是否为空；`curl` 命令失败时不要把输出文件当作成片。不要对任意响应中的 URL 自动附加 TokenONE 令牌。

浏览器 `<video src>` 无法自动附加上述 Bearer Header。建议由业务后端下载并存储成片，再以自己的受控文件服务向浏览器提供播放、拖动和下载能力。不要为了播放把长期 API Key 暴露给浏览器。

生成完成后请尽快下载并保存到自己的存储服务。视频下载地址可能失效，能查到任务记录不代表视频仍可下载。

## 8. 计费与失败处理

- 价格以 TokenONE 中该账号的实际配置和消费明细为准，不要照搬供应商价格表。
- 费用与分辨率、计费秒数有关。使用参考视频时，计费秒数可能还包含参考视频时长，不能只按输出 `duration` 估算。最终扣费请查看消费明细。
- 创建任务时可能先预扣费用，之后根据任务结果结算或退款。
- 已生成成功但业务侧下载失败，不代表生成费自动退款。应重试查询或下载同一个任务，而不是重新生成。

### 常见问题

| 现象 | 排查与处理 |
| --- | --- |
| 请求被拒绝 | 根据错误信息检查模型权限、余额、JSON 结构、时长、分辨率、宽高比与素材组合 |
| 基础请求成功，添加某参数后失败 | 先检查参数类型、取值和素材组合；均正确时，联系平台确认账号是否有支持该参数的渠道，不自动删参数重试 |
| 只有尾帧时报错 | 添加 `first_frame` 首帧图片；如果图片只作一般参考而不要求作为尾帧，改用 `reference_image` |
| 切换模型后无法提交 | 确认账号有权调用目标模型，并按目标模型的说明检查参数 |
| 素材浏览器能打开，任务却失败 | 检查公网可访问性、签名有效期、文件类型、访问限制及远端抓取条件 |
| 创建请求超时，没有拿到 ID | 任务可能已经创建。先检查平台任务记录或联系支持；直接重发可能创建第二个任务并再次计费 |
| 查询临时超时或限流 | 使用原 ID 稍后再查，多次失败时延长查询间隔，不重新创建任务 |
| 状态为 completed，下载失败 | 重试同一任务的 `/content`；仍失败时，保留任务 ID 和错误信息联系平台排查 |
| 查不到任务 | 确认使用创建响应的 `id`、正确的 TokenONE 实例及有权访问该任务的账号 |

错误响应的具体结构可能因校验阶段而不同。业务代码应先检查 HTTP 状态，再读取响应中可用的错误字段；查询返回 HTTP 200 时仍须检查任务 `status`。

## 9. 开发者验收清单

- 创建一次只生成一个任务，页面刷新、轮询、下载失败不触发重复创建。
- WAN3 标准和 Prime 分别测试，分辨率通过 `resolution` 传递。
- 首帧与尾帧角色正确；普通参考图模式使用 `reference_image`。
- 下载后检查实际成片的时长、尺寸和声音是否符合请求。
- 对业务会使用的宽高比、参考素材、声音和水印设置分别测试。
- 失败停止轮询并显示原因，完成后保存结果；前端与服务端均不泄露 API Key。

上线前，请使用实际部署账号完成上述测试。

## 维护依据

本文根据 TokenONE / New API 的视频接口及已实现的模型适配编写，章节组织参考了[知梦 WAN3 对接手册](https://zhimengapi.pages.dev/video/wan3)。调用 TokenONE 时请使用本文的地址、模型 ID 和请求格式，不要直接套用供应商接口示例。
