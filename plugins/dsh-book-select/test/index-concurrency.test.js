import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Point the history folder at a scratch directory before the plugin module
// captures it at import time.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'bs-concurrency-'))

const { apply } = await import('../index.js')

/**
 * Build a fake plugin context with just enough services for `apply()`.
 * @param {(options: object) => AsyncIterable<object>} stream - the fake model stream.
 * @returns {{ctx: object, tools: object[]}} the context and the registered tools.
 */
function makeCtx(stream) {
  const tools = []
  const ctx = {
    webServer: { register: () => {} },
    tools: { register: (tool) => tools.push(tool) },
    get: (name) => {
      if (name === 'webServer') return ctx.webServer
      if (name === 'tools') return ctx.tools
      if (name === 'connection') return { requestRejection: () => undefined }
      if (name === 'llm') return { stream }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      return undefined
    },
    effect: (fn) => fn(),
    logger: { warn() {}, info() {}, error() {} },
  }
  apply(ctx)
  return { ctx, tools }
}

/**
 * A model that judges every book it is asked about, and records how many calls
 * were in flight at the same time.
 * @returns {{stream: Function, peak: () => number, calls: () => number}} the fake model.
 */
function countingModel() {
  let running = 0
  let peak = 0
  let calls = 0
  const stream = async function* stream(options) {
    calls++
    running++
    peak = Math.max(peak, running)
    try {
      const prompt = options.messages[0].content[0].text
      const start = prompt.indexOf('[')
      const end = prompt.lastIndexOf(']')
      const books = JSON.parse(prompt.slice(start, end + 1))
      await new Promise((resolve) => setTimeout(resolve, 30))
      yield {
        type: 'text-delta',
        index: 0,
        text: JSON.stringify({
          passed: books.map((book) => ({ 序号: book.序号, 题名: book.书名, 通过理由: 'ok' })),
          rejected: [],
          review: [],
        }),
      }
    } finally {
      running--
    }
  }
  return { stream, peak: () => peak, calls: () => calls }
}

/**
 * Sleep like the real adapter does: an aborted signal rejects the call.
 * @param {number} ms - how long to sleep.
 * @param {AbortSignal} [signal] - aborts the call.
 * @returns {Promise<void>} resolves when the time is up.
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }, { once: true })
  })
}

/** Run the tool until the background job is done. */
async function runToCompletion(tool, args) {
  let summary = await tool.execute({ action: 'run', ...args }, {})
  for (let i = 0; i < 200 && summary.job?.running === true; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    summary = await tool.execute({ action: 'status' }, {})
  }
  return summary
}

test('the run defaults to three batches at a time', async () => {
  const model = countingModel()
  const { tools } = makeCtx(model.stream)
  const tool = tools[0]
  await tool.execute({ action: 'sample' }, {})
  const summary = await runToCompletion(tool, { batch_size: 5 })
  assert.equal(summary.job.concurrency, 3)
  assert.equal(summary.options.concurrency, 3)
  assert.equal(summary.job.running, false)
})

test('concurrency two really runs two model calls at the same time', async () => {
  const model = countingModel()
  const { tools } = makeCtx(model.stream)
  const tool = tools[0]
  await tool.execute({ action: 'sample' }, {})
  const summary = await runToCompletion(tool, { batch_size: 5, concurrency: 2 })
  assert.equal(summary.job.concurrency, 2)
  assert.equal(model.peak(), 2)
  assert.equal(summary.counts.pending, 0)
  // Every judged book has exactly one verdict.
  const verdicts = summary.items.filter((item) => item.status !== 'pending' && item.status !== 'failed')
  const numbers = verdicts.map((item) => item.no)
  assert.equal(new Set(numbers).size, numbers.length)
})

test('concurrency one behaves like the old sequential run', async () => {
  const model = countingModel()
  const { tools } = makeCtx(model.stream)
  const tool = tools[0]
  await tool.execute({ action: 'sample' }, {})
  const summary = await runToCompletion(tool, { batch_size: 5, concurrency: 1 })
  assert.equal(summary.job.concurrency, 1)
  assert.equal(model.peak(), 1)
  assert.equal(summary.counts.pending, 0)
})

test('cancelling mid-run leaves the in-flight books pending, not failed', async () => {
  let running = 0
  const stream = async function* stream(options) {
    running++
    try {
      const prompt = options.messages[0].content[0].text
      const start = prompt.indexOf('[')
      const end = prompt.lastIndexOf(']')
      const books = JSON.parse(prompt.slice(start, end + 1))
      await sleep(300, options.signal)
      yield {
        type: 'text-delta',
        index: 0,
        text: JSON.stringify({
          passed: books.map((book) => ({ 序号: book.序号, 题名: book.书名, 通过理由: 'ok' })),
          rejected: [],
          review: [],
        }),
      }
    } finally {
      running--
    }
  }
  const { tools } = makeCtx(stream)
  const tool = tools[0]
  await tool.execute({ action: 'sample' }, {})
  await tool.execute({ action: 'run', batch_size: 5, concurrency: 3 }, {})
  await new Promise((resolve) => setTimeout(resolve, 60))
  await tool.execute({ action: 'cancel' }, {})
  let summary = await tool.execute({ action: 'status' }, {})
  for (let i = 0; i < 200 && summary.job?.running === true; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    summary = await tool.execute({ action: 'status' }, {})
  }
  assert.equal(summary.job.running, false)
  assert.equal(summary.job.cancelled, true)
  // Nothing may be parked in the failed bucket because the user stopped it.
  assert.equal(summary.counts.failed, 0)
  assert.ok(summary.counts.pending > 0)
})
