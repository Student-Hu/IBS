import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const source = await readFile(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

/**
 * Pull one dictionary block out of the client source.
 * @param {string} name - the dictionary variable name.
 * @returns {Set<string>} its keys.
 */
function dictionaryKeys(name) {
  const start = source.indexOf(`const ${name} = {`)
  assert.ok(start > 0, `找不到词典 ${name}`)
  const end = source.indexOf('\n    }', start)
  assert.ok(end > start, `词典 ${name} 没有结束`)
  const block = source.slice(start, end)
  const keys = new Set()
  for (const line of block.split('\n')) {
    const match = /^\s{6}([A-Za-z0-9_]+):/.exec(line)
    if (match !== null) keys.add(match[1])
  }
  return keys
}

const zh = dictionaryKeys('zh')
const en = dictionaryKeys('en')

test('both dictionaries carry the concurrency keys', () => {
  assert.ok(zh.has('concurrency'))
  assert.ok(zh.has('concurrencyUnit'))
  assert.ok(en.has('concurrency'))
  assert.ok(en.has('concurrencyUnit'))
})

test('the two dictionaries cover exactly the same keys', () => {
  const missingInEn = [...zh].filter((key) => !en.has(key))
  const missingInZh = [...en].filter((key) => !zh.has(key))
  assert.deepEqual(missingInEn, [])
  assert.deepEqual(missingInZh, [])
})

test('every key the view asks for exists in both dictionaries', () => {
  const used = new Set()
  for (const match of source.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)) used.add(match[1])
  assert.ok(used.size > 50)
  for (const key of used) {
    assert.ok(zh.has(key), `中文词典缺少 ${key}`)
    assert.ok(en.has(key), `英文词典缺少 ${key}`)
  }
})

test('the view sends the concurrency it picked', () => {
  assert.ok(/call\('run', \{ sessionId, batchSize, concurrency \}\)/.test(source))
  assert.ok(/const \[concurrency, setConcurrency\] = React\.useState\(6\)/.test(source))
})
