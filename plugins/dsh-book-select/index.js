/**
 * Book-selection workbench — host half.
 *
 * Responsibilities:
 * - keep one screening session per conversation (imported books, statuses, job);
 * - expose it to the browser view through a small JSON route at
 *   `/book-select/api/*` (the view has no other channel to the Host);
 * - run batches through {@link screenBatch} so a run can be cancelled and
 *   resumed like the workflow's breakpoint check;
 * - register `book_select` so the same operations are reachable from the model.
 *
 * The operations are implemented once below and shared by both entry points.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  AI_RULES,
  CLASS_RULES,
  CONTENT_RULES,
  I_CLASS_WHITELIST,
  BANNED_KEYWORDS,
  PREFILTER_RULES,
  countPrefilterHits,
} from './lib/rules.js'
import { importBooks, sampleBooks } from './lib/parse.js'
import { createCooldownGate, runPool, splitBatches } from './lib/scheduler.js'
import { answerDesignQuestion, modelLabel, normalizeNo, screenBatch } from './lib/screening.js'
import { buildXlsx } from './lib/xlsx.js'

/** Loader identity (must equal the package name). */
export const name = 'dsh-book-select'

/**
 * Services the plugin mounts with. Every `ctx.get(name)` below must appear here:
 * this Cordis declares dependencies as an array, so an undeclared service read
 * fails activation instead of resolving to `undefined`.
 */
export const inject = ['webServer', 'tools', 'connection', 'llm', 'agentDefaultModel']

/** Route prefix owned by this plugin. */
const ROUTE = '/book-select/api'

/** Hard ceiling on one session's book count, to keep the view responsive. */
const MAX_BOOKS = 5_000

/** Batch-size bounds accepted from the UI. */
const BATCH_MIN = 5
const BATCH_MAX = 40
const BATCH_DEFAULT = 15

/** How many batches may be screened at the same time. */
const CONCURRENCY_MIN = 1
const CONCURRENCY_MAX = 6
const CONCURRENCY_DEFAULT = 3

/** Ceilings for one Excel export request, so a huge list cannot exhaust memory. */
const EXPORT_MAX_ROWS = 20_000
const EXPORT_MAX_COLUMNS = 200

/**
 * Where finished lists are kept between restarts: one JSON file per import,
 * written when books arrive and again after every judged batch.
 */
const HISTORY_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'book-select', 'history')

/** How many past lists stay on disk. */
const HISTORY_LIMIT = 40

/** History ids double as file names, so only harmless characters are allowed. */
const HISTORY_ID_RE = /^[A-Za-z0-9._-]{1,80}$/

/** An error that maps onto a specific HTTP status for the JSON route. */
class RequestError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Read and parse a JSON request body.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {number} limit - maximum accepted body size in bytes.
 * @returns {Promise<object>} the parsed body (`{}` for an empty body).
 */
async function readJsonBody(req, limit = 8 * 1024 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new RequestError(413, 'payload-too-large', '请求体过大：一次最多导入 8 MB 的书目数据。')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new RequestError(400, 'invalid-json', '请求体不是合法 JSON。')
  }
}

/** Write one JSON response. */
function writeJson(res, status, body) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Write the `{ok:true,value}` envelope the client expects. */
function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value })
}

/** Write an error envelope, mapping unknown failures to 500. */
function writeError(res, error) {
  if (error instanceof RequestError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  writeJson(res, 500, { ok: false, error: { code: 'internal', message: error?.message ?? String(error) } })
}

/** Clamp a batch size into the accepted range. */
function clampBatch(value) {
  const size = Number.isFinite(Number(value)) ? Math.round(Number(value)) : BATCH_DEFAULT
  return Math.min(BATCH_MAX, Math.max(BATCH_MIN, size))
}

/** Clamp a concurrency into the accepted range. */
function clampConcurrency(value) {
  const count = Number.isFinite(Number(value)) ? Math.round(Number(value)) : CONCURRENCY_DEFAULT
  return Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, count))
}

/** Token fields the panel adds up; anything else is ignored. */
const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']

