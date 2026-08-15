import { useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, Path, PencilBrush, Point, type TPointerEventInfo, type TPointerEvent } from 'fabric'
import { api, type ImageSlot, type ImageSlotKey, type Page, type Stroke } from '../api/client'

type Mode = 'none' | 'draw' | 'pan'

const COLORS = ['#ff3c3c', '#2d6bff', '#222222']

interface Props {
  page: Page
  slot: ImageSlotKey
  label: string
  onPageUpdate: (page: Page) => void
}

function getImageSlotData(page: Page, slot: ImageSlotKey): ImageSlot | null {
  switch (slot) {
    case 'a':
      return page.image_a
    case 'a2':
      return page.image_a2
    case 'b':
      return page.image_b
    case 'b2':
      return page.image_b2
  }
}

function getStockNameData(page: Page, slot: ImageSlotKey): string {
  switch (slot) {
    case 'a':
      return page.stock_name_a
    case 'a2':
      return page.stock_name_a2
    case 'b':
      return page.stock_name_b
    case 'b2':
      return page.stock_name_b2
  }
}

/**
 * How the current image is placed on the canvas: a plain "contain fit"
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

export function ChartCanvas({ page, slot, label, onPageUpdate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const elRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const currentImgRef = useRef<FabricImage | null>(null)
  const placementRef = useRef<Placement>({ scale: 1, left: 0, top: 0 })
  const strokesRef = useRef<Stroke[]>([])
  const modeRef = useRef<Mode>('none')
  const [mode, setMode] = useState<Mode>('none')
  const [color, setColor] = useState(COLORS[0])
  const [penWidth, setPenWidth] = useState(3)
  const [uploading, setUploading] = useState(false)
  const stockNameSaveTimer = useRef<number | null>(null)
  const [stockName, setStockName] = useState(getStockNameData(page, slot))

  const imageSlot: ImageSlot | null = getImageSlotData(page, slot)
  const imageUrl = imageSlot ? `/uploads/${imageSlot.path}` : null
  const savedStockName = getStockNameData(page, slot)

  // Keep the input in sync when the underlying page data changes from
  // elsewhere (e.g. switching pages), without fighting the user's typing.
  useEffect(() => {
    setStockName(savedStockName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, savedStockName])

  function handleStockNameChange(value: string) {
    setStockName(value)
    if (stockNameSaveTimer.current) window.clearTimeout(stockNameSaveTimer.current)
    stockNameSaveTimer.current = window.setTimeout(async () => {
      const updated = await api.updateStockName(page.id, slot, value)
      onPageUpdate(updated)
    }, 500)
  }

  // ---- Fabric canvas lifecycle (mounted once per component instance) -----

  useEffect(() => {
    if (!elRef.current || !wrapRef.current) return
    const canvas = new Canvas(elRef.current, { selection: false })
    canvasRef.current = canvas
    canvas.freeDrawingBrush = new PencilBrush(canvas)
    canvas.isDrawingMode = false

    const resize = () => syncAndFit(canvas)
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapRef.current)
    // ResizeObserver alone doesn't reliably fire for every browser-window
    // resize in all cases — back it up with a direct window listener.
    window.addEventListener('resize', resize)

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
      if (modeRef.current !== 'pan') return
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
      window.removeEventListener('resize', resize)
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
      img.set({ selectable: false, evented: false, objectCaching: false })
      canvas.add(img)
      currentImgRef.current = img
      strokesRef.current = imageSlot?.strokes ?? []
      fitAndRedraw(canvas)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

  useEffect(() => {
    modeRef.current = mode
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
    // Contain the whole image within the box (letterbox) — nothing gets
    // cropped, matching what users expect for reviewing a chart image.
    const scale = Math.min(cw / iw, ch / ih)
    return { scale, left: (cw - iw * scale) / 2, top: (ch - ih * scale) / 2 }
  }

  /** Re-measures the wrap element and applies that size to the canvas
   * before fitting — this is the single source of truth for "current size",
   * used by both the resize listeners and the manual 맞춤 button so neither
   * can act on a stale canvas.getWidth()/getHeight(). */
  function syncAndFit(canvas: Canvas) {
    if (!wrapRef.current) return
    canvas.setDimensions({
      width: wrapRef.current.clientWidth,
      height: wrapRef.current.clientHeight,
    })
    fitAndRedraw(canvas)
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
    img.dirty = true
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    redrawStrokes(canvas, strokesRef.current)
    canvas.requestRenderAll()
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

  function undoLastStroke() {
    const canvas = canvasRef.current
    if (!canvas) return
    const paths = canvas.getObjects().filter((o) => o.type === 'path')
    const last = paths[paths.length - 1]
    if (!last) return
    canvas.remove(last)
    canvas.requestRenderAll()
    void persistStrokes()
  }

  function clearStrokes() {
    const canvas = canvasRef.current
    if (!canvas) return
    const paths = canvas.getObjects().filter((o) => o.type === 'path')
    if (paths.length === 0) return
    if (!window.confirm('이 이미지에 그린 내용을 모두 지울까요?')) return
    for (const p of paths) canvas.remove(p)
    canvas.requestRenderAll()
    void persistStrokes()
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

  async function handleDeleteImage() {
    if (!window.confirm('이 이미지를 삭제할까요? (그려둔 내용도 함께 삭제됩니다)')) return
    const updated = await api.deleteImage(page.id, slot)
    onPageUpdate(updated)
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
          {uploading ? '업로드 중...' : `이미지 ${label} 업로드`}
          <input type="file" accept="image/png,image/jpeg,image/bmp,image/webp" onChange={handleUpload} hidden />
        </label>
        {imageUrl && (
          <button type="button" onClick={handleDeleteImage}>
            이미지 삭제
          </button>
        )}
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
            if (canvas) syncAndFit(canvas)
          }}
        >
          맞춤
        </button>
        <button type="button" onClick={undoLastStroke}>
          실행취소
        </button>
        <button type="button" onClick={clearStrokes}>
          전체 지우기
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
      <div className="chart-stockname-row">
        <input
          type="text"
          className="stockname-input"
          placeholder={`종목명 ${label}`}
          value={stockName}
          onChange={(e) => handleStockNameChange(e.target.value)}
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
