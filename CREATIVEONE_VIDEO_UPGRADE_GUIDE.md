# CreativeOne 视频接口升级指南

公共请求与响应以 [TokenONE 标准视频 API](docs/tokenone-video-api.md) 为准。本文只说明 CreativeOne 的迁移步骤，不另行定义公共契约。

## 1. 适用范围与交付状态

本指南供 CreativeOne 实施 TokenOne 统一视频接口迁移，配套 [统一参数契约方案](TOKENONE_VIDEO_CONTRACT_PLAN.md)。目前是升级设计，依据 CreativeOne 当前工作区代码核对；不表示 TokenOne 插件已经发布或真实上游验收通过。本次只编写指南，未修改 CreativeOne 仓库。

CreativeOne 升级后的所有新视频调用统一使用 TokenOne `/v1/videos` 公共规约，不按供应商或插件切换请求格式。TokenOne 本期只改造我们维护的自定义插件（RollDek、知梦），内置公共 Doubao、Alibaba 及其他渠道仍维持原协议。若应用使用的分组接入不符合规约的插件而导致错误，正常返回和展示错误即可，CreativeOne 不承担兼容这些插件的责任。历史任务保留原有查询恢复链路。

RollDek Seedance 由插件执行 `/v1/videos → /v1/videos` 的必要转换；本期准确型号为 `sd-2.0-ch1`、`sd-2.5-ch1`、`sd-2.5-ch2`、`sd-2.5-ch3`，按条计费，具体映射已列入主方案。CreativeOne 不需要知道插件采用火山协议还是 `/v1/videos`，也不承担供应商型号后缀、私有素材角色或下载地址转换。

## 2. 调用链与现有可复用能力

调用链保持为：浏览器 → CreativeOne 后端 → TokenOne → 供应商。TokenOne 用户 API Token 仅由 CreativeOne 后端使用；供应商密钥仅在 TokenOne 服务端。

| 环节 | 当前实现 | 升级要求 |
| --- | --- | --- |
| 创建 | Seedance 使用 `contents/generations/tasks` 和 `content`；其他家族使用 `videos`，但 Veo/H3 仍有专用字段 | 升级后的新视频请求全部使用公共结构 |
| 路径选择 | `videoTaskPath(family)` 按家族判断 | 新创建统一为 videos；家族只用于界面分类与公共模型选项 |
| 能力配置 | 家族预设叠加型号覆盖 | 保留公共模型产品选项，不增加插件能力表；最终能力校验交给 TokenOne |
| 查询 | 后台按任务保存的 `path` 和 `upstream_id` 查询 | 新公共任务使用标准状态；历史任务继续按已保存路径查询 |
| 下载 | 当前后台已统一用 TokenOne 公共 ID 请求 `videos/{id}/content`，携带用户 Token，拒绝重定向 | 直接复用；不增加供应商 URL 下载分支 |
| 文件交付 | 后端保存到 CreativeOne 文件库，浏览器读取本地 `file` 结果 | 保留；不能用 TokenOne 返回 `completed` 替代文件落库成功 |
| 恢复 | 后台重试查询，下载或保存异常可暂停后恢复 | 恢复原任务；不能重新创建生成任务 |

区分三个 ID：CreativeOne `generation_tasks.id` 是本地任务 ID；其 `upstream_id` 保存的是 **TokenOne 公共任务 ID**；供应商私有任务 ID 不进入应用调用契约。不要根据数据库列名 `upstream_id` 将其理解为供应商 ID。

## 3. 公共模型选项与责任边界

CreativeOne 升级后的新视频调用只使用 TokenOne `/v1/videos` 规约。复用 `shared/video-models.ts` 和现有设置来展示公共模型的产品选项、默认值及基本输入提示，不增加按插件、供应商或分组选择协议的配置，也不维护多个插件能力的交集、并集或兼容表。

