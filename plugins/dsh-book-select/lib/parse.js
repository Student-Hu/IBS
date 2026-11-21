/**
 * Import normalisation for the book-selection workbench.
 *
 * The source workflow read an `.xlsx` with n8n's "Extract from File" node. This
 * plugin has no dependency budget, so `.xlsx` is read with a minimal ZIP/XML
 * reader on top of `node:zlib`, and a pasted table (TSV from Excel, CSV, or a
 * JSON array) goes through the same header mapping.
 *
 * Every book is normalised to the workflow's field names so the rule text and
 * the model prompt stay readable:
 * `{ id, no, title, price, publisher, isbn, author, year, cls, summary, edition, pages }`.
 */

import { inflateRawSync } from 'node:zlib'
import { prefilterBooks } from './rules.js'

/** Header aliases, matched after {@link normalizeHeader}. */
const HEADER_ALIASES = {
  no: ['序号', '订号', '编号', '序号no', 'no', 'serialno', 'serial'],
  title: ['书名', '题名', '图书名称', '图书题名', '书名题名', 'title'],
  price: ['价格', '定价', '单价', '价格元', '定价元', 'price'],
  publisher: ['出版社', '出版者', '出版单位', '出版机构', 'publisher'],
  isbn: ['isbn', 'isbn号', '国际标准书号', '书号'],
  author: ['责任者', '作者', '著者', '编著者', 'author'],
  year: ['出版年', '出版年份', '出版日期', '年份', 'publicationyear', 'year'],
  cls: ['分类号', '中图分类号', '中图法分类号', '类别', '分类', 'classification', 'classificationno', 'clc'],
  summary: ['内容简介', '简介', '内容提要', '摘要', '内容介绍', 'summary', 'description', 'abstract'],
  edition: ['版次', '版本', '版别', 'edition'],
  pages: ['页码', '页数', 'pagination', 'pages'],
}

/** Field order used when the pasted table has no recognisable header. */
const POSITIONAL_FIELDS = ['no', 'title', 'price', 'publisher', 'isbn', 'author', 'year', 'cls', 'summary', 'edition', 'pages']

/** Chinese label of each normalised field, also used for header-less tables. */
const FIELD_LABELS = {
  no: '序号',
  title: '书名',
  price: '价格',
  publisher: '出版社',
  isbn: 'ISBN',
  author: '责任者',
  year: '出版年',
  cls: '分类号',
  summary: '内容简介',
  edition: '版次',
  pages: '页码',
}

/**
 * Fold a raw header cell for alias matching: BOM/whitespace/full-width spaces
 * removed. A trailing `(元)`/`（元）` is dropped so `定价（元）` still matches.
 */
function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（(]元[）)]$/, '')
    .replace(/[:：*]/g, '')
    .toLowerCase()
}

/** Columns that must not be guessed by the "contains" alias pass. */
const IGNORED_HEADERS = new Set([
  '丛书题名', '丛书名', '丛书', '第二责任者', '其他责任者', '译者', '版本说明', '版次说明', '分册名',
])

/**
 * Map one header row to field names.
 * @param {string[]} cells - the raw header row.
 * @returns {(string|null)[]} one field name (or null) per column.
 */
function mapHeader(cells) {
  return cells.map((cell) => {
    const header = normalizeHeader(cell)
    if (header === '') return null
    if (IGNORED_HEADERS.has(header)) return null
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((alias) => normalizeHeader(alias) === header)) return field
    }
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((alias) => normalizeHeader(alias).length > 1 && header.includes(normalizeHeader(alias)))) {
        return field
      }
    }
    return null
  })
}

/** Guess the delimiter of a pasted table from its first line. */
function guessDelimiter(line) {
  const tabs = (line.match(/\t/g) || []).length
  const commas = (line.match(/,/g) || []).length
  const semicolons = (line.match(/;/g) || []).length
  if (tabs > 0 && tabs >= commas) return '\t'
  if (commaLine(line) > semicolons) return ','
  if (semicolons > 0) return ';'
  return tabs > 0 ? '\t' : ','
}

