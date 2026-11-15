import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts'
import type { SimQuizInsight } from '../api/client'
import type { Bar } from '../lib/simBars'

const FONT = "12px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif"
const LINE_HEIGHT = 15
const PAD = 3
// How far a label stays from the edges of the pane, and a leader line from its bar.
const EDGE = 2
const GAP = 3
// Where a label with no price of its own hangs: under the chart's legend and tools.
const TOP = 26
// Half the width of a bracket's end ticks.
const TICK = 5

interface Size {
  width: number
  height: number
}

/** Where a label's box goes, given its size: the top-left corner. */
type Place = (width: number, height: number) => [number, number]

/** `#rrggbb` as an rgba() of that colour. */
function tint(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1]
  if (!hex) return color
  const n = parseInt(hex, 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Draws a quiz's insight — the reading of the chart behind the quiz — over a
 * pane: shaded price bands and spans of bars behind the series; lines,
 * brackets and labels in front. Everything is kept by frame number and price
 * and turned into pixels on every repaint, so it stays on its bars while the
 * chart scrolls and zooms. A `plain` layer is for the lower pane, which has
 * no prices: it draws only what runs from top to bottom.
 */
export class SimInsightLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private series: ISeriesApi<SeriesType> | null = null
  private requestUpdate: (() => void) | null = null
  private insight: SimQuizInsight | null = null
  private bars: Bar[] = []
  private readonly plain: boolean

  private readonly views: IPrimitivePaneView[] = [
    {
      zOrder: () => 'bottom',
      renderer: (): IPrimitivePaneRenderer => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paintBehind(context, mediaSize)),
      }),
    },
    {
      zOrder: () => 'top',
      renderer: (): IPrimitivePaneRenderer => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paintFront(context, mediaSize)),
      }),
    },
  ]

  constructor(plain = false) {
    this.plain = plain
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart
    this.series = series
    this.requestUpdate = requestUpdate
  }

  detached(): void {
    this.chart = this.series = this.requestUpdate = null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }

  /** What to draw (null: nothing), over the bars on the chart. */
  set(insight: SimQuizInsight | null, bars: Bar[]): void {
    this.insight = insight
    this.bars = bars
    this.requestUpdate?.()
  }

  /** Pixel x of the centre of a frame's bar, and half a bar's width. */
  private columns(): { x: (frame: number) => number; half: number } | null {
    const scale = this.chart?.timeScale()
    const x0 = scale?.logicalToCoordinate(0 as Logical) ?? null
    const x1 = scale?.logicalToCoordinate(1 as Logical) ?? null
    if (x0 === null || x1 === null) return null
    return { x: (frame) => x0 + (frame - 1) * (x1 - x0), half: (x1 - x0) / 2 }
  }

  private y(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null
  }

  private paintBehind(ctx: CanvasRenderingContext2D, size: Size): void {
    const cols = this.columns()
    if (!this.insight || !cols) return
    for (const zone of this.insight.zones) {
      const left = Math.round(cols.x(zone.start) - cols.half)
      const right = Math.round(cols.x(zone.end) + cols.half)
      ctx.fillStyle = tint(zone.color, zone.opacity)
      ctx.fillRect(left, 0, right - left, size.height)
    }
    if (this.plain) return
    for (const band of this.insight.bands) {
      const top = this.y(band.hi)
      const bottom = this.y(band.lo)
      if (top === null || bottom === null) continue
      const left = band.start > 0 ? Math.round(cols.x(band.start) - cols.half) : 0
      ctx.fillStyle = tint(band.color, 0.16)
      ctx.fillRect(left, top, size.width - left, bottom - top)
    }
  }

  private paintFront(ctx: CanvasRenderingContext2D, size: Size): void {
    const cols = this.columns()
    if (!this.insight || !cols) return
    const { bands, zones, levels, vlines, brackets, marks } = this.insight
    ctx.save()
    ctx.lineWidth = 1

    for (const line of vlines) {
      const x = Math.round(cols.x(line.frame) + cols.half) + 0.5
      this.stroke(ctx, line.color, [5, 4], [x, 0], [x, size.height])
    }
    if (this.plain) {
      ctx.restore()
      return
    }

    for (const band of bands) {
      const top = this.y(band.hi)
      const bottom = this.y(band.lo)
      if (top === null || bottom === null) continue
      const left = band.start > 0 ? cols.x(band.start) - cols.half : 0
      for (const y of [top, bottom]) {
        this.stroke(ctx, tint(band.color, 0.8), [], [left, Math.round(y) + 0.5], [size.width, Math.round(y) + 0.5])
      }
      const from = band.label_frame > 0 ? cols.x(band.label_frame) - cols.half : left
      this.label(ctx, size, band.text, band.color, () => [from + GAP, top + GAP])
    }
    for (const level of levels) {
      const y = this.y(level.price)
      if (y === null) continue
      const at = Math.round(y) + 0.5
      this.stroke(ctx, level.color, [6, 3], [cols.x(level.start) - cols.half, at], [cols.x(level.end) + cols.half, at], 2)
      const from = cols.x(level.label_frame > 0 ? level.label_frame : level.start) - cols.half
      this.label(ctx, size, level.text, level.color, (_, h) => [from, y - h - GAP])
    }
    for (const zone of zones) {
      const centre = (cols.x(zone.start) + cols.x(zone.end)) / 2
      const top = zone.text_price > 0 ? this.y(zone.text_price) : TOP
      if (top === null) continue
      this.label(ctx, size, zone.text, zone.color, (w) => [centre - w / 2, top])
    }
    for (const line of vlines) {
      const x = cols.x(line.frame) + cols.half
      const top = line.text_price > 0 ? this.y(line.text_price) : TOP
      if (top === null) continue
      this.label(ctx, size, line.text, line.color, (w) => [line.side === 'left' ? x - w - GAP : x + GAP, top])
    }
    for (const bracket of brackets) {
      const top = this.y(bracket.hi)
      const bottom = this.y(bracket.lo)
      if (top === null || bottom === null) continue
      const x = Math.round(cols.x(bracket.frame)) + 0.5
      this.stroke(ctx, bracket.color, [], [x, top], [x, bottom], 2)
      for (const y of [top, bottom]) this.stroke(ctx, bracket.color, [], [x - TICK, y], [x + TICK, y], 2)
      this.label(ctx, size, bracket.text, bracket.color, (_, h) => [x + TICK + GAP, (top + bottom) / 2 - h / 2])
    }
    for (const mark of marks) {
      const bar = this.bars[mark.frame - 1]
      const tip = bar ? this.y(mark.side === 'above' ? bar.h : bar.l) : null
      if (tip === null) continue
      const up = mark.side === 'above' ? -1 : 1
      const x = cols.x(mark.frame)
      const end: [number, number] = [x + mark.dx, tip + up * (GAP + mark.len)]
      this.stroke(ctx, '#111111', [], [x, tip + up * GAP], end)
      this.label(
        ctx,
        size,
        mark.text,
        '#111111',
        (w, h) => [end[0] - w / 2, mark.side === 'above' ? end[1] - h : end[1]],
        mark.bold,
      )
    }
    ctx.restore()
  }

  private stroke(
    ctx: CanvasRenderingContext2D,
    color: string,
    dash: number[],
    from: [number, number],
    to: [number, number],
    width = 1,
  ): void {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(from[0], from[1])
    ctx.lineTo(to[0], to[1])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Text in a white box edged with its colour, kept inside the pane.
  private label(
    ctx: CanvasRenderingContext2D,
    size: Size,
    text: string,
    color: string,
    place: Place,
    bold = false,
  ): void {
    if (!text) return
    const lines = text.split('\n')
    ctx.font = bold ? `bold ${FONT}` : FONT
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + PAD * 2
    const height = lines.length * LINE_HEIGHT + PAD * 2
    const [wantX, wantY] = place(width, height)
    const x = Math.round(Math.max(EDGE, Math.min(wantX, size.width - width - EDGE)))
    const y = Math.round(Math.max(EDGE, Math.min(wantY, size.height - height - EDGE)))
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
    ctx.fillRect(x, y, width, height)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    lines.forEach((line, i) => ctx.fillText(line, x + PAD, y + PAD + LINE_HEIGHT * (i + 0.5)))
  }
}
