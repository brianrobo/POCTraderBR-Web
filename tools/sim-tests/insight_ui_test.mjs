// Drives the insight map in headless Chrome over CDP: files a quiz under a new
// node from the simulator's editor, organises the map (inbox, node detail,
// child nodes, merging), opens a quiz back in the simulator, and checks that a
// deleted quiz or node takes its links with it.
//
//   node tools/sim-tests/insight_ui_test.mjs <absolute path of tools/sim-tests>
//
// Needs the server on :8000 serving the current build. Screenshots (i*.png)
// are written next to this file.
import assert from 'node:assert/strict'
import { APP, api, button, launch, scenarioRow, sleep } from './harness.mjs'

const DIR = process.argv[2]
const SCENARIO = '__uitest 인사이트'
const NODE = '__uitest 눌림목'
const CHILD = '__uitest 재돌파'

// One session of 1-minute bars: 11/13 09:00–09:59.
const COUNT = 60
const cdt = Buffer.alloc(8 + COUNT * 64)
cdt.writeInt32LE(1, 0)
cdt.writeInt32LE(COUNT, 4)
for (let i = 0; i < COUNT; i++) {
  const c = 5 + Math.sin(i / 7) * 0.5
  const stamp = 20261113090000 + i * 100
  ;[stamp, c - 0.01, c + 0.03, c - 0.03, c, 1000 + i, 0, 0].forEach((x, k) => cdt.writeDoubleLE(x, 8 + i * 64 + k * 8))
}

const cleanup = async () => {
  for (const s of await api('GET', '/api/sim/scenarios')) if (s.name === SCENARIO) await api('DELETE', `/api/sim/scenarios/${s.id}`)
  // this test's nodes, the ones under others first
  for (;;) {
    const mine = (await api('GET', '/api/insights')).nodes.filter((n) => n.name.startsWith('__uitest'))
    if (mine.length === 0) break
    for (const n of mine.filter((leaf) => !mine.some((m) => m.parent_id === leaf.id)))
      await api('DELETE', `/api/insights/nodes/${n.id}`)
  }
}

const map = () => api('GET', '/api/insights')
const nodeNamed = async (name) => (await map()).nodes.find((n) => n.name === name)
/** quiz id -> stance of the quizzes a node rests on. */
const linksOf = async (nodeId) =>
  Object.fromEntries((await map()).evidence.filter((e) => e.node_id === nodeId).map((e) => [e.quiz_id, e.stance]))
