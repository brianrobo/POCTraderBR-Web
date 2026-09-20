import { useEffect, useRef, useState } from 'react'

type Mode = 'idle' | 'roi' | 'colorUp' | 'colorDown' | 'peak' | 'trough'

interface Roi {
  x: number
  y: number
  w: number
  h: number
}

interface RGB {
  r: number
  g: number
  b: number
}

interface DragRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Threshold {
  level: number
  y: number
  triggered: boolean
}

interface LogEntry {
  time: string
  kind: 'recover' | 'surge' | 'inflection'
  level?: number
}

interface HistorySample {
  t: number
  y: number
}

interface FlashState {
  kind: 'recover' | 'surge' | 'inflection'
  level?: number
  until: number
}

interface TrackedLow {
  y: number
  t: number
}

interface InflectionZone {
  topY: number
  bottomY: number
}

const ANALYSIS_INTERVAL_MS = 700
const COLOR_TOLERANCE = 30
const THRESHOLD_LEVELS = [50, 80, 100]
const SURGE_COOLDOWN_MS = 15000

// Reasonable guesses for the standard red(up)/blue(down) candle colors used
// by Korean HTS charting tools — a convenience default so the user doesn't
// have to click-calibrate. Exact shades vary by theme/monitor, so this is a
// starting point; click-registering the real on-screen color is more
// accurate and overrides these.
const DEFAULT_UP_COLOR: RGB = { r: 230, g: 30, b: 30 }
const DEFAULT_DOWN_COLOR: RGB = { r: 40, g: 90, b: 230 }

function colorMatches(data: Uint8ClampedArray, idx: number, color: RGB): boolean {
  return (
    Math.abs(data[idx] - color.r) <= COLOR_TOLERANCE &&
    Math.abs(data[idx + 1] - color.g) <= COLOR_TOLERANCE &&
    Math.abs(data[idx + 2] - color.b) <= COLOR_TOLERANCE
  )
}

function matchesAnyColor(data: Uint8ClampedArray, idx: number, colors: RGB[]): boolean {
  return colors.some((c) => colorMatches(data, idx, c))
}

