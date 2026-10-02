# New API COMPOSITE：功能与实现交接

> 本文件已保存到本项目，后续以此处为准。第 1–10 节保留原始交接内容；第 11 节起为本次 review、实现修订和实际交付记录。用户本轮明确指定 **tokenone.lab 当前接入的数据库**，因此覆盖第 10 节原先选择 migration 数据库的约定。开发验证使用该数据库的隔离副本。不得部署生产或修改线上 IDONE。

日期：2026-09-29。接收项目：`/home/hulei/projects/newapi`。

本文是本次需求的实施基准，替代此前讨论的影子分组、Reseller 拦截计费、逐模型倍率覆盖和独立应用定价引擎方案。原交接时只有方案；实际代码、验证、本地接管和后续改动收敛记录见第 11–18 节。当前运行版本为第 17 节的 `v0.0.0-composite.20260929.4`。

## 1. 要实现什么

在 New API 增加具名 **COMPOSITE（组合分组）** 类型。管理员可以创建多个组合组，每个组合指定一组有序的普通业务分组，并配置自己的倍率。每个应用使用一个组合组，例如 PPTONE、AGENTONE。

用户在有权限的组合组下创建原生 Key。Key 只选择组合名称，不能自行编辑组合成员、顺序、倍率或跨成员重试策略。

请求按模型在组合成员中选择实际业务组，最终倍率为：

```text
最终倍率 = COMPOSITE 基础倍率 × 实际普通组基础倍率
费用 = 原生模型计费结果 × 最终倍率
```

倍率应在原生配额转换/舍入之前应用。不是先按普通组扣费再返现，也不对已舍入的费用再扣一次。

### 示例

原业务组 GPT 的倍率为 0.4，提供 gpt-5.6；IMAGE 的倍率为 0.8，提供 gpt-image-2。

```text
PPTONE（COMPOSITE，倍率 0.8）
  成员顺序：GPT → IMAGE

AGENTONE（COMPOSITE，倍率 0.9）
  成员顺序：GPT → IMAGE
```

| Key 所选组 | 实际命中组 | 最终倍率 |
|---|---|---:|
| GPT | GPT | 0.4 |
| IMAGE | IMAGE | 0.8 |
| PPTONE | GPT | 0.32 |
| PPTONE | IMAGE | 0.64 |
| AGENTONE | GPT | 0.36 |
| AGENTONE | IMAGE | 0.72 |

GPT 基础倍率改成 0.5 后，新 PPTONE 请求命中 GPT 的倍率自动为 0.4，无需维护应用模型价表。示例名字和数值是测试样例，不是生产配置。

## 2. 确定的行为要求

### 2.1 权限

- 用户拥有 PPTONE 权限，就可以通过 PPTONE 调用其成员；不要求另行授予用户 GPT/IMAGE 的直接权限。
- 组合权限不扩大原生用户的直接可选组。没有 GPT 直接权限的用户，不能因此创建或使用直接 GPT Key。
- 原来已经拥有的直接组权限保持不变。
- 原生用户/Key 启停、有效期、额度、IP 限制、模型限制继续执行。组合不绕过这些控制。
- 对单个组合的授权仍复用原生可用组机制；本功能不另建账号授权平台。
- 用户可以修改/停用自己的 Key，但不能通过传入 auto_groups、请求头、改名、请求参数改变组合的受管成员。若将 Key 改成普通 AUTO，就按其直接权限执行普通 AUTO，并失去组合语义。
- 不要求验证调用来自真实 PPTONE 程序。拥有组合 Key 的人可以在外部使用同价，这不是本次要解决的应用来源认证。

### 2.2 与 AUTO 的关系

COMPOSITE 不受以下原生 AUTO 设置限制：

1. 全局 AutoGroups 列表。
2. 用户在普通 Key 上填写的 auto_groups。
3. 普通 Key 自定义 AUTO 的数量上限 MaxTokenAutoGroups。
4. 用户对每个成员普通组的直接可选权限。

例如全局 AUTO 只有 default、VIP，PPTONE 仍可使用管理员指定的 GPT、IMAGE。可独立设置组合成员数量上限以防配置滥用，但不能偷偷复用普通 AUTO 限制。

普通 AUTO 保持原有行为，不获得上述例外。禁止将 COMPOSITE 填入全局或 Key 自定义 AUTO 的成员集合，否则可能形成嵌套授权绕过。

### 2.3 路由

- 首版仅允许引用普通组，不允许引用 auto、自身或其他 COMPOSITE。
- 成员必须存在，有明确基础倍率；去重并保留管理员顺序。
- 按顺序寻找支持本次模型的可用渠道；第一个成员无适配渠道时可继续下一个，不代表上游失败后的跨组重试已开启。
- 同模型在多个成员组可用时按顺序，不按最低价格。
- 组内继续原生优先级/权重/故障处理，尽量不复制原生调度实现。
- 上游失败后的跨成员重试由管理员配置，默认建议关闭；成员无模型时的正常选组不受此开关影响。接口必须明确这两个行为的区别。
- 亲和性、指定渠道、协议过滤、参数覆盖后的重选等路径不得逃出成员范围；指定渠道不能绕过组合权限。若上游原生行为与严格顺序有差别，应明确调整和测试，不能在不同入口选择不同含义。
- COMPOSITE 不直接绑定渠道。渠道继续归属原 GPT/IMAGE，不复制渠道或凭据。
- 无有效成员、停用、配置损坏或无可用渠道时明确拒绝，不回落 default 或全局 AUTO。

### 2.4 计费优先级

组合调用严格使用两层基础 GroupRatio 的乘积，不额外使用用户组特殊倍率。这是当前交接采用的简化规则。

普通分组/AUTO 调用仍保留原生用户组特殊倍率行为。不要全局移除原有优惠配置。

显式倍率 0 与缺失不同：0 按原生免费语义处理；缺失成员倍率拒绝，不悄悄使用 1。验证有限非负数及合理上限，沿用原生金额安全转换。

