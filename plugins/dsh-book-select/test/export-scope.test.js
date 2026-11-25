import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const source = await readFile(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

test('the export scope selector is gone', () => {
  assert.ok(!/exportScope\s*:/.test(source), '导出范围的状态还在')
  assert.ok(!source.includes('setExportScope'), '导出范围的选择器还在')
  assert.ok(!/scopeAll\s*:/.test(source), '「全部书目」选项还在')
  assert.ok(!source.includes('scopePassed'), '「仅通过的」选项还在')
})

test('the export writes exactly the rows the current view shows', () => {
  assert.ok(/const rows = visible\.map\(/.test(source), '导出没有直接用当前视图的 visible')
  assert.ok(!/visible\.filter\(\(item\) => item\.status === 'passed'\)/.test(source), '导出还在单独过滤「通过」')
})

test('the file name carries the current status tab', () => {
  assert.ok(/scope: filter === 'all' \? 'all' : filter/.test(source))
  assert.ok(/book-selection-\$\{scope\}-/.test(source))
})

test('the button says what kind of data it will write', () => {
  assert.ok(/t\('exportHint', \{ scope: exportTabLabel, count: visible\.length \}\)/.test(source))
  assert.ok(/const exportTabLabel = t\(FILTER_LABEL\[filter\] \?\? 'scopeAllBooks'\)/.test(source))
  assert.ok(/t\('exportHintSearch', \{ query: query\.trim\(\) \}\)/.test(source))
})
