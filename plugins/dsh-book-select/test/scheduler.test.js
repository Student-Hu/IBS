import assert from 'node:assert/strict'
import test from 'node:test'

import { createCooldownGate, runPool, splitBatches } from '../lib/scheduler.js'

test('splitBatches cuts the books in order and keeps the short tail', () => {
  const books = [1, 2, 3, 4, 5, 6, 7]
  const batches = splitBatches(books, 3)
  assert.equal(batches.length, 3)
  assert.deepEqual(batches[0], [1, 2, 3])
  assert.deepEqual(batches[1], [4, 5, 6])
  assert.deepEqual(batches[2], [7])
})

test('runPool never exceeds the concurrency limit and runs every batch', async () => {
  const batches = splitBatches(Array.from({ length: 6 }, (_, i) => i), 1)
  let running = 0
  let peak = 0
  const seen = []
  const result = await runPool(batches, 2, async (batch) => {
    running++
    peak = Math.max(peak, running)
    seen.push(batch)
    await new Promise((resolve) => setTimeout(resolve, 20))
    running--
  })
  assert.equal(peak, 2)
  assert.equal(seen.length, 6)
  assert.equal(result.aborted, false)
})

test('runPool stops dispatching new batches once the signal aborts', async () => {
  const controller = new AbortController()
  const batches = splitBatches(Array.from({ length: 6 }, (_, i) => i), 1)
  let processed = 0
  const result = await runPool(batches, 1, async () => {
    processed++
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }, { signal: controller.signal })
  assert.equal(result.aborted, true)
  assert.ok(processed < batches.length)
})

test('runPool reports a failing batch and keeps going', async () => {
  const batches = splitBatches([1, 2, 3], 1)
  const failures = []
  const seen = []
  await runPool(batches, 2, async (batch) => {
    seen.push(batch)
    if (batch[0] === 2) throw new Error('boom')
  }, { onError: (error, batch) => failures.push([error.message, batch[0]]) })
  assert.equal(seen.length, 3)
  assert.deepEqual(failures, [['boom', 2]])
})

test('createCooldownGate holds workers until the gate opens', async () => {
  const gate = createCooldownGate()
  const started = Date.now()
  await gate.wait()
  assert.ok(Date.now() - started < 20)

  gate.block(40)
  const blocked = Date.now()
  await gate.wait()
  assert.ok(Date.now() - blocked >= 30)
})

test('createCooldownGate wait returns at once when the signal is already aborted', async () => {
  const gate = createCooldownGate()
  gate.block(5_000)
  const controller = new AbortController()
  controller.abort()
  const started = Date.now()
  await gate.wait(controller.signal)
  assert.ok(Date.now() - started < 20)
})