| 责任方 | 负责内容 |
| --- | --- |
| CreativeOne | 公共请求构造、产品开放的参数、公共结构校验、应用用户与素材归属、任务记录、结果保存和错误展示 |
| TokenOne | 分组与渠道选择、插件能力差异、准确型号映射、供应商限制和扩展白名单的最终校验、计费、上游查询与下载 |
| TokenOne 管理配置 | 决定分组接入哪些渠道；接入不符合规约的插件而产生错误时，应用正常报错即可 |

公共模型选项包括时长、分辨率、画幅、素材角色及应用实际开放的扩展。它们描述用户意图，不承诺当前分组内任意插件都支持。请求能否由所选候选处理由 TokenOne 决定；没有可用能力或不兼容时返回错误，CreativeOne 不改参数、不降级、不切换供应商协议。

- `seedance/wan/h3/veo` 可以继续用于界面分类和公共模型选项，但新创建路径始终为 `videos`。
- 公共模型 ID 使用 TokenOne 公布的身份，不推导供应商后缀。尚未确定身份的型号不能用猜测 ID 接入。
- 应用可展示公共模型的 `4:3`、`3:4` 等选项，不需要根据当前分组是否包含 RollDek 动态裁剪；不被支持的请求由 TokenOne 报错。
- `maxImages/maxVideos/maxAudios: null` 等现有配置不能对用户解释为供应商已验证“无限制”。应用的提示不替代 TokenOne 的最终校验。
- H3 当前界面默认 `4 秒 / 768P / 16:9`，可以显式保留。公共选项为 480P/768P/1080P/2K、4–30 秒（2K 最长 15 秒），画幅为 adaptive/21:9/16:9/4:3/1:1/3:4/9:16；标准/优先选择使用 metadata.parameters.fast_mode 的 false/true。这些为待实施契约，不表示当前插件已经全部支持。
- 应用只提供公共素材 URL。供应商专用上传地址或其他私有要求由 TokenOne 侧适配或拒绝；CreativeOne 不新增供应商上传逻辑。

TokenOne 的逐插件能力矩阵、插件版本和真实验证记录留在其实施与交接资料中，不成为 CreativeOne 的运行时依赖。无需能力发现 API、动态供应商探测或新的配置中心。

## 4. 请求字段迁移

所有新视频请求使用公共 JSON 结构，发送用户选择的公共模型参数及应用开放的扩展。供应商参数映射和最终能力校验由 TokenOne 完成，应用不重复实现。

| CreativeOne 当前来源/写法 | 新公共请求 | 处理规则 |
| --- | --- | --- |
| 选中模型，可能含应用内部 `channel::model` 标识 | `model` | 使用现有解析逻辑提取公共模型名；应用内部选择标识不发往 TokenOne |
| Seedance `content` 中的文本 | `prompt` | 保留用户提示词，不拼接供应商参数指令 |
| 界面字符串 `seconds` | 数字 `duration` | 先验证非空、有限整数及型号范围；不能把空字符串转成 `0` 再当缺省 |
| 界面 `720`、`768`、`2k` 等 | `720P`、`768P`、`2K` 等 `resolution` | 仅做约定的格式转换，不做档位近似或降级 |
| 界面比例与 `auto` | `ratio`，`auto` 映射为 `adaptive` | 仅在型号支持自适应时允许 |
| `content[].image_url/video_url/audio_url`、`reference_images` | `metadata.input.media` | 每项只有 `type`、`url`；由用户选择的素材用途确定角色 |
| 输出声音 `generate_audio` | `metadata.parameters.audio` | 按产品选项与用户选择发送，TokenOne 校验插件支持情况；输入参考音频与输出声音不是同一能力 |
| H3 标准/优先选择 | `metadata.parameters.fast_mode` | JSON false/true；保留 false，未选择则省略；计费由 TokenOne 处理 |
| 水印、种子等 | `metadata.parameters.watermark/seed` 等 | 仅构造应用开放的字段，不展开任意对象；插件执行最终白名单校验 |
| H3 `generation_mode`、Seedance `omni_reference_task_type` | 通常不发送 | 可从素材角色推导的值交给插件；编辑/延长等无法等价表达的功能，须单独确认映射后迁移，不能丢弃用户意图 |
| Veo `size/generation_mode/reference_images` | `resolution/ratio/metadata.input.media` | 新创建统一公共写法；公共模型没有可控时长选项时不发送 `duration` |

