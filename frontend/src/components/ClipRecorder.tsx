import { useEffect, useRef, useState } from 'react'
import { api, type Page } from '../api/client'

const MAX_SECONDS = 30
const FPS = 30

type Phase = 'idle' | 'picking' | 'recording' | 'saving'

interface Selection {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Timers {
  draw?: number
  tick?: number
  stop?: number
}

function even(n: number): number {
  return n - (n % 2)
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function ClipPlayer({ url, autoPlay = false }: { url: string; autoPlay?: boolean }) {
  return (
    <video
      className="clip-player"
      src={url}
      controls
      preload="metadata"
      onLoadedMetadata={(e) => {
        const v = e.currentTarget
        const start = () => {
          if (autoPlay) void v.play().catch(() => undefined)
        }
        if (v.duration !== Infinity) {
          start()
          return
        }
        v.ontimeupdate = () => {
          v.ontimeupdate = null
          v.currentTime = 0
          start()
        }
        v.currentTime = 1e101
      }}
    />
  )
}

interface Props {
  pageId: string
  clipUrl: string | null
  onChange: (page: Page) => void
}

export function ClipRecorder({ pageId, clipUrl, onChange }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [sel, setSel] = useState<Selection | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timersRef = useRef<Timers>({})
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  const cleanup = () => {
    const t = timersRef.current
    window.clearInterval(t.draw)
    window.clearInterval(t.tick)
    window.clearTimeout(t.stop)
    timersRef.current = {}
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => cleanup, [])

  useEffect(() => {
    if (phase === 'picking' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      void videoRef.current.play()
    }
  }, [phase])

  const reset = () => {
    cleanup()
    setPhase('idle')
    setSel(null)
  }

  const startPicking = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('화면 캡처는 http://localhost:8000 에서만 사용할 수 있습니다.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      streamRef.current = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorderRef.current) stopRecording()
        else reset()
      })
      setSel(null)
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

  const stopRecording = () => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }

  const startRecording = () => {
    const v = videoRef.current
    const stream = streamRef.current
    if (!v || !stream || !sel) return
    const vw = v.videoWidth
    const vh = v.videoHeight
    const x = Math.round(Math.min(sel.x0, sel.x1) * vw)
    const y = Math.round(Math.min(sel.y0, sel.y1) * vh)
    const w = even(Math.round(Math.abs(sel.x1 - sel.x0) * vw))
    const h = even(Math.round(Math.abs(sel.y1 - sel.y0) * vh))
    if (w < 16 || h < 16) {
      setError('영역이 너무 작습니다.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setError('캔버스를 만들 수 없습니다.')
      return
    }
    const draw = () => ctx.drawImage(v, x, y, w, h, 0, 0, w, h)
    draw()
    timersRef.current.draw = window.setInterval(draw, 1000 / FPS)

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'
    const rec = new MediaRecorder(canvas.captureStream(FPS), { mimeType, videoBitsPerSecond: 2_500_000 })
    chunksRef.current = []
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data)
    }
    rec.onstop = async () => {
      recorderRef.current = null
      cleanup()
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      chunksRef.current = []
      if (blob.size === 0) {
        setError('녹화된 내용이 없습니다.')
        setPhase('idle')
        return
      }
      setPhase('saving')
      try {
        onChange(await api.uploadClip(pageId, blob))
        setSel(null)
        setPhase('idle')
      } catch (err) {
        setError((err as Error).message)
        setPhase('idle')
      }
    }
    recorderRef.current = rec
    rec.start(500)

    const startedAt = Date.now()
    setElapsed(0)
    timersRef.current.tick = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      250,
    )
    timersRef.current.stop = window.setTimeout(stopRecording, MAX_SECONDS * 1000)
    setPhase('recording')
  }

  const removeClip = async () => {
    if (!window.confirm('이 클립을 삭제할까요?')) return
    onChange(await api.deleteClip(pageId))
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
    <div className="insight-clip">
      <div className="insight-clip-head">
        <span className="insight-clip-title">흐름 클립</span>
        {phase === 'idle' && (
          <>
            <button type="button" onClick={startPicking}>
              {clipUrl ? '클립 다시 녹화' : '클립 녹화'}
            </button>
            {clipUrl && (
              <button type="button" className="danger" onClick={removeClip}>
                클립 삭제
              </button>
            )}
          </>
        )}
        {error && <span className="clip-error">{error}</span>}
      </div>

      {phase === 'idle' && clipUrl && <ClipPlayer url={clipUrl} />}

      {phase !== 'idle' && (
        <div className={`clip-overlay ${phase}`}>
          <div className="clip-panel">
            {phase === 'picking' && (
              <div className="clip-hint">
                녹화할 차트 영역을 드래그로 지정하세요. 최대 {MAX_SECONDS}초까지 녹화됩니다.
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
                <button type="button" disabled={!sel} onClick={startRecording}>
                  녹화 시작
                </button>
                <button type="button" onClick={reset}>
                  취소
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'recording' && (
        <div className="clip-rec-pill">
          <span className="clip-rec-dot" />
          REC {elapsed}s / {MAX_SECONDS}s
          <button type="button" onClick={stopRecording}>
            정지
          </button>
        </div>
      )}
      {phase === 'saving' && <div className="clip-rec-pill">저장 중...</div>}
    </div>
  )
}
