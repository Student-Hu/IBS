/**
 * Model-facing half of the workbench: batch screening against the acquisition
 * policy, tolerant decoding of the JSON contract, and the design Q&A.
 *
 * The upstream n8n workflow called MiniMax-M3 through a LangChain agent with a
 * structured-output parser. Here the call goes through the Harness `llm`
 * service with the caller's default model, and the JSON contract is enforced by
 * the prompt plus {@link parseScreeningJson}.
 */

import {
  AI_RULES,
  BANNED_KEYWORDS,
  CLASS_RULES,
  CONTENT_RULES,
  I_CLASS_WHITELIST,
  PREFILTER_RULES,
} from './rules.js'

/** Longest book summary sent to the model, in characters. */
const SUMMARY_CLIP = 400

/** Wall-clock ceiling for one model call. */
const CALL_TIMEOUT_MS = 240_000

/** Output budget for one screening call: enough for 40 verdicts plus reasoning. */
const SCREEN_MAX_TOKENS = 16_000

/** How many times one batch may be retried after a provider rate limit. */
const RATE_LIMIT_MAX_RETRIES = 3

/** First backoff step for a rate-limited batch, in milliseconds. */
const RATE_LIMIT_BASE_DELAY_MS = 2_000

/**
 * Resolve the model route the workbench uses: the Harness default selection, so
 * a user switching models changes screening and Q&A together.
 * @param {object} ctx - plugin context.
 * @returns {{llm: object, provider: string, model: string, reasoningEffort?: string}}
 */
function requireModel(ctx) {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new Error('大模型服务不可用：当前 Harness 没有挂载 llm 服务，无法做 AI 判定。')
  }
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  if (selection === undefined || selection === null) {
    throw new Error('没有可用的默认模型：请先在 Harness 的模型设置里选择一个模型。')
  }
  return { llm, provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
}

/** Describe the active model for the panel footer. */
export function modelLabel(ctx) {
  try {
    const { provider, model } = requireModel(ctx)
    return `${provider} / ${model}`
  } catch {
    return '模型不可用'
  }
}

/** Merge a caller signal with a deadline into one abort signal. */
function withDeadline(signal, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('模型调用超时')), ms)
  timer.unref?.()
  const forward = () => controller.abort(signal.reason)
  if (signal !== undefined && signal !== null) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', forward, { once: true })
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', forward)
    },
  }
}

/**
 * Run one non-streaming generation and return its text.
 *
 * Chunks are reassembled per block index: providers may emit `text-delta`s, a
 * final `text` block, or both, so a delta-less block is taken from `block-end`
 * instead of being dropped.
 * @param {object} ctx - plugin context.
 * @param {{system?: string, messages: object[], temperature?: number, maxTokens?: number, signal?: AbortSignal}} options - call shape.
 * @returns {Promise<string>} the concatenated text blocks.
 */
export async function completeText(ctx, options) {
  const { llm, provider, model, reasoningEffort } = requireModel(ctx)
  const deadline = withDeadline(options.signal, CALL_TIMEOUT_MS)
  const parts = new Map()
  let finish = null
  try {
    for await (const chunk of llm.stream({
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(options.system === undefined ? {} : { system: options.system }),
      messages: options.messages,
      temperature: options.temperature ?? 0,
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      signal: deadline.signal,
    })) {
      if (chunk.type === 'text-delta') {
        parts.set(chunk.index, (parts.get(chunk.index) ?? '') + chunk.text)
      } else if (chunk.type === 'block-end') {
        if (chunk.block?.type === 'text' && !parts.has(chunk.index)) parts.set(chunk.index, chunk.block.text)
      } else if (chunk.type === 'finish') {
        finish = chunk.reason
      }
    }
  } catch (error) {
    if (deadline.signal.aborted) {
      const aborted = new Error(`模型调用中断：${error?.message ?? '超时或已取消'}`)
      aborted.llmCode = error?.failure?.code
      aborted.retryAfterMs = error?.failure?.providerRetryAfterMs
      throw aborted
    }
    if (error?.llmCode === undefined && error?.failure?.code !== undefined) error.llmCode = error.failure.code
    if (error?.retryAfterMs === undefined && error?.failure?.providerRetryAfterMs !== undefined) {
      error.retryAfterMs = error.failure.providerRetryAfterMs
    }
    throw error
  } finally {
    deadline.dispose()
  }
  if (finish !== null && (finish.kind === 'error' || finish.kind === 'aborted')) {
    const failure = finish.failure
    const error = new Error(`模型调用失败：${failure?.message ?? finish.kind}`)
    // The stable failure code is what callers route on — never the message text.
    error.llmCode = failure?.code
    error.retryAfterMs = failure?.providerRetryAfterMs
    throw error
  }
  const text = [...parts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value)
    .join('')
  if (text.trim() === '') {
    const hint = finish?.kind === 'max-tokens' ? '输出预算可能被推理过程耗尽' : '可能被截断或触发了内容过滤'
    throw new Error(`模型没有返回任何文本（${hint}），可把批大小调小后重试。`)
  }
  return text
}