计费、预扣、跨组重试、图片数量调整、退款、日志必须使用一致结果。现有工具附加费或其他费用凡原来受组倍率作用的，都应使用正确的最终组倍率；不要只覆盖表达式主体而漏掉其他费用。

## 3. 实现方向：新增模块 + 请求内受管 AUTO

主要目标是减少频繁合并上游时的旧文件改动。将业务逻辑集中在新增文件，现有文件只加必要的小段调用。不是“只能改三文件”的硬性指标；正确性优先。

候选路径：

```text
原生 TokenAuth
  验证原始 Key.group=PPTONE，用户确有 PPTONE 权限
       ↓
新增 PrepareCompositeRequest
  从服务端读取组合并冻结配置/倍率快照
  保存原始组合名
  仅在本次内存上下文中切换路由 TokenGroup/UsingGroup 为 auto
       ↓
原生 AUTO 调度
  GetRequestAutoGroups 对可信组合快照返回受管成员
  普通 AUTO 仍走原生列表和权限过滤
       ↓
选中实际普通组
       ↓
倍率适配函数：快照中组合倍率 × 所选成员倍率
       ↓
原生 PriceData、BillingSession、结算/退款、日志
```

这是基于已读源码的实现候选，不是已验证补丁。先做纵向原型验证请求上下文与实际协议，再确定最终接入点。

### 3.1 三处核心旧文件接入候选

| 位置 | 改动 |
|---|---|
| middleware/auth.go | SetupContextForToken 成功后、c.Next 前调用新增请求准备函数；失败终止 |
| service/group.go | GetRequestAutoGroups 优先读取可信组合快照；否则原样执行上游逻辑；补充禁止 AUTO 嵌套组合 |
| relay/helper/price.go | HandleGroupRatio 中对组合请求读取所选成员并计算最终倍率；普通请求原样执行 |

这种转换使当前 controller/model.go 的 /v1/models 有机会直接复用原生 AUTO 模型并集，也使原生渠道选择/亲和性入口可以复用 GetRequestAutoGroups。必须实测，不能只看这三个函数就认为所有入口都已覆盖。

完成版还需要管理 API、配置保护、准确价格展示、日志和必要的异步快照接入。目标是约 5–7 个旧文件的小幅改动；实际图片/异步路径可能增加，交付时报告真实 diff，不承诺固定文件数。

### 3.2 新增文件组织（建议）

```text
setting/composite_setting/config.go   类型配置、验证、版本和快照读取
middleware/composite.go               已鉴权请求准备与支持范围检查
service/composite.go                  成员、授权边界和模型/价格信息
relay/helper/composite_price.go       两层倍率适配
controller/composite.go               管理与详情 API
router/composite.go                   独立路由注册
```

按实际包依赖拆分，避免循环引用。不要建立庞大插件框架，也不要复制整份上游调度/计费文件。任务插件不是本功能所需的全局权限/计费扩展点。

## 4. 请求状态和快照要求

可信组合快照只能由服务端鉴权后生成，不接受客户端 header/body 构造。建议包含：组合名、配置版本、有序成员、组合基础倍率、各成员基础倍率、重试策略。

保留三个概念：

1. 数据库 Key.group：PPTONE，不改写。
2. 内部调度模式：AUTO，仅本次请求用于复用代码。
3. 本次实际组：GPT 或 IMAGE，渠道选择结果。

不要用一个字段来回覆盖并丢掉入口组；不得临时修改数据库 Key、用户组、全局 GroupRatio 或全局用户权限。

冻结本次倍率后，后台改价只影响新请求。跨组重试使用同一快照里对应成员的倍率，恰好乘一次；重试更贵时在发送前补足预扣。

同步/流式请求可以使用适当的请求上下文，但异步任务不能依赖 Gin context 存活。将所需组合/倍率元数据保存进原有任务 JSON 快照，完成/重算/退款读取快照。若必须给现有 Go struct 增字段，就做最小显式增加，不用隐式全局状态绕开修改。

快照的具体锁定点应与原生资金预留边界一致；配置读取、成员合法性和倍率不能来自互相矛盾的版本。

## 5. 配置持久化与管理 API

优先沿用现有 options 表，不新增 Token、用户、钱包字段，不新增资金表。

GroupRatio 继续作为各具名组基础倍率的唯一来源。组合类型和成员关系用新名字空间配置，避免重复存倍率。不得同时持久化历史 group_ratio_setting.group_ratio 别名。

示意配置（拟议结构）：

```json
{
  "PPTONE": {
    "enabled": true,
    "members": ["GPT", "IMAGE"],
    "cross_group_retry": false
  },
  "AGENTONE": {
    "enabled": true,
    "members": ["GPT", "IMAGE"],
    "cross_group_retry": false
  }
}
```

组合成员、类型、倍率写入要有版本冲突检查和必要事务，校验引用。原生组删除/改名/渠道编辑入口也必须不能绕过限制；或者运行时对非法状态统一拒绝，并在管理接口暴露错误。不要假定新增接口是唯一写入口。

存在 Key 或在途任务引用时，停用组合而不是直接移除类型记录，防止旧 Key 被当普通组放行。插件/功能开关关闭时也须拒绝已有组合 Key，不按普通价格继续执行。

新增独立管理 API，路径按项目规范命名。至少支持：列表/详情、创建/更新/停用、校验/生效版本、模型及价格路径详情。复用原生管理鉴权和审计，普通用户不能写配置；用户只读接口限定到本人有权限的组。

## 6. UI 与 Reseller 契约

为少改上游前端，完整组合配置界面优先放 Reseller，New API 提供管理 API。本次 New API 实现不自动扩展为 Reseller 项目开发，但须交付可调用、可测试的接口文档/示例。

原生组列表要能返回 PPTONE/AGENTONE 供现有 Reseller 配置默认组；Key 创建继续接受 group=PPTONE。原 native Key 列表显示 PPTONE，而非内部转换后的 auto。用户界面不出现自定义组合成员编辑器。

Reseller 当前单应用独占默认组的机制可以保留：应用 PPTONE → 组合 PPTONE。两个应用不共享 auto 这个持久组名。现有 ensure 请求参数 issuer/subject 不变，仍创建本人 Key，不代建共享服务账号。

