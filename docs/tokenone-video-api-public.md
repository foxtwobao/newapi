# TokenONE 标准视频 API 调用规范

更新日期：2026-10-31。本文面向通过 TokenONE API 生成视频的应用开发者，介绍通用请求格式、任务查询和鉴权下载。

本文由统一接口规范和具体模型参数说明组成。所有模型均使用 TokenONE 的公共模型 ID、字段名称与素材结构；应用按照所选模型的说明填写参数，无需判断具体服务来源或切换请求格式。

模型是否可用，以账号实际开通情况为准。具体模型说明将随上线情况逐项补充，列出通过 TokenONE 调用时的必填项、默认值、合法取值、素材限制及扩展参数。本文当前示例用于说明通用调用结构，不表示所有模型支持示例中的全部选项。

## 1. 接口与鉴权

API 根地址为 `https://token.agentone.work`，不包含 `/v1`。使用其他部署时，请替换为其实际根地址。

| 操作 | 方法 | 路径 |
| --- | --- | --- |
| 创建视频任务 | POST | `/v1/videos` |
| 查询任务 | GET | `/v1/videos/{id}` |
| 下载视频 | GET | `/v1/videos/{id}/content` |
| 获取下载响应头 | HEAD | `/v1/videos/{id}/content` |

所有请求携带：

```http
Authorization: Bearer <TOKENONE_API_TOKEN>
```

创建请求同时设置 `Content-Type: application/json`。API Token 应保存在应用服务端，不写入网页、公开仓库或日志，不拼入 URL。

`id` 始终使用创建响应中的 TokenONE 任务 ID。调用流程为：**创建 → 保存 id → 查询状态 → 完成后下载并保存**。创建成功不代表视频已经生成。

## 2. 公共请求参数

| 字段 | JSON 类型 | 说明 |
| --- | --- | --- |
| model | string | 必填，账号可用的模型 ID；按模型说明填写完整名称，不自行拼接后缀 |
| prompt | string | 必填非空，描述画面、动作或镜头 |
| duration | number | 请求生成的视频时长，单位秒；仅在模型支持时发送，取值见对应模型说明 |
| resolution | string | 输出分辨率档位，例如 720P；可选值见模型说明 |
| ratio | string | 输出宽高比，例如 16:9；可选值见模型说明 |
| metadata.input.media | array | 输入素材列表，可省略；每项仅包含 type 和 url |
| metadata.parameters | object | 模型明确开放的扩展参数，可省略；不能任意透传其他字段 |

`resolution` 表示分辨率档位，不保证输出恰好为某个固定像素尺寸。`ratio: "adaptive"` 表示允许模型自动选择画幅，仅在模型支持时使用。

每次创建对应一个视频任务。不要假定其他视频 SDK 中的上传、批量、编辑或扩展字段均受支持。

### 缺省值与参数校验

- 建议显式填写用户选择的时长、分辨率和画幅；模型不支持控制的字段应省略。
- 未提供的基本参数采用对应模型说明中的缺省规则；不能把未提供理解为数字 0 或布尔 false。
- 非必填扩展未提供时保持省略，不自动补 false。
- 明确选择 false 与未提供不同；合法的数值 0 必须保留。0 是否合法由该字段定义决定，不能作为通用缺省值。
- 不支持的字段、取值、组合、非法 null 或错误类型会报错，不会静默忽略或修改用户选择。

### 兼容别名

新应用应只使用标准字段。已有客户端可能使用以下兼容写法：

| 兼容字段 | 标准含义 | 冲突处理 |
| --- | --- | --- |
| seconds | duration | 可兼容明确支持的整数字符串；与 duration 不一致时报错 |
| aspect_ratio | ratio | 含义不一致时报错 |
| size | resolution，或已登记的分辨率与画幅组合 | 必须是明确支持的档位或尺寸映射；与 resolution、ratio 冲突时报错 |

例如，`duration: 6` 与 `seconds: "5"` 同时出现会报错。新请求不应同时发送多套素材结构，也不要把公共字段重复放入 metadata.parameters。

## 3. 输入素材

素材统一放在 `metadata.input.media`：

```json
{
  "metadata": {
    "input": {
      "media": [
        {"type": "first_frame", "url": "https://example.com/start.jpg"}
      ]
    }
  }
}
```

