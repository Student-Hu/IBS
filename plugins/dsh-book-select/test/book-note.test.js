import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Point the history folder at a scratch directory before the plugin module
// captures it at import time.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'bs-note-'))

const { apply } = await import('../index.js')
const clientSource = await readFile(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

/**
 * Build a fake plugin context with just enough services for `apply()`.
 * @returns {{ctx: object, tools: object[]}} the context and the registered tools.
 */
function makeCtx() {
  const tools = []
  const ctx = {
    webServer: { register: () => {} },
    tools: { register: (tool) => tools.push(tool) },
    get: (name) => {
      if (name === 'webServer') return ctx.webServer
      if (name === 'tools') return ctx.tools
      if (name === 'connection') return { requestRejection: () => undefined }
      if (name === 'llm') return { stream: async function* stream() {} }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      return undefined
    },
    effect: (fn) => fn(),
    logger: { warn() {}, info() {}, error() {} },
  }
  apply(ctx)
  return { ctx, tools }
}

/** Let the queued history write land. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 60))
}

test('a note is stored on the book and read back with the summary', async () => {
  const { tools } = makeCtx()
  const tool = tools[0]
  const imported = await tool.execute({ action: 'sample' }, {})
  const book = imported.items[0]
  assert.equal(book.note, '')
  await tool.execute({ action: 'set_note', book_id: book.id, note: '作者方向对口，留着' }, {})
  const state = await tool.execute({ action: 'status' }, {})
  assert.equal(state.items.find((item) => item.id === book.id).note, '作者方向对口，留着')
})

test('writing a note leaves the verdict alone', async () => {
  const { tools } = makeCtx()
  const tool = tools[0]
  const imported = await tool.execute({ action: 'sample' }, {})
  const book = imported.items[0]
  await tool.execute({ action: 'set_status', book_id: book.id, status: 'passed' }, {})
  await tool.execute({ action: 'set_note', book_id: book.id, note: '馆配需要' }, {})
  const state = await tool.execute({ action: 'status' }, {})
  const item = state.items.find((entry) => entry.id === book.id)
  assert.equal(item.status, 'passed')
  assert.equal(item.source, 'manual')
  assert.equal(item.note, '馆配需要')
})

test('an empty note clears the remark', async () => {
  const { tools } = makeCtx()
  const tool = tools[0]
  const imported = await tool.execute({ action: 'sample' }, {})
  const book = imported.items[0]
  await tool.execute({ action: 'set_note', book_id: book.id, note: '先记着' }, {})
  await tool.execute({ action: 'set_note', book_id: book.id, note: '' }, {})
  const state = await tool.execute({ action: 'status' }, {})
  assert.equal(state.items.find((item) => item.id === book.id).note, '')
})

test('a note on an unknown book is refused', async () => {
  const { tools } = makeCtx()
  const tool = tools[0]
  await tool.execute({ action: 'sample' }, {})
  await assert.rejects(
    () => tool.execute({ action: 'set_note', book_id: 'nope', note: 'x' }, {}),
    /找不到编号为 nope 的图书/,
  )
})

test('the note rides along with the saved list', async () => {
  const { tools } = makeCtx()
  const tool = tools[0]
  const imported = await tool.execute({ action: 'sample' }, {})
  const book = imported.items[0]
  await tool.execute({ action: 'set_note', book_id: book.id, note: '留档批注' }, {})
  await settle()
  const state = await tool.execute({ action: 'status' }, {})
  const restored = await tool.execute({ action: 'load_history', history_id: state.historyId }, {})
  assert.equal(restored.items.find((item) => item.id === book.id).note, '留档批注')
})

test('the results filter finds a book by its note', async () => {
  const { tools } = makeCtx()
  const tool = tools[0]
  const imported = await tool.execute({ action: 'sample' }, {})
  const book = imported.items[0]
  await tool.execute({ action: 'set_note', book_id: book.id, note: '独家资源' }, {})
  const found = await tool.execute({ action: 'results', query: '独家资源' }, {})
  assert.equal(found.total, 1)
  assert.equal(found.items[0].id, book.id)
})

test('the view keeps a note column and sends the note to the host', () => {
  assert.ok(/colNote/.test(clientSource))
  assert.ok(/call\('setNote', \{ sessionId, id, note \}\)/.test(clientSource))
  assert.ok(/t\('colNote'\)/.test(clientSource))
})