价格展示不能把 PPTONE 的 0.8 显示为所有模型的最终倍率。补充“组合倍率/实际成员/最终倍率”详情；同模型有多个可能成员时显示路径或区间，不保证始终最便宜。如果原价格页需要小改才能避免误导，允许增加独立组件和一个入口调用。

日志至少可核对组合名、实际组、组合倍率、成员倍率、最终倍率、配置版本；金额来源仍是原生结算。扩展现有 JSON，不重写历史日志。用户日志的可见性与管理员审计分开处理，不因减少 UI 改动泄漏敏感信息。

## 7. 支持范围与禁止静默降级

首版必须覆盖用户实际使用的 gpt-5.6 和 gpt-image-2 路径，至少检查 Chat/Responses HTTP/SSE、图片生成/编辑及实际计费模式。

不要只按请求 URL 判断图片是否同步：当前原生图片入口可能由任务插件承接。实际渠道走任务时必须处理任务提交/完成快照，不得用“首版暂不支持异步”宣称两个目标模型已经完成。

以下路径需要逐项检查：原生普通路由、Responses WebSocket、Realtime、Playground、异步提交/轮询、渠道亲和性、指定渠道、协议插件。仅从 TokenAuth 接入不会自动覆盖使用 UserAuth 的 Playground。未覆盖的路径应在上游提交及预扣前明确拒绝组合调用，普通请求不受影响，并列入交付限制。

已经发现 service/quota.go 的 Realtime 预扣和 service/task_billing.go 的任务重算有独立组倍率读取。不能只改 HandleGroupRatio 就默认它们正确。对现有归档之外的新上游代码也要重新搜索。

## 8. 必须完成的行为测试

优先复用现有测试设施、集中增加集成用例；遵守 New API 项目测试和计费规范，不写只验证文件结构/函数调用的镜像测试。

| 类别 | 验收要求 |
|---|---|
| 基本路由 | 示例两个模型分别命中 GPT/IMAGE，组合 Key 持久组不变 |
| AUTO 隔离 | 全局 AUTO 不含成员、Key 自定义列表不同、普通 AUTO 上限小于组合成员数，组合仍按管理员列表执行 |
| 委托权限 | 仅有 PPTONE 权限可组合调用；直接 GPT/IMAGE Key 创建/调用仍拒绝 |
| 防篡改 | auto_groups、请求头、改名、嵌套 AUTO/COMPOSITE、指定渠道不能扩大成员范围 |
| 原生回归 | 普通组/AUTO 权限、用户组特殊倍率和原渠道行为不变 |
| 倍率 | 0.8×0.4、0.8×0.8 等结果正确；显式 0 与缺失区分；无效/溢出拒绝 |
| 资金 | 预扣/实际结算/失败退款/Key额度/用户余额/日志一致，不重复扣费或返还 |
| 重试 | 同模型多组按策略选路，跨组后重算一次，更贵请求先补预扣 |
| 在途更新 | 请求开始后改组合和成员倍率，新旧请求分别按自己的快照执行 |
| 文本/图片 | 实际协议的普通/流式、生成/编辑、图片数量变化、失败和断开 |
| 异步 | 请求结束后任务完成/失败仍保留组合倍率，改价后不按新配置重算旧任务 |
| 配置 | 并发保存冲突、重启、多实例、停用/引用删除、损坏状态没有静默回退 |
| 接入 | 原生模型列表、Key创建/展示、Reseller ensure 所需的具名组接口兼容 |

资金验证用隔离真实 PostgreSQL；如改动持久化/迁移，遵守上游 SQLite/MySQL/PostgreSQL 兼容验证要求。模拟上游避免真实扣费；真实上游验收和模拟验收分别报告。

## 9. 建议实施顺序与上游合并

1. 阅读项目 AGENTS.md、计费规则、实际使用的计费表达式/插件规范；核对最新开发基线，不复用本说明中的历史行号。
2. 在隔离分支制作纵向原型：组合权限 → 请求内 AUTO → 成员列表 → 倍率乘积 → 模型列表/资金校验。
3. 审计实际图片和独立结算路径，修正快照/入口设计；随后补齐管理 API、校验、日志/价格信息。
4. 跑行为回归与原生普通路径回归，报告真实旧文件改动清单及每处原因。
5. 保持新增模块与薄接入提交清楚，选定一次上游版本更新做隔离合并演练。

上游更新流程建议：在候选升级分支 git merge → 编译/原生必要检查/COMPOSITE行为测试 → 审阅升级结果。冲突不自动选 ours/theirs；测试失败不生成可部署通过结论。不承诺零冲突，也不以编译通过代替财务和授权回归。

不采用文本查找替换自动注入代码、运行时 monkey patch、临时全局倍率或复制整套上游路由。这些会降低可审阅性或漏掉上游修复。

## 10. 交付物与环境边界

交付：新增代码与最小接入 diff、配置/API说明、必要 UI/展示适配、测试结果、协议支持清单、升级合并检查、停用/回退步骤。明确哪些需要 Reseller 后续接入，不把未开发的管理界面称为已完成。

本次交接是源码功能实现方案，历史“仅原版”的部署状态不自动改变。实际开发由用户在 New API 项目发起；若项目旧规则禁止源码定制，实施指令须明确本功能的开发例外。无论开发授权如何，不能自动发布或替换生产镜像。

测试使用 migration 独立环境或它的专用隔离测试实例/数据库；不得默认使用 New API/Reseller 历史 55200 / tokenone.lab 实例。参考：

- `/home/hulei/projects/tokenone_migration/docs/LOCAL_MIGRATION_LAB.md`
- migration 入口 `https://migration.lab.home.arpa`，后端 `192.168.10.38:55400`
- 本项目目标数据库容器 `tokenone-migration-postgres`，应用 `tokenone-migration-newapi`

不可默认覆盖 migration 现有数据或更换运行镜像；自动化优先用隔离 fixture。不得修改线上 IDONE，不自动登录真实用户，不重复导入生产资产，不停止或变更源 sub2api。

