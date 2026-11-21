# 批次进度可视化 —— 实现计划

日期：2026-11-21
设计文档：`doc/design/2026-11-21-batch-progress-visualization-design.md`
执行方式：native（本会话逐任务执行）

## Global Constraints

- 插件零第三方运行时依赖；界面全部手写 `h()`，无 JSX；只用真实主题 token（14 个 `--dsw-alias-*` + `--dsw-specific-sidebar-fill`），其余在 `.bsx-root` 内 `color-mix` 派生。
- 测试用 Node 内置 `node:test`，目录 `plugins/dsh-book-select/test/`，**不进 package.json 的 files 白名单**。
- 测试命令：`cd plugins/dsh-book-select && node --test`（**不能带 `test/` 参数**，Node 24.12.0 会报 MODULE_NOT_FOUND）。
- 本目录**不是 git 仓库** → 「提交」步骤改为**检查点**：把改动文件复制到 `backup/checkpoint-N/`。
- 绝不用 PowerShell 读写仓库里的 UTF-8 源码；中文 JSON 用 node 脚本读写。
- 改动 client.js 后必须 `plugin_manager set_plugin(include:book-select, false)` → `true` 让条目重新激活才生效。

## 已锁定的选型（用户确认）

- 面板形态 **A**：在跑的批每批一行。
- token 展示 **H**：本轮总量 + 每批一行。
- **D**：阶段文案 = 调用模型中 / 解析返回 / 限流退避 N 秒后重试 / 拆批重试 / 写回判定。
- **E**：已完成的批默认显示最近 10 条 + 「展开全部」。
- **F**：跑完保留面板（即批次报告），随历史存档留存。

---

## Task 1 — `lib/screening.js`：接住 usage 块 + 阶段回调

**Files**
- Modify: `plugins/dsh-book-select/lib/screening.js`

**Interfaces**
```js
export async function completeText(ctx, options)
// options 增补：onUsage?: (usage: object) => void
// chunk.type === 'usage' → options.onUsage?.(chunk.usage)

export async function screenBatch(ctx, books, options)
// options 增补：onStage?: (stage: string, info?: object) => void
// 阶段：'calling' | 'parsing' | 'cooling' | 'splitting'
```

- [x] Step 1.1：`completeText` 的 chunk 循环加 `usage` 分支 → `options.onUsage?.(chunk.usage)`。
- [x] Step 1.2：`screenOnce` 在调用前 `onStage('calling')`、解析前 `onStage('parsing')`，并把 `onUsage` 透传给 `completeText`。
- [x] Step 1.3：`screenBatch` 的限流分支 `onStage('cooling', { attempt, delayMs })`；拆批分支 `onStage('splitting', { depth, left, right })`。
- [x] Step 1.4：`node --check lib/screening.js` 通过。

## Task 2 — `index.js`：Host 侧批次记录与 token 累加

**Files**
- Modify: `plugins/dsh-book-select/index.js`

**Interfaces**
```js
function addUsage(target, usage) // 累加 TokenUsage 数值字段
// job.batchLog: Array<{
//   no, phase, bookCount, titles, status, stage, stageInfo,
//   startedAt, endedAt, elapsedMs, retry, split, counts, usage, error
// }>
// job.usage: 累计 TokenUsage | null
```

- [x] Step 2.1：新增 `addUsage()` 工具函数（累加 input/output/total/cacheRead/cacheWrite/reasoning）。
- [x] Step 2.2：`startRun` 的 job 增加 `batchLog: []` 与 `usage: null`；批号按「阶段基准 + 池内序号」连续编号。
- [x] Step 2.3：worker 里建批次记录；传 `onStage`（更新 stage/retry/split）与 `onUsage`（累加到记录与 job）。
- [x] Step 2.4：成功 → `status='done'` + counts；失败 → `status='failed'` + error；取消 → `status='cancelled'`；三者都写 endedAt/elapsedMs。
- [x] Step 2.5：`node --check index.js` 通过。

## Task 3 — `client.js`：批次监控折叠面板 + token 条

**Files**
- Modify: `plugins/dsh-book-select/client.js`

- [x] Step 3.1：新增状态 `monitorOpen` / `monitorTouched` / `showAllBatches` / `now`（每秒跳）。
- [x] Step 3.2：新 job 出现时自动展开一次（用户手动动过则不再自动展开）。
- [x] Step 3.3：run bar 后插入「批次监控」折叠按钮与徽标；面板内容 = 汇总行 + token 条 + 在跑的批 + 已完成的批（最近 10 条 / 展开全部）。
- [x] Step 3.4：CSS 增 `.bsx-monitor*`、`.bsx-token-*`、`.bsx-lane*` 系列。
- [x] Step 3.5：zh/en 词典各补同名 key（见设计文档「词典」一节）。
- [x] Step 3.6：`node --check client.js` 通过；zh/en 键集合一致。

## Task 4 — 测试

**Files**
- Add: `plugins/dsh-book-select/test/batch-progress.test.js`

- [x] Step 4.1：假 ctx 跑两批（假 llm 发 usage 块），断言 `job.batchLog` 的条数/no/status/counts/elapsedMs。
- [x] Step 4.2：断言 `job.usage` 与每批 usage 的累加正确。
- [x] Step 4.3：断言阶段回调被调用（calling → parsing）。
- [x] Step 4.4：沿用 `test/client-dictionary.test.js` 的一致性断言（zh/en 键集合相同、代码用到的键都在两词典里）。
- [x] Step 4.5：`node --test` 全绿（既有 19 个 + 新增）。

## Task 5 — 重新激活、实机验证、打包 0.1.4、GitHub Release

- [x] Step 5.1：`set_plugin(include:book-select, false)` → `true`，确认 `application:"applied"`。
- [x] Step 5.2：实机跑 `sample` + `run`，看批次记录、阶段、token 是否出现且正确。
- [x] Step 5.3：`package.json` 版本升 0.1.4；README 补「批次监控」说明；设计文档状态改「已确认」。
- [x] Step 5.4：`npm pack --pack-destination ..\..\dist` + 源码 zip（`tar -a -cf`），逐字节校验 + `node --check` + 无 U+FFFD；更新 `dist/INSTALL.md`。
- [x] Step 5.5：提交并推送 GitHub 私有仓库 `Student-Hu/IBS`，发 v0.1.4 Release。