上例是素材字段片段，完整创建请求还需要 model 和 prompt。示例 URL 必须替换为真实文件地址。

| type | 含义 |
| --- | --- |
| first_frame | 指定首帧图片 |
| last_frame | 指定尾帧图片 |
| reference_image | 主体、外观或风格参考图片 |
| reference_video | 动作或镜头参考视频 |
| reference_audio | 输入参考音频 |

角色决定素材用途，不能只靠数组位置区分首尾帧。普通参考素材的相对顺序会保留。输入参考音频与“是否生成输出声音”的设置是不同功能。

具体模型支持哪些角色、数量和组合，以该模型说明为准；不能假定所有模型都支持五种角色或任意混合。

素材地址须为服务端可读取的公网文件地址，推荐 HTTPS。不要提交网页展示地址、本地路径、相对路径、data URL、blob URL 或依赖浏览器登录状态的链接。模型如有额外地址或文件要求，会在上线说明中明确列出。

签名链接的有效期应覆盖排队和生成过程。URL 格式和数量校验通过，不保证实际文件可读、格式或时长有效；任务仍可能因素材问题失败。不要在素材条目中填写 duration、tokens、charge 等计费信息。

## 4. 创建视频

在应用服务端配置 API 根地址和用户 Token。将 `YOUR_VIDEO_MODEL` 替换为账号已开通的模型 ID，并选择该模型支持的参数：

```bash
curl --fail-with-body --request POST "$TOKENONE_BASE_URL/v1/videos" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "YOUR_VIDEO_MODEL",
    "prompt": "人物缓缓转身",
    "duration": 6,
    "resolution": "720P",
    "ratio": "16:9",
    "metadata": {
      "input": {"media": [
        {"type": "first_frame", "url": "https://example.com/start.jpg"}
      ]},
      "parameters": {}
    }
  }'
```

纯文生视频可省略 metadata.input；没有扩展参数时可省略 metadata.parameters。没有素材或扩展时可省略整个 metadata。创建请求可能产生费用。

创建成功返回 HTTP 200 和任务对象。以下 ID、模型与时间均为占位示例：

```json
{
  "id": "task_PUBLIC_ID",
  "object": "video",
  "model": "YOUR_VIDEO_MODEL",
  "status": "queued",
  "progress": 0,
  "created_at": 1793400000
}
```

保存 `id`，之后查询和下载始终使用它，不依赖旧字段 task_id。回执也可能立即返回 completed 或 failed，不要假定一定先排队。

## 5. 查询任务

```bash
curl --fail-with-body "$TOKENONE_BASE_URL/v1/videos/$TASK_ID" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN"
```

使用创建任务所属账号有权访问该任务的 Token。查询成功返回任务对象：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | TokenONE 任务 ID |
| object | string | video |
| model | string | 创建使用的模型身份 |
| status | string | 任务状态，见下表 |
| progress | integer | 进度辅助信息，正常范围 0–100，不带百分号 |
| created_at | integer | Unix 秒时间戳 |
| completed_at | integer，可选 | 成功完成时间，缺失不等于失败 |
| error | object，可选 | 可用的错误 code/message；缺失时显示通用失败提示 |

| status | 含义 | 应用行为 |
| --- | --- | --- |
| queued | 已受理，等待处理 | 稍后查询同一任务 |
| in_progress | 正在生成或处理结果 | 稍后查询同一任务 |
| completed | 已确认生成完成 | 下载并保存成片 |
| failed | 任务失败 | 停止轮询，展示原因 |

建议每 10–20 秒查询一次，遇到限流或临时错误时退避，并遵守 Retry-After（如有）。进度不保证单调或实时，达到 100 不能替代 status。遇到未知状态或无效响应时保留原任务并记录异常，不当作完成或重新创建。

完成响应示例：

```json
{
  "id": "task_PUBLIC_ID",
  "object": "video",
  "model": "YOUR_VIDEO_MODEL",
  "status": "completed",
  "progress": 100,
  "created_at": 1793400000,
  "completed_at": 1793400060
}
```

响应不要求提供视频 URL。应用直接使用下一节的 content 接口，不需要在其他字段中查找下载地址。

## 6. 下载与播放

生成 completed 后，使用同一个任务 ID 下载：

