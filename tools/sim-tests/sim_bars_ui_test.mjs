// Drives the built app in headless Chrome over CDP: makes a scenario from a
// price file through "+ 추가", then exercises its editor and practice.
//
//   node tools/sim-tests/sim_bars_ui_test.mjs <absolute path of tools/sim-tests>
//
// Needs the server on :8000 serving the current build. The price file it
// uploads and the screenshots (b*.png) are written next to this file.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { api, button, launch, pane, scenarioRow, sleep } from './harness.mjs'

const DIR = process.argv[2]
const SCENARIO = '__uitest 가격'
const STOCK = '유아이테스트 홀딩스'
const PRICE_FILE = `${DIR}/UITEST_1분봉.cdt`

// Two sessions of 1-minute bars: 11/12 09:00–10:59 and 11/13 09:00–10:29.
const round = (n) => Math.round(n * 1e4) / 1e4
const bars = []
for (const [day, count] of [[12, 120], [13, 90]]) {
  for (let m = 0; m < count; m++) {
    const i = bars.length
    const o = i === 0 ? 5 : bars[i - 1].c
    const c = round(5 + Math.sin(i / 9) * 0.8 + i * 0.004)
    bars.push({
      t: Date.UTC(2026, 10, day, 9, m) / 1000,
      stamp: 20261100000000 + day * 1e6 + (9 + Math.floor(m / 60)) * 1e4 + (m % 60) * 100,
      o, c, h: round(Math.max(o, c) + 0.02), l: round(Math.min(o, c) - 0.02), v: 1000 + ((i * 37) % 500),
    })
  }
}
const FIRST = 120 // index of the first 11/13 bar
const cdt = Buffer.alloc(8 + bars.length * 64)
cdt.writeInt32LE(1, 0)
cdt.writeInt32LE(bars.length, 4)
bars.forEach((b, i) => [b.stamp, b.o, b.h, b.l, b.c, b.v, 0, 0].forEach((x, k) => cdt.writeDoubleLE(x, 8 + i * 64 + k * 8)))
writeFileSync(PRICE_FILE, cdt)

