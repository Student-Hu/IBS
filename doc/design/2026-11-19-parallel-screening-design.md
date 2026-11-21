# 选书插件：批次并发判定（设计）

日期：2026-11-19　范围：`plugins/dsh-book-select`（版本 0.1.2 → 0.1.3）

## 意图与动机

真实书单 99 本走 6 批要约 190 秒，瓶颈不是模型能力，是 `index.js` 的 `startRun` 把批与批**串行**了：每批 `await screenBatch(...)` 完才进下一批。用户要的是「多 agent 并发执行」。

结论：**要的是「多路并发跑批」，不是「真·多 agent」**。真多 agent（每批一个标准模式 agent）会让每批多带一整套系统提示与工具 schema，时延从 1 分钟涨到数分钟，模型还有概率去调工具而不是回 JSON——为提速不值得。用户已确认走路线 A。

## 目标 / 非目标

目标：
- 批与批之间并发执行，墙钟时间约按并发度线性下降；**token 成本不变**。
- 并发下不丢判定、不重复判定、不写坏历史文件。
- 限流（429）发生时自动退避重试同一批，而不是把该批打成「失败」或拆批重打。

非目标：
- 不做双模型交叉复核（路线 B）、不做每批一个真 agent（路线 C）。用户本轮明确不选。
- 不改判定规则、不改提示词、不改 UI 表格与导出结构。

## 约束

- 插件直接调 `ctx.llm.stream`，**不走 agent-loop**，所以 `dsh-llm-retry` 那套退避重试（挂在 `agent/request-error` 事件上）覆盖不到我们的调用——限流兜底必须自己写。
- `llm.stream` 每次调用是独立 `AsyncIterable`，adapter 层无全局串行化/信号量，**并发本身没有技术障碍**；真实约束是 provider 限流与账号并发配额。
- `screenBatch` 已有批内并行（失败时对半拆批 `Promise.all` 重试），并行原语已存在，只需搬到批与批之间。
- 同一本书只能被判一次：并发下每批仍取自同一份 `pending` 快照，批次之间互不重叠。
- `applyOutcome` 只操作本批的 book 对象（`byNo`/`byTitle`/`seen` 均为批内局部），跨批无写冲突。

## 方案对比（已与用户确认）

| 路线 | 做法 | 收益 | 代价 |
|---|---|---|---|
| **A（选定）** | 同模型多批并行，同一批次池有界 | 墙钟约 ÷并发度；token 不变 | 需自建限流退避与写盘串行化 |
| B | 双模型交叉复核，不一致转待复审 | 判定更可信 | token 翻倍；是准确率而非提速 |
| C | 每批一个标准模式 agent | 可指定不同模型/角色 | token 与时延暴涨、模型跑偏、会话树膨胀 |

## 实现要点

### 1. 并发池（`index.js` `startRun`）
- 保留现有两阶段结构（先 `pending` 后 `retry`），**阶段之间仍然串行**——「先待判定、后失败重试」的语义不变；并发只发生在**同一阶段内**。
- 每阶段把书切成批数组，起 `min(concurrency, batches.length)` 个 worker，各自按游标领批；一个 worker 同时只跑一批。
- 每批的处理与现在完全一致：`screenBatch` → `applyOutcome`；出错则该批整体进「失败」桶并记 `AI 判定失败：<原文>`。
- 取消：`controller.abort()` 后，worker 在领下一批前检查 `signal.aborted` 直接退出；在途调用由 `screenBatch` 抛「模型调用中断」，被识别为取消而非失败——**被取消的批保持 `pending`，不污染失败桶**。

### 2. 限流退避（`lib/screening.js`）
- `completeText` 现在丢掉了失败码：只抛 `模型调用失败：<message>`。改为在抛出的 Error 上挂 `llmCode`（取自 `finish.failure.code`）与 `retryAfterMs`（取自 `finish.failure.providerRetryAfterMs`）。
- `screenBatch` 的 catch 分支**先判限流再判可恢复拆批**：命中 `RATE_LIMIT` 时**不拆批**（拆批只会加倍请求），而是等待退避后重试同一批，最多 3 次。退避时长取 `retryAfterMs`，缺省用指数退避（2s/4s/8s，带抖动）。
- 共享冷却闸：任一 worker 撞上限流时，把闸门关闭到「当前时刻 + 退避时长」，其他 worker 在领新批前等闸门，避免所有 worker 同时硬撞同一堵墙。
- 3 次退避仍失败 → 该批按现状进「失败」桶，用户可用「重试失败书目」再跑。

### 3. 写盘串行化（`index.js` `persist`）
并发 worker 会在同一时刻各自 `await persist(state)`，写同一个 JSON 文件，可能交错写坏。做法：闭包内维护一条 promise 链，写入排队执行、失败只记 warn 不阻断后续。

### 4. 参数与界面
- `state.options` 增加 `concurrency`（默认 **3**，范围 1–6），随 `summaryOf` 下发，UI 与工具都能改。
- 客户端「每批」选择器旁加一个「并发」选择器（1/2/3/4/6），运行时禁用。
- 工具 `book_select` 的 `run` 动作新增 `concurrency` 参数；`job` 对象增加 `concurrency` 字段，前端进度条旁显示。
- 词典 zh/en 各加 2 个 key（`concurrency`、`concurrencyUnit`），维持两侧 key 对齐。

### 5. 文档与版本
- README「用法」第 3 步补充并发说明与限流退避行为；「已知边界」补并发上限与限流说明。
- `package.json` 版本 0.1.2 → 0.1.3；重建 `dist/` 的 tgz 与 source.zip，更新 `INSTALL.md` 的校验值。

## 留给实现者的检查项

- `node --check` 五个 js 文件通过。
- zh/en 词典 key 完全对齐、无重复。
- 实测：载入 12 条示例 → 待判定 10 条、批大小 5、并发 3 → 2 批并行，计数与串行版一致（5 passed / 6 rejected / 1 review 一类的期望值），且**没有书被判两次**。
- 实测限流路径：临时注入一次 `RATE_LIMIT` 失败，确认该批退避后重试成功、最终不是「失败」状态。
- 取消中途：确认在途批次不算失败、剩余书仍是「待判定」。
