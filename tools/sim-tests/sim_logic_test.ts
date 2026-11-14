// Frame-change detection and 30m/1m sync rules, without a browser.
//
//   node tools/sim-tests/sim_logic_test.ts <absolute path of frontend>
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
const { FrameChangeDetector, framesDiffer, DEFAULT_FRAME_CHANGE_OPTIONS } = await import(
  pathToFileURL(`${root}/src/lib/frameChange.ts`).href
)
const { splitTracks, syncedIndex30 } = await import(pathToFileURL(`${root}/src/lib/simSync.ts`).href)

const W = 400
const H = 200
// A "chart" with `bars` candles drawn as 6px-wide columns.
function chart(bars: number, cursorAt = -1): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4).fill(255)
  const paint = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * W + x) * 4
        d[i] = v
        d[i + 1] = v
        d[i + 2] = v
      }
  }
  for (let b = 0; b < bars; b++) paint(10 + b * 8, 60 + (b % 5) * 10, 6, 40, 30)
  if (cursorAt >= 0) paint(cursorAt, 20, 12, 18, 0)
  return d
}

// --- framesDiffer
assert.equal(framesDiffer(chart(5), chart(5), DEFAULT_FRAME_CHANGE_OPTIONS), false)
assert.equal(framesDiffer(chart(5), chart(6), DEFAULT_FRAME_CHANGE_OPTIONS), true)
const noisy = chart(5)
for (let i = 0; i < noisy.length; i += 4) noisy[i] = Math.max(0, noisy[i] - 10) // compression-level noise
assert.equal(framesDiffer(chart(5), noisy, DEFAULT_FRAME_CHANGE_OPTIONS), false)

// Mimics the component's loop: returns the list of kept states.
function run(events: { t: number; frame?: Uint8ClampedArray; name?: string; stop?: boolean }[]): string[] {
  const det = new FrameChangeDetector()
  const kept: string[] = []
  let held = ''
  for (const e of events) {
    if (e.stop) {
      if (det.settle(e.t, true)) kept.push(held)
      continue
    }
    if (!e.frame) {
      if (det.settle(e.t)) kept.push(held) // settle-poll timer tick
      continue
    }
    const { changed, keepPrevious } = det.push(e.frame, e.t)
    if (keepPrevious) kept.push(held)
    if (changed) held = e.name ?? ''
    else if (det.settle(e.t)) kept.push(held)
  }
  return kept
}

// 1. Three candle steps, each resting >= settleMs; stream delivers a frame only on change.
assert.deepEqual(
  run([
    { t: 0, frame: chart(5), name: 'c5' },
    { t: 200, }, { t: 400 }, // poll ticks
    { t: 1000, frame: chart(6), name: 'c6' },
    { t: 1200 }, { t: 1400 },
    { t: 2000, frame: chart(7), name: 'c7' },
    { t: 2050, stop: true },
  ]),
  ['c5', 'c6', 'c7'],
)

// 2. No poll timer (throttled background tab): states are still kept when the next change arrives.
assert.deepEqual(
  run([
    { t: 0, frame: chart(5), name: 'c5' },
    { t: 1000, frame: chart(6), name: 'c6' },
    { t: 2000, frame: chart(7), name: 'c7' },
    { t: 2100, stop: true },
  ]),
  ['c5', 'c6', 'c7'],
)

// 3. Half-drawn redraw (two quick changes within settleMs) keeps only the final state.
assert.deepEqual(
  run([
    { t: 0, frame: chart(5), name: 'c5' },
    { t: 300 },
    { t: 1000, frame: chart(6, 300), name: 'partial' },
    { t: 1030, frame: chart(6), name: 'c6' },
    { t: 1300 },
    { t: 1400, stop: true },
  ]),
  ['c5', 'c6'],
)