## 11. 本项目的 review 结论与实现修订

原方向可行，但三处 hook 不足以覆盖路由和资金边界。采用新增模块加薄接入，保留原生渠道选择、协议转换、钱包、Key 配额和任务结算；没有复制调度器、资金系统或建立新的账户表。

1. **不能只把组名改成 AUTO。** 原生指定渠道和亲和性可能提前返回，AUTO 的后续选组也不等于管理员指定的严格顺序。因此新增 `service/composite.go` 统一选择成员，再调用原生 `GetRandomSatisfiedChannel` 处理组内优先级、权重、协议过滤。指定渠道只能属于首个可用成员；普通亲和性不能越过成员顺序，严格亲和性冲突则拒绝。
2. **配置不能只依赖进程内缓存。** 每次 TokenAuth 后用一条 SQL 同时读取类型注册表和 GroupRatio，冻结请求快照。原生配置缓存只用于编辑器/可选项；普通 AUTO 在请求阶段还会按数据库注册表剔除组合。全局 AUTO 与 Key 自定义 AUTO 的保存都查询数据库，避免其他实例缓存延迟造成嵌套。代价是普通 Token 请求也增加一次数据库读取；组合请求另检查直接渠道绑定。
3. **旧请求不能跟随后台改价。** 最终倍率通过快照计算，使用十进制乘积后交给原生金额转换。普通组特殊倍率仍保留；组合只用两层基础倍率。缺失倍率、损坏注册表、停用及非法渠道绑定均拒绝，显式 0 保留免费语义。
4. **更贵重试必须先预留资金。** 同步请求保存组倍率之前的预扣基础，重试前用新成员倍率调用原生 BillingSession.Reserve；任务路径也在重试发送前追加预留。原生结算和退款负责最终资金变化。
5. **异步不能依赖 Gin context。** 在现有任务 private_data JSON 的 BillingContext 增加可选 `composite`，未新增列。任务完成、按 token 重算及退款日志读取提交时的元数据和倍率。即时图片和后台轮询均走原生任务宿主。
6. **配置与倍率原子保存。** `composite_setting.groups` 只存类型、成员和重试策略；倍率仍只存 `GroupRatio`。使用整体配置 SHA-256 版本做乐观冲突检查，事务保存两项配置，清除历史倍率别名。写事务先取得注册表的写入保留，再读版本，兼容 SQLite 的跨进程竞争。类型记录只允许停用，不提供删除接口。
7. **不把基础倍率当成最终价格。** 原生组列表标注 COMPOSITE；价格 API 从普通倍率表移除组合，并新增模型/成员/倍率路径。前端新增独立折叠区域，复用 Accordion、StaticDataTable 和 ModelPriceCell。比例展示需要保留小数精度，使用经 `toIntlLocale` 转换的语言及 15 位有效数字；没有复制价格算法。

Key 编辑器保留 COMPOSITE 顶层选择，将类型正确显示为 COMPOSITE；普通 AUTO 成员候选仅含普通组。复用现有选择器和倍率徽章，没有新增一套 Key 表单。

本项目没有“普通用户只能创建自己用户组 Key”的额外限制。本实现按原生可用组授权：可创建有授权的普通组或 COMPOSITE Key；组合授权不会授予成员的直接权限。接管以本项目为代码基线，不移入其他项目的隐藏权限补丁或额外日报功能。

### 明确的首版语义

- 成员上限 32，去重并保留顺序；基础倍率必须有限且在 0–1000。
- 普通组不能直接原地转换为同名 COMPOSITE，避免已有 Key 被重新解释；请用新组合名迁移。
- `cross_group_retry=false`：首次选择可跳过不支持模型的成员；一旦选择成员，上游失败后的重试留在该成员，即使后来没有可用渠道也不跨组。
- `cross_group_retry=true`：可重试的上游失败后尝试下一成员，受原生整个请求的重试次数限制。不会把每个成员再扩展成一整套重试预算，也不保证最低价。是否可重试仍由原生错误策略判断。
- 配置更改影响新请求；在途请求及已持久化任务保留原快照。渠道健康、模型能力仍按原生机制更新。
- 支持 Chat/Responses HTTP 和 SSE、图片生成/编辑、原生模型列表，以及上述共享端点的任务插件路径和 Responses 任务查询。
- COMPOSITE 的 Responses WebSocket、Realtime、Playground、其他原生/插件专有入口明确拒绝，拒绝发生在上游提交和预扣之前。普通组这些入口不受该功能限制。

## 12. API 契约

所有管理接口沿用原生 Dashboard Bearer JWT/PAT 鉴权；写入使用 RootAuth，并进入原生管理审计。不是模型调用用的 `sk-` Key。

| 方法与路径 | 权限与行为 |
|---|---|
| `GET /api/composite` | Root，返回 `data.version`、`data.groups`、`data.max_members` |
| `GET /api/composite/:name` | Root，查看定义、倍率、模型价格路径或配置错误 |
| `PUT /api/composite/:name` | Root，创建/修改/停用；必须携带上一版 `expected_version` |
| `PUT /api/composite/:name?validate_only=true` | Root，只校验，不写入 |
| `GET /api/composite/self` | 已登录用户，只返回本人原生可用组中的组合 |
| `GET /api/composite/self/:name` | 已登录用户，无权查看与不存在均返回 404 |

写请求示例（先 GET 获取版本，不要照抄占位符）：

```json
{
  "expected_version": "GET返回的整体配置版本",
  "definition": {
    "enabled": true,
    "members": ["GPT", "IMAGE"],
    "cross_group_retry": false
  },
  "ratio": 0.8
}
```

成功：`{"success":true,"data":{"version":"新版本"}}`。过期版本：HTTP 409，需重新读取并审阅后保存。非法定义：HTTP 400。普通用户写入：HTTP 403；未鉴权：HTTP 401。请求体上限 64 KiB。停用通过同一 PUT 将 `enabled` 改成 `false`。