const pad = (n) => String(n).padStart(2, '0')
const barTime = (t) => {
  const d = new Date(t * 1000)
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
// The line above a chart for the candle `b`.
const readout = (b) =>
  `${barTime(b.t)} · 시 ${b.o.toFixed(4)} 고 ${b.h.toFixed(4)} 저 ${b.l.toFixed(4)} 종 ${b.c.toFixed(4)} · 거래량 ${b.v.toLocaleString('en-US')} · 거래대금 ${((((b.h + b.l) / 2) * b.v) / 70000).toFixed(2)}`
// The 30-minute (or `span`-second) candle in progress at 1-minute bar `now`.
const forming30 = (now, span = 1800) => {
  const start = bars[now].t - (bars[now].t % span)
  const seen = bars.slice(0, now + 1).filter((b) => b.t >= start)
  return {
    t: start,
    o: seen[0].o,
    h: Math.max(...seen.map((b) => b.h)),
    l: Math.min(...seen.map((b) => b.l)),
    c: seen.at(-1).c,
    v: seen.reduce((n, b) => n + b.v, 0),
  }
}

const cleanup = async () => {
  for (const s of await api('GET', '/api/sim/scenarios')) if (s.name === SCENARIO) await api('DELETE', `/api/sim/scenarios/${s.id}`)
}

const browser = await launch(DIR, 9334)
try {
  await cleanup()
  const app = await browser.openApp()
  const text = (sel) => app.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`)
  const has = (sel) => app.ev(`!!document.querySelector(${JSON.stringify(sel)})`)
  const label = (i) => app.ev(`${pane(i)}.querySelector('.sim-pane-label').textContent`)
  const meta = () => app.ev(`${scenarioRow(SCENARIO)}.querySelector('.sim-scn-meta').textContent`)
  const right = async (n, shift = false) => {
    for (let i = 0; i < n; i++) await app.key('ArrowRight', 39, shift ? 8 : 0)
  }
  // Presses the mouse button on an element and leaves it down; the returned function releases it.
  const press = async (elExpr) => {
    const r = await app.rectOf(elExpr)
    const [x, y] = [r.x + r.w / 2, r.y + r.h / 2]
    await app.mouse('mouseMoved', x, y, { button: 'none' })
    await app.mouse('mousePressed', x, y, { clickCount: 1 })
    return () => app.mouse('mouseReleased', x, y, { clickCount: 1 })
  }
  const add = `document.querySelector('.sim-add')`

  // --- "+ 추가": file -> day -> name
  await app.click(button(`document.querySelector('.chartpat-sidebar-head')`, '+ 추가'))
  await app.waitFor(add, 'add panel')
  assert.equal(await app.ev(`${button(add, '시나리오 만들기')}.disabled`), true)
  await app.shot('b01_add_empty')
  const { result } = await app.send('Runtime.evaluate', { expression: `${add}.querySelector('input[type=file]')` })
  await app.send('DOM.setFileInputFiles', { files: [PRICE_FILE], objectId: result.objectId })
  await app.waitFor(button(add, '11/13 · 90봉'), 'sessions of the file')
  assert.ok(await app.ev(`!!${button(add, '11/12 · 120봉')}`))
  assert.equal(await app.ev(`${button(add, '11/13 · 90봉')}.className`), 'active') // the last day is preselected
  assert.ok((await text('.sim-add .sim-hint')).startsWith('UITEST · 1분봉 210개 · 11/12 09:00 ~ 11/13 10:29'))
  assert.equal(await app.ev(`${add}.querySelector('.sim-label-input').placeholder`), '26.11.13 UITEST')
  await app.click(button(add, '11/12 · 120봉'))
  assert.equal(await has('.sim-add .sim-hint .sim-warn'), true) // nothing before the first day
  assert.equal(await app.ev(`${add}.querySelector('.sim-label-input').placeholder`), '26.11.12 UITEST')
  await app.click(button(add, '11/13 · 90봉'))
  assert.equal(await has('.sim-add .sim-hint .sim-warn'), false)
  await app.click(`${add}.querySelector('.sim-label-input')`)
  await app.send('Input.insertText', { text: SCENARIO })
  await app.click(`${add}.querySelector('.sim-stock-input')`)
  await app.send('Input.insertText', { text: STOCK })
  await app.shot('b02_add_ready')
  await app.click(button(add, '시나리오 만들기'))

  // --- editor: opens on the first bar of the chosen day
  await app.waitFor(`document.querySelector('.sim-bar-nav')`, 'bar editor')
  await app.waitFor(`document.querySelectorAll('.sim-chart canvas').length > 0`, 'charts')
  const scenario = (await api('GET', '/api/sim/scenarios')).find((s) => s.name === SCENARIO)
  assert.deepEqual([scenario.kind, scenario.bar_count, scenario.quiz_count], ['bars', 90, 0])
  assert.ok((await meta()).startsWith('가격 데이터 · 1분 90봉 · 퀴즈 0'))

  // --- the stock's name: under the scenario name in the list, changed by double-clicking it
  const stockLine = `${scenarioRow(SCENARIO)}.querySelector('.sim-scn-stock')`
  const askStock = async (answer) => {
    await app.ev(`window.prompt = (message, value) => { window.__asked = [message, value]; return ${JSON.stringify(answer)} }`)
    await app.ev(`${stockLine}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  }
  const stockOf = async () => (await api('GET', '/api/sim/scenarios')).find((s) => s.id === scenario.id).stock_name
  assert.equal(scenario.stock_name, STOCK)
  assert.equal(await app.ev(`${stockLine}.textContent`), STOCK)
  assert.deepEqual(
    await app.ev(`[...${scenarioRow(SCENARIO)}.querySelector('.sim-scn').children].map((el) => el.className.trim())`),
    ['sim-scn-name', 'sim-scn-stock', 'sim-scn-meta'],
  )
  assert.equal(await text('.sim-head-title'), SCENARIO + STOCK)
  assert.equal(await text('.sim-head-stock'), STOCK)
  await askStock(null) // cancelled
  assert.deepEqual(await app.ev(`window.__asked`), ['종목명 (비우면 지워집니다)', STOCK])
  await sleep(300)
  assert.equal(await stockOf(), STOCK)
  await askStock(` ${STOCK} 2 `)
  await app.waitFor(`${stockLine}.textContent === ${JSON.stringify(`${STOCK} 2`)}`, 'the changed stock name')
  await app.waitFor(`document.querySelector('.sim-head-stock').textContent === ${JSON.stringify(`${STOCK} 2`)}`, 'the head')
  assert.equal(await stockOf(), `${STOCK} 2`)
  await app.shot('b02a_stock_name')
  // emptied: the selected scenario keeps the line, as the place to enter one
  await askStock('')
  await app.waitFor(`${stockLine}.classList.contains('empty')`, 'the empty stock line')
  assert.equal(await app.ev(`${stockLine}.textContent`), '종목명 입력')
  assert.equal(await stockOf(), '')
  assert.equal(await has('.sim-head-stock'), false)
  assert.equal(await text('.sim-head-title'), SCENARIO)
  const navCount = () => text('.sim-bar-nav .sim-nav-count')
  assert.equal(await navCount(), '121 / 210')
  assert.equal(await label(1), readout(bars[FIRST]))
  assert.equal(await label(0), readout(forming30(FIRST)))
  await sleep(300)
  await app.shot('b03_editor_start')

  // hovering a chart shows, under the time, the Korean time of the bar under the cursor
  // (11/12 and 11/13 are US standard time: +14h) and its frame number
  const kst = (i) =>
    app.ev(`(() => { const el = ${pane(i)}.querySelector('.sim-chart-kst'); return getComputedStyle(el).display === 'none' ? null : el.textContent })()`)
  const hover = async (i, fx, fy) => {
    const r = await app.rectOf(`${pane(i)}.querySelector('.sim-chart-host')`)
    await app.mouse('mouseMoved', r.x + r.w * fx, r.y + r.h * fy, { button: 'none' })
    await sleep(150)
  }
  // A "KST 11/13 23:00\n프레임 121" label: the exchange time and the frame text.
  const hoverLabel = (shown) => {
    const [, month, day, hh, mm, frames] =
      String(shown).match(/^KST (\d\d)\/(\d\d) (\d\d):(\d\d)\n프레임 (.+)$/) ?? assert.fail(`hover label: ${shown}`)
    return { t: Date.UTC(2026, month - 1, day, hh, mm) / 1000 - 14 * 3600, frames }
  }
  assert.deepEqual([await kst(0), await kst(1)], [null, null])
  await hover(1, 0.6, 0.4)
  const over1 = hoverLabel(await kst(1))
  const hovered = bars.findIndex((b) => b.t === over1.t)
  assert.ok(hovered > 0 && hovered < FIRST, `hovered bar ${hovered}`)
  assert.equal(over1.frames, String(hovered + 1)) // the number the counter shows at that bar
  await sleep(200)
  await app.shot('b03a_hover')
  await hover(1, 0.86, 0.4) // near the last bar: the label stays clear of the price scale
  const atEdge = await app.ev(`(() => { const l = ${pane(1)}.querySelector('.sim-chart-kst').getBoundingClientRect();
    const h = ${pane(1)}.querySelector('.sim-chart-host').getBoundingClientRect(); return { right: l.right - h.left, bottom: h.bottom - l.bottom, width: h.width } })()`)
  assert.ok(atEdge.right > 0 && atEdge.right < atEdge.width - 30 && atEdge.bottom >= 0 && atEdge.bottom < 8, JSON.stringify(atEdge))
  await hover(0, 0.85, 0.4)
  assert.equal(await kst(1), null) // gone with the crosshair
  const over30 = hoverLabel(await kst(0))
  const first30 = bars.findIndex((b) => b.t === over30.t)
  assert.ok(over30.t % 1800 === 0 && first30 >= 0 && first30 < FIRST, `hovered 30m candle ${over30.t}`)
  assert.equal(over30.frames, `${first30 + 1}~${first30 + 30}`) // the 1-minute bars of that candle
  await app.mouse('mouseMoved', 5, 5, { button: 'none' })
  await sleep(150)
  assert.equal(await kst(0), null)

  // under the 1-minute chart's time axis: the frame number of every 50th bar, below that bar
  const frameTicks = (i) =>
    app.ev(`(() => { const h = ${pane(i)}.querySelector('.sim-chart-host').getBoundingClientRect();
      return [...${pane(i)}.querySelectorAll('.sim-chart-frames span')].map((el) => { const r = el.getBoundingClientRect();
        return { text: el.textContent, fx: (r.left + r.width / 2 - h.left) / h.width, below: h.bottom - r.bottom } }) })()`)
  const ticksAreOverTheirFrames = async (last) => {
    const ticks = await frameTicks(1)
    const numbers = ticks.map((t) => Number(t.text))
    assert.equal(numbers.at(-1), last, JSON.stringify(ticks)) // the next one is not on the chart yet
    numbers.forEach((n, k) => assert.equal(n, last - 50 * (numbers.length - 1 - k), JSON.stringify(ticks)))
    for (const tick of ticks) {
      assert.ok(tick.below > 0 && tick.below < 40, JSON.stringify(ticks)) // inside the time axis
      await hover(1, tick.fx, 0.4)
      assert.equal(hoverLabel(await kst(1)).frames, tick.text)
    }
    await app.mouse('mouseMoved', 5, 5, { button: 'none' })
    await sleep(150)
  }
  assert.deepEqual(await frameTicks(0), []) // not on the left chart, whose candles hold many frames
  await ticksAreOverTheirFrames(100)

  // ▶: a click is one bar; held down it keeps stepping, and stops on release
  const forward = button(`document.querySelector('.sim-bar-nav')`, '▶')
  await app.click(forward)
  assert.equal(await navCount(), '122 / 210')
  await ticksAreOverTheirFrames(100) // the number moved along with its bar
  const release = await press(forward)
  await sleep(1000)
  await release()
  const held = Number((await navCount()).split(' ')[0])
  assert.ok(held >= 126 && held <= 132, `held ▶ for 1s: at ${held}`)
  await sleep(400)
  assert.equal(await navCount(), `${held} / 210`)
  for (let i = FIRST + 1; i < held; i++) await app.key('ArrowLeft', 37)
  assert.equal(await navCount(), '121 / 210')

  // --- replay start: move it into 11/12 and back
  const replayHere = button(`document.querySelector('.sim-body')`, '지금 봉을 연습 시작으로')
  await app.click(button(`document.querySelector('.sim-body')`, '11/12'))
  assert.equal(await navCount(), '1 / 210')
  await right(11, true)
  assert.equal(await navCount(), '111 / 210')
  await app.click(replayHere)
  await app.waitFor(`${scenarioRow(SCENARIO)}.textContent.includes('1분 100봉')`, 'new replay start in the list')
  assert.ok((await text('.sim-body')).includes('연습 시작: 11/12 10:50'))
  await app.click(button(`document.querySelector('.sim-body')`, '11/13'))
  await app.click(replayHere)
  await app.waitFor(`${scenarioRow(SCENARIO)}.textContent.includes('1분 90봉')`, 'replay start restored')
  assert.equal(await navCount(), '121 / 210')

  // ←/→ one bar, Shift ten; the 30m candle is only what has been seen so far
  await right(3)
  await right(1, true)
  assert.equal(await navCount(), '134 / 210')
  const QUIZ = FIRST + 13
  assert.equal(await label(1), readout(bars[QUIZ]))
  assert.equal(await label(0), readout(forming30(QUIZ)))

  // --- quiz range: frames 125~134 (11/13 09:04 ~ 09:13), given as frame numbers
  const FROM = FIRST + 4
  const quizzes = async () =>
    (await api('GET', `/api/sim/scenarios/${scenario.id}/bars`)).quizzes.map((q) => [q.start_time, q.bar_time])
  const editor = `document.querySelector('.sim-quiz-editor')`
  const addForm = `${editor}.querySelector('.sim-range-form')`
  const pickedForm = `${editor}.querySelector('.sim-quiz-picked .sim-range-form')`
  // Types a frame number into the first (0) or last (1) field of a range form.
  const fill = async (form, k, value) => {
    const input = `${form}.querySelectorAll('.sim-frame-input')[${k}]`
    await app.click(input)
    await app.ev(`${input}.select()`)
    await app.send('Input.insertText', { text: String(value) })
  }
  const canSubmit = async (form) => !(await app.ev(`${form}.querySelector('button[type=submit]').disabled`))
  const submit = async (form) => {
    await app.click(`${form}.querySelector('button[type=submit]')`)
    await sleep(400)
  }
  await app.ev(`window.confirm = () => true`)
  assert.equal(await canSubmit(addForm), false)
  await fill(addForm, 0, FROM + 1)
  assert.equal(await canSubmit(addForm), false) // no end yet
  await app.click(`${addForm}.querySelectorAll('button[type=button]')[1]`) // "지금": the bar being viewed
  assert.equal(await app.ev(`${addForm}.querySelectorAll('.sim-frame-input')[1].value`), String(QUIZ + 1))
  await submit(addForm)
  await app.waitFor(`document.querySelector('.sim-quiz-note')`, 'quiz note box')
  assert.deepEqual(await quizzes(), [[bars[FROM].t, bars[QUIZ].t]])
  await app.waitFor(`${scenarioRow(SCENARIO)}.textContent.includes('1분 86봉 · 퀴즈 1')`, 'practice from the range start')
  assert.ok((await text('.sim-main .sim-hint')).includes('연습은 프레임 125 (11/13 09:04, 첫 퀴즈 구간의 시작)부터'))
  assert.equal(await app.ev(`${replayHere}.disabled`), true) // the quiz range decides where practice starts now
  // the fields are left, so the arrow keys step through the bars again
  await app.key('ArrowLeft', 37)
  assert.equal(await navCount(), '133 / 210')
  await right(1)

  // another quiz may not end at the same bar; a range may not end before it starts
  await fill(addForm, 0, FROM + 6)
  await submit(addForm)
  assert.equal(await text('.sim-quiz-error'), '프레임 134에서 끝나는 퀴즈가 이미 있습니다.')
  await fill(addForm, 0, QUIZ + 7)
  assert.equal(await canSubmit(addForm), false)
  // the same frame twice is a quiz about that one moment
  await fill(addForm, 1, QUIZ + 7)
  await submit(addForm)
  assert.deepEqual(await quizzes(), [[bars[FROM].t, bars[QUIZ].t], [bars[QUIZ + 6].t, bars[QUIZ + 6].t]])
  assert.equal(await has('.sim-quiz-error'), false)
  assert.equal(await navCount(), '140 / 210') // moved to the new quiz, which is the one picked
  assert.ok(await app.ev(`!!${button(editor, '140 미정')} && ${button(editor, '140 미정')}.className === 'active'`))
  await app.click(button(`${editor}.querySelector('.sim-quiz-picked')`, '퀴즈 삭제'))
  await sleep(400)
  assert.deepEqual(await quizzes(), [[bars[FROM].t, bars[QUIZ].t]])

  // picking the quiz from the list goes to its last bar; its range can be changed
  await app.click(button(editor, '125~134 미정'))
  assert.equal(await navCount(), '134 / 210')
  assert.equal(await canSubmit(pickedForm), false) // nothing changed yet
  await fill(pickedForm, 0, FROM - 1)
  await submit(pickedForm)
  assert.deepEqual(await quizzes(), [[bars[FROM - 2].t, bars[QUIZ].t]])
  await fill(pickedForm, 0, FROM + 1)
  await submit(pickedForm)
  assert.deepEqual(await quizzes(), [[bars[FROM].t, bars[QUIZ].t]])

  // the answer and the note
  await app.click(button(`${editor}.querySelector('.sim-quiz-outcome')`, '상승 안 함 (매수 안 함)'))
  await app.waitFor(`document.querySelector('.sim-quiz-editor').textContent.includes('125~134 상승 안 함')`, 'the other answer')
  await sleep(300)
  assert.deepEqual((await api('GET', `/api/sim/scenarios/${scenario.id}/bars`)).quizzes.map((q) => q.outcome), ['loss'])
  await app.click(button(`${editor}.querySelector('.sim-quiz-outcome')`, '상승'))
  await app.click(`document.querySelector('.sim-quiz-note')`)
  await app.send('Input.insertText', { text: '눌림 후 재돌파' })
  await app.click(`document.querySelector('.sim-main .sim-hint')`) // blur -> save
  await sleep(400)
  let data = await api('GET', `/api/sim/scenarios/${scenario.id}/bars`)
  assert.deepEqual(data.quizzes.map((q) => [q.start_time, q.bar_time, q.outcome, q.note]), [
    [bars[FROM].t, bars[QUIZ].t, 'profit', '눌림 후 재돌파'],
  ])
  const quizEditor = await text('.sim-quiz-editor')
  assert.ok(quizEditor.includes('125~134 상승'), quizEditor)
  assert.ok(quizEditor.includes('11/13 09:04 ~ 11/13 09:13'), quizEditor)
  assert.ok(quizEditor.includes(`종가 ${bars[QUIZ].c.toFixed(4)} 기준 11/13 10:29까지`), quizEditor)
  await sleep(300)
  await app.shot('b04_editor_quiz')
  await app.click(button(`document.querySelector('.sim-body')`, '11/13'))

  // the lower pane switches between amount and volume
  const lowerName = await text('.sim-lower-toggle')
  await app.click(`document.querySelector('.sim-lower-toggle')`)
  assert.notEqual(await text('.sim-lower-toggle'), lowerName)
  await app.click(`document.querySelector('.sim-lower-toggle')`)
  assert.equal(await text('.sim-lower-toggle'), lowerName)

  // the left chart switches between 30-minute and 5-minute candles, both built from the 1-minute bars
  const pick = `${pane(0)}.querySelector('.sim-candle-pick')`
  const picked = () => app.ev(`${pick}.querySelector('button.active').textContent`)
  assert.equal(await picked(), '30분봉')
  assert.equal(await app.ev(`!!${pane(1)}.querySelector('.sim-candle-pick')`), false) // the right chart stays 1-minute
  await right(7)
  assert.equal(await navCount(), '128 / 210')
  await app.click(button(pick, '5분봉'))
  await app.waitFor(`${pane(0)}.querySelectorAll('.sim-chart canvas').length > 0`, '5-minute chart')
  assert.equal(await picked(), '5분봉')
  assert.equal(await label(0), readout(forming30(FIRST + 7, 300))) // 09:05–09:07 so far
  assert.equal(await label(1), readout(bars[FIRST + 7]))
  await right(3)
  assert.equal(await label(0), readout(forming30(FIRST + 10, 300))) // the next candle, 09:10
  await sleep(300)
  await app.shot('b04b_editor_5min')
  await app.click(button(pick, '30분봉'))
  assert.equal(await picked(), '30분봉')
  assert.equal(await label(0), readout(forming30(FIRST + 10)))
  await app.click(button(`document.querySelector('.sim-body')`, '11/13'))

  // --- drawing on the 1-minute chart (the editor is at bar FIRST again)
  assert.equal(await navCount(), '121 / 210')
  assert.equal(await app.ev(`!!${pane(0)}.querySelector('.sim-draw-tools')`), false) // not on the 30-minute chart
  await app.ev(`window.confirm = (message) => { window.__asked = message; return window.__yes === true }`)
  const tools = `${pane(1)}.querySelector('.sim-draw-tools')`
  let host = await app.rectOf(`${pane(1)}.querySelector('.sim-chart-host')`)
  const px = (f) => host.x + host.w * f
  const py = (f) => host.y + host.h * f
  const drawings = async () => (await api('GET', `/api/sim/scenarios/${scenario.id}/bars`)).drawings
  // The shapes once the server holds `count` of them: a change is saved in the background.
  const saved = async (count) => {
    const t0 = Date.now()
    for (;;) {
      const list = await drawings()
      if (list.length === count || Date.now() - t0 > 3000) return list
      await sleep(100)
    }
  }
  const canDelete = async () => !(await app.ev(`${button(tools, '삭제')}.disabled`))
  // How many shapes "모두 지우기" would remove, without removing them.
  const shown = async () => {
    if (await app.ev(`${button(tools, '모두 지우기')}.disabled`)) return 0
    await app.ev(`window.__yes = false`)
    await app.click(button(tools, '모두 지우기'))
    return Number((await app.ev(`window.__asked`)).match(/(\d+)개/)[1])
  }
  const drag = async (x1, y1, x2, y2) => {
    await app.mouse('mouseMoved', x1, y1, { button: 'none' })
    await app.mouse('mousePressed', x1, y1, { clickCount: 1 })
    for (let i = 1; i <= 4; i++) await app.mouse('mouseMoved', x1 + ((x2 - x1) * i) / 4, y1 + ((y2 - y1) * i) / 4)
    await app.mouse('mouseReleased', x2, y2, { clickCount: 1 })
    await sleep(250)
  }
  // Picks a tool and drags from one corner to the other (fractions of the chart).
  const draw = async (tool, fx1, fy1, fx2, fy2) => {
    await app.click(button(tools, tool))
    assert.equal(await app.ev(`${button(tools, tool)}.className`), 'active')
    await drag(px(fx1), py(fy1), px(fx2), py(fy2))
  }
  // The chart takes a second click within half a second for a double click, so wait first.
  const clickChart = async (x, y) => {
    await sleep(550)
    await app.clickAt(x, y)
    await sleep(150)
  }

  assert.equal(await canDelete(), false)
  assert.equal(await shown(), 0)
  await draw('사각형', 0.3, 0.2, 0.45, 0.5)
  assert.equal(await has('.sim-draw-layer'), false) // one shape per tool pick
  assert.equal(await canDelete(), true) // the new shape is picked
  await app.key('Escape', 27)
  assert.equal(await canDelete(), false)
  await draw('원', 0.5, 0.15, 0.62, 0.4)
  await draw('선', 0.1, 0.55, 0.25, 0.35)
  let drawn = await saved(3)
  assert.deepEqual(drawn.map((d) => [d.kind, d.at]), [['rect', FIRST], ['ellipse', FIRST], ['line', FIRST]])
  const [rect] = drawn
  assert.ok(rect.x1 < rect.x2 && rect.y1 > rect.y2, JSON.stringify(rect)) // dragged right and down
  assert.ok(rect.x2 <= FIRST && rect.x1 > FIRST - 150, JSON.stringify(rect)) // bar positions
  assert.ok(rect.y1 < 8 && rect.y2 > 3, JSON.stringify(rect)) // prices
  assert.ok(drawn[2].y2 > drawn[2].y1) // the line was dragged upwards
  await sleep(200)
  await app.shot('b04a_drawn')

  // a click on the outline picks a shape; inside it, or on nothing, lets go
  await clickChart(px(0.3), py(0.35))
  assert.equal(await canDelete(), true)
  await clickChart(px(0.375), py(0.35))
  assert.equal(await canDelete(), false)
  // Delete key removes the picked one, and so does the button
  await clickChart(px(0.175), py(0.45))
  assert.equal(await canDelete(), true)
  await app.key('Delete', 46)
  assert.deepEqual((await saved(2)).map((d) => d.kind), ['rect', 'ellipse'])
  assert.equal(await canDelete(), false)
  await clickChart(px(0.62), py(0.275))
  assert.equal(await canDelete(), true)
  await app.click(button(tools, '삭제'))
  assert.deepEqual((await saved(1)).map((d) => d.id), [rect.id])
  // a stray click with a tool draws nothing; Esc puts the tool down
  await app.click(button(tools, '선'))
  await drag(px(0.7), py(0.3), px(0.7) + 2, py(0.3) + 1)
  assert.equal(await has('.sim-draw-layer'), true)
  await app.key('Escape', 27)
  assert.equal(await has('.sim-draw-layer'), false)
  assert.equal((await drawings()).length, 1)

  // ten bars on, the rectangle has moved left with its bars
  const barWidth = (host.w * 0.15) / (rect.x2 - rect.x1)
  await right(1, true)
  assert.equal(await navCount(), '131 / 210')
  await clickChart(px(0.3), py(0.35))
  assert.equal(await canDelete(), false)
  const [left, rightWas] = [px(0.3) - 10 * barWidth, px(0.45) - 10 * barWidth]
  await clickChart(left, py(0.35))
  assert.equal(await canDelete(), true)
  await clickChart(rightWas, py(0.35))
  assert.equal(await canDelete(), true)
  await sleep(200)
  await app.shot('b04b_stepped')

  // zooming in around its left edge keeps that edge under the cursor and pushes the right one away
  for (let i = 0; i < 5; i++) await app.mouse('mouseWheel', left, py(0.35), { button: 'none', deltaX: 0, deltaY: -100 })
  await sleep(300)
  await clickChart(left, py(0.35))
  assert.equal(await canDelete(), true)
  await clickChart(rightWas, py(0.35))
  assert.equal(await canDelete(), false)
  // the width of a bar after the zoom, measured with a new shape (drawn at bar FIRST + 10)
  await draw('원', 0.55, 0.15, 0.7, 0.4)
  drawn = await saved(2)
  const zoomedWidth = (host.w * 0.15) / (drawn[1].x2 - drawn[1].x1)
  assert.ok(zoomedWidth > barWidth * 1.3, `bar width ${barWidth} -> ${zoomedWidth}`)
  await clickChart(left + (rect.x2 - rect.x1) * zoomedWidth, py(0.35))
  assert.equal(await canDelete(), true) // the rectangle grew with the chart
  await draw('선', 0.75, 0.3, 0.88, 0.45)
  assert.deepEqual((await saved(3)).map((d) => [d.kind, d.at]), [['rect', FIRST], ['ellipse', FIRST + 10], ['line', FIRST + 10]])
  assert.equal(await shown(), 3)
  await sleep(200)
  await app.shot('b04c_zoomed')

  // a horizontal line is placed with one click, and is picked anywhere along its price
  await app.click(button(tools, '수평선'))
  assert.equal(await app.ev(`${button(tools, '수평선')}.className`), 'active')
  await drag(px(0.5), py(0.7), px(0.5), py(0.7)) // on the volume: no price there
  assert.equal(await has('.sim-draw-layer'), true)
  assert.equal((await drawings()).length, 3)
  await drag(px(0.5), py(0.55), px(0.5), py(0.55))
  assert.equal(await has('.sim-draw-layer'), false)
  drawn = await saved(4)
  const flat = drawn[3]
  assert.deepEqual([flat.kind, flat.at], ['hline', FIRST + 10])
  assert.ok(flat.x1 === flat.x2 && flat.y1 === flat.y2, JSON.stringify(flat))
  assert.ok(flat.y1 < rect.y2 && flat.y1 > 3, JSON.stringify(flat)) // below the rectangle
  assert.equal(await canDelete(), true)
  await sleep(200)
  await app.shot('b04d_hline')
  await app.key('Escape', 27)
  assert.equal(await canDelete(), false)
  await clickChart(px(0.05), py(0.55) - 12)
  assert.equal(await canDelete(), false)
  await clickChart(px(0.05), py(0.55))
  assert.equal(await canDelete(), true)
  await app.key('Delete', 46)
  assert.deepEqual((await saved(3)).map((d) => d.kind), ['rect', 'ellipse', 'line'])
  assert.equal(await shown(), 3)

  // --- practice
  await app.click(button(`document.querySelector('.sim-head')`, '연습'))
  await app.waitFor(`document.querySelector('.sim-practice-bar')`, 'practice view')
  const runCount = () => text('.sim-practice-bar .sim-nav-count')
  // the run begins at the first bar of the quiz range, counted like everywhere else
  assert.equal(await runCount(), '125 / 210')
  assert.equal(await label(1), readout(bars[FROM]))
  assert.equal(await text('.sim-run-note'), '퀴즈 구간 프레임 125~134 — 134에서 답합니다')
  assert.equal(await has('.sim-question'), false)
  assert.equal(await shown(), 1) // only what was drawn by this bar
  await sleep(300)
  await app.shot('b05_practice_start')
  // frame numbers count from the start of the file here too;
  // the 30-minute candle in progress lists the bars seen so far
  const hoverLast = async (i) => {
    const r = await app.rectOf(`${pane(i)}.querySelector('.sim-chart-host')`)
    for (let x = r.x + r.w - 70; x > r.x + r.w / 2; x -= 2) {
      await app.mouse('mouseMoved', x, r.y + r.h * 0.4, { button: 'none' })
      await sleep(30)
      if (await kst(i)) return
    }
    assert.fail('no bar under the cursor')
  }
  await hoverLast(1)
  assert.deepEqual(hoverLabel(await kst(1)), { t: bars[FROM].t, frames: String(FROM + 1) })
  await hoverLast(0)
  assert.deepEqual(hoverLabel(await kst(0)), { t: bars[FIRST].t, frames: `${FIRST + 1}~${FROM + 1}` })
  await right(2)
  await sleep(200)
  assert.equal(hoverLabel(await kst(0)).frames, `${FIRST + 1}~${FROM + 3}`)
  // the bars before the range are history: the run cannot go back into them
  for (let i = 0; i < 4; i++) await app.key('ArrowLeft', 37)
  assert.equal(await runCount(), '125 / 210')
  assert.equal(await app.ev(`${button(`document.querySelector('.sim-practice-bar')`, '◀')}.disabled`), true)
  // holding ▶ plays bar by bar and stops by itself at the last bar of the range
  const releasePlay = await press(button(`document.querySelector('.sim-practice-bar')`, '▶'))
  await app.waitFor(`document.querySelector('.sim-practice-bar .sim-nav-count').textContent === '134 / 210'`, 'held ▶ to reach the end of the quiz range')
  await sleep(400)
  assert.equal(await runCount(), '134 / 210')
  await releasePlay()
  await right(3)
  assert.equal(await runCount(), '134 / 210') // locked there until the answer
  assert.equal(await label(1), readout(bars[QUIZ]))
  assert.equal(await has('.sim-question'), true)
  assert.equal(await has('.sim-run-note'), false)
  assert.ok((await text('.sim-question')).startsWith('이후 가격이 상승할까요?'))
  assert.ok((await text('.sim-question')).includes('상승 안 함 (매수 안 함)'))
  assert.equal(await shown(), 3) // the shapes drawn at bar FIRST + 10 have appeared
  await sleep(300)
  await app.shot('b06_practice_quiz')

  await app.click(button(`document.querySelector('.sim-question')`, '상승'))
  await app.waitFor(`!document.querySelector('.sim-question')`, 'question to close')
  assert.equal(await has('.sim-result.wrong, .sim-result.correct'), false) // outcome not shown yet
  await right(1)
  assert.equal(await runCount(), '135 / 210')
  assert.equal(await has('.sim-result.wrong, .sim-result.correct'), false)
  // a shape drawn while practising is saved with the bar it was drawn at
  host = await app.rectOf(`${pane(1)}.querySelector('.sim-chart-host')`)
  await draw('사각형', 0.6, 0.2, 0.75, 0.4)
  assert.deepEqual((await drawings()).map((d) => d.at), [FIRST, FIRST + 10, FIRST + 10, FIRST + 14])
  assert.equal(await shown(), 4)
  await app.click(button(`document.querySelector('.sim-result')`, '결과 보기'))
  assert.equal(await has('.sim-result.correct'), true)
  const resultText = await text('.sim-result')
  assert.ok(resultText.startsWith('프레임 125~134 선택: 상승'), resultText)
  assert.ok(resultText.includes('이후 상승 — 정답') && resultText.includes('눌림 후 재돌파'), resultText)
  assert.ok(resultText.includes(`종가 ${bars[QUIZ].c.toFixed(4)} 기준 11/13 10:29까지`), resultText)
  assert.ok((await text('.sim-practice-bar')).includes('퀴즈 1 / 1 · 정답 1 / 1'))
  await app.waitFor(`${scenarioRow(SCENARIO)}.textContent.includes('정답 1/1')`, 'sidebar stats')
  await right(8, true)
  assert.equal(await runCount(), '210 / 210')
  assert.equal(await label(1), readout(bars.at(-1)))
  assert.equal(await label(0), readout(forming30(bars.length - 1)))
  await sleep(300)
  await ticksAreOverTheirFrames(200) // file frame numbers in practice too
  await app.shot('b07_practice_end')

  await app.click(button(`document.querySelector('.sim-practice-bar')`, '처음부터 다시'))
  assert.equal(await runCount(), '125 / 210')
  assert.equal(await has('.sim-result'), false)
  // "모두 지우기" removes what is on the chart now, not the shapes still to come
  assert.equal(await shown(), 1)
  await app.ev(`window.__yes = true`)
  await app.click(button(tools, '모두 지우기'))
  assert.deepEqual((await saved(3)).map((d) => d.at), [FIRST + 10, FIRST + 10, FIRST + 14])
  assert.equal(await shown(), 0)
  data = await api('GET', `/api/sim/scenarios/${scenario.id}/bars`)
  assert.deepEqual(data.attempts.map((a) => [a.answer, a.result]), [['buy', 'correct']])

  // a scenario with quiz points opens in practice mode
  await app.send('Page.reload')
  await sleep(500)
  await app.waitFor(scenarioRow(SCENARIO), 'scenario row')
  await app.click(scenarioRow(SCENARIO))
  await app.waitFor(`document.querySelector('.sim-practice-bar')`, 'practice view on open')

  // --- "My Insight": a quiz's insight drawn on the 1-minute chart
  const toggle = `${pane(1)}.querySelector('.sim-insight-toggle')`
  const insightButton = () => app.ev(`(() => { const b = ${toggle}; return [b.disabled, b.className.includes('active'), b.title] })()`)
  const notes = () => app.ev(`[...document.querySelectorAll('.sim-insight-notes li')].map((li) => li.textContent)`)
  const openScenario = async () => {
    await app.send('Page.reload')
    await sleep(500)
    await app.waitFor(scenarioRow(SCENARIO), 'scenario row')
    await app.click(scenarioRow(SCENARIO))
    await app.waitFor(`document.querySelector('.sim-practice-bar')`, 'practice view on open')
  }
  assert.equal(await app.ev(`!!${pane(0)}.querySelector('.sim-insight-toggle')`), false) // only on the 1-minute chart
  assert.deepEqual(await insightButton(), [true, false, '이 시나리오의 퀴즈에 등록된 해석이 없습니다'])
  const INSIGHT_NOTES = ['① 126~130 구간의 설명', '② 134에서 판단 → 이후 상승']
  await api('PUT', `/api/sim/bar-quizzes/${data.quizzes[0].id}/insight`, {
    zones: [{ start: FROM + 2, end: FROM + 6, text: '① 구간' }],
    levels: [{ price: bars[FROM + 4].c, start: FROM + 5, end: QUIZ + 20, text: '자리' }],
    vlines: [{ frame: QUIZ + 1, text: '② 판단' }],
    marks: [{ frame: QUIZ + 3, text: '이후', side: 'below' }],
    notes: INSIGHT_NOTES,
  })
  await openScenario()
  // in practice it is kept back until its quiz has been answered
  assert.deepEqual(await insightButton(), [true, false, '해석이 있는 퀴즈에 답한 뒤에 볼 수 있습니다'])
  await right(9)
  assert.equal(await runCount(), '134 / 210')
  assert.equal((await insightButton())[0], true)
  await app.click(button(`document.querySelector('.sim-question')`, '상승'))
  await app.waitFor(`!document.querySelector('.sim-question')`, 'question to close')
  assert.deepEqual(await insightButton(), [false, false, '프레임 125~134 퀴즈의 해석을 차트에 표시합니다'])
  assert.deepEqual(await notes(), [])
  await app.click(toggle)
  assert.deepEqual((await insightButton()).slice(0, 2), [false, true])
  assert.deepEqual(await notes(), INSIGHT_NOTES)
  assert.equal(await has('.sim-panes.insight-on'), true)
  assert.equal(await runCount(), '134 / 210') // the run stays where it is
  await right(4)
  assert.equal(await runCount(), '138 / 210')
  await sleep(300)
  await app.shot('b08_insight_practice')
  await app.click(toggle)
  assert.deepEqual((await insightButton()).slice(0, 2), [false, false])
  assert.deepEqual(await notes(), [])
  assert.equal(await has('.sim-panes.insight-on'), false)
  // a new run has answered nothing yet
  await app.click(toggle)
  await app.click(button(`document.querySelector('.sim-practice-bar')`, '처음부터 다시'))
  assert.equal((await insightButton())[0], true)
  assert.deepEqual(await notes(), [])

  // in the editor it goes on to the last bar the insight covers — 30 bars past the quiz range — and picks the quiz
  await app.click(button(`document.querySelector('.sim-head')`, '편집'))
  await app.waitFor(`document.querySelector('.sim-quiz-editor')`, 'editor')
  assert.equal(await text('.sim-bar-nav .sim-nav-count'), '125 / 210')
  assert.deepEqual(await insightButton(), [false, false, '프레임 125~134 퀴즈의 해석을 차트에 표시합니다'])
  await app.click(toggle)
  assert.equal(await text('.sim-bar-nav .sim-nav-count'), '164 / 210')
  assert.deepEqual(await notes(), INSIGHT_NOTES)
  assert.equal(await app.ev(`${button(`document.querySelector('.sim-quiz-editor')`, '125~134 상승')}.className`), 'active')
  await sleep(300)
  await app.shot('b09_insight_editor')
  await app.click(toggle)
  assert.deepEqual(await notes(), [])
  assert.equal(await text('.sim-bar-nav .sim-nav-count'), '164 / 210')
  // without the insight the button has nothing to show
  await api('DELETE', `/api/sim/bar-quizzes/${data.quizzes[0].id}/insight`)
  await openScenario()
  assert.deepEqual(await insightButton(), [true, false, '이 시나리오의 퀴즈에 등록된 해석이 없습니다'])

  // --- the divider between the two charts: dragged to resize them, remembered, double-clicked for the default widths
  const splitter = `document.querySelector('.sim-splitter')`
  const widths = async () => [(await app.rectOf(pane(0))).w, (await app.rectOf(pane(1))).w]
  const dragSplitter = async (dx) => {
    const r = await app.rectOf(splitter)
    const x = r.x + r.w / 2
    const y = r.y + r.h / 2
    await app.mouse('mouseMoved', x, y, { button: 'none' })
    await app.mouse('mousePressed', x, y, { clickCount: 1 })
    for (let i = 1; i <= 4; i++) await app.mouse('mouseMoved', x + (dx * i) / 4, y)
    await app.mouse('mouseReleased', x + dx, y, { clickCount: 1 })
    await sleep(200)
  }
  const near = (a, b) => Math.abs(a - b) <= 2
  await app.ev(`localStorage.removeItem('sim.split')`)
  await openScenario()
  const [even0, even1] = await widths()
  assert.ok(near(even0, even1), `even at first: ${even0} / ${even1}`)
  await dragSplitter(-150)
  let [w0, w1] = await widths()
  assert.ok(near(w0, even0 - 150) && near(w1, even1 + 150), `after the drag: ${w0} / ${w1}`)
  assert.equal(await app.ev(`${splitter}.className`), 'sim-splitter') // released
  await sleep(300)
  {
    // the frame numbers stay under their bars when the chart is given another width
    const ticks = await frameTicks(1)
    assert.ok(ticks.length > 0)
    for (const tick of ticks) {
      await hover(1, tick.fx, 0.4)
      assert.equal(hoverLabel(await kst(1)).frames, tick.text)
    }
    await app.mouse('mouseMoved', 5, 5, { button: 'none' })
    await sleep(150)
  }
  await app.shot('b10_split')
  await openScenario() // remembered
  assert.deepEqual((await widths()).map(Math.round), [w0, w1].map(Math.round))
  await app.click(button(`document.querySelector('.sim-head')`, '편집')) // the editor shares it
  await app.waitFor(`document.querySelector('.sim-quiz-editor')`, 'editor')
  assert.ok(near((await widths())[0], w0))
  await dragSplitter(-2000) // no narrower than 15% of the row
  ;[w0, w1] = await widths()
  const row = (await app.rectOf(`document.querySelector('.sim-panes')`)).w
  assert.ok(near(w0, row * 0.15), `narrowest: ${w0} of ${row}`)
  await dragSplitter(4000) // nor wider than 85%
  ;[w0, w1] = await widths()
  assert.ok(near(w0, row * 0.85), `widest: ${w0} of ${row}`)
  {
    const r = await app.rectOf(splitter)
    const x = r.x + r.w / 2
    const y = r.y + r.h / 2
    await app.mouse('mousePressed', x, y, { clickCount: 1 })
    await app.mouse('mouseReleased', x, y, { clickCount: 1 })
    await app.mouse('mousePressed', x, y, { clickCount: 2 })
    await app.mouse('mouseReleased', x, y, { clickCount: 2 })
    await sleep(200)
  }
  ;[w0, w1] = await widths()
  assert.ok(near(w0, w1), `even again: ${w0} / ${w1}`)
  assert.equal(await app.ev(`localStorage.getItem('sim.split')`), null)
  await app.click(button(`document.querySelector('.sim-head')`, '연습'))
  await app.waitFor(`document.querySelector('.sim-practice-bar')`, 'practice view')

  // --- delete from the editor
  await app.click(button(`document.querySelector('.sim-head')`, '편집'))
  await app.ev(`window.confirm = () => true`)
  await app.click(button(`document.querySelector('.sim-head')`, '시나리오 삭제'))
  await app.waitFor(`!${scenarioRow(SCENARIO)}`, 'scenario to disappear')
  assert.equal((await api('GET', '/api/sim/scenarios')).some((s) => s.name === SCENARIO), false)

  console.log('bars ui test passed')
} catch (e) {
  console.error('FAILED:', e.stack)
  process.exitCode = 1
} finally {
  await cleanup().catch(() => undefined)
  browser.close()
}
