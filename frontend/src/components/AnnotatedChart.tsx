import { useEffect, useRef, useState } from 'react'
import type { ImageSlot, Stroke } from '../api/client'

export function uploadUrl(path: string): string {
  return `/uploads/${path.split('/').map(encodeURIComponent).join('/')}`
}

interface Box {
  wrapH: number
  imgW: number
  imgH: number
  left: number
  top: number
}

interface Props {
  src: string
  strokes: Stroke[]
  alt: string
  /** Fixed row height (px) so a second image (e.g. 돌파 확대) can match the
   * main chart's rendered height. Omit to size the wrapper to the image's
   * own aspect ratio at whatever width it's given (full-bleed, no crop). */
  height?: number
  /** How to fill `height` when the image's own aspect ratio doesn't match:
   * 'contain' letterboxes (no crop, may show empty bars), 'cover' crops
   * (fills the box completely, no bars). Ignored when `height` is omitted. */
  fit?: 'contain' | 'cover'
  /** Fires with this image's own rendered height whenever it's (re)computed
   * — lets a sibling image match it via the `height` prop above. */
  onHeightChange?: (height: number) => void
}

/**
 * Read-only render of a chart image with its saved pen/text annotations.
 * Strokes are stored in the image's native pixel coordinates. The overlay
 * SVG is sized/positioned to exactly match the image's own rendered box
 * (computed here) rather than assumed to fill the wrapper — required once
 * a fixed `height` can crop/letterbox the image away from the wrapper's edges.
 */
export function AnnotatedChart({ src, strokes, alt, height, fit = 'contain', onHeightChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!natural || !wrap) return
    const compute = () => {
      const cw = wrap.clientWidth
      if (cw <= 0) return
      let next: Box
      if (height) {
        const scale =
          fit === 'cover' ? Math.max(cw / natural.w, height / natural.h) : Math.min(cw / natural.w, height / natural.h)
        const imgW = natural.w * scale
        const imgH = natural.h * scale
        next = { wrapH: height, imgW, imgH, left: (cw - imgW) / 2, top: (height - imgH) / 2 }
      } else {
        const imgH = cw * (natural.h / natural.w)
        next = { wrapH: imgH, imgW: cw, imgH, left: 0, top: 0 }
      }
      setBox(next)
      onHeightChange?.(next.wrapH)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(wrap)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, height, fit])

  return (
    <div className="annotated-chart" ref={wrapRef} style={{ height: box?.wrapH }}>
      <img
        className="remind-chart-img"
        src={src}
        alt={alt}
        style={box ? { width: box.imgW, height: box.imgH, left: box.left, top: box.top } : { opacity: 0 }}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
      {natural && box && (
        <svg
          className="annotated-chart-overlay"
          style={{ width: box.imgW, height: box.imgH, left: box.left, top: box.top }}
          viewBox={`0 0 ${natural.w} ${natural.h}`}
          preserveAspectRatio="none"
        >
          {strokes.map((s, i) =>
            s.kind === 'text' ? (
              <text
                key={i}
                x={s.x}
                y={s.y}
                fontSize={s.font_size}
                fill={s.color}
                fontFamily="'Times New Roman', serif"
                dominantBaseline="text-before-edge"
              >
                {s.text}
              </text>
            ) : (
              <path
                key={i}
                d={s.points.map(([x, y], j) => `${j === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')}
                stroke={s.color}
                strokeWidth={s.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}
        </svg>
      )}
    </div>
  )
}

/**
 * The "main chart + 돌파 확대" pair, wherever it appears (insight feed card,
 * 1분봉 비교 card). The main image renders at its own natural height; the
 * zoom image is fed that same height and crops (never letterboxes) to match
 * it exactly, so the two sit flush without black bars.
 */
export function ChartComparisonImages({
  imageA,
  imageB,
  itemName,
}: {
  imageA: ImageSlot | null
  imageB: ImageSlot | null
  itemName: string
}) {
  const [mainHeight, setMainHeight] = useState<number | undefined>(undefined)

  if (!imageA && !imageB) return null

  return (
    <div className="insight-card-images">
      {imageA && (
        <AnnotatedChart
          src={uploadUrl(imageA.path)}
          strokes={imageA.strokes}
          alt={`${itemName} 화면`}
          onHeightChange={imageB ? setMainHeight : undefined}
        />
      )}
      {imageB && (
        <AnnotatedChart
          src={uploadUrl(imageB.path)}
          strokes={imageB.strokes}
          alt={`${itemName} 돌파 확대`}
          height={mainHeight}
          fit="cover"
        />
      )}
    </div>
  )
}
