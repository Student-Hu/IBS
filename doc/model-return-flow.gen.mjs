import fs from 'node:fs'

const W = 1250
const PAD = 32
const LOOP_X = W - 30
const MAIN_X = 452
const MAIN_W = W - MAIN_X - 70
const LEFT_X = PAD
const LEFT_W = MAIN_X - PAD - 56

const nodes = []
const edges = []

function node(id, col, title, lines = [], kind = 'step') {
  nodes.push({ id, col, title, lines, kind })
}

// main column
node('M1', 'main', '① 送一批书给模型', ['来源：待判定优先 → 失败重试', '批大小 5–40（默认 15）'])
node('M2', 'main', '② 拼装请求', ['system = AI_RULES 规则全文', 'user = 10 字段 JSON（简介截 400 字）'])
node('M3', 'main', '③ llm.stream 调用默认模型', ['temperature 0 · maxTokens 16000', '240 秒超时，可取消'])
node('M4', 'main', '④ 流式拼文本', ['text-delta 按 index 累积', 'block-end 整块兜底（不发 delta 的 provider）'])
node('D1', 'main', 'finish = error / 文本为空？', [], 'decision')
node('M5', 'main', '⑤ parseScreeningJson 容错解析', ['去 ``` 围栏 → 取第一个 { 到最后一个 }', '原样 → 去尾逗号 → 中文引号替换'])
node('D2', 'main', '解析成功？', [], 'decision')
node('M6', 'main', '⑥ 归一化为三个桶', ['passed / rejected / review', '非数组当空，非对象元素丢弃'])
node('M7', 'main', '⑦ applyOutcome 贴回书', ['序号队列认领（重复序号各领一本）', '题名兜底 · seen 去重 · 写 status/source/reason'])
node('M8', 'main', '⑧ 兜底：批内未被认领的书', ['status = review', 'reason =「模型未给出判定，转入待复审」'])
node('M9', 'main', '⑨ 落盘 + 刷新', ['每批 revision++ → history/<id>.json', '前端每秒轮询 counts/job，行数据 3 秒'])

// left column: error lane
node('E1', 'left', '抛错（保留原文）', ['模型调用失败：… / 没有返回任何文本 /', '不是合法 JSON（可能被截断）'], 'error')
node('E2', 'left', 'screenBatch 错误分类', ['可恢复＝空文本 · JSON · 找不到 JSON', '且 books > 1 且 depth < 3'], 'error')
node('D3', 'left', '可恢复？', [], 'decision')
node('E3', 'left', '对半拆批并行重试', ['15 → 8+7 → 4+4 …（最多 3 层）', '单本仍失败即放弃'], 'retry')
node('E4', 'left', '整批判「失败」', ['status = failed', 'reason =「AI 判定失败：<原文>」', 'job.failed += batch.length'], 'error')
node('E5', 'left', '下一轮再处理', ['待判定清空后按钮变「重试失败书目」', '运行前快照，不重复打同一批'], 'retry')

// layout
const GAP = 26
function layout(col) {
  let y = 104
  for (const n of nodes.filter((x) => x.col === col)) {
    n.h = 40 + n.lines.length * 19 + 14
    if (n.kind === 'decision') n.h = 64
    n.y = y
    y += n.h + GAP
  }
  return y
}
const mainBottom = layout('main')
const leftBottom = layout('left')
const H = Math.max(mainBottom, leftBottom) + 132

const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
const xOf = (n) => (n.col === 'main' ? MAIN_X : LEFT_X)
const wOf = (n) => (n.col === 'main' ? MAIN_W : LEFT_W)
for (const n of nodes) {
  n.x = xOf(n)
  n.w = wOf(n)
}

const palette = {
  step: { fill: '#ffffff', stroke: '#c3ccdb', head: '#eef2ff', headText: '#1e3a8a' },
  decision: { fill: '#fff8ec', stroke: '#e0b56b', head: '#fdeccb', headText: '#8a5300' },
  error: { fill: '#fff6f6', stroke: '#e6a3a3', head: '#fde4e4', headText: '#8f1d1d' },
  retry: { fill: '#f4fbf7', stroke: '#9dcdb4', head: '#e0f4e9', headText: '#155e3b' },
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const out = []
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Microsoft YaHei','PingFang SC','Segoe UI',sans-serif">`)
out.push(`<defs>
  <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a97ab"/>
  </marker>
  <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#c07b7b"/>
  </marker>
</defs>`)
out.push(`<rect width="${W}" height="${H}" fill="#fbfcfe"/>`)
out.push(`<text x="${PAD}" y="46" font-size="24" font-weight="700" fill="#16233a">选书插件：模型返回处理流程</text>`)
out.push(`<text x="${PAD}" y="72" font-size="13.5" fill="#5b6b85">主链＝正常路径（右列）；左侧＝出错与重试路径。所有判断都在 lib/screening.js 与 index.js 里</text>`)
out.push(`<text x="${LEFT_X}" y="86" font-size="12.5" font-weight="700" fill="#8f1d1d">出错 / 重试</text>`)
out.push(`<text x="${MAIN_X}" y="86" font-size="12.5" font-weight="700" fill="#1e3a8a">正常路径</text>`)

for (const n of nodes) {
  const p = palette[n.kind]
  if (n.kind === 'decision') {
    const cx = n.x + n.w / 2
    const cy = n.y + n.h / 2
    out.push(`<path d="M ${cx} ${n.y} L ${n.x + n.w} ${cy} L ${cx} ${n.y + n.h} L ${n.x} ${cy} Z" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1.4"/>`)
    out.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="14" font-weight="600" fill="${p.headText}">${esc(n.title)}</text>`)
    continue
  }
  out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${p.fill}" stroke="${p.stroke}" stroke-width="1.4"/>`)
  out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="30" rx="10" fill="${p.head}"/>`)
  out.push(`<rect x="${n.x}" y="${n.y + 18}" width="${n.w}" height="12" fill="${p.head}"/>`)
  out.push(`<text x="${n.x + 14}" y="${n.y + 20}" font-size="14" font-weight="700" fill="${p.headText}">${esc(n.title)}</text>`)
  n.lines.forEach((line, i) => {
    out.push(`<text x="${n.x + 14}" y="${n.y + 48 + i * 19}" font-size="12.8" fill="#3d4a5f">${esc(line)}</text>`)
  })
}

function path(d, color = '#8a97ab', marker = 'a') {
  out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" marker-end="url(#${marker})"/>`)
}