/** Trim a summary for the prompt. */
function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/**
 * Project one book onto the fields the policy needs — the same names the
 * workflow's prompt used, minus ISBN and price noise that never matters.
 * @param {object} book - normalised book.
 * @returns {object} prompt-facing record.
 */
export function projectBook(book) {
  const record = {
    序号: String(book.no ?? ''),
    书名: book.title ?? '',
    价格: book.price ?? 0,
    出版社: book.publisher ?? '',
    分类号: book.cls ?? '',
    出版年: book.year === 0 ? '' : book.year,
    责任者: book.author ?? '',
    版次: book.edition ?? '',
    页码: book.pages ?? '',
    内容简介: clip(book.summary, SUMMARY_CLIP),
  }
  if (typeof book.hint === 'string' && book.hint !== '') record.预筛提示 = book.hint
  return record
}

/**
 * Build the user turn for one batch.
 * @param {object[]} books - the batch.
 * @returns {string} the prompt text.
 */
export function buildScreeningMessage(books) {
  const payload = books.map(projectBook)
  return `按照规则处理下面 ${payload.length} 本书的选择：\n${JSON.stringify(payload, null, 1)}\n\n只输出 JSON 对象，不要任何解释。`
}

/**
 * Decode the model's screening JSON, tolerating code fences, prose around the
 * object, trailing commas, and numeric `序号` values.
 * @param {string} text - raw model output.
 * @returns {{passed: object[], rejected: object[], review: object[]}} the three lists.
 */
export function parseScreeningJson(text) {
  const cleaned = String(text)
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型输出里没有找到 JSON 对象。')
  const body = cleaned.slice(start, end + 1)
  const attempts = [body, body.replace(/,\s*([}\]])/g, '$1'), body.replace(/[\u201c\u201d]/g, '"')]
  let parsed = null
  for (const attempt of attempts) {
    try {
      parsed = JSON.parse(attempt)
      break
    } catch {
      parsed = null
    }
  }
  if (parsed === null) throw new Error('模型输出不是合法 JSON（可能被截断）。')
  const list = (value) => (Array.isArray(value) ? value.filter((entry) => entry !== null && typeof entry === 'object') : [])
  return { passed: list(parsed.passed), rejected: list(parsed.rejected), review: list(parsed.review) }
}

/**
 * Whether a failure was the provider refusing more requests right now.
 *
 * Routed on the stable failure code `RATE_LIMIT` the `llm` service reports —
 * never on the message text, which providers word differently.
 * @param {unknown} error - the thrown error.
 * @returns {boolean} true when the call was rate limited.
 */
export function isRateLimit(error) {
  return error?.llmCode === 'RATE_LIMIT'
}

/**
 * How long to wait before retrying a rate-limited batch.
 * @param {number} attempt - zero-based retry index.
 * @param {number} [retryAfterMs] - the provider's own retry hint, in milliseconds.
 * @param {() => number} [random] - jitter source, injected so tests stay deterministic.
 * @returns {number} the delay in milliseconds.
 */