// 4. A cursor sweeping across (always moving) and leaving: no extra frames, and the
//    state it returns to is not kept twice.
assert.deepEqual(
  run([
    { t: 0, frame: chart(5), name: 'c5' },
    { t: 300 },
    { t: 1000, frame: chart(5, 50), name: 'cur1' },
    { t: 1040, frame: chart(5, 120), name: 'cur2' },
    { t: 1080, frame: chart(5, 200), name: 'cur3' },
    { t: 1120, frame: chart(5), name: 'c5-again' },
    { t: 1400 },
    { t: 2000, frame: chart(6), name: 'c6' },
    { t: 2300 },
    { t: 2400, stop: true },
  ]),
  ['c5', 'c6'],
)

// 5. Identical frames delivered repeatedly (video-element sampling fallback).
assert.deepEqual(
  run([
    { t: 0, frame: chart(5), name: 'c5' },
    { t: 100, frame: chart(5), name: 'dup' },
    { t: 200, frame: chart(5), name: 'dup' },
    { t: 300, frame: chart(5), name: 'dup' },
    { t: 400, frame: chart(6), name: 'c6' },
    { t: 500, frame: chart(6), name: 'dup' },
    { t: 700, frame: chart(6), name: 'dup' },
    { t: 800, stop: true },
  ]),
  ['c5', 'c6'],
)

// 6. Stepping faster than settleMs loses the in-between candle (documented limit).
assert.deepEqual(
  run([
    { t: 0, frame: chart(5), name: 'c5' },
    { t: 300 },
    { t: 1000, frame: chart(6), name: 'c6' },
    { t: 1100, frame: chart(7), name: 'c7' },
    { t: 1400 },
  ]),
  ['c5', 'c7'],
)

// --- simSync
const f = (id: string, track: string, position: number, sync: string | null = null) => ({
  id, scenario_id: 's', track, position, image_url: '', label: '', sync_frame_id: sync,
  is_quiz: false, quiz_outcome: '', quiz_note: '',
})
const m1 = [0, 1, 2, 3, 4, 5].map((i) => f(`m${i}`, '1m', i))
// shuffled input order must not matter
let t = splitTracks([f('b', '30m', 1, 'm2'), ...m1.slice().reverse(), f('a', '30m', 0), f('c', '30m', 2, 'm4')])
assert.deepEqual(t.m1.map((x: { id: string }) => x.id), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
assert.deepEqual(t.m30.map((x: { id: string }) => x.id), ['a', 'b', 'c'])
// first 30m frame unsynced -> stands in as starting chart
assert.deepEqual([0, 1, 2, 3, 4, 5].map((p) => syncedIndex30(t, p)), [0, 0, 1, 1, 2, 2])

// first 30m frame synced later -> nothing before its sync point
t = splitTracks([...m1, f('a', '30m', 0, 'm1'), f('b', '30m', 1, 'm3')])
assert.deepEqual([0, 1, 2, 3, 4, 5].map((p) => syncedIndex30(t, p)), [null, 0, 0, 1, 1, 1])

// unsynced later frames are never shown; dangling sync id counts as unsynced
t = splitTracks([...m1, f('a', '30m', 0), f('b', '30m', 1), f('c', '30m', 2, 'gone'), f('d', '30m', 3, 'm5')])
assert.deepEqual([0, 1, 2, 3, 4, 5].map((p) => syncedIndex30(t, p)), [0, 0, 0, 0, 0, 3])

// no 30m frames
t = splitTracks(m1)
assert.equal(syncedIndex30(t, 3), null)

// --- simBars (price-data scenarios)
const B = await import(pathToFileURL(`${root}/src/lib/simBars.ts`).href)
const T = (day: number, hh: number, mm: number) => Date.UTC(2026, 10, day, hh, mm) / 1000
// [time, open, high, low, close, volume]
const rows = [
  [T(12, 9, 28), 10, 11, 9, 10.5, 100],
  [T(12, 9, 29), 10.5, 12, 10, 11, 200],
  [T(12, 9, 30), 11, 11.5, 10.8, 11.2, 300],
  [T(12, 9, 31), 11.2, 13, 11, 12.5, 400],
  [T(12, 10, 5), 12.5, 12.6, 8, 9, 500],
  [T(13, 0, 39), 9, 9.5, 8.5, 9.2, 50], // overnight: still the 11/12 session
  [T(13, 7, 48), 9.2, 10, 9, 9.8, 600],
  [T(13, 7, 49), 9.8, 9.9, 9.1, 9.3, 700],
]
const bars = B.decodeBars(rows)
assert.equal(bars.length, 8)
// traded amount: ((H+L)/2) * V / 70000, from the bar it is drawn on
assert.equal(B.tradedAmount(bars[1]), (((12 + 10) / 2) * 200) / 70000)

// 30-minute candles are stamped with their start time and include the forming one
const all30 = B.aggregate30(bars)
assert.deepEqual(all30.map((b: { t: number }) => b.t), [T(12, 9, 0), T(12, 9, 30), T(12, 10, 0), T(13, 0, 30), T(13, 7, 30)])
assert.deepEqual(all30[0], { t: T(12, 9, 0), o: 10, h: 12, l: 9, c: 11, v: 300 })
assert.deepEqual(all30[1], { t: T(12, 9, 30), o: 11, h: 13, l: 10.8, c: 12.5, v: 700 })
assert.equal(B.tradedAmount(all30[0]), (((12 + 9) / 2) * 300) / 70000) // the 30-minute candle's own high, low, volume
// cut at 09:30: the 09:30 candle is only what has been seen so far — no look-ahead
const cut = B.aggregate30(bars, 2)
assert.equal(cut.length, 2)
assert.deepEqual(cut[1], { t: T(12, 9, 30), o: 11, h: 11.5, l: 10.8, c: 11.2, v: 300 })
assert.equal(B.aggregate30(bars, 0).length, 1)
assert.equal(bars[2].h, 11.5) // aggregation must not mutate the 1-minute bars
assert.equal(B.bucket30(T(12, 9, 59)), T(12, 9, 30))

const round = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6)
assert.deepEqual(B.movingAverage(bars.slice(0, 4), 2).map(round), [null, 10.75, 11.1, 11.85])
assert.deepEqual(B.movingAverage(bars.slice(0, 2), 5), [null, null])