```bash
curl --fail "$TOKENONE_BASE_URL/v1/videos/$TASK_ID/content" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN" \
  --output result.mp4
```

成功返回媒体字节，不是 JSON 地址。先检查 HTTP 状态、Content-Type 和内容非空，再保存为视频；命令失败产生的文件不能当作成片。

可使用 HEAD 查看响应头；需要分段下载时，可发送 `Range: bytes=0-1023`。返回 206 时检查 Content-Range；返回 200 可能是完整文件，不能当作指定片段。

示例不使用 `curl -L`。应用不得向任意地址或未经校验的跨域重定向附加 TokenONE Token。浏览器 `<video src>` 不能自动附加 Bearer Header，建议由应用后端下载并保存，再通过自己的文件服务提供播放。

**生成完成与下载成功分别处理**：completed 后即使视频暂不可下载或内容已失效，也不能自动重新生成。应恢复同一任务的查询、下载或文件保存；内容失效时展示明确错误。任务记录存在不保证视频永久可下载，完成后请尽快保存。

## 7. 错误与恢复

| 场景 | 应用处理 |
| --- | --- |
| 参数类型、别名冲突、不支持参数或组合 | 展示错误并修改输入，不自动删参数、删素材或降低用户选择 |
| 模型未开放或当前请求不可用 | 检查模型说明与账号权限，不自动切换其他调用格式 |
| 创建超时或断网，没有拿到 id | 保留“提交结果未知”，检查平台任务记录或联系支持；不要盲目重发 POST |
| 查询或下载限流、网络错误、临时 5xx | 退避重试同一任务的 GET，不重新创建 |
| 401 / 403 | 检查 Token 和访问权限，不尝试他人账号的 Token |
| 下载 404 | 任务不存在或不可访问，核对原任务 ID 与账号 |
| 任务未完成时下载 | 通常返回 400 invalid_request_error；先查询任务状态，不把所有 400 都当临时错误 |
| 409 artifact_not_ready | 内容暂未就绪，可稍后下载同一任务 |
| 410 artifact_gone | 内容已失效或不可恢复，停止无限重试，不自动重新生成 |
| status 为 failed | 展示失败信息；用户明确选择另行生成才创建新任务 |

错误结构可能因处理阶段不同而不同，不保证每个响应都有相同的 code/type。先检查 HTTP 状态，再读取可用错误信息；查询返回 HTTP 200 时仍须检查 status。查询不存在任务可能返回 400 task_not_exist，不能只按下载接口的状态码处理查询错误。

本接口不承诺创建请求的幂等语义。页面刷新、轮询失败和下载失败不能触发自动重建；应用自行控制查询、下载的退避与恢复。

## 8. 费用说明

价格以账号实际配置和消费明细为准。不同模型的计费单位和影响价格的参数可能不同，将随模型上线说明公布，不能仅根据输出 duration 推算全部费用。

创建时可能预扣费用，之后按任务结果和有效用量结算或退款。生成完成但下载、保存失败，不代表生成费用自动退款；应继续处理原任务，不重复创建。

## 9. 具体模型参数说明

本节按实际已上线的 TokenONE 公共模型逐项补充。每个模型的说明包含：

| 内容 | 说明范围 |
| --- | --- |
| 模型身份 | 请求中使用的准确 model，以及适用场景 |
| 公共参数 | prompt、duration、resolution、ratio 的必填性、合法值与默认值；不支持的字段明确说明 |
| 素材要求 | media 支持的 type、数量、顺序、组合、URL、文件格式、大小和时长限制 |
| 扩展参数 | metadata.parameters 中允许的字段、类型、取值、缺省行为及参数之间的约束 |
| 计费影响 | 影响费用的公共选项，具体价格以账号配置为准 |
| 完整示例 | 可直接用于 TokenONE POST /v1/videos 的请求；查询和下载继续使用统一接口 |

同一公共字段在各模型中含义相同，支持范围可以不同。例如某模型的 duration 必填、另一模型不支持控制时长，均在各自说明中明确。模型说明中的字段和示例全部采用本文的 TokenONE 请求格式，不需要应用自行转换。

目前尚未在本节发布具体型号条目；参数能力经上线确认后逐项补充。

## 维护说明

本文为 TokenONE / New API 的标准视频接入说明，统一接口与具体模型参数说明共同构成客户接入依据。
