import { useEffect, useRef, useState } from 'react'
import { api, type SimFrame, type SimTrack } from '../api/client'
import { FrameChangeDetector } from '../lib/frameChange'

// Live screen capture for a simulator track: share the chart window, drag a
// region, then step the chart one candle at a time — every time the region
// settles on a new picture it is saved as the next frame. Frames are taken
// straight from the screen stream (no video file in between), so they stay
// as sharp as a screenshot.

const REGION_KEY = 'poctrader:simCaptureRegion'
const COMPARE_MAX_WIDTH = 800
const SETTLE_POLL_MS = 200
const FALLBACK_SAMPLE_MS = 100

type Phase = 'idle' | 'picking' | 'capturing' | 'finishing'

interface Selection {
  x0: number
  y0: number
  x1: number
  y1: number
}

// Chromium-only; delivers frames without timers, so capture keeps working
// while this tab sits in the background behind the chart program.
interface TrackProcessor {
  readable: ReadableStream<VideoFrame>
}
type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessor

interface CaptureSession {
  stop: () => void
  finish: () => void
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

// While capturing, this tab usually sits hidden behind the chart program,
// where the browser slows page timers down to one tick a second. Timers in a
// worker keep their pace, so the ticks come from there.
function startTicker(ms: number, onTick: () => void): () => void {
  try {
    const url = URL.createObjectURL(
      new Blob([`setInterval(() => postMessage(0), ${ms})`], { type: 'text/javascript' }),
    )
    const worker = new Worker(url)
    worker.onmessage = onTick
    return () => {
      worker.terminate()
      URL.revokeObjectURL(url)
    }
  } catch {
    const id = window.setInterval(onTick, ms)
    return () => window.clearInterval(id)
  }
}

function loadRegion(track: SimTrack): Selection | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${REGION_KEY}:${track}`) ?? 'null')
    if (parsed && ['x0', 'y0', 'x1', 'y1'].every((k) => typeof parsed[k] === 'number')) return parsed as Selection
  } catch {
    // ignore malformed value
  }
  return null
}

interface Props {
  scenarioId: string
  track: SimTrack
  onFrame: (frame: SimFrame) => void
  onDone: () => void
}

export function SimFrameCapture({ scenarioId, track, onFrame, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const [count, setCount] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<CaptureSession | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(
    () => () => {
      sessionRef.current?.stop()
      sessionRef.current = null
      releaseStream()
    },
    [],
  )

  useEffect(() => {
    if (phase === 'picking' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      void videoRef.current.play()
    }
  }, [phase])

  const reset = () => {
    releaseStream()
    setPhase('idle')
  }

  const startPicking = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('화면 캡처는 http://localhost:8000 에서만 사용할 수 있습니다.')
      return
    }
    try {
      // `cursor` isn't in the TS constraint types yet; browsers that don't
      // know it just ignore it.
      const video = { cursor: 'never' } as MediaTrackConstraints
      const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false })
      streamRef.current = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (sessionRef.current) sessionRef.current.finish()
        else reset()
      })
      setSel(loadRegion(track))
      setPhase('picking')
    } catch (e) {
      const err = e as Error
      setError(err.name === 'NotAllowedError' ? '화면 공유가 취소되었습니다.' : err.message)
    }
  }

  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phase !== 'picking') return
    const r = e.currentTarget.getBoundingClientRect()
    const x = clamp01((e.clientX - r.left) / r.width)
    const y = clamp01((e.clientY - r.top) / r.height)
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartRef.current = { x, y }
    setSel({ x0: x, y0: y, x1: x, y1: y })
  }

  const onStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start) return
    const r = e.currentTarget.getBoundingClientRect()
    const x1 = clamp01((e.clientX - r.left) / r.width)
    const y1 = clamp01((e.clientY - r.top) / r.height)
    setSel({ x0: start.x, y0: start.y, x1, y1 })
  }

  const onStagePointerUp = () => {
    dragStartRef.current = null
    setSel((prev) => {
      if (!prev) return prev
      const tooSmall = Math.abs(prev.x1 - prev.x0) < 0.01 || Math.abs(prev.y1 - prev.y0) < 0.01
      return tooSmall ? null : prev
    })
  }

  const startCapturing = () => {
    const v = videoRef.current
    const stream = streamRef.current
    const videoTrack = stream?.getVideoTracks()[0]
    if (!v || !videoTrack || !sel) return
    if (Math.abs(sel.x1 - sel.x0) * v.videoWidth < 16 || Math.abs(sel.y1 - sel.y0) * v.videoHeight < 16) {
      setError('영역이 너무 작습니다.')
      return
    }

    // `held` keeps the full-size pixels of the current screen state until the
    // detector decides whether to save them; `cmp` is a smaller copy that is
    // cheap to read back and compare on every frame.
    const held = document.createElement('canvas')
    const cmp = document.createElement('canvas')
    const heldCtx = held.getContext('2d')
    const cmpCtx = cmp.getContext('2d', { willReadFrequently: true })
    if (!heldCtx || !cmpCtx) {
      setError('캔버스를 만들 수 없습니다.')
      return
    }

    localStorage.setItem(`${REGION_KEY}:${track}`, JSON.stringify(sel))
    let detector = new FrameChangeDetector()
    let uploads: Promise<void> = Promise.resolve()
    let stopped = false

    // The selection is kept as fractions of the picture and turned into
    // source pixels here, so it still covers the same area if the stream
    // changes resolution (the shared window gets resized).
    let srcW = 0
    let srcH = 0
    let x = 0
    let y = 0
    let w = 0
    let h = 0
    const fit = (width: number, height: number) => {
      srcW = width
      srcH = height
      x = Math.round(Math.min(sel.x0, sel.x1) * width)
      y = Math.round(Math.min(sel.y0, sel.y1) * height)
      w = Math.max(1, Math.round(Math.abs(sel.x1 - sel.x0) * width))
      h = Math.max(1, Math.round(Math.abs(sel.y1 - sel.y0) * height))
      held.width = w
      held.height = h
      const scale = Math.min(1, COMPARE_MAX_WIDTH / w)
      cmp.width = Math.max(1, Math.round(w * scale))
      cmp.height = Math.max(1, Math.round(h * scale))
      detector = new FrameChangeDetector()
    }

    // toBlob snapshots the canvas when called, so the held pixels can be
    // overwritten right after; chaining keeps uploads in capture order.
    const saveHeld = () => {
      const blob = new Promise<Blob | null>((resolve) => held.toBlob(resolve, 'image/png'))
      uploads = uploads
        .then(async () => {
          const data = await blob
          if (!data) return
          onFrame(await api.addSimFrame(scenarioId, track, data))
          setCount((c) => c + 1)
        })
        .catch((err: Error) => setError(err.message))
    }

    const process = (source: CanvasImageSource, width: number, height: number) => {
      if (stopped || width === 0 || height === 0) return
      const now = performance.now()
      if (width !== srcW || height !== srcH) {
        // Resizing clears `held`, so settle what it shows first.
        if (detector.settle(now, true)) saveHeld()
        fit(width, height)
      }
      cmpCtx.drawImage(source, x, y, w, h, 0, 0, cmp.width, cmp.height)
      const data = cmpCtx.getImageData(0, 0, cmp.width, cmp.height).data
      const { changed, keepPrevious } = detector.push(data, now)
      if (keepPrevious) saveHeld()
      if (changed) heldCtx.drawImage(source, x, y, w, h, 0, 0, w, h)
      else if (detector.settle(now)) saveHeld()
    }

    let stopTicker: () => void
    let reader: ReadableStreamDefaultReader<VideoFrame> | undefined
    let readerTrack: MediaStreamTrack | undefined
    const Processor = (window as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
      .MediaStreamTrackProcessor
    if (Processor) {
      readerTrack = videoTrack.clone()
      reader = new Processor({ track: readerTrack }).readable.getReader()
      const activeReader = reader
      void (async () => {
        for (;;) {
          const { done, value } = await activeReader.read()
          if (done || !value) break
          try {
            process(value, value.displayWidth, value.displayHeight)
          } finally {
            value.close()
          }
        }
      })().catch(() => undefined)
      // The screen stream only sends frames while something changes, so a
      // timer has to notice that the picture has gone quiet.
      stopTicker = startTicker(SETTLE_POLL_MS, () => {
        if (!stopped && detector.settle(performance.now())) saveHeld()
      })
    } else {
      stopTicker = startTicker(FALLBACK_SAMPLE_MS, () => process(v, v.videoWidth, v.videoHeight))
    }

    const stop = () => {
      stopped = true
      stopTicker()
      void reader?.cancel().catch(() => undefined)
      readerTrack?.stop()
    }

    const finish = () => {
      if (stopped) return
      if (detector.settle(performance.now(), true)) saveHeld()
      stop()
      sessionRef.current = null
      releaseStream()
      setPhase('finishing')
      void uploads.then(() => {
        setPhase('idle')
        onDone()
      })
    }

    sessionRef.current = { stop, finish }
    setCount(0)
    setPhase('capturing')
  }

  const selBox = sel
    ? {
        left: `${Math.min(sel.x0, sel.x1) * 100}%`,
        top: `${Math.min(sel.y0, sel.y1) * 100}%`,
        width: `${Math.abs(sel.x1 - sel.x0) * 100}%`,
        height: `${Math.abs(sel.y1 - sel.y0) * 100}%`,
      }
    : null

  return (
    <>
      {phase === 'idle' && (
        <button type="button" onClick={startPicking}>
          화면 캡쳐
        </button>
      )}
      {error && <span className="clip-error">{error}</span>}

      {phase !== 'idle' && (
        <div className={`clip-overlay ${phase === 'picking' ? 'picking' : 'recording'}`}>
          <div className="clip-panel">
            {phase === 'picking' && (
              <div className="clip-hint">
                {track === '30m' ? '30분봉' : '1분봉'} 차트 영역을 드래그로 지정하세요. 캡쳐를 시작한 뒤 차트를 한
                봉씩 넘기면, 화면이 바뀌어 멈출 때마다 한 프레임씩 저장됩니다. 봉을 넘긴 뒤 0.5초쯤 두고 다음 봉으로
                넘기고, 마우스 커서와 깜빡이는 표시(현재가, 시계)는 영역 밖에 두세요.
              </div>
            )}
            <div
              className="clip-stage"
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={onStagePointerUp}
            >
              <video ref={videoRef} muted playsInline className="clip-video" />
              {phase === 'picking' && selBox && <div className="clip-sel" style={selBox} />}
            </div>
            {phase === 'picking' && (
              <div className="clip-actions">
                <button type="button" disabled={!sel} onClick={startCapturing}>
                  캡쳐 시작
                </button>
                <button type="button" onClick={reset}>
                  취소
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'capturing' && (
        <div className="clip-rec-pill">
          <span className="clip-rec-dot" />
          {track === '30m' ? '30분봉' : '1분봉'} 캡쳐 중 · {count} 프레임
          <button type="button" onClick={() => sessionRef.current?.finish()}>
            정지
          </button>
        </div>
      )}
      {phase === 'finishing' && <div className="clip-rec-pill">프레임 저장 중...</div>}
    </>
  )
}