assert.equal(B.indexAtOrAfter(bars, T(12, 9, 30)), 2)
assert.equal(B.indexAtOrAfter(bars, T(12, 9, 40)), 4)
assert.equal(B.indexAtOrAfter(bars, 0), 0)
assert.equal(B.indexAtOrAfter(bars, T(14, 0, 0)), -1)

// the 1-minute bars a 30-minute candle is made of, up to the current bar
assert.deepEqual(B.barsOf30(bars, T(12, 9, 0)), [0, 1])
assert.deepEqual(B.barsOf30(bars, T(12, 9, 30)), [2, 3])
assert.deepEqual(B.barsOf30(bars, T(12, 9, 30), 2), [2, 2]) // still forming
assert.deepEqual(B.barsOf30(bars, T(12, 10, 0)), [4, 4])
assert.deepEqual(B.barsOf30(bars, T(13, 7, 30)), [6, 7]) // the last candle
assert.equal(B.barsOf30(bars, T(12, 9, 30), 1), null) // not reached yet
assert.equal(B.barsOf30(bars, T(12, 10, 30)), null) // no trades in that half hour
assert.equal(B.barsOf30(bars, T(14, 0, 0)), null)

// a practice run begins at the replay start, or where the earliest quiz range does
assert.equal(B.practiceStart(bars, bars[6].t, []), 6)
assert.equal(B.practiceStart(bars, bars[6].t, [bars[7].t, bars[3].t]), 3)
assert.equal(B.practiceStart(bars, bars[2].t, [bars[5].t]), 5)
assert.equal(B.practiceStart(bars, T(14, 0, 0), []), 0)

