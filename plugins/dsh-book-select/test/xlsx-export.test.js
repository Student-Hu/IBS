import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { readXlsx } from '../lib/parse.js'
import { buildWorkbookParts, buildXlsx, columnName, crc32, escapeXml, safeSheetName } from '../lib/xlsx.js'

// Keep the history folder out of the real profile before the plugin captures it.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'bs-xlsx-'))
const { apply } = await import('../index.js')

const hostSource = await readFile(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8')
const clientSource = await readFile(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

const TABLE = {
  sheetName: '选书结果',
  header: ['序号', '书名', '价格', '判定'],
  rows: [
    ['1', '甲书 & <丙>', 39.8, '通过'],
    ['2', '乙书', '', '排除：规则二-1'],
  ],
}

test('column letters follow the spreadsheet convention', () => {
  assert.equal(columnName(1), 'A')
  assert.equal(columnName(26), 'Z')
  assert.equal(columnName(27), 'AA')
  assert.equal(columnName(52), 'AZ')
  assert.equal(columnName(53), 'BA')
})

test('xml text is escaped and control characters dropped', () => {
  assert.equal(escapeXml('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;')
  assert.equal(escapeXml('keep\ttab\nnewline'), 'keep\ttab\nnewline')
  assert.equal(escapeXml(`drop${String.fromCharCode(0)}null`), 'dropnull')
})

test('sheet names stay inside what excel accepts', () => {
  assert.equal(safeSheetName('选书结果'), '选书结果')
  assert.equal(safeSheetName('a/b:c*d?e[f]g'), 'a b c d e f g')
  assert.equal(safeSheetName(''), 'Sheet1')
  assert.equal(safeSheetName('x'.repeat(40)).length, 31)
})

test('the workbook holds the header, the rows and the excel parts', () => {
  const { parts } = buildWorkbookParts(TABLE)
  assert.deepEqual(
    parts.map((part) => part.name),
    [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ],
  )
  const sheet = parts.find((part) => part.name === 'xl/worksheets/sheet1.xml').text
  assert.ok(sheet.includes('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">序号</t></is></c>'))
  assert.ok(sheet.includes('<c r="C2"><v>39.8</v></c>'), '数字应写成数值单元格')
  assert.ok(sheet.includes('甲书 &amp; &lt;丙&gt;'), '文本应转义')
  assert.ok(sheet.includes('state="frozen"'), '首行应冻结')
  assert.ok(sheet.includes('<autoFilter ref="A1:D3"/>'))
})

test('the file is a real xlsx: the reader in this package reads it back', () => {
  const bytes = buildXlsx(TABLE)
  assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK')
  const rows = readXlsx(bytes)
  assert.deepEqual(rows, [
    ['序号', '书名', '价格', '判定'],
    ['1', '甲书 & <丙>', '39.8', '通过'],
    ['2', '乙书', '', '排除：规则二-1'],
  ])
})

test('the archive directory lists every part', () => {
  const bytes = buildXlsx(TABLE)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index
      break
    }
  }
  assert.ok(eocd >= 0, '找不到 ZIP 目录结尾')
  assert.equal(view.getUint16(eocd + 10, true), 6, '目录里应有 6 个条目')
  assert.equal(view.getUint32(eocd + 12, true) + view.getUint32(eocd + 16, true) + 22, bytes.length)
})

test('the crc of a known buffer matches the zip polynomial', () => {
  assert.equal(crc32(Buffer.from('123456789', 'utf8')), 0xcbf43926)
})

test('the host half packs the table into a workbook', () => {
  assert.ok(/import \{ buildXlsx \} from '\.\/lib\/xlsx\.js'/.test(hostSource))
  assert.ok(/exportXlsx: \(payload\) => doExportXlsx\(payload\)/.test(hostSource))
  assert.ok(/base64: bytes\.toString\('base64'\)/.test(hostSource))
})

test('the browser half asks the host and downloads the bytes', () => {
  assert.ok(/call\('exportXlsx', \{ sessionId, sheetName: t\('exportSheet'\)/.test(clientSource))
  assert.ok(/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/.test(clientSource))
  assert.ok(/t\('exportXlsx'\)/.test(clientSource))
  assert.ok(/exportXlsx: '导出 Excel'/.test(clientSource))
  assert.ok(/exportXlsx: 'Export Excel'/.test(clientSource))
})

/**
 * Mount the plugin against a fake host and keep the route handler.
 * @returns {Function} the request handler of `/book-select/api`.
 */
function mountPlugin() {
  let handler = null
  const ctx = {
    webServer: { register: (route) => { handler = route.handler } },
    tools: { register: () => {} },
    get: (name) => {
      if (name === 'webServer') return ctx.webServer
      if (name === 'tools') return ctx.tools
      if (name === 'connection') return { requestRejection: () => undefined }
      if (name === 'llm') return { stream: async function* () {} }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      return undefined
    },
    effect: (fn) => fn(),
    logger: { warn() {}, info() {}, error() {} },
  }
  apply(ctx)
  return handler
}

/**
 * A request the JSON route can read.
 * @param {string} url - the request path.
 * @param {object} body - the JSON body.
 * @returns {object} the fake request.
 */
function fakeRequest(url, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return {
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield payload
    },
  }
}

/**
 * A response the JSON route can write.
 * @returns {object} the fake response.
 */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
      this.headersSent = true
    },
    end(payload) {
      this.body = payload === undefined ? '' : Buffer.from(payload).toString('utf8')
    },
    destroy() {},
  }
}

test('the export route answers with a workbook the reader can open', async () => {
  const handler = mountPlugin()
  const res = fakeResponse()
  await handler(fakeRequest('/book-select/api/exportXlsx', {
    sheetName: '选书结果',
    filename: 'book-selection.xlsx',
    header: ['序号', '书名', '判定'],
    rows: [['1', '甲书', '通过'], ['2', '乙书', '排除']],
  }), res)
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.value.filename, 'book-selection.xlsx')
  const bytes = Buffer.from(body.value.base64, 'base64')
  assert.deepEqual(readXlsx(bytes), [
    ['序号', '书名', '判定'],
    ['1', '甲书', '通过'],
    ['2', '乙书', '排除'],
  ])
})

test('the export route refuses an empty table', async () => {
  const handler = mountPlugin()
  const res = fakeResponse()
  await handler(fakeRequest('/book-select/api/exportXlsx', { header: [], rows: [] }), res)
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'empty-table')
})
