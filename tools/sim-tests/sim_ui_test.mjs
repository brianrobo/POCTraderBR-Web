// Drives the built app in headless Chrome over CDP: captures a fake "chart"
// tab through the real getDisplayMedia path, then exercises editor + practice.
//
//   node tools/sim-tests/sim_ui_test.mjs <absolute path of tools/sim-tests>
//
// Needs the server on :8000 serving the current build. Screenshots and the
// captured frames are written next to this file. Env: FALLBACK=1 tests the
// <video>-sampling path (no MediaStreamTrackProcessor), DIAG=1 logs each
// step, KEEP=1 leaves the `__uitest` scenario in place.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { APP, api, button, launch, pane, scenarioRow, sleep } from './harness.mjs'

const DIR = process.argv[2]
const SCENARIO = '__uitest'
// Pause after each candle step of the fake chart. Headless Chrome may deliver
// frames of the captured (background) tab only about once a second.
const STEP_MS = 1500

const browser = await launch(DIR, 9333, ['--auto-select-tab-capture-source-by-title=FAKECHART'])

let scenarioId
try {
  for (const s of await api('GET', '/api/sim/scenarios')) if (s.name === SCENARIO) await api('DELETE', `/api/sim/scenarios/${s.id}`)
  scenarioId = (await api('POST', '/api/sim/scenarios', { name: SCENARIO })).id

  const chart = await browser.openPage(pathToFileURL(`${DIR}/fakechart.html`).href, 1000, 600)
  const app = await browser.openApp()
  await app.waitFor(scenarioRow(SCENARIO), 'scenario row')
  await app.shot('01_list')
  await app.click(scenarioRow(SCENARIO))
  await app.waitFor(`document.querySelectorAll('.sim-pane').length === 2`, 'editor panes')
  await app.shot('02_editor_empty')

  // --- live capture of each track
  for (const [track, paneIndex, steps] of [['1m', 1, 8], ['30m', 0, 3]]) {
    await chart.ev(`reset(${JSON.stringify(track)})`)
    if (!process.env.NO_FRONT) await app.send('Page.bringToFront')
    console.log(track, 'before capture click:', await app.ev(`document.visibilityState + ' focus=' + document.hasFocus()`))
    await app.click(button(pane(paneIndex), '화면 캡쳐'))
    // Headless tab capture sends no frame while the captured tab is static, so
    // repaint it (same pixels) until the first frame shows up.
    await app.waitFor(`document.querySelector('.clip-overlay.picking video')`, 'picking overlay')
    for (let i = 0; i < 10 && !(await app.ev(`document.querySelector('.clip-overlay.picking video').videoWidth > 0`)); i++) {
      await chart.ev(`reset(${JSON.stringify(track)})`)
      await sleep(500)
    }
    try {
      await app.waitFor(`document.querySelector('.clip-overlay.picking video')?.videoWidth > 0`, 'shared stream', 15000)
    } catch (e) {
      console.log('capture did not start; error text:', await app.ev(`document.querySelector('.clip-error')?.textContent ?? null`))
      const state = `(() => { const o = document.querySelector('.clip-overlay'); const v = document.querySelector('.clip-overlay video');
        const t = v?.srcObject?.getVideoTracks?.()[0];
        return JSON.stringify({ overlay: o?.className ?? null, video: v ? { w: v.videoWidth, ready: v.readyState, paused: v.paused, hasSrc: !!v.srcObject } : null,
          track: t ? { state: t.readyState, muted: t.muted, enabled: t.enabled, settings: t.getSettings() } : null }) })()`
      console.log('state:', await app.ev(state))
      await chart.ev('step()')
      await sleep(1500)
      console.log('after a chart step:', await app.ev(state))
      await app.shot('fail_capture')
      throw e
    }
    // headless tab capture starts small and switches resolution; wait for the layout to stop moving
    for (let last = '', same = 0; same < 8; ) {
      const now = JSON.stringify(await app.rectOf(`document.querySelector('.clip-stage')`))
      same = now === last ? same + 1 : 0
      last = now
      await sleep(150)
    }
    if (process.env.FALLBACK) await app.ev(`delete window.MediaStreamTrackProcessor`)
    const stage = await app.rectOf(`document.querySelector('.clip-stage')`)
    const [x0, y0, x1, y1] = [stage.x + stage.w * 0.02, stage.y + stage.h * 0.02, stage.x + stage.w * 0.98, stage.y + stage.h * 0.98]
    await app.mouse('mouseMoved', x0, y0, { button: 'none' })
    await app.mouse('mousePressed', x0, y0, { clickCount: 1 })
    await app.mouse('mouseMoved', (x0 + x1) / 2, (y0 + y1) / 2)
    await app.mouse('mouseMoved', x1, y1)
    await app.mouse('mouseReleased', x1, y1, { clickCount: 1 })
    await sleep(200)
    console.log(
      'stage', JSON.stringify(stage),
      'sel', await app.ev(`document.querySelector('.clip-sel')?.getAttribute('style') ?? null`),
      'video', await app.ev(`(() => { const v = document.querySelector('.clip-video'); return v.videoWidth + 'x' + v.videoHeight })()`),
    )
    if (track === '1m') await app.shot('03_picking')
    await app.click(button(`document.querySelector('.clip-actions')`, '캡쳐 시작'))
    await app.waitFor(`document.querySelector('.clip-rec-pill')`, 'capturing pill')
    await sleep(900)
    for (let i = 0; i < steps; i++) {
      await chart.ev('step()')
      await sleep(STEP_MS)
      if (process.env.DIAG)
        console.log(
          ' step', i + 1,
          await app.ev(`(() => { const v = document.querySelector('.clip-video'); const q = v.getVideoPlaybackQuality();
            return JSON.stringify({ pill: document.querySelector('.clip-rec-pill').textContent, t: v.currentTime, paused: v.paused, frames: q.totalVideoFrames, dropped: q.droppedVideoFrames, vis: document.visibilityState }) })()`),
        )
    }
    if (process.env.DIAG) {
      const d = await api('GET', `/api/sim/scenarios/${scenarioId}`)
      const fr = d.frames.filter((f) => f.track === track)
      for (let i = 0; i < fr.length; i++) {
        const img = await fetch(APP + fr[i].image_url)
        writeFileSync(`${DIR}/diag_${track}_${i}.png`, Buffer.from(await img.arrayBuffer()))
      }
    }
    console.log(track, 'pill:', await app.ev(`document.querySelector('.clip-rec-pill').textContent`))
    await app.click(button(`document.querySelector('.clip-rec-pill')`, '정지'))
    await app.waitFor(`!document.querySelector('.clip-rec-pill')`, 'capture to finish', 15000)
    await sleep(300)
    const detail = await api('GET', `/api/sim/scenarios/${scenarioId}`)
    const frames = detail.frames.filter((f) => f.track === track)
    console.log(track, 'frames saved:', frames.length, '(expected', steps + 1, ')')
    assert.equal(frames.length, steps + 1)
    for (let i = 0; i < frames.length; i++) {
      const img = await fetch(APP + frames[i].image_url)
      writeFileSync(`${DIR}/frame_${track}_${i}.png`, Buffer.from(await img.arrayBuffer()))
    }
    // the editor shows them without a reload
    assert.equal(await app.ev(`${pane(paneIndex)}.querySelector('.sim-nav-count').textContent`), `1 / ${steps + 1}`)
  }
  await app.shot('04_editor_captured')

  // --- sync: 30m #2 appears from 1m #4, 30m #3 from 1m #7
  const count = (i) => app.ev(`${pane(i)}.querySelector('.sim-nav-count').textContent`)
  const next = (i) => app.click(button(pane(i), '▶'))
  await next(0)
  for (let i = 0; i < 3; i++) await next(1)
  assert.equal(await count(0), '2 / 4')
  assert.equal(await count(1), '4 / 9')
  await app.click(button(pane(0), '지금 1분봉 #4에 맞추기'))
  await app.waitFor(`${pane(0)}.querySelector('.sim-sync').textContent.includes('1분봉 #4')`, 'sync text')
  await next(0)
  for (let i = 0; i < 3; i++) await next(1)
  await app.click(button(pane(0), '지금 1분봉 #7에 맞추기'))
  await app.waitFor(`${pane(0)}.querySelector('.sim-sync').textContent.includes('1분봉 #7')`, 'sync text 2')

  // --- quiz on 1m #5 via keyboard navigation (1m pane is active after the clicks above)
  await app.click(`${pane(1)}.querySelector('.sim-stage')`)
  await app.key('ArrowLeft', 37)
  await app.key('ArrowLeft', 37)
  assert.equal(await count(1), '5 / 9')
  assert.equal(await count(0), '3 / 4') // the other pane did not move
  await app.click(`document.querySelector('.sim-check input')`)
  await app.waitFor(`document.querySelector('.sim-quiz-note')`, 'quiz note box')
  await app.click(button(`document.querySelector('.sim-quiz-editor')`, '손실 (패스가 정답)'))
  await app.click(`document.querySelector('.sim-quiz-note')`)
  await app.send('Input.insertText', { text: '고점 처리 없이 밀림' })
  await app.click(`${pane(1)}.querySelector('.sim-stage')`) // blur -> save
  await sleep(400)
  await app.shot('05_editor_quiz')
  let detail = await api('GET', `/api/sim/scenarios/${scenarioId}`)
  const m1 = detail.frames.filter((f) => f.track === '1m')
  const m30 = detail.frames.filter((f) => f.track === '30m')
  assert.deepEqual(m30.map((f) => f.sync_frame_id), [null, m1[3].id, m1[6].id, null])
  assert.deepEqual([m1[4].is_quiz, m1[4].quiz_outcome, m1[4].quiz_note], [true, 'loss', '고점 처리 없이 밀림'])
  assert.equal(await app.ev(`document.querySelector('.sim-hint .sim-warn')?.textContent.trim()`), '동기화 안 된 30분봉 프레임 1개 (연습 화면에 나오지 않습니다)')

  // --- practice
  await app.click(button(`document.querySelector('.sim-head')`, '연습'))
  await app.waitFor(`document.querySelector('.sim-practice-bar')`, 'practice view')
  const src = (i) => app.ev(`new URL(${pane(i)}.querySelector('.sim-stage img')?.src ?? 'http://x/none').pathname`)
  const barCount = () => app.ev(`document.querySelector('.sim-practice-bar .sim-nav-count').textContent`)
  const has = (sel) => app.ev(`!!document.querySelector(${JSON.stringify(sel)})`)
  const right = async (n) => {
    for (let i = 0; i < n; i++) await app.key('ArrowRight', 39)
  }
  assert.equal(await src(0), m30[0].image_url) // unsynced first 30m frame is the starting chart
  assert.equal(await src(1), m1[0].image_url)
  await app.shot('06_practice_start')
  await right(2)
  assert.equal(await src(0), m30[0].image_url)
  await right(1)
  assert.equal(await src(1), m1[3].image_url)
  assert.equal(await src(0), m30[1].image_url) // 30m #2 appears exactly at 1m #4
  assert.equal(await has('.sim-question'), false)
  await right(6)
  assert.equal(await src(1), m1[4].image_url) // locked at the quiz frame
  assert.equal(await barCount(), '5 / 9')
  assert.equal(await has('.sim-question'), true)
  await app.shot('07_practice_quiz')

  await app.click(button(`document.querySelector('.sim-question')`, '매수'))
  await app.waitFor(`!document.querySelector('.sim-question')`, 'question to close')
  assert.equal(await has('.sim-result'), true)
  assert.equal(await has('.sim-result.wrong, .sim-result.correct'), false) // outcome not shown yet
  await right(1)
  assert.equal(await src(1), m1[5].image_url)
  assert.equal(await has('.sim-result.wrong, .sim-result.correct'), false)
  await app.shot('08_practice_after_answer')
  await right(10)
  assert.equal(await src(1), m1[8].image_url)
  assert.equal(await src(0), m30[2].image_url) // 30m #3 from 1m #7; unsynced #4 never shown
  assert.equal(await has('.sim-result.wrong'), true)
  const resultText = await app.ev(`document.querySelector('.sim-result').textContent`)
  assert.ok(resultText.includes('매수했다면 손실 — 오답') && resultText.includes('고점 처리 없이 밀림'), resultText)
  assert.ok((await app.ev(`document.querySelector('.sim-practice-bar').textContent`)).includes('퀴즈 1 / 1 · 정답 0 / 1'))
  await app.waitFor(`document.querySelector('.chartpat-tree-row.selected .sim-scn-meta').textContent.includes('정답 0/1')`, 'sidebar stats')
  await app.shot('09_practice_result')

  await app.click(button(`document.querySelector('.sim-practice-bar')`, '처음부터 다시'))
  assert.equal(await src(1), m1[0].image_url)
  assert.equal(await has('.sim-result'), false)
  await right(9)
  assert.equal(await src(1), m1[4].image_url)
  await app.click(button(`document.querySelector('.sim-question')`, '패스'))
  await app.click(button(`document.querySelector('.sim-result')`, '결과 보기'))
  assert.equal(await has('.sim-result.correct'), true)
  detail = await api('GET', `/api/sim/scenarios/${scenarioId}`)
  assert.deepEqual(detail.attempts.map((a) => [a.answer, a.result]), [['buy', 'wrong'], ['skip', 'correct']])

  // a scenario with quiz points opens in practice mode
  await app.send('Page.reload')
  await sleep(500)
  await app.waitFor(`document.querySelector('.chartpat-tree-row')`, 'scenario list')
  await app.click(scenarioRow(SCENARIO))
  await app.waitFor(`document.querySelector('.sim-practice-bar')`, 'practice view on open')

  console.log('ui test passed')
} catch (e) {
  console.error('FAILED:', e.stack)
  process.exitCode = 1
} finally {
  if (scenarioId && !process.env.KEEP) await api('DELETE', `/api/sim/scenarios/${scenarioId}`).catch(() => undefined)
  browser.close()
}