/** Commas outside quotes — cheap relevance signal for the delimiter guess. */
function commaLine(line) {
  let count = 0
  let quoted = false
  for (const char of line) {
    if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) count++
  }
  return count
}

/**
 * Split delimited text into rows, honouring double-quoted cells (a `""` inside
 * a quoted cell is an escaped quote) and both CRLF/LF line endings.
 * @param {string} text - table text.
 * @param {string} delimiter - one-character separator.
 * @returns {string[][]} cells per row.
 */
function splitRows(text, delimiter) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\r') {
      if (text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cell)
  rows.push(row)
  return rows.filter((cells) => cells.some((value) => String(value).trim() !== ''))
}

/** Decode the XML entities OOXML writes into cell text. */
function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Concatenate every `<t>` run of one shared-string entry, skipping phonetics. */
function collectText(xml) {
  let text = ''
  const cleaned = String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g
  let match
  while ((match = re.exec(cleaned)) !== null) text += decodeXml(match[1])
  return text
}

/** `A` → 0, `AB` → 27: the zero-based column index of an A1-style reference. */
function columnIndex(letters) {
  let index = 0
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64)
  return index - 1
}

/**
 * Read an XLSX byte buffer into a matrix of strings.
 *
 * Only the parts that carry values are parsed: the central directory, the first
 * worksheet, `sharedStrings.xml`, and `xl/workbook.xml` (to pick the first
 * sheet). Formatting, styles, dates-as-numbers or merged cells beyond the
 * anchor are not interpreted — the acquisition list only needs the text values.
 * @param {Uint8Array} bytes - the `.xlsx` file content.
 * @returns {string[][]} rows of cell text.
 */
export function readXlsx(bytes) {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength)
  const decoder = new TextDecoder()

  let eocd = -1
  for (let i = uint8.length - 22; i >= 0 && i > uint8.length - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件（未找到 ZIP 目录结尾）。请另存为 .xlsx，或直接粘贴表格文本。')

  const total = view.getUint16(eocd + 10, true)
  const directoryOffset = view.getUint32(eocd + 16, true)
  const entries = new Map()
  let cursor = directoryOffset
  for (let i = 0; i < total; i++) {
    if (cursor + 46 > uint8.length || view.getUint32(cursor, true) !== 0x02014b50) break
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(uint8.subarray(cursor + 46, cursor + 46 + nameLength))
    entries.set(name, { method, compressedSize, localOffset })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  const readEntry = (name) => {
    const entry = entries.get(name)
    if (entry === undefined) return null
    const local = entry.localOffset
    if (view.getUint32(local, true) !== 0x04034b50) return null
    const nameLength = view.getUint16(local + 26, true)
    const extraLength = view.getUint16(local + 28, true)
    const start = local + 30 + nameLength + extraLength
    const payload = uint8.subarray(start, start + entry.compressedSize)
    if (entry.method === 0) return payload
    if (entry.method === 8) return new Uint8Array(inflateRawSync(payload))
    throw new Error('xlsx 内部条目使用了不支持的压缩方式（仅支持 store/deflate）。')
  }

  let sheetPath = 'xl/worksheets/sheet1.xml'
  const workbook = readEntry('xl/workbook.xml')
  if (workbook !== null) {
    const xml = decoder.decode(workbook)
    const sheetName = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(xml)?.[1]
    if (sheetName !== undefined) {
      const rels = readEntry('xl/_rels/workbook.xml.rels')
      if (rels !== null) {
        const relXml = decoder.decode(rels)
        const target = new RegExp(`<Relationship\\b[^>]*\\bId="${sheetName}"[^>]*\\bTarget="([^"]+)"`).exec(relXml)?.[1]
        if (target !== undefined) {
          sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
        }
      }
    }
  }

  const sheet = readEntry(sheetPath) ?? readEntry('xl/worksheets/sheet1.xml')
  if (sheet === null) throw new Error('xlsx 中找不到工作表数据。')

  let shared = []
  const sharedEntry = readEntry('xl/sharedStrings.xml')
  if (sharedEntry !== null) {
    const xml = decoder.decode(sharedEntry)
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g
    let match
    while ((match = re.exec(xml)) !== null) shared.push(collectText(match[1]))
  }

  const sheetXml = decoder.decode(sheet)
  const rows = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch
  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    const cells = []
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g
    let cellMatch
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const attributes = cellMatch[1] ?? cellMatch[2] ?? ''
      const inner = cellMatch[3] ?? ''
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1]
      const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1]
      let value = ''
      if (type === 'inlineStr') {
        value = collectText(inner)
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        if (raw !== undefined) value = type === 's' ? (shared[Number(raw)] ?? '') : decodeXml(raw)
      }
      const index = reference === undefined ? cells.length : columnIndex(reference)
      cells[index] = value
    }
    if (cells.some((value) => value !== undefined && String(value).trim() !== '')) rows.push(Array.from(cells, (value) => value ?? ''))
  }
  return rows
}

