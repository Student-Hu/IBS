/**
 * Minimal SpreadsheetML writer — enough to hand a table to Excel, WPS or
 * LibreOffice as a real `.xlsx` file.
 *
 * An `.xlsx` file is a ZIP container holding a handful of XML parts. This
 * writer emits the smallest valid workbook: one worksheet, inline strings for
 * text (so there is no shared-string table to keep in sync), plain numbers
 * for numeric cells, a bold header row, frozen panes and an auto-filter.
 *
 * It runs on the Host half only: a ZIP container needs a CRC-32 and a deflate
 * step, and the browser half has no zlib. The browser asks the Host for the
 * finished bytes and downloads them.
 *
 * Only `lib/xlsx.js` is imported from the Host half, so the package stays
 * free of third-party runtime dependencies.
 */

import { deflateRawSync } from 'node:zlib'

/** Longest sheet name Excel accepts. */
const MAX_SHEET_NAME = 31

/** Widest column we ask Excel to show. */
const MAX_COLUMN_WIDTH = 60

/** Narrowest column we ask Excel to show. */
const MIN_COLUMN_WIDTH = 8

/** CRC-32 lookup table (the polynomial ZIP uses). */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    table[index] = value
  }
  return table
})()

/**
 * CRC-32 of a buffer, as the ZIP container records it.
 *
 * @param {Buffer} buffer
 * @returns {number} unsigned 32-bit checksum
 */
export function crc32(buffer) {
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

/**
 * Turn a 1-based column index into its spreadsheet letters (1 → A, 27 → AA).
 *
 * @param {number} index
 * @returns {string}
 */
export function columnName(index) {
  let value = index
  let name = ''
  while (value > 0) {
    const rest = (value - 1) % 26
    name = String.fromCharCode(65 + rest) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

/**
 * Drop the control characters XML forbids, keeping tab, line feed and
 * carriage return, which Excel stores as ordinary text.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripControlCharacters(text) {
  let out = ''
  for (const char of String(text)) {
    const code = char.codePointAt(0)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue
    out += char
  }
  return out
}

/**
 * Escape the five XML entities.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeXml(text) {
  return stripControlCharacters(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Keep a sheet name Excel accepts: no `[]:*?/\`, at most 31 characters.
 *
 * @param {string} name
 * @returns {string}
 */
export function safeSheetName(name) {
  const cleaned = String(name ?? '').replace(/[[\]:*?/\\]/g, ' ').trim()
  if (cleaned === '') return 'Sheet1'
  return cleaned.slice(0, MAX_SHEET_NAME)
}

/**
 * One cell as spreadsheet XML: inline text, a number, or an empty cell.
 *
 * @param {string} reference cell reference such as `B3`
 * @param {unknown} value
 * @param {number} styleIndex 0 = body, 1 = bold header
 * @returns {string}
 */
export function cellXml(reference, value, styleIndex = 0) {
  const style = styleIndex === 1 ? ' s="1"' : ''
  if (value === null || value === undefined || value === '') {
    return `<c r="${reference}"${style}/>`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"${style}><v>${value}</v></c>`
  }
  const text = escapeXml(value)
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
}

/**
 * Build the XML parts of a one-sheet workbook.
 *
 * Exposed separately from {@link buildXlsx} so the parts can be inspected in
 * tests without unpacking a ZIP.
 *
 * @param {{sheetName?: string, header?: unknown[], rows?: unknown[][]}} input
 * @returns {{sheetName: string, parts: {name: string, text: string}[]}}
 */
export function buildWorkbookParts({ sheetName, header = [], rows = [] } = {}) {
  const title = safeSheetName(sheetName)
  const columns = Array.isArray(header) ? header : []
  const body = Array.isArray(rows) ? rows : []
  const columnCount = Math.max(columns.length, ...body.map((row) => (Array.isArray(row) ? row.length : 0)), 0)
  const lastColumn = columnName(Math.max(columnCount, 1))
  const lastRow = body.length + 1

  const widths = []
  for (let index = 0; index < columnCount; index += 1) {
    const label = String(columns[index] ?? '')
    const widest = body.reduce((max, row) => {
      const cell = Array.isArray(row) ? String(row[index] ?? '') : ''
      return Math.max(max, cell.length)
    }, label.length)
    widths.push(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(widest * 1.8) + 2)))
  }

  const sheetRows = []
  if (columnCount > 0) {
    const cells = []
    for (let index = 0; index < columnCount; index += 1) {
      cells.push(cellXml(`${columnName(index + 1)}1`, columns[index] ?? '', 1))
    }
    sheetRows.push(`<row r="1">${cells.join('')}</row>`)
  }
  for (let rowIndex = 0; rowIndex < body.length; rowIndex += 1) {
    const row = Array.isArray(body[rowIndex]) ? body[rowIndex] : []
    const cells = []
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      cells.push(cellXml(`${columnName(columnIndex + 1)}${rowIndex + 2}`, row[columnIndex] ?? ''))
    }
    sheetRows.push(`<row r="${rowIndex + 2}">${cells.join('')}</row>`)
  }

  const cols = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join('')

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${sheetRows.join('')}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(title)}" sheetId="1" r:id="rId1"/></sheets></workbook>`

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

  return {
    sheetName: title,
    parts: [
      { name: '[Content_Types].xml', text: contentTypes },
      { name: '_rels/.rels', text: rootRels },
      { name: 'xl/workbook.xml', text: workbook },
      { name: 'xl/_rels/workbook.xml.rels', text: workbookRels },
      { name: 'xl/styles.xml', text: styles },
      { name: 'xl/worksheets/sheet1.xml', text: sheet },
    ],
  }
}

/**
 * Pack parts into a ZIP container.
 *
 * @param {{name: string, text: string}[]} parts
 * @param {Date} [now] timestamp recorded in the archive
 * @returns {Buffer}
 */
export function zipParts(parts, now = new Date()) {
  const year = Math.max(1980, now.getFullYear())
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

  const localChunks = []
  const centralChunks = []
  let offset = 0

  for (const part of parts) {
    const nameBytes = Buffer.from(part.name, 'utf8')
    const raw = Buffer.from(part.text, 'utf8')
    const deflated = deflateRawSync(raw, { level: 9 })
    const compressed = deflated.length < raw.length
    const data = compressed ? deflated : raw
    const method = compressed ? 8 : 0
    const checksum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)

    localChunks.push(local, nameBytes, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)

    centralChunks.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }

  const centralDirectory = Buffer.concat(centralChunks)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(parts.length, 8)
  end.writeUInt16LE(parts.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localChunks, centralDirectory, end])
}

/**
 * Build a one-sheet `.xlsx` file from a header row and data rows.
 *
 * @param {{sheetName?: string, header?: unknown[], rows?: unknown[][]}} input
 * @returns {Buffer} the file bytes
 */
export function buildXlsx(input) {
  const { parts } = buildWorkbookParts(input)
  return zipParts(parts)
}