export function backoffDelay(attempt, retryAfterMs, random = Math.random) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs
  const base = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt
  return Math.round(base + base * 0.25 * random())
}

/**
 * Screen one batch with the model.
 *
 * A rate-limited call is retried as the *same* batch after a backoff — halving
 * it would only double the requests the provider is already refusing. Other
 * recoverable failures (empty text, truncated JSON) still split the batch in
 * half, because a smaller batch is what makes those succeed.
 * @param {object} ctx - plugin context.
 * @param {object[]} books - the batch (already prefilted).
 * @param {{signal?: AbortSignal, gate?: {block: (ms: number) => void, wait: (signal?: AbortSignal) => Promise<void>}, attempt?: number}} options - cancellation, shared cooldown gate, retry count.
 * @returns {Promise<{passed: object[], rejected: object[], review: object[]}>} decoded lists.
 */
export async function screenBatch(ctx, books, options = {}) {
  try {
    return await screenOnce(ctx, books, options)
  } catch (error) {
    const attempt = options.attempt ?? 0
    if (isRateLimit(error)) {
      if (attempt >= RATE_LIMIT_MAX_RETRIES) throw error
      const delay = backoffDelay(attempt, error.retryAfterMs)
      // Tell the shared gate so sibling workers stop hammering the provider too.
      options.gate?.block(delay)
      await options.gate?.wait(options.signal)
      return screenBatch(ctx, books, { ...options, attempt: attempt + 1 })
    }
    const depth = options.depth ?? 0
    const recoverable = /没有返回任何文本|JSON|没有找到|解析/.test(String(error?.message ?? ''))
    if (!recoverable || books.length <= 1 || depth >= 3) throw error
    const half = Math.ceil(books.length / 2)
    const next = { ...options, depth: depth + 1, attempt: 0 }
    const [left, right] = await Promise.all([
      screenBatch(ctx, books.slice(0, half), next),
      screenBatch(ctx, books.slice(half), next),
    ])
    return {
      passed: [...left.passed, ...right.passed],
      rejected: [...left.rejected, ...right.rejected],
      review: [...left.review, ...right.review],
    }
  }
}

/**
 * One screening call: build the prompt, ask, decode. Split out so `screenBatch`
 * can retry halves without duplicating the call shape.
 * @param {object} ctx - plugin context.
 * @param {object[]} books - the batch.
 * @param {{signal?: AbortSignal}} options - cancellation.
 * @returns {Promise<{passed: object[], rejected: object[], review: object[]}>} verdicts.
 */
async function screenOnce(ctx, books, options) {
  const text = await completeText(ctx, {
    system: AI_RULES,
    messages: [{ role: 'user', content: [{ type: 'text', text: buildScreeningMessage(books) }] }],
    temperature: 0,
    maxTokens: SCREEN_MAX_TOKENS,
    signal: options.signal,
  })
  return parseScreeningJson(text)
}

/** Normalise a 序号 for matching model output back to input books. */
export function normalizeNo(value) {
  return String(value ?? '')
    .replace(/[^\dA-Za-z\u4e00-\u9fa5.-]/g, '')
    .trim()
}

/**
 * The design knowledge handed to the Q&A model: what the plugin does, where each
 * decision lives, and which limits are known. Kept in sync with the code by
 * hand — the Q&A must not invent behaviour this workbench does not have.
 */