原生 `POST /api/token/` 仍使用 `group: "PPTONE"`。组列表仍兼容具名组；`/api/user/self/groups` 中组合额外返回 `type: "composite"`、`composite_ratio`，原 `ratio` 为字符串 `"COMPOSITE"`。`GET /api/pricing` 新增 `composite_groups`，普通 `group_ratio` 不含组合。

用户 Key 的 `auto_groups`、跨组重试字段、请求头或 body 不能覆盖管理员定义。更改 Key 为普通 AUTO 后重新执行普通直接权限规则。

消费/任务日志增加：

```json
{
  "composite": {
    "name": "PPTONE",
    "version": "配置版本",
    "member": "GPT",
    "composite_ratio": 0.8,
    "member_ratio": 0.4,
    "final_ratio": 0.32
  }
}
```

该字段是调用者自身的价格路径，不含渠道 ID、上游凭据或其他用户配置；原有渠道诊断仍按管理员/root 日志权限分层。

## 13. 验证记录与边界

验证用模拟上游，不发生真实模型扣费。SQLite/MySQL/PostgreSQL 均使用真实数据库；MySQL、PostgreSQL 的主库和日志库分别配置。

| 验证项 | 实际执行与结果 |
|---|---|
| 最小纵向原型 | `go test ./controller -run '^TestCompositeVerticalPrototype$' -count=1 -v`：通过；GPT/IMAGE 分别 1600/3200 quota，Key 持久组不变，钱包/Key/日志一致 |
| 完整相关后端回归 | `GOMAXPROCS=2 go test -p 2 ./controller ./middleware ./service ./relay/helper ./model ./router`：通过 |
| 三库功能测试 | `go test -p 2 ./controller -run '^TestComposite' -count=2 -v`；外部库通过 `TEST_RESPONSES_SQL_DSN` 和 `TEST_RESPONSES_LOG_SQL_DSN` 注入，凭据仅保存在忽略目录 |
| 数据库版本 | SQLite **3.50.4**；MySQL **8.0.46**；PostgreSQL **15.18** |
| 新库重复迁移 | `go build -o .local-tests/composite/dbcheck ./deploy/tokenone-lab/dbcheck`；`NEWAPI_DATABASE_CHECK=isolated` 加隔离 DSN/SQLITE_PATH 执行。三库各连续迁移两次通过，单独日志库也完成迁移 |
| 实际数据副本升级 | 同一 dbcheck 对 tokenone.lab 副本连续迁移两次；243 个用户、323 把 Key、31 个渠道、23 项配置、0 个任务的全行摘要前后相同。开发副本渠道在迁移前已停用 |
| 前端 | `bun run typecheck`、`bun run build` 通过；`bun run test --maxWorkers=1 src/features/pricing`：10 文件、254 用例通过；`bun run test --maxWorkers=1 src/features/keys`：8 文件、69 用例通过。对本次修改的 TS/TSX 文件执行 oxlint 通过；整个 pricing 目录另有原有 lint 问题，未为本功能扩改 |
| 本地启动 | 本项目构建产物已在隔离开发库启动，`GET http://127.0.0.1:55210/api/status` 返回 success |
| 本地站点接管 | `https://tokenone.lab.home.arpa/api/status`：200，版本 `v0.0.0-composite.20260929.3`；首页和 JS 资源 200，价格 API 200，两个 COMPOSITE 管理入口未登录均 401 |

功能用例集中在 `controller/composite_test.go`，包含原生鉴权/模型/IP/额度限制、禁用 Key、直接组拒绝、模型并集、WebSocket/Realtime/Playground 拒绝、零倍率、缺失/损坏配置、渠道绑定、管理员校验/版本冲突、指定渠道、亲和性顺序、请求参数篡改、陈旧缓存下 AUTO 嵌套拒绝、跨进程版本竞争、在途改价，以及 HTTP/SSE 文本和图片表达式计费。

计费表达式使用现有数据中的 GPT 272k 分层价格和图片 `p * 5 + cr * 1.25 + c * 30` 模式。任务插件图片验证请求 4 张、实际 2 张，按 0.64 结算；异步请求结束后改价，完成仍使用旧快照，失败退款，重复轮询不重复结算。普通组特殊倍率另有回归。

安全审查依据：[OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/)、[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)。应用的控制是服务器端权限、拒绝越权/失效配置、保留 Key 限制、原生 Bearer 管理鉴权及不记录凭据；不宣称通过完整 ASVS 认证。

未覆盖或不在本轮范围：

- 真实付费上游调用及所有第三方任务插件。本轮当前数据的图片渠道是原生 OpenAI 类型；任务宿主另用真实 JavaScript 插件加模拟提供方验证。
- 当前数据中可用的是 `gpt-5.6-sol/terra/luna` 等名称，不是示例裸名 `gpt-5.6`；测试为示例裸名建立隔离渠道，没有往站点虚构可用模型。
- COMPOSITE 的 WS/Realtime/Playground、其他专用协议首版拒绝，未实现其计费适配。
- 未测试 ClickHouse 日志库、所有数据库最低版本、真实网络故障矩阵、长时间流式断连、订阅资金来源的 COMPOSITE 专项用例、任务提交跨成员重试的补预扣专项用例和大规模压力。
- Reseller 组合编辑界面及真实应用 ensure 调用不在本项目实现；已提供具名组、Key 和管理 API 契约。
- 已 fetch `upstream/main`，仍是本次基线 `789c970199ea527e6a26e071915f4a4cd2c64178`，没有更新提交可做升级合并演练。因此不宣称验证了未来版本兼容或零冲突。

## 14. 本项目的固定路径与运维约定

