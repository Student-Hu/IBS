# 选书插件：批次并发判定 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `dsh-book-select` 的「开始 AI 判定」在同一阶段内并发跑多个批次（默认并发 3），并在 provider 限流时自动退避重试同一批，而不是把它打成「失败」。

**Architecture:** 新增 `lib/scheduler.js` 承载纯逻辑的批次池（切批、有界并发、共享冷却闸），`lib/screening.js` 承担限流识别与同批退避重试，`index.js` 的 `startRun` 从「串行 for 循环」改为「按阶段 → 批次池」，并把存档写入改成串行链以免并发写坏 JSON 文件。判定规则、提示词、表格与导出结构一律不动。

**Tech Stack:** Node.js 24（内置 `node:test`，零第三方依赖）、ESM、DeepSeek Harness 插件（`webServer` / `tools` / `connection` / `llm` / `agentDefaultModel`）。

**Spec:** `doc/design/2026-11-19-parallel-screening-design.md`（同目录，本计划与之一一对应）。

## Global Constraints

- 工作目录 `D:\CodeProject\Agent\library\dsh-library`，插件包 `plugins/dsh-book-select`（包名 `dsh-book-select`，当前版本 0.1.2 → 本计划结束为 **0.1.3**）。
- **本目录不是 git 仓库**（`git rev-parse` 报 `fatal: not a git repository`），因此计划中的「提交」步骤改为**检查点**：把改动过的文件复制到 `D:\CodeProject\Agent\library\dsh-library\backup\checkpoint-<步骤号>\`，失败可直接回滚。已有基线备份 `backup\dsh-book-select-0.1.2-backup-20261119.zip`（SHA-256 `c7f654255b89239efea0353ee374e2e62f56c762fef398e271645275292718fd`）。
- 插件**零第三方运行时依赖**；测试只用 Node 内置 `node:test`，放在 `plugins/dsh-book-select/test/`，**不进 `package.json` 的 `files` 白名单**（发布产物不含测试）。
- 源码为 UTF-8；**不得用 PowerShell 读写源码文件**（曾导致 U+FFFD 事故），改文件一律用 read/write/edit 工具。
- 批大小边界沿用 `index.js` 的 `BATCH_MIN=5 / BATCH_MAX=40 / BATCH_DEFAULT=15`；并发边界新增 `CONCURRENCY_MIN=1 / CONCURRENCY_MAX=6 / CONCURRENCY_DEFAULT=3`。
- 限流判定只用稳定失败码 `RATE_LIMIT`（来自 `dsh-llm` 的失败分类），**不解析错误消息文本**。
- 两阶段语义不变：**先跑完「待判定」，再跑「失败重试」**，阶段之间仍串行；并发只发生在阶段内部。
- 每批结束后仍要 `persist(state)` 存档，存档写入必须串行。
- 改完 `client.js` / `index.js` 后必须让插件条目重新激活才生效：`plugin_manager set_plugin(include:book-select, false)` → `true`，再刷新浏览器。

## Review Focus

规格没写、但真实使用最容易踩到的五类输入/状况：

1. **provider 首调就返回 `RATE_LIMIT`** —— 该批必须退避后**重试同一批**（不拆批、不进「失败」桶），否则用户会以为这批书判定失败而手工处理。
2. **并发写同一个历史 JSON 文件** —— 两个 worker 同时 `writeFile` 会写出交错损坏的 JSON，存档直接作废。
3. **判定途中点「取消」** —— 在途批次必须保持「待判定」，绝不能被写成「失败」，否则下次运行会把它们当失败批次重试。
4. **模型输出被截断成半截 JSON** —— 这类可恢复错误仍要按原逻辑**对半拆批重试**（最多 3 层），不能被新的限流分支吞掉。
5. **源表里序号重复** —— 并发下多个 worker 同时回写判定，序号队列（`applyOutcome` 的 `byNo`）必须保证每条判定落在**不同的书**上，不能互相覆盖。

---

### Task 1: 限流识别与同批退避重试（`lib/screening.js`）

**Files:**
- Modify: `plugins/dsh-book-select/lib/screening.js`（`completeText` 约 :86-128；`screenBatch` 约 :206-225）
- Test: `plugins/dsh-book-select/test/screening-rate-limit.test.js`（新建）

**Interfaces:**
- Consumes: 无（Task 1 独立）。
- Produces:
  - `export function isRateLimit(error): boolean` —— `error.llmCode === 'RATE_LIMIT'`。
  - `export function backoffDelay(attempt: number, retryAfterMs?: number, random?: () => number): number` —— `retryAfterMs` 为正有限数时直接返回它；否则返回 `2000 * 2 ** attempt` 再加 `base * 0.25 * random()` 的抖动（`random` 默认 `Math.random`，测试传 `() => 0` 得到确定值）。
  - `completeText` 抛出的 Error 额外带两个属性：`llmCode`（`finish.failure?.code`）、`retryAfterMs`（`finish.failure?.providerRetryAfterMs`）。`catch` 分支里直接抛出的原始异常也要从 `error.failure?.code` 取 `llmCode`。
  - `screenBatch(ctx, books, options)` 的 `options` 新增两个可选字段：`gate`（Task 2 的冷却闸，鸭子类型 `{ block(ms), wait(signal) }`）、`attempt`（已重试次数，默认 0）。

- [x] **Step 1: 写失败测试**

新建 `test/screening-rate-limit.test.js`，用 Node 内置 `node:test` + `node:assert/strict`。测试用的假 `ctx`：

```js
const fakeCtx = (stream) => ({
  get: (name) => (name === 'llm' ? { stream } : name === 'agentDefaultModel'
    ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined),
})
```

四个用例：

1. `completeText` 在收到 `{type:'finish', reason:{kind:'error', failure:{message:'rate limited', code:'RATE_LIMIT', providerRetryAfterMs:1234, status:429}}}` 时，抛出的错误 `llmCode === 'RATE_LIMIT'` 且 `retryAfterMs === 1234`。
2. `screenBatch` 遇到一次 `RATE_LIMIT` 后**重试同一批**：假 `stream` 第一次抛限流、第二次返回合法 JSON。断言 `stream` 被调用 **2 次**，且两次收到的 user 消息里**都含全部书名**（证明没有拆批），结果 `passed.length` 等于书的数量。
3. `screenBatch` 连续限流到耗尽重试次数后**抛出**（不静默进失败桶）：假 `stream` 永远限流，断言 `stream` 调用次数为 **4**（首次 + 3 次重试），抛出的错误 `llmCode === 'RATE_LIMIT'`。
4. `backoffDelay(0, undefined, () => 0) === 2000`、`backoffDelay(1, undefined, () => 0) === 4000`、`backoffDelay(2, undefined, () => 0) === 8000`，且 `backoffDelay(0, 1500) === 1500`（provider 提示优先）。

- [x] **Step 2: 运行测试确认失败**

Run: `cd plugins/dsh-book-select && node --test`
Expected: FAIL —— `isRateLimit` / `backoffDelay` 尚未导出，`screenBatch` 不会重试。

- [x] **Step 3: 实现 `completeText` 的失败元数据**

在 `completeText` 的 `finish.kind === 'error' || 'aborted'` 分支里，把 `new Error(...)` 换成带属性的错误：

```js
const failure = finish.failure
const error = new Error(`模型调用失败：${failure?.message ?? finish.kind}`)
error.llmCode = failure?.code
error.retryAfterMs = failure?.providerRetryAfterMs
throw error
```

在 `catch` 分支（`llm.stream` 直接抛异常）里，抛出前同样补 `error.llmCode = error.failure?.code ?? error.llmCode`。

- [x] **Step 4: 实现 `isRateLimit` / `backoffDelay`**

在 `lib/screening.js` 中导出这两个函数；`isRateLimit` 只看 `error?.llmCode === 'RATE_LIMIT'`。

- [x] **Step 5: 实现 `screenBatch` 的限流分支**

改写 `screenBatch` 的 catch 开头，使**限流先于拆批**被判断：

```js
const attempt = options.attempt ?? 0
if (isRateLimit(error)) {
  if (attempt >= RATE_LIMIT_MAX_RETRIES) throw error
  const delay = backoffDelay(attempt, error.retryAfterMs)
  options.gate?.block(delay)
  await options.gate?.wait(options.signal)
  return screenBatch(ctx, books, { ...options, attempt: attempt + 1 })
}
```

限流分支**不得**落到下面的「对半拆批」逻辑里；`RATE_LIMIT_MAX_RETRIES = 3`。拆批分支递归时把 `attempt` 归零（`{ ...options, depth: depth + 1, attempt: 0 }`）。

- [x] **Step 6: 运行测试确认通过**

Run: `cd plugins/dsh-book-select && node --test`
Expected: PASS，4 个用例全绿。

- [x] **Step 7: 检查点**

把 `lib/screening.js` 与 `test/screening-rate-limit.test.js` 复制到 `backup\checkpoint-1\`。

---

### Task 2: 批次池与共享冷却闸（`lib/scheduler.js`，新建）

**Files:**
- Create: `plugins/dsh-book-select/lib/scheduler.js`
- Test: `plugins/dsh-book-select/test/scheduler.test.js`（新建）

**Interfaces:**
- Consumes: Task 1 的 `backoffDelay`（不使用，只用 `gate` 鸭子类型）。
- Produces:
  - `export function splitBatches(books: object[], size: number): object[][]` —— 顺序切块，最后一块可以不足 `size`。
  - `export function createCooldownGate(): { block(ms: number): void, wait(signal?: AbortSignal): Promise<void> }` —— `block(ms)` 把闸门关到「当前时刻 + ms」（取更晚者）；`wait(signal)` 睡到闸门打开为止，信号已中止时立刻返回。
  - `export async function runPool(batches: object[][], concurrency: number, worker: (batch: object[], index: number) => Promise<void>, options?: { signal?: AbortSignal, beforeBatch?: () => Promise<void>, onError?: (error: unknown, batch: object[], index: number) => void }): Promise<{ aborted: boolean }>` —— 同一时刻在跑的 `worker` 不超过 `concurrency` 个；`signal` 中止后不再派发新批次；`worker` 抛错时交给 `onError` 并继续下一个批次，不中断整池。

- [x] **Step 1: 写失败测试**

新建 `test/scheduler.test.js`：

1. `splitBatches([1..7], 3)` → 长度 3，块大小 3/3/1，顺序保持。
2. `runPool` 的并发上限：6 个批次、`concurrency = 2`，worker 用计数器记录同时在跑的最大值并 `await` 一个短延时；断言最大并发 **等于 2**（不是 1 也不是 6），且 6 个批次全部被处理。
3. `runPool` 遇中止：`signal` 在第一个批次完成后 abort，断言返回 `{ aborted: true }` 且**处理数小于总数**。
4. `createCooldownGate`：`gate.block(40)` 后 `await gate.wait()` 的耗时 **≥ 30ms**；不 block 时几乎立刻返回。

- [x] **Step 2: 运行测试确认失败**

Run: `cd plugins/dsh-book-select && node --test`
Expected: FAIL —— `lib/scheduler.js` 不存在。

- [x] **Step 3: 实现 `lib/scheduler.js`**

按 Interfaces 里的签名实现三个导出；`runPool` 用「共享游标 + 固定数量的 runner」：

```js
let cursor = 0
const limit = Math.max(1, Math.min(concurrency, batches.length))
const runner = async () => {
  while (true) {
    if (options.signal?.aborted) { aborted = true; return }
    const index = cursor++
    if (index >= batches.length) return
    const batch = batches[index]
    if (options.beforeBatch !== undefined) await options.beforeBatch(batch, index)
    if (options.signal?.aborted) { aborted = true; return }
    try { await worker(batch, index) }
    catch (error) { options.onError?.(error, batch, index) }
  }
}
await Promise.all(Array.from({ length: limit }, runner))
```

`gate.wait` 用一个可被 `signal` 中止打断的定时器实现（`setTimeout` + `abort` 监听）。

- [x] **Step 4: 运行测试确认通过**

Run: `cd plugins/dsh-book-select && node --test`
Expected: PASS，Task 1 + Task 2 的用例全绿。

- [x] **Step 5: 检查点**

复制 `lib/scheduler.js` 与 `test/scheduler.test.js` 到 `backup\checkpoint-2\`。

---

### Task 3: Host 端并发编排（`index.js`）

**Files:**
- Modify: `plugins/dsh-book-select/index.js`（常量区 :47-51；`createState` :143-159；`persist` :295-322；`startRun` :421-518；`operations.run` :593-596；工具参数 :670-692 与 `case 'run'` :714-715）
- Test: `plugins/dsh-book-select/test/index-concurrency.test.js`（新建）

**Interfaces:**
- Consumes: Task 2 的 `splitBatches` / `runPool` / `createCooldownGate`；Task 1 的 `screenBatch`（多了 `gate` 选项）。
- Produces:
  - 新常量 `CONCURRENCY_MIN = 1`、`CONCURRENCY_MAX = 6`、`CONCURRENCY_DEFAULT = 3`。
  - `clampConcurrency(value): number`（与 `clampBatch` 同形）。
  - `state.options.concurrency`（默认 `CONCURRENCY_DEFAULT`，经 `summaryOf` 的 `options` 下发给前端）。
  - `job.concurrency`（本次运行实际并发度）。
  - `startRun(state, requestedBatch, requestedConcurrency)` 第三参数可选；`operations.run` 读 `payload.concurrency`；工具 `book_select` 新增参数 `concurrency`（整数，1-6，默认 3）。

- [x] **Step 1: 写失败测试**

新建 `test/index-concurrency.test.js`。`index.js` 的 `apply(ctx)` 需要 `webServer` / `tools` / `connection` / `llm` / `agentDefaultModel` 五个服务，因此用最小假 `ctx` 装配后直接调 `apply(ctx)`：

- 假 `ctx`：`get(name)` 对五个服务各返回一个可用的最小实现；`webServer.register` 记录 handler；`tools.register` 记录工具；`effect(fn)` 直接调用 `fn()`；`logger` 为 no-op。
- 假 `llm.stream` 每次返回一个可解析的 JSON 判定（`{"passed":[…],"rejected":[],"review":[]}`），并统计**同时在跑的调用数**。

三个用例：

1. `run` 时 `job.concurrency === 3`（默认），`summary.options.concurrency === 3`。
2. 传入 `concurrency: 2` 时，假 `llm.stream` 观测到的**最大同时调用数 === 2**（证明真的并发），且所有书都拿到判定（没有书被判两次：每个 `序号` 恰好出现在一个 verdict 里）。
3. 传入 `concurrency: 1` 时，最大同时调用数 === 1（并发 1 等价于原来的串行行为）。

- [x] **Step 2: 运行测试确认失败**

Run: `cd plugins/dsh-book-select && node --test`
Expected: FAIL —— `startRun` 还没有第三个参数，`job.concurrency` 不存在。

- [x] **Step 3: 加常量与并发夹取**

在 `BATCH_DEFAULT = 15` 后面加 `CONCURRENCY_MIN = 1` / `CONCURRENCY_MAX = 6` / `CONCURRENCY_DEFAULT = 3`；在 `clampBatch` 后面加同形的 `clampConcurrency`。

- [x] **Step 4: 让 `state.options` 带并发度**

`createState` 的 `options` 改为 `{ batchSize: BATCH_DEFAULT, concurrency: CONCURRENCY_DEFAULT }`。

- [x] **Step 5: 把存档写入改成串行链**

在 `apply(ctx)` 闭包里加 `let writeChain = Promise.resolve()`；把 `persist` 拆成「排队的 `persist`」+「真正写盘的 `writeHistory`」：

```js
const persist = (state) => {
  writeChain = writeChain.then(() => writeHistory(state))
  return writeChain
}
```

`writeHistory` 保持原有内容（原样：生成 record、`mkdir`、`writeFile`、`pruneHistory`，失败只 `ctx.logger?.warn`）。**必须保证 `writeHistory` 永不 reject**，否则链会断。

- [x] **Step 6: 把 `startRun` 改为批次池**

改动点：

- 签名 `startRun(state, requestedBatch, requestedConcurrency)`；计算 `const concurrency = clampConcurrency(requestedConcurrency ?? state.options.concurrency)`，写回 `state.options.concurrency`。
- `job` 对象加 `concurrency` 字段。
- 每次运行新建一个共享冷却闸：`const gate = createCooldownGate()`。
- 把「for 相位 → for 批次」的嵌套循环换成：相位仍 `for (const phase of phases)` 串行，相位内用 `splitBatches(phase.books, size)` + `runPool(batches, concurrency, worker, { signal: controller.signal, beforeBatch: () => gate.wait(controller.signal) })`。
- `worker` 内部保持原有语义：
  - `try { const outcome = await screenBatch(ctx, batch, { signal: controller.signal, gate }); applyOutcome(batch, outcome) }`
  - catch：`if (controller.signal.aborted) { job.cancelled = true; return }`（**在途批次保持 pending，不写 failed**），否则 `job.failed += batch.length` 并把该批每本写成 `status='failed'`、`reason=\`AI 判定失败：${reason}\``。
  - 之后 `job.done += batch.length`、`job.batchesDone++`、`state.revision++`、`await persist(state)`。
