import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type SeriesMarkerBar,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { SimDrawing, SimDrawingKind, SimQuizInsight } from '../api/client'
import {
  MA_PERIODS,
  formatBarTime,
  formatClock,
  formatDate,
  movingAverage,
  toKst,
  tradedAmount,
  type Bar,
} from '../lib/simBars'
import { SimDrawingLayer, type Shape } from './SimDrawingLayer'
import { SimInsightLayer } from './SimInsightLayer'
import { SimRangeLayer, type TimeRange } from './SimRangeLayer'

export type LowerPane = 'amount' | 'volume'

export const LOWER_PANE_NAME: Record<LowerPane, string> = { amount: '거래대금', volume: '거래량' }

const LOWER_PANE_KEY = 'sim.lowerPane'

/** Which series the lower pane shows, remembered across visits. */
export function useLowerPane(): [LowerPane, () => void] {
  const [lower, setLower] = useState<LowerPane>(() =>
    localStorage.getItem(LOWER_PANE_KEY) === 'volume' ? 'volume' : 'amount',
  )
  const toggle = () => {
    const next = lower === 'amount' ? 'volume' : 'amount'
    localStorage.setItem(LOWER_PANE_KEY, next)
    setLower(next)
  }
  return [lower, toggle]
}

export interface ChartMark {
  /** Time of the bar the mark sits on. */
  t: number
  text: string
  kind: 'quiz' | 'buy' | 'skip'
}

/** A shape as it leaves the chart: where it is, not yet when it was drawn. */
export type DrawnShape = Omit<SimDrawing, 'at'>

export interface ChartDrawing {
  shapes: SimDrawing[]
  onAdd: (shape: DrawnShape) => void
  onRemove: (ids: string[]) => void
}

interface Props {
  /** Bars up to "now" — the chart always follows the last one. */
  bars: Bar[]
  marks?: ChartMark[]
  /** Spans of bars to shade — the quiz ranges. */
  ranges?: TimeRange[]
  /** How many bars are in view until the user zooms. */
  visibleBars: number
  lower: LowerPane
  /** Lets lines, horizontal lines, rectangles and ellipses be drawn on the chart. */
  drawing?: ChartDrawing
  /** Frame number(s) of the bar at a time, shown under the crosshair's time. */
  frameLabel?: (t: number) => string | null
  /** Numbers the bars under the time axis, one label every this many bars (the first bar is 1). */
  frameEvery?: number
  /** A quiz's insight to draw over the bars — only what sits on the bars given. */
  insight?: SimQuizInsight | null
  /** Bars (by index) to bring into view; each new value moves the view once. */
  focus?: { from: number; to: number } | null
}

const TOOLS: { kind: SimDrawingKind; label: string }[] = [
  { kind: 'line', label: '선' },
  { kind: 'hline', label: '수평선' },
  { kind: 'rect', label: '사각형' },
  { kind: 'ellipse', label: '원' },
]
const NO_SHAPES: SimDrawing[] = []
// A drag shorter than this (px) is a stray click, not a shape.
const MIN_DRAG = 4

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const rounded = (n: number, digits: number) => Number(n.toFixed(digits))

// Keys typed into a text field are not chart shortcuts.
function isTyping(el: HTMLElement | null): boolean {
  if (!el) return false
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true
  return el.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes((el as HTMLInputElement).type)
}

// Colours follow the HTS chart the scenarios are studied on: gray canvas,
// red up / blue down candles, and its moving-average line colours.
const UP = '#e8121d'
const DOWN = '#0a4fd6'
const MA_COLOR: Record<number, string> = { 5: '#ff3b30', 10: '#1e5bff', 20: '#ff9500', 60: '#0a9b3c', 120: '#111111' }
const LOWER_COLOR = '#1b2a6b'
const MARK_STYLE: Record<ChartMark['kind'], Pick<SeriesMarkerBar<Time>, 'position' | 'shape' | 'color'>> = {
  quiz: { position: 'aboveBar', shape: 'arrowDown', color: '#7a1fd1' },
  buy: { position: 'belowBar', shape: 'arrowUp', color: '#c2000b' },
  skip: { position: 'aboveBar', shape: 'circle', color: '#3a3f4a' },
}
// Empty bar slots kept to the right of the latest bar.
const RIGHT_PAD = 4
// Tall enough for the two lines (Korean time, frame number) under the crosshair's time label,
// and for the row of frame numbers under the axis' own labels.
const TIME_AXIS_HEIGHT = 58