| 用途 | 路径/目标 |
|---|---|
| 唯一代码与交接文档 | `/home/hulei/projects/newapi`，本文 |
| 启动入口与 unit 源文件 | `deploy/tokenone-lab/` |
| 正式本地站点 | `https://tokenone.lab.home.arpa/` → 原有 55200 端口 |
| 本地站点私密配置 | `data/tokenone-lab/lab/environment.json`，0600 |
| 开发配置 | `data/tokenone-lab/dev/environment.json`，0600；端口 55210，NODE_TYPE=slave |
| 构建产物 | `data/tokenone-lab/releases/<版本>/new-api`，`current` 符号链接选择版本 |
| 日志 | `data/tokenone-lab/{lab,dev}/logs/` |
| 备份 | `data/tokenone-lab/backups/`，0700 目录、0600 数据文件 |
| 开发数据库 | `deploy/tokenone-lab/dev-postgres.yml`；容器 `newapi-tokenone-dev-postgres`；持久卷 `newapi-tokenone-dev_postgres`；仅 127.0.0.1:55211，库 `tokenone_dev` |
| 一次性测试数据与证据 | `.local-tests/composite/`，不提交凭据或数据库 dump |

原站点数据库保持 `127.0.0.1:5436/newapi_data_migration_rehearsal`，现有数据库容器 `codex-newapi-test-pg-20260924` 原地保留；没有因整理目录而重建数据库、重导用户资产或移动其数据卷。新入口保存相同 SQL_DSN 和签名配置；不依赖其他项目的源码或启动脚本。

2026-09-29 已完成本地接管。`tokenone-newapi-local.service` 和 `tokenone-newapi-dev.service` 的 unit 安装在 `/etc/systemd/system/`，源码均为本项目 `deploy/tokenone-lab/` 下对应文件；正式本地服务的 `/proc/<pid>/exe` 已核对为本项目 `data/tokenone-lab/releases/composite-20260929.3/new-api`。Caddy 域名和后端地址未改，生产和线上 IDONE 未操作。除这些本机服务配置、隔离数据库容器/卷外，本轮源码和文件均在本项目内，没有修改其他项目源码。

切换前一致性备份、旧二进制、旧 unit 和切换前后数据摘要保存在 `data/tokenone-lab/backups/before-project-takeover-20260929-105712/`；`backups/takeover-backup-path` 保存该绝对路径。备份约 168 MB，私密文件权限为 0600。243 个用户、323 把 Key、31 个渠道、23 项配置及任务表的全行 SHA-256 切换前后完全一致。数据库地址、SESSION_SECRET、CRYPTO_SECRET 逐项比较一致，未在文档或日志输出值。

验证日志位于 `.local-tests/composite/`：`backend-regression-full.log`、`integration-{sqlite,mysql,postgres}.log`、`dbcheck-*.log`、`frontend-tests-full-pricing.log`、`frontend-keys.log`、`frontend-lint-changed.log`、`typecheck.log`、`frontend-build.log`、`backend-build-final.log` 和 `takeover-health.json`。数据库测试容器已停止，保留复现数据；开发数据库和两个本地服务继续运行。

开发 PostgreSQL 从本地站点一致性备份恢复，未使用 migration 站点的数据库。开发副本禁用渠道和 abilities，并以 slave 运行、禁用任务插件。开发 unit 限定 localhost 网络，防止复制的渠道、定时任务或用户配置误连上游。不要将开发配置用于 55200，不要让开发进程连接站点主库。

例行开发：

```sh
docker compose --env-file data/tokenone-lab/dev/database.env \
  -f deploy/tokenone-lab/dev-postgres.yml up -d
sudo systemctl start tokenone-newapi-dev.service
```

更新必须先在隔离库编译、跑本节测试、审阅 diff 和配置错误，再更新 `current` 并重启本地 unit。生产发布不属于本授权。配置倍率变化走带版本 API，不编辑多份倍率映射。

回退：先停止新提交并等待在途/异步任务完成；导出组合定义，停用组合及其 Key，再切换二进制。旧版不认识 COMPOSITE 类型，不能带着有效组合 Key 直接回退。日常代码回退不恢复旧数据库备份，以免覆盖回退期间新增的余额、Key 和消费记录。示例组合未自动配置进站点现有数据。

## 15. 修改范围与上游维护

收敛后实际新增 **17 个文件**，修改 **35 个已有文件**；已有文件 diff 为 **293 行新增、17 行删除**，未计新增文件内容。分类如下：

| 分类 | 新增 | 修改已有 |
|---|---:|---:|
| 后端功能 Go 文件 | 9 | 15 |
| 后端测试 | 1 | 5 |
| 前端功能 | 1 | 5 |
| 前端测试 | 0 | 3 |
| 七种语言文件 | 0 | 7 |
| 本地运维入口、unit、隔离数据库与验证工具 | 5 | 0 |
| 本交接文档 | 1 | 0 |

COMPOSITE 的核心放在新增 `setting/composite_setting/`、`types/composite.go`、`model/composite.go`、`service/composite*.go`、`middleware/composite.go`、`relay/helper/composite_price.go`、`controller/composite.go`、`router/composite.go`。配置复用 options，异步快照复用 private_data，日志复用 other，没有新增资金表或数据库列。

现有生产 Go 文件的必要改动覆盖：TokenAuth、组列表/Key 校验、配置保存、组选择、价格适配、同步/任务重试预扣、任务 JSON、任务重算、日志、价格 API、路由注册。原生 HandleGroupRatio 保留原签名和实现；新增 ResolveRequestGroupRatio 提供会返回 error 的组合倍率适配，只有支持组合的调用点接入。普通 WebSocket 和原生阶梯计费文件保持上游原样。不能为了维持“只改 5–7 个文件”而漏掉独立资金路径。

现有后端测试文件只补必要的原生请求上下文/options 表 fixture；新增后端场景集中在一个文件。前端新增一个组件，现有价格页、hook、类型各一处接入；Key 选择器复用现有徽章并排除 AUTO 嵌套，扩展三个现有前端测试文件。七种语言各新增七个翻译键。

建议上游提交仅包含通用 COMPOSITE 功能及测试；`deploy/tokenone-lab/` 和本机接管记录独立维护。上游新增协议、资金预扣或异步重算入口时，优先增加显式支持并补行为测试；未验证入口继续拒绝组合调用。不要通过自动文本注入或整文件覆盖来升级。

回退先停止组合新流量并完成在途/异步结算，停用相关 Key 后才能回到不认识 COMPOSITE 的原版。保留新增交易与日志，不恢复旧资金快照覆盖新消费。

