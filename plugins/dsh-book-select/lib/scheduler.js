/**
 * Batch scheduling for the screening run: cut books into batches, run a
 * bounded number of them at once, and hold every worker back while the
 * provider is refusing requests.
 *
 * Pure logic only — no plugin services, no model calls.
 */

/**
 * Cut books into consecutive batches.
 * @param {object[]} books - the books to split, in order.
 * @param {number} size - the maximum batch size.
 * @returns {object[][]} the batches, the last one possibly shorter.
 */
export function splitBatches(books, size) {
  const step = Math.max(1, Math.floor(Number(size) || 1))
  const batches = []
  for (let offset = 0; offset < books.length; offset += step) {
    batches.push(books.slice(offset, offset + step))
  }
  return batches
}

/**
 * A shared cooldown gate.
 *
 * When one worker is rate limited it closes the gate for everyone, so the
 * other workers stop asking the provider for a while instead of piling on.
 * @returns {{block: (ms: number) => void, wait: (signal?: AbortSignal) => Promise<void>}} the gate.
 */
export function createCooldownGate() {
  let openAt = 0
  return {
    /**
     * Close the gate for at least `ms` milliseconds.
     * @param {number} ms - how long to hold workers back.
     * @returns {void}
     */
    block(ms) {
      const delay = Number(ms)
      if (!Number.isFinite(delay) || delay <= 0) return
      openAt = Math.max(openAt, Date.now() + delay)
    },
    /**
     * Wait until the gate opens.
     * @param {AbortSignal} [signal] - aborts the wait immediately.
     * @returns {Promise<void>} resolves when the gate is open.
     */
    async wait(signal) {
      while (true) {
        if (signal?.aborted) return
        const remaining = openAt - Date.now()
        if (remaining <= 0) return
        await sleep(remaining, signal)
      }
    },
  }
}

/**
 * Run batches with a bounded number of workers.
 *
 * One shared cursor hands out batches, so a fast worker picks up the next
 * batch instead of idling next to a slow one. A failing batch is reported to
 * `onError` and the pool keeps going.
 * @param {object[][]} batches - the batches to run.
 * @param {number} concurrency - how many batches may run at once.
 * @param {(batch: object[], index: number) => Promise<void>} worker - the per-batch job.
 * @param {{signal?: AbortSignal, beforeBatch?: (batch: object[], index: number) => Promise<void>, onError?: (error: unknown, batch: object[], index: number) => void}} [options] - cancellation, pre-batch hook, error sink.
 * @returns {Promise<{aborted: boolean}>} whether the run was cut short.
 */
export async function runPool(batches, concurrency, worker, options = {}) {
  const list = Array.isArray(batches) ? batches : []
  let cursor = 0
  let aborted = false
  const limit = Math.max(1, Math.min(Math.floor(Number(concurrency) || 1), list.length))

  const runner = async () => {
    while (true) {
      if (options.signal?.aborted) {
        aborted = true
        return
      }
      const index = cursor++
      if (index >= list.length) return
      const batch = list[index]
      if (options.beforeBatch !== undefined) await options.beforeBatch(batch, index)
      if (options.signal?.aborted) {
        aborted = true
        return
      }
      try {
        await worker(batch, index)
      } catch (error) {
        options.onError?.(error, batch, index)
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runner()))
  return { aborted }
}

/**
 * Sleep, waking early when the signal aborts.
 * @param {number} ms - how long to sleep.
 * @param {AbortSignal} [signal] - aborts the sleep.
 * @returns {Promise<void>} resolves when the time is up or the signal aborts.
 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
