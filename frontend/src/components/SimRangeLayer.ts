import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  Logical,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'

/** A span of bars, by the times of its first and last bar. */
export interface TimeRange {
  from: number
  to: number
}

const FILL = 'rgba(122, 31, 209, 0.13)'
const EDGE = 'rgba(122, 31, 209, 0.75)'

/**
 * Shades spans of bars over the full height of a pane, behind the series —
 * the quiz ranges. Both ends of a span must be bars on the chart.
 */
export class SimRangeLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private requestUpdate: (() => void) | null = null
  private ranges: TimeRange[] = []

  private readonly view: IPrimitivePaneView = {
    zOrder: () => 'bottom',
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize.height)),
    }),
  }

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chart = chart
    this.requestUpdate = requestUpdate
  }

  detached(): void {
    this.chart = this.requestUpdate = null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }

  set(ranges: TimeRange[]): void {
    this.ranges = ranges
    this.requestUpdate?.()
  }

  private paint(ctx: CanvasRenderingContext2D, height: number): void {
    if (!this.chart) return
    const scale = this.chart.timeScale()
    const x0 = scale.logicalToCoordinate(0 as Logical)
    const x1 = scale.logicalToCoordinate(1 as Logical)
    if (x0 === null || x1 === null) return
    // A span covers its bars whole: half a bar's width beyond the centres of the first and last.
    const half = (x1 - x0) / 2
    for (const range of this.ranges) {
      const from = scale.timeToCoordinate(range.from as UTCTimestamp)
      const to = scale.timeToCoordinate(range.to as UTCTimestamp)
      if (from === null || to === null) continue
      const left = Math.round(from - half)
      const right = Math.round(to + half)
      ctx.fillStyle = FILL
      ctx.fillRect(left, 0, right - left, height)
      ctx.fillStyle = EDGE
      ctx.fillRect(left, 0, 1, height)
      ctx.fillRect(right - 1, 0, 1, height)
    }
  }
}