- 相位结束后仍 `if (job.cancelled) break`。

- [x] **Step 7: 打通 HTTP 与工具参数**

`operations.run` 改为 `startRun(state, payload.batchSize, payload.concurrency)`；工具 `parameters.properties` 加 `concurrency: { type: 'integer', description: 'For run: how many batches to screen at once (1-6, default 3).' }`；`case 'run'` 传 `concurrency: args.concurrency`；工具 description 末尾补一句「`run` screens up to `concurrency` batches at once (1-6, default 3)」。

- [x] **Step 8: 运行测试确认通过**

Run: `cd plugins/dsh-book-select && node --test`
Expected: PASS，Task 1–3 的用例全绿。

- [x] **Step 9: 检查点**

复制 `index.js` 与 `test/index-concurrency.test.js` 到 `backup\checkpoint-3\`。

---

### Task 4: 界面并发选择器与文档（`client.js` + `README.md`）

**Files:**
- Modify: `plugins/dsh-book-select/client.js`（词典 zh :51-58 / en :160-167；`batchSize` 状态 :483；宿主同步 :531-534；`doRun` :654-657；runBar 的「每批」选择器 :822-831；进度文案 :832-838）
- Modify: `plugins/dsh-book-select/README.md`（用法第 3 步 :45；对照表「分批」行 :62；「扩展」段 :79；「已知边界」段 :101-104）
- Test: `plugins/dsh-book-select/test/client-dictionary.test.js`（新建）

**Interfaces:**
- Consumes: Task 3 的 `summary.options.concurrency` 与 `job.concurrency`。
- Produces:
  - 新词典键（zh/en 各一）：`concurrency`（zh「并发」/ en「Concurrency」）、`concurrencyUnit`（zh「路」/ en「at once」）。
  - 客户端状态 `concurrency`（默认 3），下拉选项 `[1, 2, 3, 4, 6]`，运行时（`jobRunning`）禁用。
  - `doRun` 的请求体带 `concurrency`。

- [x] **Step 1: 写失败测试**

新建 `test/client-dictionary.test.js`：读 `client.js` 源码文本，断言中英两段词典都含 `concurrency:` 与 `concurrencyUnit:` 两个键，且**键集合完全一致**（用正则抽取 `^ {6}(\w+):` 的键名后比较）；再断言 `client.js` 里出现的每个 `t('...')` 键名都在两段词典里存在（防止漏译）。

- [x] **Step 2: 运行测试确认失败**

Run: `cd plugins/dsh-book-select && node --test`
Expected: FAIL —— 词典里还没有 `concurrency` 键。

- [x] **Step 3: 加词典键**

zh 段在 `batch: '每批',` 之后插入 `concurrency: '并发',` 与 `concurrencyUnit: '路',`；en 段在 `batch: 'Batch',` 之后插入 `concurrency: 'Concurrency',` 与 `concurrencyUnit: 'at once',`。

- [x] **Step 4: 加并发状态与下拉**

- `const [concurrency, setConcurrency] = React.useState(3)`（放在 `batchSize` 状态之后）。
- 宿主同步：在 `hostBatchSize` 的 effect 旁边加 `const hostConcurrency = summary?.options?.concurrency`，变化时 `setConcurrency(hostConcurrency)`。
- `doRun` 的 `call('run', { sessionId, batchSize, concurrency })`。
- runBar：在「每批」label 之后插入同样的 label 结构，label 文本 `t('concurrency')`，`select` 的选项取 `[1, 2, 3, 4, 6]`，`disabled: jobRunning`。
- 进度文案追加 `· ${t('concurrency')} ${job.concurrency}`（`job.concurrency` 为 undefined 时不显示）。

- [x] **Step 5: 更新 README**

- 用法第 3 步补一句：同一阶段内默认并发 3 批同时判定（可调 1–6），限流时该批自动退避重试、不会直接算失败；取消时在途批次保持「待判定」。
- 对照表「分批」行改为：`5–40 本/批（默认 15），并发 1–6 批（默认 3）；单批调用失败进「失败」桶，待判定清空后再整批重试`。
- 「扩展」段补一句：并发度边界在 `index.js` 的 `CONCURRENCY_MIN/CONCURRENCY_MAX/CONCURRENCY_DEFAULT`。
- 「已知边界」补一条：并发度越高越容易撞 provider 限流，插件会退避重试同一批；仍频繁失败时把并发调回 1–2。

- [x] **Step 6: 运行测试确认通过**

Run: `cd plugins/dsh-book-select && node --test`
Expected: PASS，全部用例绿。

- [x] **Step 7: 检查点**

复制 `client.js` 与 `README.md` 到 `backup\checkpoint-4\`。

---

### Task 5: 重新激活、实机验证与打包

**Files:**
- Modify: `plugins/dsh-book-select/package.json`（`version` → `0.1.3`）
- Modify: `plugins/dsh-book-select/lib/screening.js`（`designBrief()` 里的状态机与参数段，与新行为对齐）
- Create/Replace: `dist/dsh-book-select-0.1.3.tgz`、`dist/dsh-book-select-0.1.3-source.zip`、`dist/INSTALL.md`（更新校验值与版本说明）

**Interfaces:**
- Consumes: Task 1–4 的全部改动。
- Produces: 可分发的 0.1.3 产物。

- [x] **Step 1: 让插件条目重新激活**

`plugin_manager set_plugin(include:book-select, false)` → `set_plugin(include:book-select, true)`；两次都应返回 `application:"applied"`、`warnings:[]`。

- [x] **Step 2: 实机跑一遍并发判定**

用 `book_select` 工具：`sample` → 12 条示例；`run`（`batch_size: 5`, `concurrency: 3`）→ 等 `job.running` 为 false；断言 `counts` 与串行版一致（`pending` 归零、`failed` 为 0 或仅限真实失败的书）、没有书被判两次。再 `run` 一次 → 应报 `没有待判定的图书…`（`RequestError(400,'no-pending',…)`）。

- [x] **Step 3: 验证存档没被写坏**

读 `$DSH_HOME/book-select/history/<id>.json`，`JSON.parse` 必须成功且 `items.length` 正确。

- [x] **Step 4: 同步 `designBrief()`**

`lib/screening.js` 的 `designBrief()` 里「## 状态机」与「## 参数与可调点」两段仍写着旧的「整批转 review」与「批大小」描述；改成与实现一致：状态机含 `failed` 桶、模型调用异常进「失败」而非「待复审」、两阶段（先待判定后失败重试）、并发度 1–6（默认 3）、限流退避重试同一批。

- [x] **Step 5: 升版本号**

`package.json` 的 `version` 改为 `0.1.3`；README 里的 tarball 文件名与 `allow-version dsh-book-select@0.1.3` 同步。

- [x] **Step 6: 重新打包**

在 `plugins/dsh-book-select` 目录下 `npm pack --pack-destination ..\..\dist`；再用 `tar -a -cf ..\..\dist\dsh-book-select-0.1.3-source.zip -C <暂存目录> dsh-book-select`（暂存目录里先 `Copy-Item` 整个包目录，保持 `lib/`、`locale/` 子目录结构）。校验：解包后 12 个文件与源码逐字节一致（Node `Buffer.compare`）、5+1 个 js 过 `node --check`、无 U+FFFD。

- [x] **Step 7: 更新 `dist/INSTALL.md`**

产物表换成 0.1.3 的两个文件与新的大小/SHA-256；保留「卸载 / 换装」与排错段。

- [x] **Step 8: 呈现交付物**

`present` 三个新产物（tgz / source.zip / INSTALL.md），并向用户说明三条改动的效果与并发度旋钮的位置。