/** How many quizzes are filed under no node. */
const loose = async () => {
  const m = await map()
  const filed = new Set(m.evidence.map((e) => e.quiz_id))
  return m.quizzes.filter((q) => !filed.has(q.id)).length
}
const until = async (check, what, timeout = 10000) => {
  const end = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`)
    await sleep(100)
  }
}

const browser = await launch(DIR, 9335)
try {
  await cleanup()
  const mapBefore = await map()

  // --- a scenario with two quizzes: frames 20~30 (with a note) and frame 45
  const form = new FormData()
  form.append('name', SCENARIO)
  form.append('file', new Blob([cdt]), 'UITEST_1분봉.cdt')
  const res = await fetch(`${APP}/api/sim/scenarios/import`, { method: 'POST', body: form })
  assert.equal(res.status, 200)
  const scenario = await res.json()
  const times = (await api('GET', `/api/sim/scenarios/${scenario.id}/bars`)).bars.map((b) => b[0])
  assert.equal(times.length, COUNT)
  const quizzes = `/api/sim/scenarios/${scenario.id}/bar-quizzes`
  const q1 = await api('POST', quizzes, { start_time: times[19], bar_time: times[29] })
  await api('PATCH', `/api/sim/bar-quizzes/${q1.id}`, { note: '눌림 후 재돌파' })
  const q2 = await api('POST', quizzes, { bar_time: times[44] })

  const app = await browser.openApp()
  const subtab = (text) => button(`document.querySelector('.virtualsim-subtabs')`, text)
  const head = `document.querySelector('.sim-head')`
  const editor = `document.querySelector('.sim-quiz-editor')`
  const linker = `document.querySelector('.sim-quiz-insights .insight-linker')`
  const main = `document.querySelector('.insight-main')`
  const row = (name) =>
    `[...document.querySelectorAll('.insight-row')].find((r) => r.querySelector('.tree-label').textContent === ${JSON.stringify(name)})`
  // The card of one of this test's quizzes, in the inbox or in a node's evidence.
  const card = (frames) =>
    `[...document.querySelectorAll('.insight-evidence')].find((c) => c.textContent.includes(${JSON.stringify(SCENARIO)}) && c.textContent.includes(${JSON.stringify(frames)}))`
  const choose = (selectExpr, value) =>
    app.ev(`(() => { const el = ${selectExpr}; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  const inboxCount = () => app.ev(`Number(document.querySelector('.insight-sidebar .tree-row .insight-count').textContent)`)
  const openEditor = async () => {
    await app.click(scenarioRow(SCENARIO))
    await app.waitFor(`document.querySelector('.sim-practice-bar')`, 'practice view')
    await app.click(button(head, '편집'))
    await app.waitFor(editor, 'editor')
  }

  assert.deepEqual(
    await app.ev(`[...document.querySelectorAll('.virtualsim-subtabs button')].map((b) => b.textContent.trim())`),
    ['시뮬레이터', '인사이트 맵'],
  )

  // --- the editor files the picked quiz under a new node
  await openEditor()
  await app.click(button(editor, '20~30 미정'))
  await app.waitFor(linker, 'insight linker')
  assert.equal(await app.ev(`!!${linker}.querySelector('.insight-chip')`), false)
  await app.ev(`window.prompt = () => ${JSON.stringify(NODE)}`)
  await app.click(button(linker, '+ 새 항목'))
  await app.waitFor(`${linker}.querySelector('.insight-chip.support')`, 'chip of the new node')
  assert.equal(await app.ev(`${linker}.querySelector('.insight-chip-name').textContent`), NODE)
  const top = await nodeNamed(NODE)
  assert.deepEqual([top.parent_id, top.kind, top.status], [null, '', 'candidate'])
  assert.deepEqual(await linksOf(top.id), { [q1.id]: 'support' })
  // the chip's button flips support / counter-example
  await app.click(button(`${linker}.querySelector('.insight-chip')`, '지지'))
  await app.waitFor(`${linker}.querySelector('.insight-chip.counter')`, 'counter chip')
  assert.deepEqual(await linksOf(top.id), { [q1.id]: 'counter' })
  await app.click(button(`${linker}.querySelector('.insight-chip')`, '반례'))
  await app.waitFor(`${linker}.querySelector('.insight-chip.support')`, 'support chip')
  await sleep(200)
  await app.shot('i01_editor_linker')
  // the other quiz is not filed yet, and can pick the node there is
  await app.click(button(editor, '45 미정'))
  await app.waitFor(`!${linker}.querySelector('.insight-chip')`, 'no chip at the other quiz')
  assert.ok(await app.ev(`[...${linker}.querySelectorAll('option')].some((o) => o.textContent === ${JSON.stringify(NODE)})`))

  // --- the map: the inbox lists the quizzes filed nowhere
  await app.click(subtab('인사이트 맵'))
  await app.waitFor(row(NODE), 'node in the tree')
  assert.equal(await inboxCount(), await loose())
  assert.equal(await app.ev(`!!${card('프레임 45')}`), true)
  assert.equal(await app.ev(`!!${card('프레임 20~30')}`), false)
  assert.equal(await app.ev(`${row(NODE)}.querySelector('.insight-count').textContent`), '1')
  await sleep(200)
  await app.shot('i02_inbox')
  const looseBefore = await inboxCount()
  await choose(`${card('프레임 45')}.querySelector('select')`, top.id)
  await app.waitFor(`!${card('프레임 45')}`, 'card to leave the inbox')
  assert.equal(await inboxCount(), looseBefore - 1)
  assert.deepEqual(await linksOf(top.id), { [q1.id]: 'support', [q2.id]: 'support' })

  // --- node detail
  await app.click(row(NODE))
  await app.waitFor(`document.querySelector('.insight-name')`, 'node detail')
  assert.equal(await app.ev(`document.querySelector('.insight-name').value`), NODE)
  assert.ok((await app.ev(`${card('프레임 20~30')}.textContent`)).includes('눌림 후 재돌파')) // the quiz's note
  await app.click(button(main, '매수 근거'))
  await app.click(button(main, '확정'))
  await app.waitFor(
    `${row(NODE)}.querySelector('.insight-kind.buy') && ${row(NODE)}.querySelector('.insight-status.confirmed')`,
    'kind and status in the tree',
  )
  await app.click(`${main}.querySelector('textarea')`)
  await app.send('Input.insertText', { text: '지지 확인 후 재돌파에서만' })
  await app.click(`${main}.querySelector('.insight-heading')`) // out of the field
  await until(async () => (await nodeNamed(NODE)).description === '지지 확인 후 재돌파에서만', 'description to save')
  // a quiz that went against the rule
  await app.click(button(card('프레임 45'), '반례'))
  await app.waitFor(`${card('프레임 45')}.classList.contains('counter')`, 'counter card')
  assert.deepEqual(await linksOf(top.id), { [q1.id]: 'support', [q2.id]: 'counter' })
  assert.ok((await app.ev(`${main}.textContent`)).includes('지지 1 · 반례 1'))
  assert.equal(await app.ev(`${row(NODE)}.querySelector('.insight-count').textContent`), '1 : 1')
  await app.click(`${card('프레임 45')}.querySelector('.insight-comment')`)
  await app.send('Input.insertText', { text: '거래량 없이 올랐다' })
  await app.key('Enter', 13)
  await until(
    async () => (await map()).evidence.some((e) => e.quiz_id === q2.id && e.comment === '거래량 없이 올랐다'),
    'comment to save',
  )
  await sleep(200)
  await app.shot('i03_node_detail')

  // --- a node under it, added from the tree
  const at = await app.rectOf(row(NODE))
  await app.mouse('mouseMoved', at.x + 60, at.y + at.h / 2, { button: 'none' })
  await app.ev(`window.prompt = () => ${JSON.stringify(CHILD)}`)
  await app.click(`${row(NODE)}.querySelector('.tree-actions button[title="하위 항목 추가"]')`)
  await app.waitFor(row(CHILD), 'child row')
  await app.waitFor(`document.querySelector('.insight-name').value === ${JSON.stringify(CHILD)}`, 'child detail')
  const child = await nodeNamed(CHILD)
  assert.equal(child.parent_id, top.id)
  assert.equal(await app.ev(`${main}.querySelector('.sim-hint').textContent`), NODE) // where it is
  // folding the parent hides it
  await app.click(`${row(NODE)}.querySelector('.tree-toggle')`)
  await app.waitFor(`!${row(CHILD)}`, 'child to fold away')
  await app.click(`${row(NODE)}.querySelector('.tree-toggle')`)
  await app.waitFor(row(CHILD), 'child to unfold')
  // a quiz picked from the node's side
  await choose(`${main}.querySelector('select[aria-label="퀴즈 연결"]')`, q1.id)
  await app.waitFor(card('프레임 20~30'), 'evidence card on the child')
  assert.deepEqual(await linksOf(child.id), { [q1.id]: 'support' })
  await app.click(row(NODE))
  await app.waitFor(`document.querySelector('.insight-name').value === ${JSON.stringify(NODE)}`, 'parent detail')
  assert.ok((await app.ev(`${main}.textContent`)).includes('(하위 항목 포함: 지지 2 · 반례 1'))
  // up to the top level, then folded into the first node
  await app.click(row(CHILD))
  await app.waitFor(`document.querySelector('.insight-name').value === ${JSON.stringify(CHILD)}`, 'child detail')
  await choose(`${main}.querySelector('select[aria-label="상위 항목"]')`, '')
  await until(async () => (await nodeNamed(CHILD)).parent_id === null, 'child to move to the top level')
  let asked = ''
  await app.ev(`window.confirm = (m) => { window.__asked = m; return true }`)
  await choose(`${main}.querySelector('select[aria-label="다른 항목에 합치기"]')`, top.id)
  await app.waitFor(`!${row(CHILD)}`, 'merged node to go')
  asked = await app.ev(`window.__asked`)
  assert.ok(asked.includes(CHILD) && asked.includes(NODE), asked)
  await app.waitFor(`document.querySelector('.insight-name').value === ${JSON.stringify(NODE)}`, 'merge target detail')
  assert.equal(await nodeNamed(CHILD), undefined)
  assert.deepEqual(await linksOf(top.id), { [q1.id]: 'support', [q2.id]: 'counter' })

  // --- from a card back to the quiz, in the scenario's editor
  await app.click(button(card('프레임 20~30'), '시뮬레이터에서 열기'))
  await app.waitFor(`document.querySelector('.sim-quiz-picked')`, 'quiz in the editor')
  assert.equal(await app.ev(`${subtab('시뮬레이터')}.classList.contains('active')`), true)
  assert.equal(await app.ev(`${button(head, '편집')}.classList.contains('active')`), true)
  assert.equal(await app.ev(`document.querySelector('.sim-quiz-picked input[aria-label="시작 프레임"]').value`), '20')
  assert.equal(await app.ev(`document.querySelector('.sim-quiz-picked input[aria-label="끝 프레임"]').value`), '30')
  assert.equal(await app.ev(`document.querySelector('.sim-bar-nav .sim-nav-count').textContent`), '30 / 60')
  await app.waitFor(`${linker} && ${linker}.querySelector('.insight-chip-name')`, 'chip in the editor')
  assert.equal(await app.ev(`${linker}.querySelector('.insight-chip-name').textContent`), NODE)
  // the map comes back to the node it was on
  await app.click(subtab('인사이트 맵'))
  await app.waitFor(`document.querySelector('.insight-name')`, 'node detail again')
  assert.equal(await app.ev(`document.querySelector('.insight-name').value`), NODE)

  // --- a deleted quiz takes its links with it
  await app.click(subtab('시뮬레이터'))
  await app.waitFor(scenarioRow(SCENARIO), 'scenario row')
  assert.equal(await app.ev(`!!${editor}`), false) // a plain visit opens nothing
  await openEditor()
  await app.click(button(editor, '45 미정'))
  await app.waitFor(`${linker} && ${linker}.querySelector('.insight-chip.counter')`, 'chip of the other quiz')
  await app.click(button(`document.querySelector('.sim-quiz-picked')`, '퀴즈 삭제'))
  await until(async () => (await map()).quizzes.every((q) => q.id !== q2.id), 'quiz to go')
  asked = await app.ev(`window.__asked`)
  assert.ok(asked.includes('프레임 45') && asked.includes('인사이트 항목 1개'), asked)
  assert.deepEqual(await linksOf(top.id), { [q1.id]: 'support' })

  // --- a deleted node leaves its quizzes, back in the inbox
  await app.click(subtab('인사이트 맵'))
  await app.waitFor(`document.querySelector('.insight-name')`, 'node detail')
  await app.click(button(main, '항목 삭제'))
  await app.waitFor(`!${row(NODE)}`, 'node to go')
  asked = await app.ev(`window.__asked`)
  assert.ok(asked.includes(NODE) && asked.includes('퀴즈 1개'), asked)
  await app.waitFor(card('프레임 20~30'), 'quiz back in the inbox')
  assert.equal(await inboxCount(), await loose())
  assert.equal((await api('GET', `/api/sim/scenarios/${scenario.id}/bars`)).quizzes.length, 1)

  await cleanup()
  assert.deepEqual(await map(), mapBefore)
  console.log('insight ui test passed')
} catch (e) {
  console.error('FAILED:', e.stack)
  process.exitCode = 1
} finally {
  await cleanup().catch(() => undefined)
  browser.close()
}