function designBrief() {
  return `## 插件定位
“选书工作台”（dsh-book-select）把 n8n 工作流「图书馆图书采购筛选工作流」实现为 Harness Web GUI 内的一个对话视图（conversation.view，标签“选书”），面向高校图书馆中文图书采购：先按硬规则预过滤征订书目，再让大模型按分类号规则与内容排除规则给出“通过 / 排除 / 待复审”结论，并支持人工改判、结果导出与针对规则/设计的问答。

## 数据流（两阶段）
阶段一 · 硬规则预过滤（不调用模型，lib/rules.js 的 prefilterBook，顺序敏感、首个命中即止）：
1. 页码 < 20 页（仅当字段是“N页”形式才判定，缺失或自由文本放行）→ 排除，原因“图书页码小于20”
2. 定价 > 500 元 → “规则二-1：图书定价>500元”
3. 版次含“影印” → “规则二-3：版次为影印版/影印本”
4. 分类号以 I 开头且出版社不在 15 家白名单 → “规则二-2：I类分类号且出版社不在白名单”

敏感词不在这里排除：命中 ${BANNED_KEYWORDS.length} 个敏感词之一的书会带一条“预筛提示”（keywordHintOf），随书交给模型按内容判断，提示词里明确要求忽略关键词本身。

阶段二 · 模型语义判定（lib/screening.js 的 screenBatch）：待判定图书按批（默认 15 本，可调 5–40）发给默认模型，同一阶段内并发跑多批（默认 3，可调 1–6，见 lib/scheduler.js 的批次池）；system 提示词就是规则全文（lib/rules.js 的 AI_RULES，含分类号规则 A/B/D/G/I/J/K/F/H 与内容排除 1–12、15–26 条），要求只输出 {"passed":[],"rejected":[],"review":[]}。解析容错：去代码围栏、取首个 { 到末个 }、修尾逗号。每本输入书必须且只能落在一个数组里；模型漏判的书进入“待复审”。

## 状态机
每本书 status ∈ pending / passed / rejected / review / failed，source ∈ rule / ai / manual。预过滤命中的直接 rejected+rule；模型返回的按列表落 passed/rejected/review+ai；模型调用失败的那一批整批 failed（原因写明失败信息），不阻塞后续批次；用户可在表格里直接改判（source 变 manual）。一次运行分两个阶段且阶段之间串行：先跑完 pending，再跑 failed 重试；再次运行只处理 pending（相当于工作流的断点续跑）。判定途中取消时，在途批次保持 pending，不算失败。

## 参数与可调点
- 批大小 batchSize：默认 15，接口限制 5–40；越大越省调用次数，但更容易撞上输出截断。一批失败（空文本或 JSON 解析失败）时会自动对半拆开重试，最多拆 3 层；真正失败的那一批整批转 failed。
- 并发度 concurrency：默认 3，接口限制 1–6；同一阶段内同时判定的批数。并发越高墙钟时间越短，但越容易撞 provider 限流。限流（失败码 RATE_LIMIT）时不拆批，退避 2/4/8 秒（优先用 provider 给的重试时间）后重试同一批，最多 3 次；仍失败才进 failed。退避期间共享冷却闸让其他 worker 一起等，避免继续撞限流。
- 阈值：页码 20、价格 500、I 类白名单（${I_CLASS_WHITELIST.length} 家）、关键词表（${BANNED_KEYWORDS.length} 个）都在 lib/rules.js 顶部常量里。
- 规则文本：AI_RULES 是唯一来源，改它即改变判定口径；分类号规则见 CLASS_RULES，内容排除见 CONTENT_RULES（条号沿用原工作流：1–12、15–26）。
- 模型：跟随 Harness 的默认模型（agentDefaultModel），temperature 固定 0，单次调用 240 秒超时。

## 数据字段
导入后规范化为：序号 no、书名 title、价格 price、出版社 publisher、ISBN、责任者 author、出版年 year、分类号 cls、内容简介 summary、版次 edition、页码 pages；状态与原因 status/reason/source。
导入支持：粘贴 Excel 复制的表格（TSV）、CSV、JSON 数组、上传 .xlsx。表头别名表在 lib/parse.js（如 题名/书名、定价/价格、中图分类号/分类号）；少于 3 列能识别时按“序号,书名,价格,出版社,ISBN,责任者,出版年,分类号,内容简介,版次,页码”的位置顺序解析。xlsx 用 node:zlib 自带的 ZIP+XML 解析，只读第一个工作表，日期列会显示为序列号；不支持旧版 .xls（提示另存为 .xlsx）。

## 已知边界
- 分类号只是线索，语义冲突时以内容价值为准（“宽进严出”，边界模糊入 review 而不是排除）。
- 模型判定有随机性；同一批重跑可能结论不同，人工改判是最终口径。
- 并发判定只改变墙钟时间，不改变判定口径（每批仍是独立的一次模型调用、同一份提示词）；但并发越高越容易撞 provider 限流，插件会退避重试同一批，仍频繁失败时把并发调回 1–2。
- 结果导出为 CSV（UTF-8 BOM，Excel 可直接打开），导出按当前筛选条件。
- 状态保存在 Host 内存（按会话隔离），Harness 重启后需要重新导入。

## 与上游 n8n 工作流的差异
- 不再需要 data table 与三份 xlsx：状态在插件内，导出一次即三类合一（含状态列）。
- 新增人工改判、按状态/关键词筛选、实时进度、设计问答。
- 保留原有规则文本与原因措辞，便于和历史上的排除原因对照。

## 源码位置（工作区 plugins/dsh-book-select）
- index.js：Host 入口，/book-select/api/* JSON 路由、会话状态、判定任务编排、book_select agent 工具
- lib/rules.js：规则常量、硬规则预过滤、AI 规则全文
- lib/parse.js：TSV/CSV/JSON/xlsx 解析与字段映射、内置示例数据
- lib/screening.js：模型调用、批量判定、JSON 容错解析、设计问答提示词
- client.js：conversation.view 视图（导入、进度、表格、规则说明、问答）`
}