/** `¥1,280.00元` → 1280, `测` → 0. */
function parsePrice(value) {
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '')
  const price = Number.parseFloat(cleaned)
  return Number.isFinite(price) ? price : 0
}

/** Parse the publication year out of `2023`, `2023年`, or `2023-05`. */
function parseYear(value) {
  const match = /\d{4}/.exec(String(value ?? ''))
  return match === null ? 0 : Number.parseInt(match[0], 10)
}

/**
 * Build one normalised book from a row and its column mapping.
 * @param {string[]} cells - the raw row.
 * @param {(string|null)[]} mapping - field name per column.
 * @param {number} index - zero-based row index, used for the fallback book id.
 * @returns {object} the normalised book.
 */
function buildBook(cells, mapping, index) {
  const raw = {}
  mapping.forEach((field, column) => {
    if (field === null) return
    const value = cells[column]
    if (value !== undefined && raw[field] === undefined) raw[field] = value
  })
  const no = String(raw.no ?? '').trim() || String(index + 1)
  return {
    id: `b${index + 1}`,
    no,
    title: String(raw.title ?? '').trim(),
    price: parsePrice(raw.price),
    publisher: String(raw.publisher ?? '').trim(),
    isbn: String(raw.isbn ?? '').trim(),
    author: String(raw.author ?? '').trim(),
    year: parseYear(raw.year),
    cls: String(raw.cls ?? '').trim(),
    summary: String(raw.summary ?? '').trim(),
    edition: String(raw.edition ?? '').trim(),
    pages: String(raw.pages ?? '').trim(),
    status: 'pending',
    reason: '',
    source: '',
    batch: null,
  }
}

/**
 * Normalise a matrix into books, deciding header vs positional layout from how
 * many cells the first row maps onto known fields (≥ 3 mapping columns means a
 * header row). Rows without a title are dropped and reported as `skipped`.
 * @param {string[][]} rows - raw table.
 * @returns {{books: object[], headers: string[], mapping: (string|null)[], skipped: number, fields: string[]}}
 */
