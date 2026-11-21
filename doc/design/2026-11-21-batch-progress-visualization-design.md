# 批次进度可视化 —— 设计文档

日期：2026-11-21
状态：已确认（用户 2026-11-21 在 mockup 上选定 A + H + D/E/F），已实现于 0.1.4

## 意图与缘由

选书判定是一个「等很久、看不到里面在发生什么」的动作：一轮 100 本书、每批 15 本、每批调用大模型约 40 秒，并发 3 路时墙钟仍有数分钟。用户在等待期间只能看到一条进度条和一行汇总数字（`已判 30/100 · 4/10 批 · 并发 3 · 失败 2`），因此无法回答三个最自然的问题：

1. **进行到哪里了** —— 哪几批在跑、还剩几批。
2. **在干啥** —— 这一批是在调模型、在等限流退避、还是在解析返回。
3. **耗时怎样** —— 当前这批跑了多久、哪一批特别慢、整轮平均多少。

本设计补上这三个问题的答案。

## 目标

- 运行中能逐批看到：批号、书名范围、当前阶段、已耗时。
- 运行结束后留下一份**批次报告**（每批的耗时与通过/排除/待复审计数），随历史存档一起保存，下次打开仍可翻。
- 耗时数字本地每秒跳动，不依赖轮询往返。
- 阶段文案能反映真实的重试行为（限流退避、拆批重试），而不是笼统的「处理中」。
- **看得见 token 消耗**：本轮总量（输入/输出/合计），以及每批各花了多少。

## 非目标

- 不做逐本（每一本书）的时间线——一轮 100 本就是 100 条记录，存档和渲染都变重。
- 不做历史运行的对比分析（批次间耗时对比图等）——本次只做单轮视图。
- 不改判定逻辑、提示词、规则、表格与导出格式。
- 不引入新的依赖或推送通道（仍用现有 1.2 秒轮询）。

## 约束

- 插件零第三方运行时依赖，界面全部手写 `h()`，无 JSX。
- 真实主题 token 只有 14 个（`--dsw-alias-*` 系列 + `--dsw-specific-sidebar-fill`），其余一律在 `.bsx-root` 内用 `color-mix` 派生。
- 并发批之间互相独立，任一批失败不影响其他批。
- 存档 JSON 已有 `job` 字段，批次报告挂进去即可自动落盘。

## 方案对比（Approaches）

| 方案 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| **A. 批次明细 + 折叠面板** | Host 记录每批的阶段/时刻/结果；前端折叠面板逐批展示 | 直接回答「到哪了/在干啥/耗时」；并发时每批一行，状态一目了然；跑完留报告 | 需要在 Host 与 `screening.js` 之间打通阶段回调；前端多一个面板 | **采用** |
| B. 只加汇总计时 | 只在现有进度条上补总耗时、平均每批耗时 | 改动最小 | 仍然不知道「哪批在跑、在干啥」，并发时是黑盒 | 否 |
| C. 纯事件日志 | 追加式事件流（「批3 开始」「批3 完成，用时 42 秒」「批5 限流退避」） | 信息全，重试过程天然顺滑 | 事件多时噪音大，看不到「当前状态」总览；没有结构化统计 | 否 |
| D. SSE/流式推送 | Host 主动推送进度事件 | 实时性最好 | 需要在 `webServer` 上另立通道，与现有轮询模式不一致，成本高 | 否 |

用户已选定 A，并选定落点为「进度条下方折叠区，默认收起」。

## 设计

### 数据结构（Host 侧）

`job` 新增 `batches` 数组，每批一条记录：

```js
{
  no: 3,                    // 全局批号（跨 pending / retry 阶段连续编号）
  phase: 'pending',         // 所属阶段
  bookCount: 15,
  titles: ['《明朝那些事》', '《万历十五年》'],  // 前两本，够认出版本
  status: 'running',        // running | done | failed | cancelled
  stage: 'calling',         // calling | cooling | splitting | parsing | applying | null
  startedAt: '2026-11-21T…',
  endedAt: null,
  elapsedMs: null,          // 结束时定格；运行中由前端本地算
  retry: 0,                 // 限流退避次数
  split: 0,                 // 拆批重试深度
  counts: null,             // { passed, rejected, review }
  usage: null,              // { inputTokens, outputTokens, totalTokens?, cacheReadTokens?, ... }
  error: null,
}
```

`job` 本身已经在存档 JSON 里（`record.job = state.job`），所以**报告自动随历史存档落盘**，不需要新的存档格式。`state.revision` 在阶段变化时自增，前端轮询即可拿到新状态。

### Token 用量（零成本可得）

DSH 的 llm 流在 `finish` 之前会推一个 `usage` 块：

```js
{ type: 'usage', usage: { inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? } }
```

- 类型定义：`dsh-llm/lib/types/types.d.ts:162-169`（`TokenUsage`；`inputTokens` 是**未缓存**的输入部分）。
- 适配器确实会发：`dsh-llm-pi-ai/lib/index.js:1653-1654` `type:'usage', usage: mapUsage(event.message.usage)`，错误路径 `:1665-1666` 也会发一份。
- 插件现在的 `completeText`（`lib/screening.js`）只处理 `text-delta` / `block-end` / `finish`，**加一个 `usage` 分支即可拿到**。
- 粒度：**一次调用一份 usage**。批次被拆成两半就是两次调用，各自一份，累加到该批；限流失败那次通常没有有效 usage（记 0）。
- 本轮总量 = 各批累加，写在 `job.usage`。
- **不换算金额**：换算需要每模型单价表，收益低、容易过期。
- **`ctx.tokenMeter` 用不上**：它测的是 agent 会话的请求包络与上下文压力（`measure(session, requestHeader)` / `contextPressure(session)`，依赖 sessionProjections），插件自己直接调 llm 不在其口径内 —— 自己做加总更准。

