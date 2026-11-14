import { useMemo } from 'react'
import {
  aggregate30,
  barsOf30,
  bucket30,
  formatBarTime,
  formatClock,
  formatPct,
  indexAtOrAfter,
  tradedAmount,
  type Aftermath,
  type Bar,
} from '../lib/simBars'
import type { SimDrawing } from '../api/client'
import { LOWER_PANE_NAME, SimBarChart, useLowerPane, type ChartDrawing, type ChartMark } from './SimBarChart'
import type { TimeRange } from './SimRangeLayer'

interface Props {
  bars: Bar[]
  /** Index of the current 1-minute bar; nothing after it is drawn. */
  now: number
  /** Marks on 1-minute bars; the ones up to `now` are shown on both charts. */
  marks: ChartMark[]
  /** Quiz ranges, by 1-minute bar times; shaded on both charts as far as `now`. */
  ranges?: TimeRange[]
  /** Shapes drawn on the 1-minute chart. */
  drawings: SimDrawing[]
  onDrawings: (next: SimDrawing[]) => void
  /** Show every shape, not only the ones drawn at or before `now`. */
  revealAll?: boolean
}

const NO_RANGES: TimeRange[] = []

const price = (n: number) => n.toFixed(4)

function Readout({ bar }: { bar: Bar }) {
  return (
    <span className="sim-pane-label">
      {formatBarTime(bar.t)} · 시 {price(bar.o)} 고 {price(bar.h)} 저 {price(bar.l)} 종 {price(bar.c)} · 거래량{' '}
      {bar.v.toLocaleString()} · 거래대금 {tradedAmount(bar).toFixed(2)}
    </span>
  )
}

/** How far price went after a quiz bar, relative to that bar's close. */
export function AftermathLine({ after }: { after: Aftermath }) {
  return (
    <span className="sim-dim">
      종가 {price(after.entry)} 기준 {formatBarTime(after.lastTime)}까지 — 최고 {formatPct(after.high, after.entry)} (
      {formatClock(after.highTime)}) · 최저 {formatPct(after.low, after.entry)} ({formatClock(after.lowTime)}) · 마지막{' '}
      {formatPct(after.last, after.entry)}
    </span>
  )
}

// 30-minute chart on the left, 1-minute chart on the right, both ending at
// the same moment: the 30-minute candle in progress is built from the
// 1-minute bars seen so far.
export function SimBarPanes({
  bars,
  now,
  marks,
  ranges = NO_RANGES,
  drawings,
  onDrawings,
  revealAll = false,
}: Props) {
  const [lower, toggleLower] = useLowerPane()
  // A shape first appears on the bar it was drawn at, so a replay does not
  // show marks made with later knowledge.
  const shapes = useMemo(
    () => (revealAll ? drawings : drawings.filter((d) => d.at <= now)),
    [drawings, now, revealAll],
  )
  const drawing: ChartDrawing = {
    shapes,
    onAdd: (shape) => onDrawings([...drawings, { ...shape, at: now }]),
    onRemove: (ids) => onDrawings(drawings.filter((d) => !ids.includes(d.id))),
  }
  const bars1 = useMemo(() => bars.slice(0, now + 1), [bars, now])
  const bars30 = useMemo(() => aggregate30(bars, now), [bars, now])
  const nowTime = bars[now]?.t ?? 0
  const marks1 = useMemo(() => marks.filter((m) => m.t <= nowTime), [marks, nowTime])
  const marks30 = useMemo(() => marks1.map((m) => ({ ...m, t: bucket30(m.t) })), [marks1])
  const ranges1 = useMemo(
    () => ranges.filter((r) => r.from <= nowTime).map((r) => ({ from: r.from, to: Math.min(r.to, nowTime) })),
    [ranges, nowTime],
  )
  const ranges30 = useMemo(() => ranges1.map((r) => ({ from: bucket30(r.from), to: bucket30(r.to) })), [ranges1])
  const last1 = bars1.at(-1)
  const last30 = bars30.at(-1)
  // Frame numbers count the 1-minute bars from the start of the file, like
  // the editor's counter; a 30-minute candle shows the ones it is made of.
  const frame1 = (t: number) => {
    const i = indexAtOrAfter(bars, t)
    return i >= 0 && bars[i].t === t ? `프레임 ${i + 1}` : null
  }
  const frame30 = (t: number) => {
    const span = barsOf30(bars, t, now)
    if (!span) return null
    return span[0] === span[1] ? `프레임 ${span[0] + 1}` : `프레임 ${span[0] + 1}~${span[1] + 1}`
  }

  return (
    <div className="sim-panes">
      <section className="sim-pane">
        <div className="sim-pane-head">
          <span className="sim-pane-title">30분봉</span>
          {last30 && <Readout bar={last30} />}
        </div>
        <div className="sim-stage">
          <SimBarChart
            bars={bars30}
            marks={marks30}
            ranges={ranges30}
            visibleBars={90}
            lower={lower}
            frameLabel={frame30}
          />
        </div>
      </section>

      <section className="sim-pane">
        <div className="sim-pane-head">
          <span className="sim-pane-title">1분봉</span>
          {last1 && <Readout bar={last1} />}
          <button type="button" className="sim-lower-toggle" title="아래 창: 거래대금 ((고가+저가)/2 × 거래량 / 70000) ↔ 거래량" onClick={toggleLower}>
            {LOWER_PANE_NAME[lower]}
          </button>
        </div>
        <div className="sim-stage">
          <SimBarChart
            bars={bars1}
            marks={marks1}
            ranges={ranges1}
            visibleBars={150}
            lower={lower}
            drawing={drawing}
            frameLabel={frame1}
          />
        </div>
      </section>
    </div>
  )
}