assert.deepEqual(B.sessionStarts(bars), [
  { label: '11/12', index: 0 },
  { label: '11/13', index: 6 },
])
assert.equal(B.sessionDay(T(13, 0, 39)), T(12, 0, 0))
assert.equal(B.sessionDay(T(13, 4, 0)), T(13, 0, 0))

assert.equal(B.formatBarTime(T(13, 7, 48)), '11/13 07:48')
assert.equal(B.formatClock(T(13, 0, 39)), '00:39')
assert.equal(B.formatScenarioDate(T(13, 7, 48)), '26.11.13')
// Korean time: +14h in US standard time, +13h in daylight time (2026: 03/08 02:00 to 11/01 02:00)
assert.equal(B.formatBarTime(B.toKst(T(13, 9, 30))), '11/13 23:30')
assert.equal(B.formatBarTime(B.toKst(T(13, 15, 42))), '11/14 05:42')
const E = (month: number, day: number, hh: number, mm: number) => Date.UTC(2026, month - 1, day, hh, mm) / 1000
assert.equal(B.formatBarTime(B.toKst(E(10, 30, 9, 30))), '10/30 22:30')
assert.equal(B.formatBarTime(B.toKst(E(11, 1, 1, 59))), '11/01 14:59')
assert.equal(B.formatBarTime(B.toKst(E(11, 1, 2, 0))), '11/01 16:00')
assert.equal(B.formatBarTime(B.toKst(E(3, 6, 9, 30))), '03/06 23:30')
assert.equal(B.formatBarTime(B.toKst(E(3, 9, 9, 30))), '03/09 22:30')
assert.equal(B.formatBarTime(B.toKst(E(12, 31, 16, 0))), '01/01 06:00')

// after a buy at the 09:29 close (11): the following bars up to 10:05
assert.deepEqual(B.aftermath(bars, 1, 4), {
  entry: 11, high: 13, highTime: T(12, 9, 31), low: 8, lowTime: T(12, 10, 5), last: 9, lastTime: T(12, 10, 5),
})
assert.equal(B.aftermath(bars, 7, 7), null) // nothing after the last bar
assert.equal(B.formatPct(13, 11), '+18.2%')
assert.equal(B.formatPct(8, 11), '-27.3%')

// --- simDrawings (picking a drawn shape by its outline)
const { hitsShape } = await import(pathToFileURL(`${root}/src/lib/simDrawings.ts`).href)
const box = { x1: 100, y1: 200, x2: 300, y2: 100 } // dragged up and to the right
// line: near the segment, not near its extension
assert.equal(hitsShape('line', box, 200, 150), true)
assert.equal(hitsShape('line', box, 200, 155), true)
assert.equal(hitsShape('line', box, 200, 170), false)
assert.equal(hitsShape('line', box, 320, 90), false)
assert.equal(hitsShape('line', { x1: 50, y1: 50, x2: 50, y2: 50 }, 53, 54), true) // a dot
// rectangle: the border only, whichever way it was dragged
assert.equal(hitsShape('rect', box, 100, 150), true)
assert.equal(hitsShape('rect', box, 200, 104), true)
assert.equal(hitsShape('rect', box, 305, 205), true)
assert.equal(hitsShape('rect', box, 200, 150), false) // inside
assert.equal(hitsShape('rect', box, 310, 150), false) // outside
// ellipse: the outline only
assert.equal(hitsShape('ellipse', box, 300, 150), true)
assert.equal(hitsShape('ellipse', box, 200, 97), true)
assert.equal(hitsShape('ellipse', box, 200, 150), false) // centre
assert.equal(hitsShape('ellipse', box, 290, 195), false) // corner of its box
assert.equal(hitsShape('ellipse', box, 271, 115), true) // on the curve at 45°
assert.equal(hitsShape('ellipse', { x1: 100, y1: 100, x2: 300, y2: 108 }, 200, 104), true) // too thin for an inside

console.log('all sim logic tests passed')
