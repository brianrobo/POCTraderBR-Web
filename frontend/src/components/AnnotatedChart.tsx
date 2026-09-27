import { useState } from 'react'
import type { Stroke } from '../api/client'

export function uploadUrl(path: string): string {
  return `/uploads/${path.split('/').map(encodeURIComponent).join('/')}`
}

// Read-only render of a chart image with its saved pen/text annotations.
// Strokes are stored in the image's native pixel coordinates, so an SVG whose
// viewBox is the image's natural size lines up at any display width.
export function AnnotatedChart({ src, strokes, alt }: { src: string; strokes: Stroke[]; alt: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  return (
    <div className="annotated-chart">
      <img
        className="remind-chart-img"
        src={src}
        alt={alt}
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
      {size && (
        <svg className="annotated-chart-overlay" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
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