## 16. 降低上游合并冲突的改动收敛

用户要求继续减轻已有文件改动后，保持权限、路由、金额、错误码和 JSON 契约，进行了以下调整：

- 恢复 `relay/helper/price.go` 中原生 `HandleGroupRatio` 的签名与完整实现；组合倍率解析放在新增的 `relay/helper/composite_price.go`，普通请求委托原生函数。
- `relay/responses_websocket.go`、`service/tiered_settle.go` 完全恢复基线内容。同步重试在已有改动的 `controller/relay.go` 调用新增 `PrepareSelectedGroupBilling`；该适配仅补组合旧价格模式的预扣，表达式预扣仍委托原生函数。
- 组合渠道选择的错误转换、Playground 校验及 AUTO 候选规则归入 `service/composite.go`；原生渠道选择文件仅保留三个明确接入分支。
- 组类型标注和价格路径分离归入 `controller/composite.go`；原组列表只新增一行调用，原价格接口只负责接入和错误响应。
- 配置写入校验、倍率别名规范化归入 `model/composite.go`。别名清理仍在原保存事务中，未改变事务或缓存更新顺序。
- 前端代码未再调整；已有单行接入、可见类型标注及 AUTO 候选过滤继续保留。没有通过响应拦截、复制整套上游函数、全局回调或隐式状态隐藏接入。

相对同一上游基线 `789c970199ea527e6a26e071915f4a4cd2c64178` 的变化：

| 指标 | 收敛前 | 收敛后 |
|---|---:|---:|
| 修改的已有文件 | 37 | 35 |
| 修改的已有后端功能文件 | 17 | 15 |
| 已有后端功能文件新增行数 | 164 | 94 |
| 已有后端功能文件删除行数 | 13 | 9 |
| 已有后端功能文件 diff 块（3 行上下文） | 43 | 34 |
| 新增文件 | 17 | 17 |

后端旧文件新增行数减少约 43%，变更块减少约 21%。这降低接触上游代码的范围，不代表已证明未来升级零冲突，也不声称达到数学意义的最少文件数。其余接入保留显式错误处理、字段和资金边界，避免为减少统计数字牺牲可读性。

本轮验证：

- `GOMAXPROCS=2 go test -p 2 ./controller ./middleware ./service ./relay/helper ./model ./router`：通过，包含 SQLite 集成场景。
- PostgreSQL 15.18、MySQL 8.0.46：分别以隔离主库/日志库执行 `go test -p 2 ./controller -run '^TestComposite' -count=2 -v`，均通过。
- `GOMAXPROCS=2 go build -p 2 -o .local-tests/composite/refactor-new-api .`：通过；`git diff --check`、所有涉及 Go 文件的 gofmt 检查通过。
- 在现有 `controller/composite_test.go` 补充倍率别名的单项保存、批量保存、相同别名和冲突别名用例，检查数据库、运行时倍率、组合最终倍率一致，以及冲突无写入、调用方草稿未被修改。
- 本轮不涉及 schema、依赖或前端变化；原三库迁移验证及前端 323 个用例记录仍见第 13 节，没有宣称本轮重新执行前端测试。

证据保存在 `.local-tests/composite/refactor-{backend,postgres,mysql,build}.log`，收敛前文件快照和前后 numstat 同在该目录。本轮收敛仅更新源码与验证产物，未切换运行中的本地站点；站点仍运行第 14 节记录的 `v0.0.0-composite.20260929.3`。

### 复审后的补充收敛

- 配置规范化采用独立错误变量，恢复原生 `err := DB.Transaction(...)`，消除一个无关的事务代码变更块。
- Key 自定义 AUTO 的循环恢复原生可选组权限检查；是否包含 COMPOSITE 由随后读取数据库的校验统一判断，不再先读编辑器缓存重复拒绝。
- 删除任务 token 重算中重复的 `modelRatio` 赋值，以及组合 Key 校验中重复的可用组/auto 判断。
- 对有权直接选择 COMPOSITE、却将其填入普通 AUTO 成员的请求，错误消息统一为已有的 `AUTO cannot contain composite groups`；HTTP 200 和 `success:false` 契约保留。新增回归断言确认缓存已知和缓存陈旧时响应一致，拒绝时不修改 Key 的 AUTO 成员。普通组权限校验仍保留在服务端；安全依据与边界见第 13 节。

这次补充将后端旧文件新增行数从 96 降至 94，变更块从 35 降至 34，没有新增文件或改变 schema。上述六个包的完整后端回归（含 SQLite）、PostgreSQL/MySQL 各两轮 COMPOSITE 测试、Go 构建、gofmt 和 diff 检查均通过。验证日志使用 `.local-tests/composite/refine-*.log`，运行中的服务未切换。

## 17. 收敛版本启动记录

2026-09-29 用户要求“请启动服务我来测试”后，已构建并启动最新收敛代码：

- 版本：`v0.0.0-composite.20260929.4`，产物为 `data/tokenone-lab/releases/composite-20260929.4/new-api`；同目录 `manifest.json` 保存源码和二进制摘要。
- 构建命令：`GOMAXPROCS=2 go build -p 2 -ldflags '-X github.com/QuantumNous/new-api/common.Version=v0.0.0-composite.20260929.4' -o data/tokenone-lab/releases/composite-20260929.4/new-api .`。前端源码与已验证的上一版一致，沿用相同前端构建产物。
- 先在隔离开发库重启 `tokenone-newapi-dev.service` 并验证，再重启 `tokenone-newapi-local.service`；两个进程均已核对运行本项目 `.4` 二进制。
- 测试入口：`https://tokenone.lab.home.arpa/`。HTTPS 首页、JS、状态和价格接口均返回 200；组合管理接口未登录返回 401。
- 仍连接原数据库，SQL_DSN、签名配置和端口未改变。启动前后用户、Key、渠道、配置、任务表全行摘要一致。
- 切换前数据库备份与前后数据摘要：`data/tokenone-lab/backups/before-refined-release-20260929-140213/`；上一版本 `.3` 保留可回退。未写入示例组合，未操作生产或线上 IDONE。
- 验证证据：`.local-tests/composite/start-latest-build.log`、`start-latest-health.json`。