function down(a, b, color = '#8a97ab', marker = 'a') {
  const x = a.x + a.w / 2
  path(`M ${x} ${a.y + a.h} L ${x} ${b.y - 2}`, color, marker)
}

// main chain
const chain = ['M1', 'M2', 'M3', 'M4', 'D1', 'M5', 'D2', 'M6', 'M7', 'M8', 'M9']
for (let i = 0; i < chain.length - 1; i++) down(byId[chain[i]], byId[chain[i + 1]])

// D1 -> E1 (left), D2 -> E1
function toLeft(from, toId, label, channel) {
  const d1 = byId[from]
  const t = byId[toId]
  const y1 = d1.y + d1.h / 2
  const x1 = d1.x
  const xm = channel
  path(`M ${x1} ${y1} L ${xm} ${y1} L ${xm} ${t.y + t.h / 2} L ${t.x + t.w + 2} ${t.y + t.h / 2}`, '#c07b7b', 'ar')
  out.push(`<text x="${xm - 6}" y="${y1 - 6}" text-anchor="end" font-size="12" font-weight="600" fill="#a15555">${esc(label)}</text>`)
}
toLeft('D1', 'E1', '是', MAIN_X - 22)
toLeft('D2', 'E1', '否', MAIN_X - 10)

// left chain
down(byId.E1, byId.E2, '#c07b7b', 'ar')
down(byId.E2, byId.D3, '#c07b7b', 'ar')
down(byId.D3, byId.E3, '#c07b7b', 'ar')
down(byId.E3, byId.E4, '#c07b7b', 'ar')
down(byId.E4, byId.E5, '#c07b7b', 'ar')

// D3 "no" -> E4 bypass: route around right of left column
{
  const d3 = byId.D3
  const e4 = byId.E4
  const y = d3.y + d3.h / 2
  const xr = d3.x + d3.w + 8
  path(`M ${d3.x + d3.w} ${y} L ${xr} ${y} L ${xr} ${e4.y + e4.h / 2} L ${e4.x + e4.w + 2} ${e4.y + e4.h / 2}`, '#c07b7b', 'ar')
  out.push(`<text x="${xr + 4}" y="${y - 7}" font-size="12" font-weight="600" fill="#a15555">否</text>`)
}
out.push(`<text x="${byId.E3.x + byId.E3.w - 12}" y="${byId.E3.y - 8}" text-anchor="end" font-size="12" font-weight="600" fill="#3f7a5c">是</text>`)

// retry success -> M6
{
  const e3 = byId.E3
  const m6 = byId.M6
  const y = e3.y + e3.h / 2
  const xr = e3.x + e3.w + 18
  const target = m6.x
  path(`M ${e3.x + e3.w} ${y} L ${xr} ${y} L ${xr} ${m6.y + m6.h / 2} L ${target - 2} ${m6.y + m6.h / 2}`, '#3f8f66', 'a')
  out.push(`<text x="${xr + 4}" y="${y + 15}" font-size="12" font-weight="600" fill="#3f7a5c">重试成功</text>`)
}

// 下一批：M9 右侧绕回 M1
{
  const m1 = byId.M1
  const m9 = byId.M9
  const xr = W - 34
  const y1 = m9.y + m9.h / 2
  const y2 = m1.y + m1.h / 2
  out.push(
    `<path d="M ${m9.x + m9.w} ${y1} L ${xr} ${y1} L ${xr} ${y2} L ${m1.x + m1.w + 2} ${y2}" fill="none" stroke="#8a97ab" stroke-width="1.5" stroke-dasharray="6 5" marker-end="url(#a)"/>`,
  )
  out.push(
    `<text x="${xr - 8}" y="${(y1 + y2) / 2}" transform="rotate(-90 ${xr - 8} ${(y1 + y2) / 2})" text-anchor="middle" font-size="12" fill="#6b7a92">下一批（job.phase: pending → retry）</text>`,
  )
}

// page frame hints + footnote
const legendY = H - 46
out.push(`<line x1="${PAD}" y1="${legendY - 26}" x2="${W - PAD}" y2="${legendY - 26}" stroke="#e3e8f0"/>`)
out.push(`<text x="${PAD}" y="${legendY}" font-size="12.5" fill="#5b6b85">契约：模型只输出一个 JSON 对象 {"passed":[…],"rejected":[…],"review":[…]}；每条含 序号 / 题名 / 通过理由·排除原因·待复审原因，一本只能落一个桶。</text>`)
out.push(`<text x="${PAD}" y="${legendY + 22}" font-size="12.5" fill="#5b6b85">取消只停「当前批之后」的批次，已判结果保留；每批结束都会 revision++ 并写 history/&lt;id&gt;.json，所以刷新/换会话都能接着看。</text>`)
out.push('</svg>')

const outPath = process.argv[2]
fs.writeFileSync(outPath, out.join('\n'), 'utf8')
console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes')
