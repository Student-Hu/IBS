import assert from 'node:assert/strict'
import test from 'node:test'

import { backoffDelay, completeText, isRateLimit, screenBatch } from '../lib/screening.js'

/**
 * A fake plugin context: `llm.stream` is the only service the screening path
 * touches besides the default-model selection.
 * @param {(options: object) => AsyncIterable<object>} stream - the fake stream.
 * @returns {object} a context the screening code accepts.
 */
function fakeCtx(stream) {
  return {
    get: (name) => (name === 'llm'
      ? { stream }
      : name === 'agentDefaultModel'
        ? { currentSelection: () => ({ provider: 'p', model: 'm' }) }
        : undefined),
  }
}

/** One rate-limit failure chunk, the shape `llm.stream` ends a failed call with. */
function rateLimitChunk(retryAfterMs) {
  return {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: { message: 'rate limited', code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: retryAfterMs },
    },
  }
}

/** One successful text chunk carrying the screening contract. */
function verdictChunk(entries) {
  return {
    type: 'text-delta',
    index: 0,
    text: JSON.stringify({ passed: entries, rejected: [], review: [] }),
  }
}

/** Two books, enough for a batch that must survive a retry intact. */
const BOOKS = [
  { no: '1', title: '甲书', price: 30, publisher: 'P', cls: 'I21', year: 2020, author: 'A', edition: '', pages: '200页', summary: 's' },
  { no: '2', title: '乙书', price: 40, publisher: 'Q', cls: 'B', year: 2021, author: 'B', edition: '', pages: '300页', summary: 's' },
]

test('completeText attaches the failure code and retry hint to the thrown error', async () => {
  const ctx = fakeCtx(async function* stream() {
    yield rateLimitChunk(1234)
  })
  await assert.rejects(
    () => completeText(ctx, { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    (error) => {
      assert.equal(error.llmCode, 'RATE_LIMIT')
      assert.equal(error.retryAfterMs, 1234)
      assert.match(error.message, /模型调用失败/)
      return true
    },
  )
})

test('screenBatch retries the same batch after a rate limit instead of splitting it', async () => {
  const seen = []
  let calls = 0
  const ctx = fakeCtx(async function* stream(options) {
    calls++
    seen.push(options.messages[0].content[0].text)
    if (calls === 1) {
      yield rateLimitChunk(1)
      return
    }
    yield verdictChunk([
      { 序号: '1', 题名: '甲书', 通过理由: '好' },
      { 序号: '2', 题名: '乙书', 通过理由: '好' },
    ])
  })
  const blocked = []
  const gate = { block: (ms) => blocked.push(ms), wait: async () => {} }
  const outcome = await screenBatch(ctx, BOOKS, { gate })
  assert.equal(calls, 2)
  assert.equal(seen.length, 2)
  for (const text of seen) {
    assert.match(text, /甲书/)
    assert.match(text, /乙书/)
  }
  assert.equal(outcome.passed.length, 2)
  assert.deepEqual(blocked, [1])
})

test('screenBatch gives up after three rate-limit retries and rethrows', async () => {
  let calls = 0
  const ctx = fakeCtx(async function* stream() {
    calls++
    yield rateLimitChunk(1)
  })
  const gate = { block: () => {}, wait: async () => {} }
  await assert.rejects(
    () => screenBatch(ctx, BOOKS, { gate }),
    (error) => {
      assert.equal(error.llmCode, 'RATE_LIMIT')
      return true
    },
  )
  assert.equal(calls, 4)
})

test('backoffDelay doubles from two seconds and prefers the provider hint', () => {
  assert.equal(backoffDelay(0, undefined, () => 0), 2000)
  assert.equal(backoffDelay(1, undefined, () => 0), 4000)
  assert.equal(backoffDelay(2, undefined, () => 0), 8000)
  assert.equal(backoffDelay(0, 1500), 1500)
})

test('isRateLimit only accepts the stable RATE_LIMIT code', () => {
  assert.equal(isRateLimit({ llmCode: 'RATE_LIMIT' }), true)
  assert.equal(isRateLimit({ llmCode: 'AUTH' }), false)
  assert.equal(isRateLimit(new Error('boom')), false)
})