export function rowsToBooks(rows) {
  if (rows.length === 0) return { books: [], headers: [], columns: [], mapping: [], skipped: 0, fields: [] }
  const first = rows[0]
  const headerMapping = mapHeader(first)
  const mappedCount = headerMapping.filter((field) => field !== null).length
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const hasHeader = mappedCount >= 3
  const mapping = hasHeader
    ? Array.from({ length: width }, (_, column) => headerMapping[column] ?? null)
    : POSITIONAL_FIELDS.slice(0, width)
  const headers = hasHeader ? first.map((cell) => String(cell).trim()) : []
  // Column labels are kept for the export, so the file comes back with every
  // column it arrived with — not only the eleven the rules look at.
  const columns = hasHeader
    ? Array.from({ length: width }, (_, column) => headers[column] || `列${column + 1}`)
    : mapping.map((field) => FIELD_LABELS[field] ?? String(field))
  const dataRows = hasHeader ? rows.slice(1) : rows
  const books = []
  let skipped = 0
  for (const row of dataRows) {
    const book = buildBook(row, mapping, books.length)
    if (book.title === '') {
      skipped++
      continue
    }
    // The untouched source cells, aligned with `columns`, for a lossless export.
    book.cells = columns.map((_, column) => String(row[column] ?? '').trim())
    books.push(book)
  }
  return {
    books,
    headers,
    columns,
    mapping,
    skipped,
    fields: mapping.filter((field) => field !== null),
  }
}

/**
 * Parse pasted table text (TSV/CSV/JSON array).
 * @param {string} text - the pasted content.
 * @returns {{books: object[], headers: string[], mapping: (string|null)[], skipped: number, fields: string[], note: string}}
 */
export function parseTableText(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '')
  if (clean.trim() === '') throw new Error('没有可解析的内容：请粘贴表格，或选择文件。')
  if (/^\s*[[{]/.test(clean)) {
    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      throw new Error('看起来是 JSON，但解析失败。请检查引号与逗号。')
    }
    if (!Array.isArray(parsed)) throw new Error('JSON 输入需要是书籍对象的数组。')
    const columns = POSITIONAL_FIELDS.map((field) => FIELD_LABELS[field] ?? field)
    const books = parsed.map((entry, index) => {
      const cells = POSITIONAL_FIELDS.map((field) => String(entry?.[field] ?? entry?.[aliasOf(field)] ?? ''))
      const book = buildBook(cells, POSITIONAL_FIELDS, index)
      book.cells = cells.map((value) => value.trim())
      return book
    })
    const kept = books.filter((book) => book.title !== '')
    return {
      books: kept,
      headers: [],
      columns,
      mapping: POSITIONAL_FIELDS,
      skipped: books.length - kept.length,
      fields: POSITIONAL_FIELDS,
      note: 'JSON 数组',
    }
  }
  const firstLine = clean.slice(0, Math.max(0, clean.search(/\r?\n|$/)))
  const delimiter = guessDelimiter(firstLine)
  const rows = splitRows(clean, delimiter)
  const result = rowsToBooks(rows)
  return { ...result, note: delimiter === '\t' ? '制表符分隔' : `分隔符 “${delimiter}”` }
}

/** Chinese field name used in a JSON book array. */
function aliasOf(field) {
  return FIELD_LABELS[field]
}

/**
 * Parse an uploaded workbook: `.xlsx` from base64, or text tables decoded from
 * base64. `.xls` (the pre-2007 binary format) is rejected with a conversion hint
 * instead of being misread.
 * @param {{base64: string, filename?: string}} input - the upload.
 * @returns {{books: object[], headers: string[], mapping: (string|null)[], skipped: number, fields: string[], note: string}}
 */
export function parseWorkbook({ base64, filename = '' }) {
  const name = String(filename).toLowerCase()
  const bytes = Uint8Array.from(Buffer.from(String(base64), 'base64'))
  if (bytes.length === 0) throw new Error('上传的文件是空的。')
  if (name.endsWith('.xls')) {
    throw new Error('不支持旧版 .xls 二进制格式，请在 Excel/WPS 中“另存为 .xlsx”后再导入。')
  }
  if (name.endsWith('.xlsx') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const parsed = rowsToBooks(readXlsx(bytes))
    return { ...parsed, note: `xlsx 工作表（${filename || '未命名'}）` }
  }
  const parsed = parseTableText(new TextDecoder('utf-8').decode(bytes))
  return { ...parsed, note: `${filename || '文本文件'}，${parsed.note}` }
}