/**
 * Add one provider usage report to a running total.
 *
 * The `llm` service reports usage per call, so a batch that was split or
 * retried contributes several reports; the panel wants one number per batch
 * and one for the whole run.
 * @param {object|null} target - the total so far.
 * @param {object} usage - one usage report.
 * @returns {object|null} the new total.
 */
function addUsage(target, usage) {
  if (usage === null || usage === undefined || typeof usage !== 'object') return target
  const total = target === null || target === undefined ? {} : { ...target }
  for (const field of USAGE_FIELDS) {
    const value = usage[field]
    if (typeof value === 'number' && Number.isFinite(value)) total[field] = (total[field] ?? 0) + value
  }
  return total
}

/** New history id: ISO time first so the directory sorts chronologically. */
function newHistoryId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

/** Absolute path of one history file. */
function historyFile(id) {
  return join(HISTORY_DIR, `${id}.json`)
}

/** Empty state for one conversation. */
function createState(key) {
  return {
    key,
    items: [],
    revision: 1,
    job: null,
    abort: null,
    options: { batchSize: BATCH_DEFAULT, concurrency: CONCURRENCY_DEFAULT },
    lastError: null,
    note: '',
    filename: '',
    historyId: '',
    importedAt: null,
    stats: null,
    columns: [],
  }
}

/** Count books per status. */
function countsOf(items) {
  const counts = { total: items.length, pending: 0, passed: 0, rejected: 0, review: 0, failed: 0, ruleRejected: 0, aiJudged: 0 }
  for (const item of items) {
    if (item.status in counts) counts[item.status]++
    if (item.source === 'rule') counts.ruleRejected++
    else if (item.source === 'ai' && item.status !== 'failed') counts.aiJudged++
  }
  return counts
}

/**
 * The serialisable summary the view polls while a run is active.
 * @param {object} state - the session state.
 * @param {object|null} ctx - plugin context, for the model label.
 * @returns {object} summary without items.
 */
function summaryOf(state, ctx) {
  return {
    revision: state.revision,
    counts: countsOf(state.items),
    hits: state.items.length === 0 ? null : countPrefilterHits(state.items),
    job: state.job,
    options: state.options,
    lastError: state.lastError,
    note: state.note,
    filename: state.filename ?? '',
    historyId: state.historyId ?? '',
    importedAt: state.importedAt,
    columns: state.columns ?? [],
    model: ctx === null ? null : modelLabel(ctx),
  }
}

/** Public projection of one book for the table. */
function bookOf(item) {
  return {
    id: item.id,
    no: item.no,
    title: item.title,
    price: item.price,
    publisher: item.publisher,
    isbn: item.isbn,
    author: item.author,
    year: item.year,
    cls: item.cls,
    summary: item.summary,
    edition: item.edition,
    pages: item.pages,
    hint: item.hint ?? '',
    // Untouched source cells, aligned with the import's `columns`, so an export
    // carries every original field rather than the eleven the rules inspect.
    cells: Array.isArray(item.cells) ? item.cells : [],
    status: item.status,
    reason: item.reason,
    source: item.source,
    // The librarian's own remark on this book: free text, independent of the
    // verdict, written by hand and kept with the record.
    note: item.note ?? '',
  }
}

/**
 * Put one model verdict onto its input book. Matching tries 序号 first (the
 * contract's key) then 题名, and ignores entries that match nothing or repeat.
 * @param {object[]} batch - the batch sent to the model.
 * @param {{passed: object[], rejected: object[], review: object[]}} outcome - decoded verdicts.
 */
function applyOutcome(batch, outcome) {
  // Queues, not single slots: a source table may repeat a 序号 (or leave the
  // column out, in which case row numbers are used), and each verdict must claim
  // a *different* book rather than overwriting the same one.
  const byNo = new Map()
  const byTitle = new Map()
  for (const book of batch) {
    const key = normalizeNo(book.no)
    const queue = byNo.get(key)
    if (queue === undefined) byNo.set(key, [book])
    else queue.push(book)
    byTitle.set(String(book.title).trim(), book)
  }
  const seen = new Set()
  const assign = (status) => (entry) => {
    const key = normalizeNo(entry.序号 ?? entry.no)
    let book = byNo.get(key)?.shift()
    if (book === undefined) book = byTitle.get(String(entry.题名 ?? entry.title ?? '').trim())
    if (book === undefined || seen.has(book.id)) return
    seen.add(book.id)
    book.status = status
    book.source = 'ai'
    book.reason = status === 'passed'
      ? String(entry.通过理由 ?? '').trim()
      : status === 'rejected'
        ? String(entry.排除原因 ?? '').trim()
        : String(entry.待复审原因 ?? '').trim()
  }
  outcome.passed.forEach(assign('passed'))
  outcome.rejected.forEach(assign('rejected'))
  outcome.review.forEach(assign('review'))
  for (const book of batch) {
    if (seen.has(book.id)) continue
    book.status = 'review'
    book.source = 'ai'
    book.reason = '模型未给出判定，转入待复审'
  }
}

