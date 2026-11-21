import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Point the history folder at a scratch directory before the plugin module
// captures it at import time.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'bs-progress-'))

const { apply } = await import('../index.js')
const { screenBatch } = await import('../lib/screening.js')

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
 * A model that passes every book it is asked about and reports what the call
 * cost.
 * @returns {Function} the fake stream.
 */
function usageModel() {
  return async function* stream(options) {
    const prompt = options.messages[0].content[0].text
    const start = prompt.indexOf('[')
    const end = prompt.lastIndexOf(']')
    const books = JSON.parse(prompt.slice(start, end + 1))
    await new Promise((resolve) => setTimeout(resolve, 10))
    yield {
      type: 'text-delta',
      index: 0,
      text: JSON.stringify({
        passed: books.map((book) => ({ 序号: book.序号, 题名: book.书名, 通过理由: 'ok' })),
        rejected: [],
        review: [],
      }),
    }
    yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
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

test('the screening call reports its stages and its token usage', async () => {
  const ctx = {
    get: (name) => {
      if (name === 'llm') return { stream: usageModel() }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      return undefined
    },
  }
  const stages = []
  const usages = []
  const books = [
    { no: '1', title: '甲书', price: 10, publisher: 'p', cls: 'A', year: 2020, author: 'a', edition: '', pages: '100页', summary: 's' },
    { no: '2', title: '乙书', price: 10, publisher: 'p', cls: 'A', year: 2020, author: 'a', edition: '', pages: '100页', summary: 's' },
  ]
  const outcome = await screenBatch(ctx, books, {
    onStage: (stage) => stages.push(stage),
    onUsage: (usage) => usages.push(usage),
  })
  assert.equal(outcome.passed.length, 2)
  assert.deepEqual(stages, ['calling', 'parsing'])
  assert.equal(usages.length, 1)
  assert.equal(usages[0].inputTokens, 120)
  assert.equal(usages[0].outputTokens, 30)
})

test('every batch leaves a record of what it did', async () => {
  const { tools } = makeCtx(usageModel())
  const tool = tools[0]
  await tool.execute({ action: 'sample' }, {})
  const summary = await runToCompletion(tool, { batch_size: 5, concurrency: 2 })
  const log = summary.job.batchLog
  assert.ok(Array.isArray(log))
  assert.equal(log.length, 2)
  assert.deepEqual(log.map((entry) => entry.no), [1, 2])
  for (const entry of log) {
    assert.equal(entry.status, 'done')
    assert.equal(entry.stage, 'applying')
    assert.equal(entry.phase, 'pending')
    assert.equal(entry.bookCount, 5)
    assert.equal(entry.titles.length, 2)
    assert.ok(entry.elapsedMs >= 0)
    assert.ok(entry.endedAt !== null)
    assert.equal(entry.counts.passed, 5)
    assert.equal(entry.counts.rejected, 0)
    assert.equal(entry.counts.review, 0)
    assert.equal(entry.error, null)
  }
})

test('the run adds the token usage of every batch up', async () => {
  const { tools } = makeCtx(usageModel())
  const tool = tools[0]
  await tool.execute({ action: 'sample' }, {})
  const summary = await runToCompletion(tool, { batch_size: 5, concurrency: 2 })
  const log = summary.job.batchLog
  const sum = log.reduce((total, entry) => total + Number(entry.usage?.inputTokens ?? 0), 0)
  assert.equal(summary.job.usage.inputTokens, sum)
  assert.equal(summary.job.usage.outputTokens, sum * (30 / 120))
  assert.equal(summary.job.usage.totalTokens, sum * (150 / 120))
})

test('the batch report travels into the history archive', async () => {
  const { tools } = makeCtx(usageModel())
  const tool = tools[0]
  await tool.execute({ action: 'sample' }, {})
  const summary = await runToCompletion(tool, { batch_size: 5, concurrency: 2 })
  const history = await tool.execute({ action: 'history' }, {})
  const entry = history.entries.find((item) => item.id === summary.historyId)
  assert.ok(entry !== undefined)
  assert.equal(entry.job.running, false)
  assert.equal(entry.job.batchLog.length, 2)
})
