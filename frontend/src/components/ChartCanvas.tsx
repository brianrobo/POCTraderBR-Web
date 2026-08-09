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

/**
 * How the current image is placed on the canvas: a plain "cover fit"
 * (scale + top-left offset) of the image object itself, kept OUTSIDE of
 * fabric's viewportTransform. viewportTransform is reserved solely for the
 * user's own interactive pan/zoom gestures (mouse wheel / drag), so the two
 * concerns never fight each other.
 *
 * Strokes are drawn with fabric's PencilBrush, which records points in the
 * canvas's "world" coordinate space. To keep strokes visually attached to
 * the image regardless of window size, we convert world <-> image-pixel
 * coordinates using this placement whenever we save or (re)draw a stroke.
 */
interface Placement {
  scale: number
  left: number
  top: number
}

export function ChartCanvas({ page, slot, onPageUpdate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const currentImgRef = useRef<FabricImage | null>(null)
  const placementRef = useRef<Placement>({ scale: 1, left: 0, top: 0 })
  const strokesRef = useRef<Stroke[]>([])
  const [mode, setMode] = useState<Mode>('draw')
  const [color, setColor] = useState(COLORS[0])
  const [penWidth, setPenWidth] = useState(3)
  const [uploading, setUploading] = useState(false)

  const imageSlot: ImageSlot | null = slot === 'a' ? page.image_a : page.image_b
  const imageUrl = imageSlot ? `/uploads/${imageSlot.path}` : null

  // ---- Fabric canvas lifecycle (mounted once per component instance) -----

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
      fitAndRedraw(canvas)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapRef.current)

    // Interactive zoom (wheel) — layered on top of the base image placement
    // via viewportTransform; never touches image scale/position itself.
    canvas.on('mouse:wheel', (opt: TPointerEventInfo<TPointerEvent>) => {
      const e = opt.e as WheelEvent
      let zoom = canvas.getZoom()
      zoom *= 0.999 ** e.deltaY
      zoom = Math.min(20, Math.max(0.2, zoom))
      canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), zoom)
      e.preventDefault()
      e.stopPropagation()
    })

    // Interactive pan (drag while in "이동" mode).
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

  // ---- Load image + strokes whenever the image changes --------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.clear()
    canvas.backgroundColor = '#15181f'
    currentImgRef.current = null
    strokesRef.current = []
    if (!imageUrl) {
      canvas.renderAll()
      return
    }
    FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img) => {
      if (canvasRef.current !== canvas) return
      img.set({ selectable: false, evented: false })
      canvas.add(img)
      currentImgRef.current = img
      strokesRef.current = imageSlot?.strokes ?? []
      fitAndRedraw(canvas)
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

  // ---- Placement (cover-fit the image object; independent of vpt) --------

  function computePlacement(canvas: Canvas, img: FabricImage): Placement | null {
    const cw = canvas.getWidth()
    const ch = canvas.getHeight()
    const iw = img.width ?? cw
    const ih = img.height ?? ch
    if (cw <= 0 || ch <= 0 || iw <= 0 || ih <= 0) return null
    // Cover the whole box (crop overflow) rather than letterboxing.
    const scale = Math.max(cw / iw, ch / ih)
    return { scale, left: (cw - iw * scale) / 2, top: (ch - ih * scale) / 2 }
  }

  /** Re-fits the image to the current canvas size, resets interactive
   * pan/zoom, and rebuilds stroke paths from canonical image-pixel data so
   * they stay aligned with the (possibly newly-scaled) image. */
  function fitAndRedraw(canvas: Canvas) {
    const img = currentImgRef.current
    if (!img) return
    const placement = computePlacement(canvas, img)
    if (!placement) return
    placementRef.current = placement
    img.set({
      originX: 'left',
      originY: 'top',
      scaleX: placement.scale,
      scaleY: placement.scale,
      left: placement.left,
      top: placement.top,
    })
    img.setCoords()
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    redrawStrokes(canvas, strokesRef.current)
  }

  function redrawStrokes(canvas: Canvas, strokes: Stroke[]) {
    for (const obj of canvas.getObjects().filter((o) => o.type === 'path')) {
      canvas.remove(obj)
    }
    const { scale, left, top } = placementRef.current
    for (const s of strokes) {
      const worldPoints: [number, number][] = s.points.map(([x, y]) => [x * scale + left, y * scale + top])
      canvas.add(pointsToPath(worldPoints, s.color, s.width * scale))
    }
    canvas.requestRenderAll()
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

  function pathToWorldPoints(path: Path): [number, number][] {
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
    const { scale, left, top } = placementRef.current
    const strokes: Stroke[] = canvas
      .getObjects()
      .filter((o): o is Path => o.type === 'path')
      .map((p) => ({
        color: String(p.stroke ?? color),
        width: (p.strokeWidth ?? penWidth) / scale,
        points: pathToWorldPoints(p).map(([x, y]): [number, number] => [(x - left) / scale, (y - top) / scale]),
      }))
    strokesRef.current = strokes
    const updated = await api.updateStrokes(page.id, slot, strokes)
    onPageUpdate(updated)
  }

  // ---- Upload / paste -------------------------------------------------------

  async function uploadFile(file: File) {
    setUploading(true)
    try {
      const updated = await api.uploadImage(page.id, slot, file)
      onPageUpdate(updated)
    } finally {
      setUploading(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadFile(file)
    e.target.value = ''
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile()
        if (!blob) continue
        e.preventDefault()
        const file = new File([blob], `clipboard-${Date.now()}${extFromMime(item.type)}`, {
          type: item.type,
        })
        await uploadFile(file)
        break
      }
    }
  }

  function extFromMime(mime: string): string {
    switch (mime) {
      case 'image/jpeg':
        return '.jpg'
      case 'image/bmp':
        return '.bmp'
      case 'image/webp':
        return '.webp'
      default:
        return '.png'
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
        <button
          type="button"
          onClick={() => {
            const canvas = canvasRef.current
            if (canvas) fitAndRedraw(canvas)
          }}
        >
          맞춤
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
      <div
        className="chart-canvas-wrap"
        ref={wrapRef}
        tabIndex={0}
        onPaste={handlePaste}
        title="클릭 후 Ctrl+V로 이미지 붙여넣기"
      >
        <canvas ref={elRef} />
        {!imageUrl && <div className="chart-empty">클릭 후 Ctrl+V로 붙여넣기 (또는 업로드 버튼)</div>}
      </div>
    </div>
  )
}