素材角色为 `first_frame`、`last_frame`、`reference_image`、`reference_video`、`reference_audio`。首尾帧角色不能由供应商数组位置猜测；普通参考素材保留相对顺序。首尾帧是否能与参考素材混用按能力配置校验，不自动改模式。

当前 Seedance 将界面的 `seconds = "-1"` 转为省略时长。本期能力表中的所有自定义型号均不支持自动时长，迁移时应提示重新选择合法秒数，不能把 -1 静默变成省略或默认值。未来只有明确支持自动时长的公共模型才可发送 duration: -1。

`false`、合法的 `seed: 0` 必须保留，不能用 `value || default` 或真假判断过滤。`duration: 0`、不支持的负数、`null` 等非法输入明确报错。未指定扩展参数时省略，TokenOne 也不向上游补值；不要求供应商内部默认行为相同，不能为了填满结构统一补 `false`。尤其当前 `createPublicVideoTask` 固定传入 `generateAudio: false, watermark: false`，迁入 Seedance 时必须读取真实设置并判断能力。

新请求不再发送 `seconds/size/aspect_ratio` 别名，也不同时发送新旧结构；兼容别名由插件负责。已有外部调用同时传标准字段与别名时，冲突必须报错，不能采用后者覆盖前者。

### 素材上传与签名

复用 CreativeOne 上传、导入和文件归属校验。浏览器向 CreativeOne 提交本地文件引用；后端经 `signVideoMedia` 转为供应商可访问的签名 HTTPS URL，再向 TokenOne 提交。

不能把 `blob:`、需要浏览器登录的 URL、应用相对路径直接发给 TokenOne，也不能将旧 Seedance 的 data URL 流程直接当成新公共 HTTPS 素材流程。保留文件归属、媒体类型与链接有效期检查。任务快照应保留现有文件引用机制，避免只保存会过期的签名 URL。

签名 HTTPS URL 并非所有模型都接受。当前知梦 Seedance 2.5 只接受 H3 专用 public_url，Veo/Omni 只接受工作台存储的公开图片 URL 且不允许查询参数；TokenOne 当前没有代上传能力。普通 CreativeOne 签名素材命中这些限制时正常报错，不能宣称素材模式已经打通，也不让应用新增供应商上传密钥或格式分支。文本模式仍可使用；是否开放受限素材模式由产品选项决定。上述输入限制不适用于网关下载结果的签名 URL，合法的结果签名必须保留。

客户端探测的素材时长只用于界面提示，不作为 TokenOne 计费用量；不要在素材条目中加入 `duration/tokens/charge`。沿用 TokenOne 安全预扣和实际用量结算，应用不增加一套计费或媒体探测服务。

## 5. CreativeOne 具体修改位置

以下路径相对于 CreativeOne 仓库，描述待实施变更，不是本次已完成的代码修改。

