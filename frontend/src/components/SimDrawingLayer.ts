import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts'
import type { SimDrawing } from '../api/client'
import { hitsShape, type Box } from '../lib/simDrawings'

/** A drawing without its bookkeeping — also the shape being dragged out. */
export type Shape = Pick<SimDrawing, 'kind' | 'x1' | 'y1' | 'x2' | 'y2'> & { id?: string }

const COLOR: Record<SimDrawing['kind'], string> = { line: '#ffe600', hline: '#ffe600', rect: '#00a843', ellipse: '#ffe600' }
const HANDLE = 3
// The price written at the right end of a horizontal line.
const PRICE_FONT = '11px sans-serif'
const PRICE_BACK = '#2b2b2b'

/**
 * Draws the shapes on the chart's main pane. They are kept in chart
 * coordinates (bar position, price) and turned into pixels on every repaint,
 * so they stay on their bars and prices while the chart scrolls and zooms.
 */
export class SimDrawingLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private series: ISeriesApi<SeriesType> | null = null
  private requestUpdate: (() => void) | null = null
  private shapes: Shape[] = []
  private selected: string | null = null

  private readonly view: IPrimitivePaneView = {
    zOrder: () => 'top',
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize.width)),
    }),
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
    return [this.view]
  }

  /** What to draw; `selected` is the id of the shape shown with its handles. */
  set(shapes: Shape[], selected: string | null): void {
    this.shapes = shapes
    this.selected = selected
    this.requestUpdate?.()
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i]
      const box = this.toPixels(shape)
      if (shape.id && box && hitsShape(shape.kind, box, x, y)) {
        return { externalId: shape.id, zOrder: 'top', cursorStyle: 'pointer' }
      }
    }
    return null
  }

  private toPixels(shape: Shape): Box | null {
    if (!this.chart || !this.series) return null
    const scale = this.chart.timeScale()
    const x1 = scale.logicalToCoordinate(shape.x1 as Logical)
    const x2 = scale.logicalToCoordinate(shape.x2 as Logical)
    const y1 = this.series.priceToCoordinate(shape.y1)
    const y2 = this.series.priceToCoordinate(shape.y2)
    return x1 === null || x2 === null || y1 === null || y2 === null ? null : { x1, y1, x2, y2 }
  }

  private paint(ctx: CanvasRenderingContext2D, width: number): void {
    for (const shape of this.shapes) {
      const box = this.toPixels(shape)
      if (!box) continue
      const picked = shape.id !== undefined && shape.id === this.selected
      ctx.strokeStyle = COLOR[shape.kind]
      ctx.lineWidth = picked ? 3 : 2
      ctx.beginPath()
      if (shape.kind === 'line') {
        ctx.moveTo(box.x1, box.y1)
        ctx.lineTo(box.x2, box.y2)
      } else if (shape.kind === 'hline') {
        ctx.moveTo(0, box.y1)
        ctx.lineTo(width, box.y1)
      } else if (shape.kind === 'rect') {
        ctx.rect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1)
      } else {
        ctx.ellipse(
          (box.x1 + box.x2) / 2,
          (box.y1 + box.y2) / 2,
          Math.abs(box.x2 - box.x1) / 2,
          Math.abs(box.y2 - box.y1) / 2,
          0,
          0,
          Math.PI * 2,
        )
      }
      ctx.stroke()
      if (shape.kind === 'hline') this.paintPrice(ctx, shape.y1, box.y1, width)
      if (!picked) continue
      ctx.fillStyle = '#ffffff'
      ctx.lineWidth = 1
      for (const [x, y] of [
        [box.x1, box.y1],
        [box.x2, box.y2],
      ]) {
        ctx.fillRect(x - HANDLE, y - HANDLE, HANDLE * 2, HANDLE * 2)
        ctx.strokeRect(x - HANDLE, y - HANDLE, HANDLE * 2, HANDLE * 2)
      }
    }
  }

  private paintPrice(ctx: CanvasRenderingContext2D, price: number, y: number, width: number): void {
    const text = this.series?.priceFormatter().format(price) ?? String(price)
    ctx.font = PRICE_FONT
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + 8
    ctx.fillStyle = PRICE_BACK
    ctx.fillRect(width - w - 2, y - 16, w, 14)
    ctx.fillStyle = COLOR.hline
    ctx.fillText(text, width - w + 2, y - 9)
  }
}