// Rescans the user-marked peak search zone for pixels matching any
// registered candle color and returns their tight bounding box — this is
// what continuously refines/redraws the "전고점 영역" rectangle each tick,
// rather than relying on one imprecise click.
function scanZoneBoundingBox(ctx: CanvasRenderingContext2D, zone: Roi, colors: RGB[]): Roi | null {
  const data = ctx.getImageData(zone.x, zone.y, zone.w, zone.h).data
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let row = 0; row < zone.h; row++) {
    for (let col = 0; col < zone.w; col++) {
      const idx = (row * zone.w + col) * 4
      if (matchesAnyColor(data, idx, colors)) {
        if (col < minX) minX = col
        if (col > maxX) maxX = col
        if (row < minY) minY = row
        if (row > maxY) maxY = row
      }
    }
  }
  if (minX === Infinity) return null
  return { x: zone.x + minX, y: zone.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function LiveAnalysisPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastAnalysisRef = useRef<number>(0)
  const dashOffsetRef = useRef<number>(0)

  const roiRef = useRef<Roi | null>(null)
  const draggingRef = useRef<DragRect | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const upColorRef = useRef<RGB | null>(null)
  const downColorRef = useRef<RGB | null>(null)
  const peakZoneRef = useRef<Roi | null>(null)
  const peakBoxRef = useRef<Roi | null>(null)
  const troughYRef = useRef<number | null>(null)
  const troughLowRef = useRef<TrackedLow | null>(null)
  const swingLowsRef = useRef<TrackedLow[]>([])
  const flatLevelRef = useRef<number | null>(null)
  const inflectionZoneRef = useRef<InflectionZone | null>(null)
  const flatToleranceRatioRef = useRef(0.04)
  const thresholdsRef = useRef<Threshold[]>([])
  const flashRef = useRef<FlashState | null>(null)
  const historyRef = useRef<HistorySample[]>([])
  const lastSurgeAlertRef = useRef<number>(0)
  const surgeEnabledRef = useRef(true)
  const surgeWindowMsRef = useRef(8000)
  const surgeRiseRatioRef = useRef(0.35)
  const inflectionEnabledRef = useRef(true)
  const inflectionConfirmRatioRef = useRef(0.08)
  const inflectionConfirmMsRef = useRef(3000)

  const [capturing, setCapturing] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')
  const [, setTick] = useState(0)
  const [log, setLog] = useState<LogEntry[]>([])
  const [surgeEnabled, setSurgeEnabled] = useState(true)
  const [surgeWindowSec, setSurgeWindowSec] = useState(8)
  const [surgeRisePct, setSurgeRisePct] = useState(35)
  const [inflectionEnabled, setInflectionEnabled] = useState(true)
  const [inflectionConfirmPct, setInflectionConfirmPct] = useState(8)
  const [inflectionConfirmSec, setInflectionConfirmSec] = useState(3)
  const [flatTolerancePct, setFlatTolerancePct] = useState(4)

  const forceUpdate = () => setTick((t) => t + 1)

  useEffect(() => {
    inflectionEnabledRef.current = inflectionEnabled
  }, [inflectionEnabled])
  useEffect(() => {
    inflectionConfirmRatioRef.current = inflectionConfirmPct / 100
  }, [inflectionConfirmPct])
  useEffect(() => {
    inflectionConfirmMsRef.current = inflectionConfirmSec * 1000
  }, [inflectionConfirmSec])
  useEffect(() => {
    flatToleranceRatioRef.current = flatTolerancePct / 100
  }, [flatTolerancePct])
  useEffect(() => {
    surgeEnabledRef.current = surgeEnabled
  }, [surgeEnabled])
  useEffect(() => {
    surgeWindowMsRef.current = surgeWindowSec * 1000
  }, [surgeWindowSec])
  useEffect(() => {
    surgeRiseRatioRef.current = surgeRisePct / 100
  }, [surgeRisePct])

  const isSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

  // Recomputes the 50/80/100% lines from the current peak-box top / trough Y,
  // but preserves each level's `triggered` flag — called every tick as the
  // peak box gets refined, so an already-fired alert doesn't get wiped just
  // because the box was redrawn at (nearly) the same position.
  const updateThresholdLevels = () => {
    const peakY = peakBoxRef.current?.y ?? null
    const troughY = troughYRef.current
    if (peakY == null || troughY == null) {
      thresholdsRef.current = []
      return
    }
    const top = Math.min(peakY, troughY)
    const bottom = Math.max(peakY, troughY)
    const existing = new Map(thresholdsRef.current.map((t) => [t.level, t]))
    thresholdsRef.current = THRESHOLD_LEVELS.map((level) => ({
      level,
      y: bottom - (level / 100) * (bottom - top),
      triggered: existing.get(level)?.triggered ?? false,
    }))
  }

  const playBeep = (level: number) => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const freq = level === 50 ? 440 : level === 80 ? 660 : 880
    const ring = () => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.35)
    }
    ring()
    if (level === 100) window.setTimeout(ring, 400)
  }

  const fireAlert = (level: number) => {
    flashRef.current = { kind: 'recover', level, until: performance.now() + 2500 }
    playBeep(level)
    const entry: LogEntry = { time: new Date().toLocaleTimeString('ko-KR', { hour12: false }), kind: 'recover', level }
    setLog((prev) => [entry, ...prev].slice(0, 50))
  }

  const playSurgeBeep = () => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    ;[500, 700, 900].forEach((freq, i) => {
      window.setTimeout(() => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.15, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.15)
      }, i * 130)
    })
  }

  const fireSurgeAlert = () => {
    flashRef.current = { kind: 'surge', until: performance.now() + 2500 }
    playSurgeBeep()
    const entry: LogEntry = { time: new Date().toLocaleTimeString('ko-KR', { hour12: false }), kind: 'surge' }
    setLog((prev) => [entry, ...prev].slice(0, 50))
  }

  const playInflectionBeep = () => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(300, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.3)
    gain.gain.setValueAtTime(0.18, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
  }

  const fireInflectionAlert = () => {
    flashRef.current = { kind: 'inflection', until: performance.now() + 2500 }
    playInflectionBeep()
    const entry: LogEntry = { time: new Date().toLocaleTimeString('ko-KR', { hour12: false }), kind: 'inflection' }
    setLog((prev) => [entry, ...prev].slice(0, 50))
  }

  // The actual rule for a downtrend→uptrend inflection: connect successive
  // swing lows — once two lows come out level (flat/수평), and a later low
  // forms HIGHER than that flat level, the downtrend has turned. This is
  // called each time one individual swing low gets confirmed (by
  // checkInflection below) and decides whether that low continues a flat
  // run, breaks it, or confirms the inflection.
  const recordSwingLow = (y: number, roiH: number) => {
    const tol = flatToleranceRatioRef.current * roiH
    const lows = swingLowsRef.current
    lows.push({ y, t: performance.now() })

    if (flatLevelRef.current == null) {
      const prev = lows[lows.length - 2]
      if (prev && Math.abs(y - prev.y) <= tol) {
        flatLevelRef.current = (y + prev.y) / 2
      }
      return
    }

    const flat = flatLevelRef.current
    if (flat - y > tol) {
      // This low is meaningfully higher (smaller y) than the flat level —
      // the downtrend has turned. The inflection "영역" spans the flat
      // level down to this higher low.
      inflectionZoneRef.current = { topY: Math.min(flat, y), bottomY: Math.max(flat, y) }
      troughYRef.current = flat
      updateThresholdLevels()
      fireInflectionAlert()
    } else if (Math.abs(y - flat) <= tol) {
      flatLevelRef.current = (flat + y) / 2 // another low at (about) the same level — refine it
    } else {
      flatLevelRef.current = null // dropped back below the flat level — sequence broken, start over
    }
  }

  // Independent module: once a peak is known, keeps tracking the running
  // low of the price proxy and confirms each individual swing low once
  // price has rebounded off it by a configured fraction of the ROI height
  // and held for a configured duration — then hands that swing low to
  // recordSwingLow to judge the flat→higher-low sequence. A manual click on
  // "눌림 저점 수동 지정" still overrides/pre-empts this (gated on troughYRef
  // being unset).
  const checkInflection = (roi: Roi, topRow: number) => {
    if (!inflectionEnabledRef.current) return
    if (!peakBoxRef.current) return
    if (troughYRef.current !== null) return

    const now = performance.now()
    const tracked = troughLowRef.current
    if (!tracked || topRow > tracked.y) {
      troughLowRef.current = { y: topRow, t: now }
      return
    }

    const reboundNeeded = inflectionConfirmRatioRef.current * roi.h
    const rebounded = tracked.y - topRow
    const sustainedMs = now - tracked.t
    if (rebounded >= reboundNeeded && sustainedMs >= inflectionConfirmMsRef.current) {
      const confirmedLowY = tracked.y
      troughLowRef.current = null
      recordSwingLow(confirmedLowY, roi.h)
    }
  }

  // Independent of the peak/trough swing setup below — only needs an ROI +
  // registered candle color, and keeps watching continuously for a fast
  // rise within a trailing time window (a proxy for "급등").
  const checkSurge = (roi: Roi, topRow: number) => {
    if (!surgeEnabledRef.current) return false
    const now = performance.now()
    const hist = historyRef.current
    hist.push({ t: now, y: topRow })
    const cutoff = now - surgeWindowMsRef.current
    while (hist.length > 0 && hist[0].t < cutoff) hist.shift()

    let lowestY = -Infinity // largest y in window = lowest price seen recently
    for (const s of hist) if (s.y > lowestY) lowestY = s.y

    const riseNeeded = surgeRiseRatioRef.current * roi.h
    if (lowestY - topRow >= riseNeeded && now - lastSurgeAlertRef.current > SURGE_COOLDOWN_MS) {
      lastSurgeAlertRef.current = now
      fireSurgeAlert()
      return true
    }
    return false
  }

  const runAnalysis = (ctx: CanvasRenderingContext2D) => {
    const colors = [upColorRef.current, downColorRef.current].filter((c): c is RGB => c !== null)
    if (colors.length === 0) return
    let changed = false

    // Keep refining the "전고점 영역" rectangle every tick from the marked
    // search zone — independent of the main observation ROI below, so it
    // works as soon as a candle color + peak zone are set.
    if (peakZoneRef.current) {
      const box = scanZoneBoundingBox(ctx, peakZoneRef.current, colors)
      const prev = peakBoxRef.current
      if (box && (!prev || prev.x !== box.x || prev.y !== box.y || prev.w !== box.w || prev.h !== box.h)) {
        peakBoxRef.current = box
        updateThresholdLevels()
        changed = true
      }
    }

    const roi = roiRef.current
    if (roi && roi.w > 0 && roi.h > 0) {
      const data = ctx.getImageData(roi.x, roi.y, roi.w, roi.h).data
      let topRow: number | null = null
      scan: for (let row = 0; row < roi.h; row++) {
        for (let col = 0; col < roi.w; col++) {
          const idx = (row * roi.w + col) * 4
          if (matchesAnyColor(data, idx, colors)) {
            topRow = roi.y + row
            break scan
          }
        }
      }
      if (topRow !== null) {
        for (const th of thresholdsRef.current) {
          if (!th.triggered && topRow <= th.y) {
            th.triggered = true
            changed = true
            fireAlert(th.level)
          }
        }
        if (checkSurge(roi, topRow)) changed = true
        const troughBefore = troughYRef.current
        checkInflection(roi, topRow)
        if (troughYRef.current !== troughBefore) changed = true
      }
    }

    if (changed) forceUpdate()
  }

  const drawOverlays = (ctx: CanvasRenderingContext2D) => {
    const canvas = ctx.canvas
    const roi = roiRef.current
    const drag = draggingRef.current

    if (drag) {
      const x = Math.min(drag.x0, drag.x1)
      const y = Math.min(drag.y0, drag.y1)
      ctx.strokeStyle = '#f5c518'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
    } else if (roi) {
      ctx.strokeStyle = '#2d6bff'
      ctx.lineWidth = 2
      ctx.strokeRect(roi.x, roi.y, roi.w, roi.h)
    }

    const lineX0 = roi ? roi.x : 0
    const lineX1 = roi ? roi.x + roi.w : canvas.width

    if (peakZoneRef.current) {
      ctx.strokeStyle = 'rgba(255, 140, 0, 0.85)'
      ctx.lineWidth = 2
      ctx.setLineDash([8, 5])
      ctx.lineDashOffset = -dashOffsetRef.current
      ctx.strokeRect(peakZoneRef.current.x, peakZoneRef.current.y, peakZoneRef.current.w, peakZoneRef.current.h)
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
      ctx.fillStyle = 'rgba(255, 140, 0, 0.85)'
      ctx.font = '12px sans-serif'
      ctx.fillText('감시 중...', peakZoneRef.current.x, peakZoneRef.current.y - 4)
    }
    if (peakBoxRef.current) {
      ctx.strokeStyle = '#ff3c3c'
      ctx.lineWidth = 2
      ctx.strokeRect(peakBoxRef.current.x, peakBoxRef.current.y, peakBoxRef.current.w, peakBoxRef.current.h)
      ctx.fillStyle = '#ff3c3c'
      ctx.font = '12px sans-serif'
      ctx.fillText('전고점', peakBoxRef.current.x, peakBoxRef.current.y + peakBoxRef.current.h + 14)
    }
    if (troughYRef.current != null && inflectionZoneRef.current) {
      // Confirmed inflection — the rule is "flat low, then a higher low", so
      // the zone spans from the flat level down/up to that higher low,
      // rather than a symmetric pad around one point.
      const { topY, bottomY } = inflectionZoneRef.current
      ctx.strokeStyle = '#4f83ff'
      ctx.lineWidth = 2
      ctx.setLineDash([8, 5])
      ctx.lineDashOffset = -dashOffsetRef.current
      ctx.strokeRect(lineX0, topY, lineX1 - lineX0, Math.max(bottomY - topY, 4))
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
      ctx.fillStyle = '#4f83ff'
      ctx.font = '12px sans-serif'
      ctx.fillText('변곡 영역 (확정)', lineX0, topY - 4)
    } else {
      // Not confirmed yet — show whichever stage of the flat→higher-low
      // sequence we're currently in.
      if (flatLevelRef.current != null && roi) {
        const tol = flatToleranceRatioRef.current * roi.h
        ctx.strokeStyle = 'rgba(79, 131, 255, 0.7)'
        ctx.lineWidth = 2
        ctx.setLineDash([8, 5])
        ctx.lineDashOffset = -dashOffsetRef.current
        ctx.strokeRect(roi.x, flatLevelRef.current - tol, roi.w, tol * 2)
        ctx.setLineDash([])
        ctx.lineDashOffset = 0
        ctx.fillStyle = 'rgba(79, 131, 255, 0.9)'
        ctx.font = '12px sans-serif'
        ctx.fillText('저점 수평 구간 (다음 저점 대기)', roi.x, flatLevelRef.current - tol - 4)
      }
      if (troughLowRef.current && roi) {
        const padding = Math.max(10, roi.h * 0.05)
        ctx.strokeStyle = 'rgba(79, 131, 255, 0.4)'
        ctx.lineWidth = 1
        ctx.setLineDash([5, 4])
        ctx.lineDashOffset = -dashOffsetRef.current
        ctx.strokeRect(roi.x, troughLowRef.current.y - padding, roi.w, padding * 2)
        ctx.setLineDash([])
        ctx.lineDashOffset = 0
        ctx.fillStyle = 'rgba(79, 131, 255, 0.75)'
        ctx.font = '11px sans-serif'
        ctx.fillText(
          `저점 추적 중... (${swingLowsRef.current.length}개 확인됨)`,
          roi.x,
          troughLowRef.current.y + padding + 13,
        )
      }
    }
    ctx.setLineDash([])

    for (const th of thresholdsRef.current) {
      ctx.strokeStyle = th.triggered ? '#2ecc71' : '#f5c518'
      ctx.beginPath()
      ctx.moveTo(lineX0, th.y)
      ctx.lineTo(lineX1, th.y)
      ctx.stroke()
      ctx.fillStyle = ctx.strokeStyle
      ctx.font = '16px sans-serif'
      ctx.fillText(`${th.level}%`, Math.min(lineX1 + 4, canvas.width - 40), th.y + 5)
    }

    const flash = flashRef.current
    if (flash) {
      if (performance.now() < flash.until) {
        ctx.strokeStyle =
          flash.kind === 'surge'
            ? '#ff8c00'
            : flash.kind === 'inflection'
              ? '#4f83ff'
              : flash.level === 100
                ? '#ff3c3c'
                : flash.level === 80
                  ? '#f5c518'
                  : '#2d6bff'
        ctx.lineWidth = 10
        ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10)
      } else {
        flashRef.current = null
      }
    }
  }

  useEffect(() => {
    if (!capturing) return
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0

    const tick = (now: number) => {
      if (video.readyState >= 2 && canvas.width > 0 && canvas.height > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        if (now - lastAnalysisRef.current > ANALYSIS_INTERVAL_MS) {
          lastAnalysisRef.current = now
          runAnalysis(ctx)
        }
        dashOffsetRef.current = (dashOffsetRef.current + 0.5) % 1000
        drawOverlays(ctx)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing])

  // Sets the canvas's CSS display size explicitly (rather than trusting CSS
  // max-width/flex to preserve aspect ratio) so getBoundingClientRect()
  // always matches the native resolution by one exact uniform scale factor.
  // Without this, the canvas being a flex item stretches its box independent
  // of its intrinsic aspect ratio, and mouse-click coordinate math
  // (toCanvasCoords) silently drifts off — the reported "cursor vs. drawn
  // rectangle" mismatch.
  const resizeCanvasDisplay = () => {
    const canvas = canvasRef.current
    if (!canvas || canvas.width === 0 || canvas.height === 0) return
    const container = canvas.parentElement
    const maxW = (container?.clientWidth ?? window.innerWidth) - 4
    const maxH = window.innerHeight * 0.7
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1)
    canvas.style.width = `${Math.round(canvas.width * scale)}px`
    canvas.style.height = `${Math.round(canvas.height * scale)}px`
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    resizeCanvasDisplay()
  }

  useEffect(() => {
    if (!capturing) return
    window.addEventListener('resize', resizeCanvasDisplay)
    return () => window.removeEventListener('resize', resizeCanvasDisplay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing])

  const stopCapture = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCapturing(false)
    roiRef.current = null
    peakZoneRef.current = null
    peakBoxRef.current = null
    troughYRef.current = null
    troughLowRef.current = null
    swingLowsRef.current = []
    flatLevelRef.current = null
    inflectionZoneRef.current = null
    thresholdsRef.current = []
    draggingRef.current = null
    dragStartRef.current = null
    flashRef.current = null
    historyRef.current = []
    lastSurgeAlertRef.current = 0
    forceUpdate()
  }

  const startCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      streamRef.current = stream
      stream.getVideoTracks()[0].addEventListener('ended', stopCapture)
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext()
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume()
      }
      setCapturing(true)
    } catch (e) {
      window.alert('화면 캡처를 시작할 수 없습니다: ' + (e as Error).message)
    }
  }

  const resetSwing = () => {
    peakZoneRef.current = null
    peakBoxRef.current = null
    troughYRef.current = null
    troughLowRef.current = null
    swingLowsRef.current = []
    flatLevelRef.current = null
    inflectionZoneRef.current = null
    thresholdsRef.current = []
    forceUpdate()
  }

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    }
  }

  const sampleColor = (cx: number, cy: number): RGB => {
    const ctx = canvasRef.current!.getContext('2d')!
    const size = 5
    const half = Math.floor(size / 2)
    const x = Math.max(0, Math.min(cx - half, ctx.canvas.width - size))
    const y = Math.max(0, Math.min(cy - half, ctx.canvas.height - size))
    const data = ctx.getImageData(x, y, size, size).data
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      n++
    }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
  }

  const isDragMode = (m: Mode) => m === 'roi' || m === 'peak'

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragMode(mode)) return
    const { x, y } = toCanvasCoords(e)
    dragStartRef.current = { x, y }
    draggingRef.current = { x0: x, y0: y, x1: x, y1: y }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragMode(mode) || !dragStartRef.current) return
    const { x, y } = toCanvasCoords(e)
    draggingRef.current = { x0: dragStartRef.current.x, y0: dragStartRef.current.y, x1: x, y1: y }
  }

  const handleMouseUp = () => {
    if (!isDragMode(mode) || !draggingRef.current) return
    const canvas = canvasRef.current
    const d = draggingRef.current
    const finishedMode = mode
    dragStartRef.current = null
    draggingRef.current = null
    if (canvas) {
      const x = Math.max(0, Math.round(Math.min(d.x0, d.x1)))
      const y = Math.max(0, Math.round(Math.min(d.y0, d.y1)))
      const w = Math.min(Math.round(Math.abs(d.x1 - d.x0)), canvas.width - x)
      const h = Math.min(Math.round(Math.abs(d.y1 - d.y0)), canvas.height - y)
      if (w > 5 && h > 5) {
        if (finishedMode === 'roi') {
          roiRef.current = { x, y, w, h }
          historyRef.current = []
          lastSurgeAlertRef.current = 0
        } else if (finishedMode === 'peak') {
          peakZoneRef.current = { x, y, w, h }
          peakBoxRef.current = null
          troughYRef.current = null
          troughLowRef.current = null
          swingLowsRef.current = []
          flatLevelRef.current = null
          inflectionZoneRef.current = null
          updateThresholdLevels()
        }
      }
    }
    setMode('idle')
    forceUpdate()
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'idle' || isDragMode(mode)) return
    const { x, y } = toCanvasCoords(e)
    if (mode === 'colorUp') {
      upColorRef.current = sampleColor(x, y)
    } else if (mode === 'colorDown') {
      downColorRef.current = sampleColor(x, y)
    } else if (mode === 'trough') {
      troughYRef.current = y
      updateThresholdLevels()
    }
    setMode('idle')
    forceUpdate()
  }

  const useDefaultColors = () => {
    upColorRef.current = DEFAULT_UP_COLOR
    downColorRef.current = DEFAULT_DOWN_COLOR
    forceUpdate()
  }

  if (!isSupported) {
    return (
      <div className="live-page">
        <div className="empty-state">
          이 기능은 브라우저의 화면 캡처 API가 필요합니다. 차트가 보이는 PC에서{' '}
          <code>http://localhost:8000</code>으로 접속했을 때만 사용할 수 있습니다 (다른 PC의 화면은 캡처할
          수 없어요).
        </div>
      </div>
    )
  }

  return (
    <div className="live-page">
      <div className="live-controls">
        {!capturing ? (
          <button type="button" onClick={startCapture}>
            화면 캡처 시작
          </button>
        ) : (
          <button type="button" onClick={stopCapture}>
            캡처 중지
          </button>
        )}
        <button
          type="button"
          disabled={!capturing}
          className={mode === 'roi' ? 'active' : ''}
          onClick={() => setMode('roi')}
        >
          관찰 영역 지정 (드래그)
        </button>
        <button
          type="button"
          disabled={!capturing}
          className={mode === 'colorUp' ? 'active' : ''}
          onClick={() => setMode('colorUp')}
        >
          상승색(빨강) 등록 (클릭)
        </button>
        <button
          type="button"
          disabled={!capturing}
          className={mode === 'colorDown' ? 'active' : ''}
          onClick={() => setMode('colorDown')}
        >
          하락색(파랑) 등록 (클릭)
        </button>
        <button type="button" disabled={!capturing} onClick={useDefaultColors}>
          기본 빨강/파랑 사용
        </button>
        <button
          type="button"
          disabled={!capturing}
          className={mode === 'peak' ? 'active' : ''}
          onClick={() => setMode('peak')}
        >
          전고점 영역 지정 (드래그)
        </button>
        <button
          type="button"
          disabled={!capturing}
          className={mode === 'trough' ? 'active' : ''}
          onClick={() => setMode('trough')}
        >
          눌림 저점 수동 지정 (클릭)
        </button>
        <button
          type="button"
          disabled={!peakZoneRef.current && troughYRef.current == null}
          onClick={resetSwing}
        >
          새 스윙으로 리셋
        </button>
      </div>

      <div className="live-surge-config">
        <label>
          <input
            type="checkbox"
            checked={surgeEnabled}
            onChange={(e) => setSurgeEnabled(e.target.checked)}
          />
          🚀 급등 자동 감지 (전고점/저점 지정 없이 상시 동작)
        </label>
        <label>
          관찰 구간
          <input
            type="number"
            min={2}
            max={60}
            value={surgeWindowSec}
            onChange={(e) => setSurgeWindowSec(Number(e.target.value) || 8)}
          />
          초
        </label>
        <label>
          상승 비율
          <input
            type="number"
            min={5}
            max={100}
            value={surgeRisePct}
            onChange={(e) => setSurgeRisePct(Number(e.target.value) || 35)}
          />
          % (관찰 영역 높이 기준)
        </label>
      </div>

      <div className="live-surge-config">
        <label>
          <input
            type="checkbox"
            checked={inflectionEnabled}
            onChange={(e) => setInflectionEnabled(e.target.checked)}
          />
          🔄 눌림 저점(변곡점) 자동 감지 (전고점 확정 후 상시 동작)
        </label>
        <label>
          반등 확인 폭
          <input
            type="number"
            min={2}
            max={50}
            value={inflectionConfirmPct}
            onChange={(e) => setInflectionConfirmPct(Number(e.target.value) || 8)}
          />
          % (관찰 영역 높이 기준)
        </label>
        <label>
          확인 시간
          <input
            type="number"
            min={1}
            max={30}
            value={inflectionConfirmSec}
            onChange={(e) => setInflectionConfirmSec(Number(e.target.value) || 3)}
          />
          초
        </label>
        <label>
          저점 수평 허용오차
          <input
            type="number"
            min={1}
            max={20}
            value={flatTolerancePct}
            onChange={(e) => setFlatTolerancePct(Number(e.target.value) || 4)}
          />
          % (이 안이면 같은 높이의 저점으로 인정)
        </label>
      </div>

      {mode !== 'idle' && (
        <div className="live-hint">
          {mode === 'roi' && '차트에서 현재가가 표시되는 우측 영역을 드래그해서 지정하세요.'}
          {mode === 'colorUp' && '상승(빨강) 캔들 위의 한 지점을 클릭하세요.'}
          {mode === 'colorDown' && '하락(파랑) 캔들 위의 한 지점을 클릭하세요.'}
          {mode === 'peak' &&
            '전고점 캔들 주변을 넉넉하게 드래그해서 감싸주세요. 정확하지 않아도 캔들색으로 자동 보정되어 계속 갱신됩니다.'}
          {mode === 'trough' && '눌림(조정) 저점 위치를 클릭하세요.'}
        </div>
      )}

      <div className="live-status">
        <span>
          상승색:{' '}
          {upColorRef.current ? (
            <span
              className="color-swatch"
              style={{
                background: `rgb(${upColorRef.current.r}, ${upColorRef.current.g}, ${upColorRef.current.b})`,
              }}
            />
          ) : (
            '미지정'
          )}
        </span>
        <span>
          하락색:{' '}
          {downColorRef.current ? (
            <span
              className="color-swatch"
              style={{
                background: `rgb(${downColorRef.current.r}, ${downColorRef.current.g}, ${downColorRef.current.b})`,
              }}
            />
          ) : (
            '미지정'
          )}
        </span>
        <span>
          전고점: {peakBoxRef.current ? '탐지됨' : peakZoneRef.current ? '탐지 중...' : '미지정'}
        </span>
        <span>
          눌림 저점:{' '}
          {troughYRef.current != null
            ? '확정됨'
            : flatLevelRef.current != null
              ? '수평 구간 확인, 다음 저점 대기 중...'
              : troughLowRef.current
                ? `저점 추적 중... (${swingLowsRef.current.length}개 확인됨)`
                : '미지정'}
        </span>
        {thresholdsRef.current.length > 0 && (
          <span className="threshold-status">
            {thresholdsRef.current.map((th) => (
              <span key={th.level} className={th.triggered ? 'triggered' : ''}>
                {th.level}%{th.triggered ? ' ✅' : ''}
              </span>
            ))}
          </span>
        )}
      </div>

      <div className="live-main">
        <video ref={videoRef} style={{ display: 'none' }} muted playsInline onLoadedMetadata={handleLoadedMetadata} />
        <canvas
          ref={canvasRef}
          className={`live-canvas ${mode !== 'idle' ? 'picking' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        />
        {!capturing && <div className="live-canvas-empty">캡처를 시작하면 화면이 여기에 표시됩니다.</div>}

        <div className="live-log">
          <h3>감지 로그</h3>
          {log.length === 0 ? (
            <div className="live-log-empty">아직 감지된 이벤트가 없습니다.</div>
          ) : (
            log.map((entry, idx) => (
              <div
                key={idx}
                className={`live-log-entry ${
                  entry.kind === 'surge'
                    ? 'level-surge'
                    : entry.kind === 'inflection'
                      ? 'level-inflection'
                      : `level-${entry.level}`
                }`}
              >
                <span className="live-log-time">{entry.time}</span>
                <span className="live-log-level">
                  {entry.kind === 'surge'
                    ? '🚀 급등 감지'
                    : entry.kind === 'inflection'
                      ? '🔄 변곡점 감지'
                      : `${entry.level}% 회복`}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