| 位置 | 必须处理的事项 |
| --- | --- |
| `shared/video-models.ts`、`web/src/lib/video-settings.ts` | 复用公共模型产品选项、默认值和输入提示，工作台/画布一致，不加入供应商能力判断 |
| `shared/video-request.ts` | 所有新视频调用生成同一公共结构，不再按家族生成供应商请求 |
| `shared/video-tasks.ts` | 新创建路径统一为 videos；历史任务沿用保存的路径 |
| `web/src/services/api/video.ts` | 新创建统一走公共接口与素材上传流程；传递真实声音/水印设置；保留落库结果与恢复逻辑 |
| `server/src/model-capabilities.ts` | 同步服务端结构和能力校验：当前严格 `wanMetadata` 不接受 `parameters`，H3 要求 `generation_mode`，Veo 只接受旧结构，Seedance 从 `content` 统计素材；这些都必须改为公共结构校验，不复制供应商限制 |
| `server/src/ai.ts` | 同步 `VIDEO_ENDPOINT_MISMATCH` 路径判断、WAN/H3 schema 及画布请求检查；继续剥离 `user_prompt/canvas_context` 等应用字段再转发 |
| `server/src/storage.ts`、`server/src/generation-executor.ts` | 复用公共素材签名和服务端执行链路；兼容仅有 `metadata.parameters` 而没有 `metadata.input` 的合法请求，避免空对象访问 |
| `shared/canvas-request.ts`、`server/src/agent/tools.ts`、`server/src/agent/site-tools.ts` | 画布、Agent、站点工具共用同一请求构造和路径选择，避免仅工作台迁移成功 |
| `server/src/tokenone.ts` | 新视频调用使用现有 `/v1/videos` 拼接机制；原生路径重写仅保留历史任务查询所需部分 |
| `server/src/video-tasks.ts` | 复用已经统一的鉴权下载；按公共状态处理新任务，保留原生查询兼容；`wan` 路径判断实际表示公共视频协议，不能据此推断模型家族 |
| `server/src/canvas-tasks.ts`、`web/src/pages/canvas/project.tsx` | 恢复时使用任务记录的 ID、路径、模型，不按当前配置重算；保留已有缺失路径处理，不能批量改写历史记录 |

不要通过全局 `.passthrough()` 或删除服务端校验来让新字段“先跑通”。CreativeOne 保留公共结构、产品开放参数及应用权限/素材归属校验；插件负责供应商限制及最终能力校验。应用不按具体插件增删字段或复制其校验规则。

## 6. 创建、查询、下载示例

以下是 **CreativeOne 服务端 → TokenOne** 的协议示例。`TOKENONE_BASE_URL` 为可信配置中的服务根地址、不含 `/v1`；Token 从现有服务端凭证机制取得。浏览器继续调用 CreativeOne 自己的接口。创建会产生费用，只有获得真实生成授权后才能执行；成功联调应选择 TokenOne 已完成适配的调用环境，不兼容配置则验证错误展示。

创建（已适配的自定义万相渠道，素材地址需替换为实际可读取地址）：

```bash
curl --fail-with-body --request POST "$TOKENONE_BASE_URL/v1/videos" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "wan3.0-video",
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

回执示意（时间戳、ID 为占位数据）：

```json
{"id":"PUBLIC_TASK_ID","object":"video","model":"wan3.0-video","status":"queued","progress":0,"created_at":1700000000}
```

保存返回的 `id`，连同本地任务的模型、路径及现有归属信息持久化。回执也可能立即 `completed` 或 `failed`，不要假定一定先排队。

以下 Seedance 公共请求同样提交到 `POST /v1/videos`，上游转换由 TokenOne 负责；不要复制豆包型号替代独立型号：

```json
{
  "model": "sd-2.5-ch1",
  "prompt": "从首帧平滑过渡到尾帧，保持人物外观一致",
  "duration": 6,
  "resolution": "720P",
  "ratio": "16:9",
  "metadata": {
    "input": {"media": [
      {"type": "first_frame", "url": "https://example.com/start.jpg"},
      {"type": "last_frame", "url": "https://example.com/end.jpg"}
    ]}
  }
}
```

这个型号要求首尾帧成对，不能只传首帧，也不能混入普通参考素材。示例展示公共协议，应用仍不需要根据供应商选择转换方式。

查询同一公共任务：

```bash
curl --fail-with-body "$TOKENONE_BASE_URL/v1/videos/$PUBLIC_TASK_ID" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN"
```

TokenOne 公共状态使用 `queued/in_progress/completed/failed`。`progress` 为展示辅助，不以达到 100 判断成功；`completed_at` 和 `error` 可能缺省。失败且没有错误详情时展示通用失败信息。完整字段与现有 HTTP 错误见主方案第 7 节。

仅在生成完成后下载：

```bash
curl --fail \
  "$TOKENONE_BASE_URL/v1/videos/$PUBLIC_TASK_ID/content" \
  --header "Authorization: Bearer $TOKENONE_API_TOKEN" \
  --output output.mp4
