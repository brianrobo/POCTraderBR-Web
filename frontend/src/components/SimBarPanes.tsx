import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  aggregate,
  barsOfCandle,
  candleStart,
  formatBarTime,
  formatClock,
  formatPct,
  indexAtOrAfter,
  tradedAmount,
  type Aftermath,
  type Bar,
} from '../lib/simBars'
import type { SimDrawing } from '../api/client'
import { insightUpTo, insightView, type QuizInsight } from '../lib/simInsight'
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
  /** The insight "My Insight" draws on the 1-minute chart; none: the button is off. */
  insight?: QuizInsight | null
  /** Why there is no insight to show, as the button's tooltip. */
  insightHint?: string
  /** Moves `now`; lets "My Insight" go on to the last bar its insight covers. */
  onSeek?: (index: number) => void
}

const NO_RANGES: TimeRange[] = []

// What the left chart can show; every one is built from the 1-minute bars.
const LEFT_CANDLES = [
  { span: 1800, name: '30분봉', visibleBars: 90 },
  { span: 300, name: '5분봉', visibleBars: 120 },
] as const
type LeftCandle = (typeof LEFT_CANDLES)[number]

const LEFT_CANDLE_KEY = 'sim.leftCandle'

/** The left chart's candle size, remembered across visits. */
function useLeftCandle(): [LeftCandle, (next: LeftCandle) => void] {
  const [left, setLeft] = useState<LeftCandle>(
    () => LEFT_CANDLES.find((c) => String(c.span) === localStorage.getItem(LEFT_CANDLE_KEY)) ?? LEFT_CANDLES[0],
  )
  const pick = (next: LeftCandle) => {
    localStorage.setItem(LEFT_CANDLE_KEY, String(next.span))
    setLeft(next)
  }
  return [left, pick]
}

const SPLIT_KEY = 'sim.split'
const SPLIT_MIN = 0.15
const SPLIT_MAX = 0.85

/** The left chart's share of the width once the divider has been dragged, remembered across visits; null: the default widths. */
function useSplit(): [number | null, (next: number | null) => void] {
  const [split, setSplit] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(SPLIT_KEY))
    return saved >= SPLIT_MIN && saved <= SPLIT_MAX ? saved : null
  })
  const set = (next: number | null) => {
    if (next === null) localStorage.removeItem(SPLIT_KEY)
    else localStorage.setItem(SPLIT_KEY, next.toFixed(4))
    setSplit(next)
  }
  return [split, set]
}

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

// 30-minute (or 5-minute) chart on the left, 1-minute chart on the right,
// both ending at the same moment: the left candle in progress is built from
// the 1-minute bars seen so far.
export function SimBarPanes({
  bars,
  now,
  marks,
  ranges = NO_RANGES,
  drawings,
  onDrawings,
  revealAll = false,
  insight = null,
  insightHint = '',
  onSeek,
}: Props) {
  const [insightOn, setInsightOn] = useState(false)
  const [focus, setFocus] = useState<{ from: number; to: number } | null>(null)
  // Only what sits on the bars shown so far, so a replay gives nothing away.
  const drawn = useMemo(
    () => (insightOn && insight ? insightUpTo(insight.insight, now) : null),
    [insightOn, insight, now],
  )
  const toggleInsight = () => {
    if (insightOn || !insight) {
      setInsightOn(false)
      return
    }
    const [first, last] = insightView(insight, bars.length)
    // Without a way to move on, the view ends at the current bar.
    const to = onSeek ? last : Math.min(last, now)
    if (onSeek && now < last) onSeek(last)
    setFocus({ from: Math.min(first, to), to })
    setInsightOn(true)
  }
  const [split, setSplit] = useSplit()
  const panes = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  // The divider follows the pointer: its middle sits where the pointer is.
  const dragSplit = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = panes.current?.getBoundingClientRect()
    if (!dragging || !box || box.width <= 0) return
    const half = e.currentTarget.offsetWidth / 2
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (e.clientX - box.left - half) / box.width)))
  }
  const [lower, toggleLower] = useLowerPane()
  const [left, pickLeft] = useLeftCandle()
  const span = left.span
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
  const barsLeft = useMemo(() => aggregate(bars, span, now), [bars, span, now])
  const nowTime = bars[now]?.t ?? 0
  const marks1 = useMemo(() => marks.filter((m) => m.t <= nowTime), [marks, nowTime])
  const marksLeft = useMemo(() => marks1.map((m) => ({ ...m, t: candleStart(m.t, span) })), [marks1, span])
  const ranges1 = useMemo(
    () => ranges.filter((r) => r.from <= nowTime).map((r) => ({ from: r.from, to: Math.min(r.to, nowTime) })),
    [ranges, nowTime],
  )
  const rangesLeft = useMemo(
    () => ranges1.map((r) => ({ from: candleStart(r.from, span), to: candleStart(r.to, span) })),
    [ranges1, span],
  )
  const last1 = bars1.at(-1)
  const lastLeft = barsLeft.at(-1)
  // Frame numbers count the 1-minute bars from the start of the file, like
  // the editor's counter; a candle of the left chart shows the ones it is made of.
  const frame1 = (t: number) => {
    const i = indexAtOrAfter(bars, t)
    return i >= 0 && bars[i].t === t ? `프레임 ${i + 1}` : null
  }
  const frameLeft = (t: number) => {
    const made = barsOfCandle(bars, t, span, now)
    if (!made) return null
    return made[0] === made[1] ? `프레임 ${made[0] + 1}` : `프레임 ${made[0] + 1}~${made[1] + 1}`
  }

  return (
    <>
      <div ref={panes} className={drawn ? 'sim-panes sim-split insight-on' : 'sim-panes sim-split'}>
        <section className="sim-pane" style={split === null ? undefined : { flex: `0 0 ${(split * 100).toFixed(2)}%` }}>
          <div className="sim-pane-head">
            <div className="sim-candle-pick">
              {LEFT_CANDLES.map((c) => (
                <button key={c.span} type="button" className={c === left ? 'active' : ''} onClick={() => pickLeft(c)}>
                  {c.name}
                </button>
              ))}
            </div>
            {lastLeft && <Readout bar={lastLeft} />}
          </div>
          <div className="sim-stage">
            {/* A new chart per candle size, so each opens at its own zoom. */}
            <SimBarChart
              key={span}
              bars={barsLeft}
              marks={marksLeft}
              ranges={rangesLeft}
              visibleBars={left.visibleBars}
              lower={lower}
              frameLabel={frameLeft}
            />
          </div>
        </section>

        <div
          className={dragging ? 'sim-splitter dragging' : 'sim-splitter'}
          role="separator"
          aria-orientation="vertical"
          title="끌어서 좌우 폭 조절 · 두 번 누르면 기본 폭으로"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragging(true)
          }}
          onPointerMove={dragSplit}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onDoubleClick={() => setSplit(null)}
        />

        <section className="sim-pane">
          <div className="sim-pane-head">
            <span className="sim-pane-title">1분봉</span>
            <button
              type="button"
              className={drawn ? 'sim-insight-toggle active' : 'sim-insight-toggle'}
              disabled={!insight}
              title={
                insight
                  ? `프레임 ${insight.from + 1}~${insight.to + 1} 퀴즈의 해석을 차트에 표시합니다`
                  : insightHint
              }
              onClick={toggleInsight}
            >
              My Insight
            </button>
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
              frameEvery={50}
              insight={drawn}
              focus={focus}
            />
          </div>
        </section>
      </div>
      {drawn && drawn.notes.length > 0 && (
        <ul className="sim-insight-notes" aria-label="My Insight">
          {drawn.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
    </>
  )
}