## 18. COMPOSITE 可视化管理（2026-09-29）

入口：系统设置 → 计费与支付 → COMPOSITE 分组，路径 `/system-settings/billing/composite`，沿用设置页超级管理员权限和服务端 `RootAuth`。

### 本轮实际改动

- 上游已有业务文件仅 `web/src/features/system-settings/billing/section-registry.tsx` 增加 6 行：导入独立模块并注册 section。现有路由、侧栏、普通分组编辑器和后端均无新增改动。
- 新增 6 个文件，全部位于 `web/src/features/system-settings/composite/`：`index.tsx`（懒加载入口）、`page.tsx`（列表和启停、预览、授权导航）、`editor.tsx`（编辑表单）、`api.ts`（查询、保存和缓存刷新）、`lib/schema.ts`（表单校验）、`__tests__/management.test.tsx`（集中回归）。
- 7 个语言文件各增加 24 条文案，按 i18n 技能通过临时 `add-missing-keys.mjs` 和 `bun run i18n:sync` 写入，临时脚本已移除。本文档补充交接记录。
- 全任务当前相对上游基线为 23 个新增文件、36 个已有文件修改；本轮新增的原有业务接触面只有上述注册表。

### 操作流程与组件复用

1. 在新页面创建 COMPOSITE，选择已有普通成员组及顺序，设置倍率、启用状态和跨组重试。
2. 点击“配置分组可见性”前往原生分组定价页，配置“用户可选”或按用户组的可见性规则并保存。创建不会自动向所有用户授权。
3. 前往 Key 页面，选择带 COMPOSITE 标识的组合分组。

名称不可改，停用代替删除。列表展示配置异常；预览复用已有 `CompositePricing`，模型及最终倍率由服务端返回。通用布局复用 `Dialog`、`ConfirmDialog`、`StaticDataTable`、`AutoGroupOrderItem`、`FormNavigationGuard` 和设置页操作区；没有新造通用表格、确认框或拖拽排序框架。

保存捕获打开编辑器时的配置版本。409 冲突保留草稿并刷新配置缓存，阻止再次提交旧版本，用户明确关闭后再打开载入最新版；后台查询失败不会销毁已打开的草稿。保存成功使 COMPOSITE、分组、价格及系统配置查询失效并刷新。

### 本轮验证

- `bun run test --maxWorkers=2 src/features/system-settings/composite/__tests__/management.test.tsx src/features/keys/components/__tests__/api-key-group-combobox.test.tsx src/features/keys/components/__tests__/api-keys-mutate-drawer.test.tsx src/features/pricing/__tests__/task-price-display.test.tsx`：4 个文件、54 个测试通过，其中管理页 27 个。覆盖创建、明确零倍率、成员与名称校验、排序、失效成员恢复、保存失败、并发冲突、草稿保留、缓存刷新、停用确认及预览异常。
- `GOMAXPROCS=2 bun run typecheck`、对新模块及注册表执行 `oxlint --threads=2`、`bun run build`、Go 构建、`git diff --check` 均通过；新增模块所有文案在 7 种语言中均无缺失。
- Playwright 在现有数据库的隔离开发副本中完成：页面创建组合 → 原生页面授权 → Key 下拉框选择 COMPOSITE → 页面创建 Key → 请求本机模拟 OpenAI 上游，HTTP 200 且返回 `COMPOSITE_UI_OK`；页面停用后，同一 Key 请求返回 HTTP 403。
- 390×844 移动端检查，页面宽度 390，无整体横向溢出；宽表格使用组件自带横向滚动。模型、成员路径、倍率乘积和价格预览可展开。
- 临时测试账号、Key、模拟渠道、COMPOSITE 及其可见性配置已从开发副本清理；开发副本临时启用的密码登录已还原为关闭，临时浏览器、预览及模拟上游服务已停止。正式本地数据库未出现这些测试记录。
- 本轮没有后端、schema 或数据库行为改动；与上一版清单逐个核对 Go 源码摘要一致。没有重复声称本轮运行三库矩阵；原三库验证记录见前文。

证据：`.local-tests/composite/ui-{regression,typecheck,lint,build,go-build,i18n,cleanup}.log`、`ui-relay-{enabled,disabled}.json`；浏览器快照和移动端截图位于 `.local-tests/composite/browser/`。

本轮未覆盖真实付费上游、双浏览器同时编辑的端到端测试（版本冲突有组件回归），以及前文列出的 Realtime、任务等既有未覆盖项。没有修改生产或线上 IDONE。

### 本地测试站点运行版本

最终版本为 `v0.0.0-composite.20260929.6`，产物 `data/tokenone-lab/releases/composite-20260929.6/new-api`。两个本机服务均已重启并验证；数据库及签名配置文件摘要未改变。入口：`https://tokenone.lab.home.arpa/system-settings/billing/composite`。

切换前备份：`data/tokenone-lab/backups/before-composite-ui-20260929-145200/`，包含数据库 dump、前后业务表摘要及上一版本路径。该次切换前后用户 243、Key 323、渠道 33、配置 23、任务 0 的全行摘要一致。`.local-tests/composite/ui-release-health.json`、`ui-https-health.json` 记录了域名版本、401 权限边界以及实际返回的 COMPOSITE JS 文件与本项目构建产物的 SHA-256 一致。此前前后端构建重叠导致的嵌入资源滞后已通过顺序重建和文件摘要核对排除。

## 附录：原交接的分析依据（历史记录）

已只读核对本地 New API 的 middleware/auth.go、service/group.go、service/channel_select.go、controller/model.go、relay/helper/price.go、service/quota.go、service/task_billing.go 及 Reseller 当前 ensure 逻辑。项目归档来源见 tokenone_migration/resources/source/provenance.json。

以上是原交接的历史依据，不是本轮实现依赖。本轮以本项目基线源码和第 11–18 节的实际结果为准；后续维护无需读取跨项目文件。COMPOSITE 是本轮新增功能，尚未合并上游。