```

实际后台继续使用现有 `fetch(..., { redirect: "error" })`：先检查 HTTP 状态及 Content-Type，再读取非空视频内容并保存文件。示例不使用 `-L`。浏览器消费 CreativeOne 返回的 `file.url/storageKey`；不解析供应商 URL，不直接拿 TokenOne Token 下载。

TokenOne 的 `completed` 表示生成完成，即使结果 URL 缺失、过期或下载暂不可用，也不改为生成失败；应用记录并展示下载/保存问题，恢复时处理同一任务。公共响应只含宿主标准字段及批准的安全扩展，不依赖原始上游数据或 URL。CreativeOne 仍需完成下载和文件保存才能向用户交付。CreativeOne 内部的 `pending/succeeded/unknown` 以及前台恢复用的 `paused` 是应用自己的状态，不应发送给 TokenOne，也不要求 TokenOne 增加这些状态。

## 7. 错误处理与任务恢复

CreativeOne 和 TokenOne 的重试机制独立配置、各自负责，不共享重试预算，不要求相互读取或覆盖重试设置。应用只按本次 HTTP 响应与任务状态处理，不推测 TokenOne 内部进行了多少次上游尝试。TokenOne 宿主 RetryTimes 默认 0，启用重试后特定提交错误存在重复受理风险；这是网关配置与实现责任，应用不读取或覆盖它。本次不改造 TokenOne 重试机制，也不承诺创建具有幂等语义；下载失败不得自动重提生成。

| 情况 | CreativeOne 应采取的行为 |
| --- | --- |
| 本地校验或 TokenOne 返回参数错误 | 展示原因并要求修改；不自动删素材、改分辨率、改时长重试 |
| 分组接入不兼容插件、没有可处理请求的渠道 | 正常展示 TokenOne 返回的错误；不识别插件、不自动改用私有格式或原生接口 |
| 创建超时、断网，是否受理未知 | 保留现有提交确认状态和任务记录；没有拿到 ID 时不能猜测任务 ID，也不能自动重发 POST；本方案不承诺 TokenOne 幂等键 |
| 查询限流、网络错误、临时 5xx | 对同一个 ID 退避重试 GET，遵守 `Retry-After`；不触发生成 |
| 未知状态或无效查询响应 | 保留任务并记录异常，按现有查询恢复机制处理，不当作完成或重新创建 |
| TokenOne `failed` | 展示失败原因，缺少详情则通用提示；用户明确另行生成才创建新任务 |
| 下载未就绪 | 当前 `/content` 未完成通常为 400 `invalid_request_error`，部分内容路径为 409 `artifact_not_ready`；核对原任务状态后重试 GET，不能把所有 400 都当临时错误 |
| 下载内容失效 | 410 `artifact_gone`：提示资源失效，停止无限重试；不自动重新生成 |
| 下载或本地保存临时失败 | 沿用暂停/恢复链路，可重新查询、下载、保存同一任务；保留 ID，不能退回创建环节 |
| 401/403、任务不存在或归属不符 | 检查当前用户权限和配置；不尝试其他用户 Token、不展示供应商私有 ID、不自动换渠道 |

错误结构沿用现有实现，不假设每个响应都有相同 `code/type`。例如查询不存在的任务当前可返回 400 `task_not_exist`，下载不存在/他人任务为 404。HTTP 成功也需要检查任务状态。

`POST .../{id}/resume` 是 CreativeOne 自己的恢复接口，不能作为 TokenOne 的新接口写入客户端 SDK。前台等待超时或关闭页面不应取消后台任务；生成完成但下载失败，不等于生成失败或应退款。

## 8. 切换顺序与回退

1. TokenOne 按自己的实施计划完成自定义插件映射、白名单、状态和结算验证，提供公共规约与准确模型身份；插件明细留在 TokenOne 侧。
2. CreativeOne 按公共规约调整请求构造、公共模型选项、服务端校验和所有调用入口，先用模拟接口验证成功与错误路径。
3. CreativeOne 前后端一起切换，新创建统一使用 `/v1/videos`；不新增按插件、分组或模型选择供应商协议的开关。
4. 授权真实联调时核对生成、查询、下载及结算；不兼容分组导致失败时正常报错，不要求所有插件完成适配才允许应用采用规约。未经授权不付费生成或部署。
5. 如应用升级本身需要回退，按现有发布流程回退版本或暂停新创建，不实现遇错自动换原生协议。已有任务继续按保存的路径和 ID 处理，不能重提交、重写 ID 或改走另一条查询链路。

历史原生路径、现有恢复入口和文件交付格式保持可用。此次协议迁移不要求新建任务表或批量转换历史记录；也不要求新增一套版本协商、路由或后台任务框架。

## 9. 验收与交接清单

优先扩展现有 `web/src/services/api/video.test.ts`、`server/src/integration.test.ts`、`server/src/server-agent.test.ts` 及适合的画布用例，避免为同一行为在各层重复造测试。

- 工作台、画布、Agent、站点工具的新视频请求均使用同一公共结构和 videos 路径；历史任务仍按保存的路径恢复。
- 分组包含不符合规约的插件或渠道时，应用正常呈现错误，不修改参数、不新增供应商适配、不自动回退原生入口。
- 准确模型 ID、素材角色及顺序、合法默认值、`seed: 0`、`audio: false`、自动时长与省略区别正确；不支持字段、超界值、别名冲突不会被静默修正。
- 新 `metadata.parameters` 可以通过服务端公共结构校验；Seedance 从新素材结构统计数量，H3/Veo 不再被旧 schema 错拒；应用未开放的字段不任意透传，供应商扩展白名单由 TokenOne 最终校验。
- 素材上传、签名及归属检查覆盖他人文件和类型不符；仅有扩展而没有素材时正常处理。受限模型不接受普通签名 URL 时正常报错，不静默转存或改生成模式。
- 创建立即完成/失败、常规轮询、缺少错误详情、未知状态、创建结果未知均正确处理。
- 生成 completed 但内容不可用时展示下载问题，不改成生成失败；公共响应没有供应商 URL 或私有字段也能完成整个流程。
- 下载覆盖成功、401/403/404、未就绪、410、超时、重定向、非视频及空响应；Token 只发往可信 TokenOne，供应商密钥不出现在应用请求或日志。
- 模拟下载/保存失败后恢复，断言没有额外创建 POST；浏览器刷新、前台超时、后台重启与旧任务恢复不会重新生成。
- 模型权限、用户任务归属及 TokenOne 渠道约束保持有效；应用升级不破坏在途任务。
- 计费验收由 TokenOne 侧确认有效参数预扣、实际用量结算及失败退款；应用不伪造用量，不将下载失败当作生成失败。

交接时分别列出：实际修改的模型与入口、模拟测试命令和结果、授权真实调用及结果、尚未验证事项。本文仅完成代码现状核对、供应商文档对照和升级设计，尚未执行 CreativeOne 修改、迁移测试或真实上游调用。TokenOne 现有插件模拟测试记录见主方案第 6.3 节，不代表 CreativeOne 迁移已经验收。
