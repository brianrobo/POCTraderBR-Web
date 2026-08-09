import { useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, Path, PencilBrush, Point, type TPointerEventInfo, type TPointerEvent } from 'fabric'
import { api, type ImageSlot, type Page, type Stroke } from '../api/client'

type Mode = 'draw' | 'pan'

const COLORS = ['#ff3c3c', '#2d6bff', '#222222']

interface Props {
  page: Page
  slot: 'a' | 'b'
  onPageUpdate: (page: Page) => void
}

export function ChartCanvas({ page, slot, onPageUpdate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const [mode, setMode] = useState<Mode>('draw')
  const [color, setColor] = useState(COLORS[0])
  const [penWidth, setPenWidth] = useState(3)
  const [uploading, setUploading] = useState(false)

  const imageSlot: ImageSlot | null = slot === 'a' ? page.image_a : page.image_b
  const imageUrl = imageSlot ? `/uploads/${imageSlot.path}` : null

  // Initialize the fabric canvas once.
  useEffect(() => {
    if (!elRef.current || !wrapRef.current) return
    const canvas = new Canvas(elRef.current, { selection: false })
    canvasRef.current = canvas
    canvas.freeDrawingBrush = new PencilBrush(canvas)
    canvas.isDrawingMode = true

    const resize = () => {
      if (!wrapRef.current) return
      canvas.setDimensions({
        width: wrapRef.current.clientWidth,
        height: wrapRef.current.clientHeight,
      })
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapRef.current)

    canvas.on('mouse:wheel', (opt: TPointerEventInfo<TPointerEvent>) => {
      const e = opt.e as WheelEvent
      let zoom = canvas.getZoom()
      zoom *= 0.999 ** e.deltaY
      zoom = Math.min(20, Math.max(0.2, zoom))
      canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), zoom)
      e.preventDefault()
      e.stopPropagation()
    })

    let isPanning = false
    let lastX = 0
    let lastY = 0
    canvas.on('mouse:down', (opt: TPointerEventInfo<TPointerEvent>) => {
      if (canvas.isDrawingMode) return
      const e = opt.e as MouseEvent
      isPanning = true
      lastX = e.clientX
      lastY = e.clientY
    })
    canvas.on('mouse:move', (opt: TPointerEventInfo<TPointerEvent>) => {
      if (!isPanning) return
      const e = opt.e as MouseEvent
      const vpt = canvas.viewportTransform
      vpt[4] += e.clientX - lastX
      vpt[5] += e.clientY - lastY
      canvas.requestRenderAll()
      lastX = e.clientX
      lastY = e.clientY
    })
    canvas.on('mouse:up', () => {
      isPanning = false
    })

    canvas.on('path:created', () => {
      void persistStrokes()
    })

    return () => {
      ro.disconnect()
      canvas.dispose()
      canvasRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load background image + previously saved strokes whenever the image changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.clear()
    canvas.backgroundColor = '#15181f'
    if (!imageUrl) {
      canvas.renderAll()
      return
    }
    FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img) => {
      if (canvasRef.current !== canvas) return
      canvas.backgroundImage = img
      img.set({ selectable: false, evented: false })
      fitToScreen(canvas, img)
      renderStrokes(canvas, imageSlot?.strokes ?? [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.isDrawingMode = mode === 'draw'
  }, [mode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas?.freeDrawingBrush) return
    canvas.freeDrawingBrush.color = color
    canvas.freeDrawingBrush.width = penWidth
  }, [color, penWidth])

  function fitToScreen(canvas: Canvas, img: FabricImage) {
    const cw = canvas.getWidth()
    const ch = canvas.getHeight()
    const iw = img.width ?? cw
    const ih = img.height ?? ch
    const scale = Math.min(cw / iw, ch / ih)
    canvas.setViewportTransform([scale, 0, 0, scale, (cw - iw * scale) / 2, (ch - ih * scale) / 2])
  }

  function renderStrokes(canvas: Canvas, strokes: Stroke[]) {
    for (const s of strokes) {
      const path = pointsToPath(s.points, s.color, s.width)
      canvas.add(path)
    }
    canvas.renderAll()
  }

  function pointsToPath(points: [number, number][], strokeColor: string, strokeWidth: number): Path {
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
    return new Path(d || 'M 0 0', {
      stroke: strokeColor,
      strokeWidth,
      fill: '',
      selectable: false,
      evented: false,
    })
  }

  function pathToPoints(path: Path): [number, number][] {
    const cmds = (path.path ?? []) as (string | number)[][]
    const pts: [number, number][] = []
    for (const cmd of cmds) {
      const [op, ...rest] = cmd
      if (op === 'M' || op === 'L') pts.push([rest[0] as number, rest[1] as number])
      else if (op === 'Q') pts.push([rest[2] as number, rest[3] as number])
    }
    return pts
  }

  async function persistStrokes() {
    const canvas = canvasRef.current
    if (!canvas) return
    const strokes: Stroke[] = canvas
      .getObjects()
      .filter((o): o is Path => o.type === 'path')
      .map((p) => ({
        color: String(p.stroke ?? color),
        width: p.strokeWidth ?? penWidth,
        points: pathToPoints(p),
      }))
    const updated = await api.updateStrokes(page.id, slot, strokes)
    onPageUpdate(updated)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const updated = await api.uploadImage(page.id, slot, file)
      onPageUpdate(updated)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="chart-pane">
      <div className="chart-toolbar">
        <label className="upload-btn">
          {uploading ? '업로드 중...' : `이미지 ${slot.toUpperCase()} 업로드`}
          <input type="file" accept="image/png,image/jpeg,image/bmp,image/webp" onChange={handleUpload} hidden />
        </label>
        <button type="button" className={mode === 'draw' ? 'active' : ''} onClick={() => setMode('draw')}>
          펜
        </button>
        <button type="button" className={mode === 'pan' ? 'active' : ''} onClick={() => setMode('pan')}>
          이동
        </button>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <input
          type="range"
          min={1}
          max={12}
          value={penWidth}
          onChange={(e) => setPenWidth(Number(e.target.value))}
        />
      </div>
      <div className="chart-canvas-wrap" ref={wrapRef}>
        <canvas ref={elRef} />
        {!imageUrl && <div className="chart-empty">이미지를 업로드하세요</div>}
      </div>
    </div>
  )
}