/**
 * Answer one question about the selection design, grounded in the rule text and
 * the implementation brief instead of general knowledge.
 * @param {object} ctx - plugin context.
 * @param {{question: string, history?: {role: string, text: string}[], stats?: object, signal?: AbortSignal}} options - question and context.
 * @returns {Promise<string>} the answer.
 */
export async function answerDesignQuestion(ctx, options) {
  const { question } = options
  if (String(question ?? '').trim() === '') throw new Error('问题不能为空。')
  const ruleDigest = [
    '## 硬规则（阶段一）',
    ...PREFILTER_RULES.map((rule, index) => `${index + 1}. ${rule.title} — ${rule.detail}`),
    '',
    '## 分类号规则（阶段二）',
    ...CLASS_RULES.map((rule) => `${rule.code} 类：${rule.text}`),
    '',
    '## 内容排除规则（阶段二）',
    ...CONTENT_RULES.map((rule) => `${rule.n}. ${rule.text}`),
  ].join('\n')
  const system = `你是“选书工作台”插件的设计顾问，服务对象是图书馆采选馆员与负责维护这套规则的工程师。你只依据下面给出的规则原文与实现说明回答，不得编造未实现的能力；规则未覆盖的问题直接说明“规则未覆盖”，并给出可落地的建议（改哪条规则、改哪个常量、如何验证）。

# 规则原文
${ruleDigest}

# 实现说明
${designBrief()}

# 回答要求
- 用中文，先给结论，再给依据（引用“规则第X条”或具体常量名/文件名）。
- 涉及参数时给出当前值（例如批大小默认 15、价格阈值 500、页码阈值 20）。
- 涉及流程时说明它属于阶段一（硬规则）还是阶段二（模型语义判定）。
- 不确定或规则冲突时明说，不要猜测。
- 默认控制在 400 字以内（用户明确要求展开时才写长），结论先行，宁可少说也不要说到一半被截断。`
  const history = Array.isArray(options.history) ? options.history.slice(-6) : []
  const messages = history.map((entry) => ({
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    content: [{ type: 'text', text: String(entry.text ?? '') }],
  }))
  messages.push({ role: 'user', content: [{ type: 'text', text: String(question) }] })
  const text = await completeText(ctx, {
    system,
    messages,
    temperature: 0.2,
    maxTokens: 2_600,
    signal: options.signal,
  })
  return text.trim()
}