/**
 * Import an arbitrary payload into normalised books and run the hard prefilter.
 * @param {{text?: string, base64?: string, filename?: string}} input - paste or upload.
 * @returns {{books: object[], stats: object, note: string}}
 */
export function importBooks(input) {
  const parsed = input.base64 !== undefined && input.base64 !== ''
    ? parseWorkbook({ base64: input.base64, filename: input.filename ?? '' })
    : parseTableText(input.text ?? '')
  if (parsed.books.length === 0) {
    throw new Error('没有解析到任何图书：请确认第一行是表头（书名、出版社、分类号等），或按“序号,书名,价格…”的顺序排列。')
  }
  const books = parsed.books.map((book) => ({ ...book }))
  const { rejected, needsAI } = prefilterBooks(books)
  return {
    books,
    note: parsed.note,
    stats: {
      imported: books.length,
      skipped: parsed.skipped,
      prefilteredRejected: rejected.length,
      needsAI: needsAI.length,
      headers: parsed.headers,
      columns: parsed.columns ?? [],
      fields: parsed.fields,
    },
  }
}

/**
 * Demo records that exercise every deterministic rule and a few semantic ones,
 * so the panel can be tried without a real acquisition file.
 */
export function sampleBooks() {
  const rows = [
    ['1', '马克思主义基本原理专题研究', '48', '人民出版社', '9787010000001', '张一', '2023', 'A811', '围绕马克思主义经典文本展开的专题研究，适合高校思想政治理论课参考。', '1版', '320页'],
    ['2', '心灵鸡汤大全集', '39.8', '某某文化出版社', '9787500000002', '李二', '2019', 'B821', '汇集人生感悟短文，主打情绪治愈。', '1版', '280页'],
    ['3', '深度学习', '128', '人民邮电出版社', '9787115000003', '王三', '2022', 'TP181', '系统讲解神经网络与深度学习框架的实现与应用。', '2版', '680页'],
    ['4', '红楼梦（影印本）', '680', '人民文学出版社', '9787020000004', '曹雪芹', '2008', 'I242.4', '古典长篇小说影印整理本。', '影印版', '1200页'],
    ['5', '考研英语词汇速记', '59', '某某教育出版社', '9787040000005', '赵四', '2023', 'H313', '面向考研人群的词汇记忆手册。', '1版', '420页'],
    ['6', '西方哲学史', '86', '商务印书馆', '9787100000006', '罗素', '2021', 'B5', '从古希腊到二十世纪的西方哲学发展脉络。', '1版', '980页'],
    ['7', '日本动漫文化研究', '68', '某大学出版社', '9787300000007', '孙五', '2020', 'J954', '分析日本动漫产业发展与受众文化。', '1版', '260页'],
    ['8', '社区治理现代化的实践路径', '45', '某人民出版社', '9787010000008', '周六', '2023', 'D669', '结合地方案例讨论基层社区治理机制。', '1版', '12页'],
    ['9', '5G 移动通信技术', '99', '人民邮电出版社', '9787115000009', '吴七', '2023', 'TN929', '介绍 5G 网络架构、关键技术与部署实践。', '1版', '460页'],
    ['10', '中国书法简史', '58', '中华书局', '9787101000010', '郑八', '2022', 'J292', '梳理中国书法发展史与代表书家。', '1版', '380页'],
    ['11', '乡村振兴案例研究', '52', '某地方出版社', '9787200000011', '冯九', '2021', 'F320', '以若干县域为样本归纳乡村振兴做法。', '1版', '300页'],
    ['12', '大学生职业生涯规划', '42', '某高教出版社', '9787040000012', '陈十', '2024', 'G647', '面向大学生的职业规划与就业指导教材。', '1版', '260页'],
  ]
  const { books, stats } = importBooks({ text: rows.map((row) => row.join('\t')).join('\n') })
  return { books, stats, note: '内置示例数据（12 条）' }
}