interface Handles {
  chart: IChartApi
  candles: ISeriesApi<'Candlestick'>
  averages: ISeriesApi<'Line'>[]
  lower: ISeriesApi<'Histogram'>
  marks: ISeriesMarkersPluginApi<Time>
  layer: SimDrawingLayer
  /** One per pane, so a span is shaded from top to bottom. */
  bands: SimRangeLayer[]
  insights: SimInsightLayer[]
  /** Puts the frame numbers under the bars they belong to, where those are now. */
  placeFrames: () => void
}

const at = (t: number) => t as UTCTimestamp

/**
 * Candles with moving averages over a volume pane, drawn from price bars.
 * Each new set of bars re-anchors the view on the latest bar while keeping
 * the zoom the user chose, like an HTS chart advancing one candle.
 */
export function SimBarChart({
  bars,
  marks,
  ranges,
  visibleBars,
  lower,
  drawing,
  frameLabel,
  frameEvery,
  insight = null,
  focus = null,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const hoverLabel = useRef<HTMLDivElement>(null)
  const frameRow = useRef<HTMLDivElement>(null)
  // The chart's handlers are set up once; they read the current props from here.
  const frameOf = useRef(frameLabel)
  const numbering = useRef({ every: frameEvery, count: bars.length })
  useEffect(() => {
    frameOf.current = frameLabel
    numbering.current = { every: frameEvery, count: bars.length }
  })
  const handles = useRef<Handles | null>(null)
  // The first draw uses `visibleBars`; later ones keep the current zoom.
  const fresh = useRef(true)

  const shapes = drawing?.shapes ?? NO_SHAPES
  const [tool, setTool] = useState<SimDrawingKind | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const picked = shapes.some((s) => s.id === selected) ? selected : null
  // The shape being dragged out, and where on screen the drag began.
  const draft = useRef<{ shape: Shape; fromX: number; fromY: number } | null>(null)

  useEffect(() => {
    if (!host.current) return
    const chart = createChart(host.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#c3c3c3' },
        textColor: '#111111',
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: '#6f6f6f' },
      },
      grid: { vertLines: { color: '#b4b4b4' }, horzLines: { color: '#b4b4b4' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#6f6f6f' },
      timeScale: {
        borderColor: '#6f6f6f',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: RIGHT_PAD,
        // The same bars stay in view when the chart is given more or less room.
        lockVisibleTimeRangeOnResize: true,
        minimumHeight: TIME_AXIS_HEIGHT,
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds
            ? formatClock(time as number)
            : formatDate(time as number),
      },
      localization: { timeFormatter: (time: Time) => formatBarTime(time as number) },
    })
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      borderUpColor: UP,
      wickUpColor: UP,
      downColor: DOWN,
      borderDownColor: DOWN,
      wickDownColor: DOWN,
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
    })
    const averages = MA_PERIODS.map((period) =>
      chart.addSeries(LineSeries, {
        color: MA_COLOR[period],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
      }),
    )
    const lowerSeries = chart.addSeries(
      HistogramSeries,
      { color: LOWER_COLOR, priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' } },
      1,
    )
    const [main, sub] = chart.panes()
    main?.setStretchFactor(3)
    sub?.setStretchFactor(1)
    const layer = new SimDrawingLayer()
    candles.attachPrimitive(layer)
    const bands = [candles, lowerSeries].map((series) => {
      const band = new SimRangeLayer()
      series.attachPrimitive(band)
      return band
    })
    // The lower pane has no prices: it gets only what runs from top to bottom.
    const insights = [candles, lowerSeries].map((series) => {
      const drawn = new SimInsightLayer(series === lowerSeries)
      series.attachPrimitive(drawn)
      return drawn
    })
    // A click on a drawn shape picks it; a click anywhere else lets go of it.
    chart.subscribeClick((param) =>
      setSelected(typeof param.hoveredObjectId === 'string' ? param.hoveredObjectId : null),
    )
    // Under the crosshair's time label (exchange time): the same moment in
    // Korea, then the bar's frame number.
    chart.subscribeCrosshairMove((param) => {
      const label = hoverLabel.current
      if (!label) return
      const x = typeof param.time === 'number' ? chart.timeScale().timeToCoordinate(param.time) : null
      if (typeof param.time !== 'number' || x === null) {
        label.style.display = 'none'
        return
      }
      const frame = frameOf.current?.(param.time)
      label.textContent = `KST ${formatBarTime(toKst(param.time))}${frame ? `\n${frame}` : ''}`
      label.style.display = 'block'
      const half = label.offsetWidth / 2
      label.style.left = `${Math.max(half, Math.min(x, chart.timeScale().width() - half))}px`
    })
    // Frame numbers under the time axis' own labels; they follow the bars as the chart is moved or resized.
    const placeFrames = () => {
      const row = frameRow.current
      if (!row) return
      const scale = chart.timeScale()
      const shown = scale.getVisibleLogicalRange()
      const { every, count } = numbering.current
      const labels: HTMLElement[] = []
      if (every && shown) {
        const first = Math.max(1, Math.ceil((shown.from + 1) / every)) * every
        for (let frame = first; frame <= count && frame - 1 <= shown.to; frame += every) {
          const x = scale.logicalToCoordinate((frame - 1) as Logical)
          if (x === null) continue
          const label = document.createElement('span')
          label.textContent = String(frame)
          label.style.left = `${x}px`
          labels.push(label)
        }
      }
      row.style.width = `${scale.width()}px`
      row.replaceChildren(...labels)
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(placeFrames)
    // The size event comes before the bars are laid out at the new width, so the numbers wait a frame.
    let queued = 0
    const placeFramesSoon = () => {
      cancelAnimationFrame(queued)
      queued = requestAnimationFrame(placeFrames)
    }
    chart.timeScale().subscribeSizeChange(placeFramesSoon)
    handles.current = {
      chart,
      candles,
      averages,
      lower: lowerSeries,
      marks: createSeriesMarkers(candles, []),
      layer,
      bands,
      insights,
      placeFrames,
    }
    fresh.current = true
    return () => {
      cancelAnimationFrame(queued)
      handles.current = null
      chart.remove()
    }
  }, [])

  useEffect(() => {
    const h = handles.current
    if (!h) return
    const scale = h.chart.timeScale()
    const shown = scale.getVisibleLogicalRange()
    const width = fresh.current || !shown ? visibleBars : shown.to - shown.from

    h.candles.setData(bars.map((b) => ({ time: at(b.t), open: b.o, high: b.h, low: b.l, close: b.c })))
    MA_PERIODS.forEach((period, i) => {
      const values = movingAverage(bars, period)
      h.averages[i].setData(
        bars.flatMap((b, j) => {
          const value = values[j]
          return value === null ? [] : [{ time: at(b.t), value }]
        }),
      )
    })
    h.lower.applyOptions({
      priceFormat: lower === 'amount' ? { type: 'price', precision: 2, minMove: 0.01 } : { type: 'volume' },
    })
    h.lower.setData(bars.map((b) => ({ time: at(b.t), value: lower === 'amount' ? tradedAmount(b) : b.v })))
    h.marks.setMarkers(
      (marks ?? []).map((m) => ({ time: at(m.t), text: m.text, ...MARK_STYLE[m.kind] })),
    )
    h.bands.forEach((band) => band.set(ranges ?? []))

    if (bars.length > 0) {
      const right = bars.length - 1 + RIGHT_PAD
      scale.setVisibleLogicalRange({ from: right - width, to: right })
      fresh.current = false
    }
    h.placeFrames()
  }, [bars, marks, ranges, visibleBars, lower, frameEvery])

  useEffect(() => {
    handles.current?.insights.forEach((drawn) => drawn.set(insight, bars))
  }, [insight, bars])

  // After the bars are drawn, so that a view asked for along with new bars wins.
  useEffect(() => {
    if (!focus) return
    handles.current?.chart.timeScale().setVisibleLogicalRange({ from: focus.from - 1, to: focus.to + RIGHT_PAD })
  }, [focus])

  useEffect(() => {
    handles.current?.layer.set(shapes, picked)
  }, [shapes, picked])

  // Delete removes the picked shape; Esc puts the tool down.
  const onRemove = drawing?.onRemove
  useEffect(() => {
    if (!onRemove) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target as HTMLElement | null)) return
      if (e.key === 'Escape') {
        setTool(null)
        setSelected(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && picked) {
        e.preventDefault()
        onRemove([picked])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRemove, picked])

  // Screen position → chart position (bar index, price).
  const pointAt = (e: ReactPointerEvent) => {
    const h = handles.current
    if (!h || !host.current) return null
    const rect = host.current.getBoundingClientRect()
    const x = h.chart.timeScale().coordinateToLogical(e.clientX - rect.left)
    const y = h.candles.coordinateToPrice(e.clientY - rect.top)
    return x === null || y === null ? null : { x: rounded(x, 3), y: rounded(y, 5) }
  }

  // Whether the pointer is over the candles, not the volume below them or the time axis.
  const overCandles = (e: ReactPointerEvent) => {
    const h = handles.current
    if (!h || !host.current) return false
    const y = e.clientY - host.current.getBoundingClientRect().top
    return y >= 0 && y <= h.chart.panes()[0].getHeight()
  }

  const beginShape = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointAt(e)
    if (e.button !== 0 || !tool || !p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    draft.current = { shape: { kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y }, fromX: e.clientX, fromY: e.clientY }
  }

  const stretchShape = (e: ReactPointerEvent) => {
    const p = pointAt(e)
    if (!draft.current || !p) return
    // A horizontal line has no second corner: it follows the pointer until it is let go.
    draft.current.shape =
      draft.current.shape.kind === 'hline'
        ? { ...draft.current.shape, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
        : { ...draft.current.shape, x2: p.x, y2: p.y }
    handles.current?.layer.set([...shapes, draft.current.shape], picked)
  }

  const endShape = (e: ReactPointerEvent, keep: boolean) => {
    const drawn = draft.current
    draft.current = null
    if (!drawn) return
    const dragged = Math.max(Math.abs(e.clientX - drawn.fromX), Math.abs(e.clientY - drawn.fromY)) >= MIN_DRAG
    // A horizontal line is placed with a click, at a price on the chart; the other shapes need a drag.
    if (keep && (drawn.shape.kind === 'hline' ? overCandles(e) : dragged)) {
      const id = newId()
      drawing?.onAdd({ ...drawn.shape, id })
      setSelected(id)
      setTool(null)
    } else handles.current?.layer.set(shapes, picked)
  }

  return (
    <div className="sim-chart">
      <div ref={host} className="sim-chart-host" />
      <div ref={frameRow} className="sim-chart-frames" />
      <div ref={hoverLabel} className="sim-chart-kst" />
      {tool && (
        <div
          className="sim-draw-layer"
          onPointerDown={beginShape}
          onPointerMove={stretchShape}
          onPointerUp={(e) => endShape(e, true)}
          onPointerCancel={(e) => endShape(e, false)}
        />
      )}
      <div className="sim-chart-legend">
        {MA_PERIODS.map((period) => (
          <span key={period} style={{ color: MA_COLOR[period] }}>
            {period}
          </span>
        ))}
        {drawing && (
          <div className="sim-draw-tools">
            {TOOLS.map((t) => (
              <button
                key={t.kind}
                type="button"
                className={tool === t.kind ? 'active' : ''}
                title={
                  t.kind === 'hline'
                    ? '수평선 그리기 — 차트 위를 클릭하면 그 가격에 그어집니다 (Esc 취소)'
                    : `${t.label} 그리기 — 차트 위에서 끌어서 그립니다 (Esc 취소)`
                }
                onClick={() => setTool(tool === t.kind ? null : t.kind)}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              disabled={!picked}
              title="그린 것을 클릭해 고른 뒤 삭제 (Delete 키)"
              onClick={() => picked && drawing.onRemove([picked])}
            >
              삭제
            </button>
            <button
              type="button"
              disabled={shapes.length === 0}
              onClick={() => {
                if (window.confirm(`그린 것 ${shapes.length}개를 모두 지울까요?`)) drawing.onRemove(shapes.map((s) => s.id))
              }}
            >
              모두 지우기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
