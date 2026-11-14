// Geometry of the shapes drawn on a simulator chart, in screen pixels: each
// shape spans the box between its two corner points.
import type { SimDrawingKind } from '../api/client'

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** How close (px) a click has to be to a shape's outline to pick it. */
export const HIT_TOLERANCE = 6

function distanceToSegment(box: Box, x: number, y: number): number {
  const dx = box.x2 - box.x1
  const dy = box.y2 - box.y1
  const lengthSq = dx * dx + dy * dy
  const along = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - box.x1) * dx + (y - box.y1) * dy) / lengthSq))
  return Math.hypot(x - (box.x1 + along * dx), y - (box.y1 + along * dy))
}

/**
 * Whether the point is on the shape's outline, within `tolerance`. The inside
 * of a rectangle or ellipse does not count, so the candles under it stay
 * clickable.
 */
export function hitsShape(kind: SimDrawingKind, box: Box, x: number, y: number, tolerance = HIT_TOLERANCE): boolean {
  if (kind === 'line') return distanceToSegment(box, x, y) <= tolerance

  const left = Math.min(box.x1, box.x2)
  const right = Math.max(box.x1, box.x2)
  const top = Math.min(box.y1, box.y2)
  const bottom = Math.max(box.y1, box.y2)
  if (x < left - tolerance || x > right + tolerance || y < top - tolerance || y > bottom + tolerance) return false

  if (kind === 'rect') {
    return !(x > left + tolerance && x < right - tolerance && y > top + tolerance && y < bottom - tolerance)
  }

  const rx = (right - left) / 2
  const ry = (bottom - top) / 2
  const fromCenter = Math.hypot(x - (left + rx), y - (top + ry))
  if (rx <= tolerance || ry <= tolerance) return true // too thin to have an inside
  // k = 1 on the outline; the outline lies at fromCenter / k along the same ray.
  const k = Math.hypot((x - (left + rx)) / rx, (y - (top + ry)) / ry)
  return k > 0 && Math.abs(fromCenter - fromCenter / k) <= tolerance
}