副产品价值：输入 token 里绝大部分是**每批重发的长规则提示词**（`AI_RULES`），这个数字能直观说明「批大小调大更省」——批越大，规则提示摊得越薄。

### 阶段从哪来（打通点）

`screening.js` 增加一个可选回调 `options.onStage(stage, info)`，由 Host 侧传入并写入对应批次记录：

| 阶段 | 触发点 | 文案 |
| --- | --- | --- |
| `calling` | `screenBatch` 进入 `screenOnce` 前 | 调用模型中 |
| `parsing` | `parseScreeningJson` 之前 | 解析返回 |
| `cooling` | 限流退避分支（`screening.js:261-267`） | 限流退避 N 秒后重试 |
| `splitting` | 拆批重试分支（`screening.js:269-282`） | 拆批重试 |
| `applying` | Host 侧 `applyOutcome` 前 | 写回判定 |

回调是纯通知，不改变任何重试与判定行为；未传回调时行为与现在完全一致（`onStage?.()` 可选调用）。

### Host 编排（index.js）

`startRun` 的 worker 里给每批建一条记录，跑完补齐状态：

- 成功 → `status='done'`，`counts` 取 `outcome` 三桶长度；
- 模型/传输失败 → `status='failed'`，`error` 记原因，该批书照旧进 `failed` 桶；
- 取消 → `status='cancelled'`（在途批次不写 failed，书保持待判定）。

`endedAt` / `elapsedMs` 在批次收尾时定格。

### 界面（client.js）

进度条（run bar）里加一个折叠按钮「批次监控」，带一个「N 批在跑」的小徽标；展开后：

```
已运行 1:42 · 平均 42 秒/批 · 最慢 批1 51 秒 · 已完成 4 批
本轮 token  输入 182.4k · 输出 24.1k · 合计 206.5k   平均 1.53k/本（每批固定规则提示 ≈ 11.8k 输入）
● 批3  15 本 《明朝那些事》…      调用模型中              38 秒    11.9k / 1.2k
● 批4  15 本 《万历十五年》…      限流退避 4 秒后重试    12 秒    11.8k / —
✓ 批1  15 本   42 秒   通过 3 · 排除 11 · 待复审 1    14.1k / 3.2k
✓ 批2  15 本   37 秒   通过 2 · 排除 12 · 待复审 1    13.8k / 3.0k
```

- 上半部分是**在跑的批**（并发 3 就是最多三行），阶段文案 + 已耗时；
- 下半部分是**已完成的批**（可滚动，按完成时间倒序），一行摘要：状态图标、批号、本数、用时、三桶计数；
- 汇总行下方一条 **token 条**：本轮输入/输出/合计、平均每本、以及「每批固定规则提示 ≈ N k 输入」的提示；
- 每批行尾一列 **token（输入/输出）**：在跑的批显示已确认的用量（调用中的显示「—」），完成的批显示该批累计；
- 总耗时、平均、最慢由已完成批的 `elapsedMs` 与 `job.startedAt` 现算；已耗时在前端每秒本地跳动。

交互约定：

- 每次 run 开始时自动展开一次；用户手动收起后不再自动展开（记住「用户动过」）。
- 任务结束后面板保留显示（此时就是那份批次报告），并入历史存档。
- 报告只在本次运行的 `job` 里；下一次 run 会开新的 `job`，报告随之更新（旧的仍在历史存档里）。

### 词典

zh/en 各新增约 14 个 key：`batchMonitor`、`runningBatches`、`batchNo`、`stageCalling`、`stageParsing`、`stageCooling`、`stageSplitting`、`stageApplying`、`elapsed`、`avgPerBatch`、`slowestBatch`、`batchesDoneCount`、`noBatchesYet` 等。

### 测试

- Host：用假 ctx 跑两批，断言 `job.batches` 的记录条数、`status`、`elapsedMs`、`counts`、失败批的 `error`，以及阶段回调确实被调用。
- 词典一致性：沿用现有 `test/client-dictionary.test.js` 的做法，断言 zh/en 键集合一致且代码里用到的键都在两词典中。

## 已知边界

- 批次记录随 `job` 一起进存档 JSON；超大书单（如 5000 本 / 每批 5 本 = 1000 批）会让存档变大，必要时再加「只保留最近 N 条」的裁剪。
- 轮询负载：每批记录约 200 字节，一轮 87 批（1300 本 / 每批 15 本）约 17 KB/次，1.2 秒一次，本地环境无压力；上千批时需要改为按需拉取。
- 阶段是**批次级**的：拆批后两个半批同时跑时，同一条记录显示的是最后一次上报的阶段。
- token 只显示**数量**，不换算金额（各模型单价不同且会变）；缓存命中部分（`cacheReadTokens`）单独保留在数据结构里，界面上作为次要信息或直接不显示。
- token 数字只统计**插件自己发出的模型调用**；本会话里 agent 自己的对话消耗不在其中。

## 交付

- 改动文件：`plugins/dsh-book-select/index.js`、`lib/screening.js`、`client.js`、`README.md`、新增测试。
- 版本升到 0.1.4，重新产出 `dist/` 三个文件（tgz / source.zip / INSTALL.md），并在 GitHub 私有仓库 `Student-Hu/IBS` 发 v0.1.4 Release（走 API，避开本机到 github.com 的不稳定链路）。