/**
 * Mount the plugin.
 * @param {object} ctx - plugin context.
 */
export function apply(ctx) {
  /** @type {Map<string, ReturnType<typeof createState>>} */
  const states = new Map()

  /** Resolve (or create) one conversation's state. */
  const stateFor = (sessionId) => {
    const key = String(sessionId ?? '').trim() || 'default'
    let state = states.get(key)
    if (state === undefined) {
      state = createState(key)
      states.set(key, state)
    }
    return state
  }

  /** Drop the oldest history files once the directory grows past the limit. */
  const pruneHistory = async () => {
    try {
      const names = (await readdir(HISTORY_DIR)).filter((entry) => entry.endsWith('.json')).sort()
      const extra = names.slice(0, Math.max(0, names.length - HISTORY_LIMIT))
      for (const name of extra) await unlink(join(HISTORY_DIR, name))
    } catch {
      // No directory yet, or a file vanished: nothing to prune.
    }
  }

  /**
   * Serialises history writes. Parallel workers must not write the same file
   * at the same time — two interleaved writes would leave a corrupt JSON file.
   */
  let writeChain = Promise.resolve()

  /**
   * Write one list to disk. Called on import and after every judged batch, so a
   * crash mid-run still leaves the batches already judged on disk.
   * @param {object} state - the session state.
   */
  const writeHistory = async (state) => {
    if (state.items.length === 0) return
    try {
      if (typeof state.historyId !== 'string' || state.historyId === '') state.historyId = newHistoryId()
      const record = {
        id: state.historyId,
        filename: state.filename ?? '',
        note: state.note,
        importedAt: state.importedAt,
        updatedAt: new Date().toISOString(),
        columns: state.columns ?? [],
        stats: state.stats,
        job: state.job,
        counts: countsOf(state.items),
        items: state.items,
      }
      await mkdir(HISTORY_DIR, { recursive: true })
      await writeFile(historyFile(state.historyId), JSON.stringify(record), 'utf8')
      await pruneHistory()
    } catch (error) {
      ctx.logger?.warn?.(`[book-select] 历史记录未保存：${error?.message ?? error}`)
    }
  }

  /**
   * Queue one history write behind the previous ones.
   * @param {object} state - the session state.
   * @returns {Promise<void>} resolves when this write is on disk.
   */
  const persist = (state) => {
    writeChain = writeChain.then(() => writeHistory(state))
    return writeChain
  }

  /** Read the history index: newest first, without the book rows. */
  const listHistory = async () => {
    let names = []
    try {
      names = (await readdir(HISTORY_DIR)).filter((entry) => entry.endsWith('.json')).sort().reverse()
    } catch {
      names = []
    }
    const entries = []
    for (const name of names.slice(0, HISTORY_LIMIT)) {
      try {
        const record = JSON.parse(await readFile(join(HISTORY_DIR, name), 'utf8'))
        const items = Array.isArray(record.items) ? record.items : []
        entries.push({
          id: record.id ?? name.replace(/\.json$/, ''),
          filename: record.filename || record.note || '导入记录',
          note: record.note ?? '',
          importedAt: record.importedAt ?? null,
          updatedAt: record.updatedAt ?? null,
          columns: Array.isArray(record.columns) ? record.columns : [],
          counts: record.counts ?? countsOf(items),
          total: items.length,
          job: record.job === null || record.job === undefined
            ? null
            : { ...record.job, running: false },
        })
      } catch {
        // Unreadable file: skip it rather than failing the whole list.
      }
    }
    return { entries, dir: HISTORY_DIR, limit: HISTORY_LIMIT }
  }

  /** Restore one stored list, verdicts included, into the live workbench. */
  const loadHistory = async (state, payload) => {
    const id = String(payload.id ?? '').trim()
    if (!HISTORY_ID_RE.test(id)) throw new RequestError(400, 'invalid-id', '历史记录编号无效。')
    let record
    try {
      record = JSON.parse(await readFile(historyFile(id), 'utf8'))
    } catch {
      throw new RequestError(404, 'history-not-found', `找不到历史记录：${id}`)
    }
    state.abort?.abort(new Error('载入历史记录替换了当前任务'))
    state.abort = null
    state.items = Array.isArray(record.items) ? record.items.map((item) => ({ ...item })) : []
    state.columns = Array.isArray(record.columns) ? record.columns : []
    state.stats = record.stats ?? null
    state.note = record.note ?? ''
    state.filename = record.filename ?? ''
    state.importedAt = record.importedAt ?? null
    state.historyId = record.id ?? id
    state.lastError = null
    state.job = record.job === null || record.job === undefined ? null : { ...record.job, running: false }
    state.revision++
    return { ...summaryOf(state, ctx), items: state.items.map(bookOf) }
  }

  /** Delete one stored list. */
  const deleteHistory = async (state, payload) => {
    const id = String(payload.id ?? '').trim()
    if (!HISTORY_ID_RE.test(id)) throw new RequestError(400, 'invalid-id', '历史记录编号无效。')
    try {
      await unlink(historyFile(id))
    } catch {
      throw new RequestError(404, 'history-not-found', `找不到历史记录：${id}`)
    }
    if (state.historyId === id) state.historyId = ''
    return listHistory()
  }

  /**
   * Replace the book list with a freshly imported one, keeping the previous job
   * out of the way.
   * @param {object} state - the session state.
   * @param {{books: object[], stats: object, note: string}} imported - import result.
   */
  const adoptImport = (state, imported) => {
    if (imported.books.length > MAX_BOOKS) {
      throw new RequestError(413, 'too-many-books', `一次最多导入 ${MAX_BOOKS} 条书目，请先拆分文件。`)
    }
    state.abort?.abort(new Error('新的导入替换了当前任务'))
    state.abort = null
    state.items = imported.books.map(bookOf)
    state.stats = imported.stats
    state.columns = Array.isArray(imported.stats?.columns) ? imported.stats.columns : []
    state.note = imported.note
    state.filename = String(imported.filename ?? '').trim()
    state.historyId = newHistoryId()
    state.importedAt = new Date().toISOString()
    state.lastError = null
    state.job = null
    state.revision++
    void persist(state)
    return state
  }

  /**
   * Start the screening job in the background: batches of one phase run
   * concurrently, per-batch isolation so one failure cannot abort the run.
   * @param {object} state - the session state.
   * @param {number} requestedBatch - requested batch size.
   * @param {number} requestedConcurrency - how many batches to screen at once.
   * @returns {object} the summary right after the job started.
   */
  const startRun = (state, requestedBatch, requestedConcurrency) => {
    if (state.job !== null && state.job.running) {
      throw new RequestError(409, 'busy', '已有判定任务在运行，请等待完成或先取消。')
    }
    // Only books without a verdict: a second run continues where the last one
    // stopped instead of re-judging (and re-billing) verdicts it already has.
    const pending = state.items.filter((item) => item.status === 'pending')
    // Books whose batch failed on the model side. Snapshotted before the run so
    // a batch that fails *now* is not retried in the same run — otherwise a dead
    // provider would be hammered twice and the retry could never settle.
    const retries = state.items.filter((item) => item.status === 'failed')
    if (pending.length === 0 && retries.length === 0) {
      throw new RequestError(400, 'no-pending', '没有待判定的图书：请先导入书目，或用「改判」把书改回「待判定」后重试。')
    }
    const size = clampBatch(requestedBatch ?? state.options.batchSize)
    const concurrency = clampConcurrency(requestedConcurrency ?? state.options.concurrency)
    state.options.batchSize = size
    state.options.concurrency = concurrency
    const controller = new AbortController()
    state.abort = controller
    // One gate for the whole run: a rate-limited worker holds the others back
    // instead of everyone hammering the provider at once.
    const gate = createCooldownGate()
    const phases = [
      { key: 'pending', books: pending },
      { key: 'retry', books: retries },
    ].filter((phase) => phase.books.length > 0)
    // Batch numbers are handed out across both phases, so the report reads
    // "batch 7" instead of restarting the count after the retry phase.
    let batchBase = 0
    const total = pending.length + retries.length
    const job = {
      id: `job-${Date.now().toString(36)}`,
      running: true,
      total,
      done: 0,
      failed: 0,
      phase: phases[0].key,
      retries: retries.length,
      batches: Math.ceil(pending.length / size) + Math.ceil(retries.length / size),
      batchesDone: 0,
      batchSize: size,
      concurrency,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      cancelled: false,
      // Per-batch progress report: what each batch is doing, how long it took
      // and what it cost in tokens. Travels with `job`, so it lands in the
      // history archive as well.
      batchLog: [],
      usage: null,
    }
    state.job = job
    state.lastError = null
    state.revision++
    void (async () => {
      try {
        for (const phase of phases) {
          job.phase = phase.key
          const batches = splitBatches(phase.books, size)
          // Batch numbers run across both phases, so the panel can say "batch 7"
          // without the reader having to know which phase it belonged to.
          const base = batchBase
          batchBase += batches.length
          const pool = await runPool(batches, concurrency, async (batch, index) => {
            const record = {
              no: base + index + 1,
              phase: phase.key,
              bookCount: batch.length,
              titles: batch.slice(0, 2).map((book) => String(book.title ?? '')),
              status: 'running',
              stage: 'calling',
              stageInfo: null,
              startedAt: new Date().toISOString(),
              endedAt: null,
              elapsedMs: null,
              retry: 0,
              split: 0,
              counts: null,
              usage: null,
              error: null,
            }
            job.batchLog.push(record)
            const startedAt = Date.now()
            try {
              const outcome = await screenBatch(ctx, batch, {
                signal: controller.signal,
                gate,
                onStage: (stage, info) => {
                  record.stage = stage
                  record.stageInfo = info ?? null
                  if (stage === 'cooling') record.retry += 1
                  if (stage === 'splitting') record.split += 1
                  state.revision++
                },
                onUsage: (usage) => {
                  record.usage = addUsage(record.usage, usage)
                  job.usage = addUsage(job.usage, usage)
                  state.revision++
                },
              })
              record.stage = 'applying'
              applyOutcome(batch, outcome)
              record.status = 'done'
              record.counts = {
                passed: outcome.passed.length,
                rejected: outcome.rejected.length,
                review: outcome.review.length,
              }
            } catch (error) {
              if (controller.signal.aborted) {
                // Cancelled mid-flight: leave the batch pending so the next run
                // picks it up — a cancelled run is not a failed batch.
                job.cancelled = true
                record.status = 'cancelled'
                record.endedAt = new Date().toISOString()
                record.elapsedMs = Date.now() - startedAt
                state.revision++
                return
              }
              // A model/transport error is not a verdict: park the batch in its
              // own bucket so the librarian can retry it instead of reviewing it.
              job.failed += batch.length
              const reason = error?.message ?? String(error)
              record.status = 'failed'
              record.error = reason
              for (const book of batch) {
                book.status = 'failed'
                book.source = 'ai'
                book.reason = `AI 判定失败：${reason}`
              }
            }
            record.endedAt = new Date().toISOString()
            record.elapsedMs = Date.now() - startedAt
            job.done += batch.length
            job.batchesDone++
            state.revision++
            // Save after every batch: a stopped run keeps what it already judged.
            await persist(state)
          }, {
            signal: controller.signal,
            beforeBatch: () => gate.wait(controller.signal),
          })
          if (pool.aborted || job.cancelled) {
            job.cancelled = true
            break
          }
        }
      } catch (error) {
        job.error = error?.message ?? String(error)
        state.lastError = job.error
      } finally {
        job.running = false
        job.finishedAt = new Date().toISOString()
        state.abort = null
        state.revision++
        await persist(state)
      }
    })()
    return summaryOf(state, ctx)
  }

  /** Import from a paste or an upload, then prefilter. */
  const doImport = (state, payload) => {
    const imported = importBooks({ text: payload.text, base64: payload.base64, filename: payload.filename })
    adoptImport(state, { ...imported, filename: payload.filename })
    return { ...summaryOf(state, ctx), items: state.items.map(bookOf) }
  }

  /** Load the built-in demo records. */
  const doSample = (state) => {
    const sample = sampleBooks()
    adoptImport(state, { ...sample, filename: '内置示例数据' })
    return { ...summaryOf(state, ctx), items: state.items.map(bookOf) }
  }

  /** Filtered result rows, newest filter applied. */
  const doResults = (state, payload) => {
    const status = String(payload.status ?? '').trim()
    const query = String(payload.query ?? '').trim().toLowerCase()
    const limit = Math.min(2_000, Math.max(1, Number(payload.limit ?? 500) || 500))
    let items = state.items
    if (status !== '' && status !== 'all') items = items.filter((item) => item.status === status)
    if (query !== '') {
      items = items.filter((item) => [item.title, item.author, item.publisher, item.cls, item.reason, item.note]
        .some((value) => String(value ?? '').toLowerCase().includes(query)))
    }
    return {
      total: items.length,
      returned: Math.min(items.length, limit),
      items: items.slice(0, limit).map(bookOf),
    }
  }

  /** Manual override of one book's verdict — the librarian's final say. */
  const doSetStatus = (state, payload) => {
    const id = String(payload.id ?? '')
    const status = String(payload.status ?? '')
    if (!['pending', 'passed', 'rejected', 'review', 'failed'].includes(status)) {
      throw new RequestError(400, 'invalid-status', `不支持的状态：${status}`)
    }
    const book = state.items.find((item) => item.id === id)
    if (book === undefined) throw new RequestError(404, 'not-found', `找不到编号为 ${id} 的图书。`)
    book.status = status
    book.source = 'manual'
    if (typeof payload.reason === 'string' && payload.reason.trim() !== '') book.reason = payload.reason.trim()
    state.revision++
    void persist(state)
    return summaryOf(state, ctx)
  }

  /**
   * The librarian's own note on one book. Free text, independent of the
   * verdict: it never changes the status, only records the human reading.
   * @param {object} state - the session state.
   * @param {{id: string, note?: string}} payload - the book id and the text.
   * @returns {object} the summary after the note is stored.
   */
  const doSetNote = (state, payload) => {
    const id = String(payload.id ?? '')
    const book = state.items.find((item) => item.id === id)
    if (book === undefined) throw new RequestError(404, 'not-found', `找不到编号为 ${id} 的图书。`)
    book.note = String(payload.note ?? '').replace(/\r\n/g, '\n').trim()
    state.revision++
    void persist(state)
    return summaryOf(state, ctx)
  }

  /**
   * Build a real `.xlsx` file from the table the browser shows. The browser
   * owns the table (status tab, search box, column order and labels); the
   * Host only encodes it, because a ZIP container needs zlib.
   * @param {{sheetName?: string, filename?: string, header?: unknown[], rows?: unknown[][]}} payload - the table to write.
   * @returns {{filename: string, base64: string}} the file name and its bytes, base64 encoded.
   */
  const doExportXlsx = (payload) => {
    const header = Array.isArray(payload.header) ? payload.header : []
    const rows = Array.isArray(payload.rows) ? payload.rows : []
    if (header.length === 0) throw new RequestError(400, 'empty-table', '没有可导出的表头。')
    if (header.length > EXPORT_MAX_COLUMNS) {
      throw new RequestError(400, 'too-many-columns', `导出列数超过上限（${EXPORT_MAX_COLUMNS} 列）。`)
    }
    if (rows.length > EXPORT_MAX_ROWS) {
      throw new RequestError(400, 'too-many-rows', `导出行数超过上限（${EXPORT_MAX_ROWS} 行）。`)
    }
    const bytes = buildXlsx({
      sheetName: String(payload.sheetName ?? '选书结果'),
      header,
      rows,
    })
    return {
      filename: String(payload.filename ?? 'book-selection.xlsx'),
      base64: bytes.toString('base64'),
    }
  }

  /** Static rule documentation for the rules panel. */
  const ruleDigest = () => ({
    prefilter: PREFILTER_RULES,
    classes: CLASS_RULES,
    content: CONTENT_RULES,
    keywords: BANNED_KEYWORDS,
    whitelist: I_CLASS_WHITELIST,
    aiPrompt: AI_RULES,
    batch: { min: BATCH_MIN, max: BATCH_MAX, default: BATCH_DEFAULT },
    sample: '内置示例：12 条记录，覆盖页码、价格、影印、I 类白名单、关键词与语义判定各条路径。',
  })

  /**
   * Shared operation table: the HTTP route and the agent tool both call these,
   * so behaviour cannot drift between them.
   */
  const operations = {
    state: (payload) => {
      const state = stateFor(payload.sessionId)
      const summary = summaryOf(state, ctx)
      return payload.withItems === false ? summary : { ...summary, items: state.items.map(bookOf) }
    },
    import: (payload) => doImport(stateFor(payload.sessionId), payload),
    sample: (payload) => doSample(stateFor(payload.sessionId)),
    run: (payload) => {
      const state = stateFor(payload.sessionId)
      return startRun(state, payload.batchSize, payload.concurrency)
    },
    cancel: (payload) => {
      const state = stateFor(payload.sessionId)
      if (state.job !== null && state.job.running && state.abort !== null) {
        state.abort.abort(new Error('用户取消了判定任务'))
      }
      return summaryOf(state, ctx)
    },
    results: (payload) => doResults(stateFor(payload.sessionId), payload),
    setStatus: (payload) => doSetStatus(stateFor(payload.sessionId), payload),
    setNote: (payload) => doSetNote(stateFor(payload.sessionId), payload),
    exportXlsx: (payload) => doExportXlsx(payload),
    reset: (payload) => {
      const state = stateFor(payload.sessionId)
      state.abort?.abort(new Error('用户重置了会话'))
      states.delete(state.key)
      return summaryOf(createState(state.key), ctx)
    },
    rules: () => ruleDigest(),
    history: async (payload) => listHistory(),
    loadHistory: (payload) => loadHistory(stateFor(payload.sessionId), payload),
    deleteHistory: (payload) => deleteHistory(stateFor(payload.sessionId), payload),
    ask: async (payload) => {
      const state = stateFor(payload.sessionId)
      const question = String(payload.question ?? '')
      const answer = await answerDesignQuestion(ctx, {
        question,
        history: Array.isArray(payload.history) ? payload.history : [],
        stats: state.stats,
      })
      return { answer, model: modelLabel(ctx) }
    },
  }

  /**
   * HTTP handler: POST only, same-origin browser only, one method per path
   * segment.
   */
  const handler = async (req, res) => {
    try {
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: '只接受 POST。' } })
        return
      }
      const rejection = ctx.get('connection')?.requestRejection?.(req)
      if (rejection !== undefined) {
        writeJson(res, rejection, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith(`${ROUTE}/`) ? pathname.slice(ROUTE.length + 1) : ''
      const operation = Object.hasOwn(operations, method) ? operations[method] : undefined
      if (operation === undefined) {
        writeJson(res, 404, { ok: false, error: { code: 'unknown-method', message: `未知接口：${method || '(空)'}` } })
        return
      }
      const payload = await readJsonBody(req)
      const value = await operation(payload)
      writeOk(res, value ?? null)
    } catch (error) {
      writeError(res, error)
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }),
    'book-select: /book-select/api routes',
  )

  /**
   * Agent-facing tool: identical operations, JSON summaries only. The session
   * key comes from the calling session so the view shows the same books.
   */
  const tool = {
    name: 'book_select',
    description: 'Acquisition screening for the sidebar "选书 / Book Select" panel. The panel holds one shared book list for the whole app: import an acquisition list (pasted table text, CSV, TSV, JSON array, or base64 .xlsx), run the deterministic prefilter plus model screening, read the verdicts, or ask about the selection rules themselves. `run` starts a background job and returns immediately; poll `status` (or `results`) until `job.running` is false. A run only screens books still in `pending`, then retries books parked in `failed` (a model/transport error, not a verdict); it never re-judges a book that already has a verdict. `run` screens up to `concurrency` batches at once (1-6, default 3). Statuses are pending/passed/rejected/review/failed; `set_status` overrides one book manually; `set_note` stores the librarian\'s own remark on one book without changing its verdict.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'import', 'sample', 'run', 'cancel', 'results', 'set_status', 'set_note', 'rules', 'history', 'load_history', 'delete_history', 'ask', 'reset'],
          description: 'status: session summary + books. import: load text/tsv/csv/json book list. sample: load the 12 demo records. run: screen books still pending, then retry failed ones. cancel: stop the running job. results: filtered verdict list. set_status: override one book. set_note: write the librarian\'s own note on one book. rules: rule documentation. history: list saved lists. load_history: restore one saved list. delete_history: drop one saved list. ask: question about the rules or the design. reset: clear the session.',
        },
        session_id: { type: 'string', description: 'Target list key. Defaults to the shared workbench list that the sidebar panel shows.' },
        text: { type: 'string', description: 'For import: pasted table text (TSV from Excel), CSV, or a JSON array of books.' },
        base64: { type: 'string', description: 'For import: base64 content of an .xlsx / .csv / .txt file.' },
        filename: { type: 'string', description: 'For import: original filename, used to pick the parser.' },
        status: { type: 'string', description: 'For results: all (default) | pending | passed | rejected | review | failed. For set_status: pending | passed | rejected | review | failed.' },
        query: { type: 'string', description: 'For results: substring filter over title/author/publisher/classification/reason/note.' },
        limit: { type: 'integer', description: 'For results: maximum rows to return (1-2000, default 500).' },
        batch_size: { type: 'integer', description: 'For run: books per model call (5-40, default 15).' },
        concurrency: { type: 'integer', description: 'For run: how many batches to screen at once (1-6, default 3).' },
        book_id: { type: 'string', description: 'For set_status / set_note: the book id from status/results.' },
        history_id: { type: 'string', description: 'For load_history / delete_history: the id from the history list.' },
        reason: { type: 'string', description: 'For set_status: optional evidence/reason to record.' },
        note: { type: 'string', description: 'For set_note: the remark to store on that book (empty string clears it).' },
        question: { type: 'string', description: 'For ask: the question about the rules or the design.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        description: 'Session summary, verdict list, rule documentation, or an answer.',
      },
      render(_args, value) {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        return [{ type: 'text', text: text.length > 20_000 ? `${text.slice(0, 20_000)}\n…(truncated)` : text }]
      },
    },
    async execute(args, exec) {
      const sessionId = String(args.session_id ?? '').trim() || 'workbench'
      const base = { sessionId }
      switch (args.action) {
        case 'status':
          return operations.state(base)
        case 'import':
          return operations.import({ ...base, text: args.text, base64: args.base64, filename: args.filename })
        case 'sample':
          return operations.sample(base)
        case 'run':
          return operations.run({ ...base, batchSize: args.batch_size, concurrency: args.concurrency })
        case 'cancel':
          return operations.cancel(base)
        case 'results':
          return operations.results({ ...base, status: args.status, query: args.query, limit: args.limit })
        case 'set_status':
          return operations.setStatus({ ...base, id: args.book_id, status: args.status, reason: args.reason })
        case 'set_note':
          return operations.setNote({ ...base, id: args.book_id, note: args.note })
        case 'rules':
          return operations.rules()
        case 'history':
          return operations.history(base)
        case 'load_history':
          return operations.loadHistory({ ...base, id: args.history_id })
        case 'delete_history':
          return operations.deleteHistory({ ...base, id: args.history_id })
        case 'ask':
          return operations.ask({ ...base, question: args.question })
        case 'reset':
          return operations.reset(base)
        default:
          throw new RequestError(400, 'unknown-action', `未知操作：${String(args.action)}`)
      }
    },
  }

  if (ctx.get('tools') !== undefined) {
    ctx.effect(() => ctx.tools.register(tool), 'book-select: book_select tool')
  }
}
