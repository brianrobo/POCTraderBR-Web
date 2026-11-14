import type { SimFrame } from '../api/client'

export interface SimTracks {
  m30: SimFrame[]
  m1: SimFrame[]
}

export function splitTracks(frames: SimFrame[]): SimTracks {
  const byPosition = (a: SimFrame, b: SimFrame) => a.position - b.position
  return {
    m30: frames.filter((f) => f.track === '30m').sort(byPosition),
    m1: frames.filter((f) => f.track === '1m').sort(byPosition),
  }
}

/**
 * Which 30m frame to show while replay sits on 1m frame `pos1`: the latest
 * one whose sync point has been reached. A 30m frame with no sync point is
 * never shown on its own — it would reveal bars that haven't formed yet —
 * except the very first one, which stands in as the starting chart.
 */
export function syncedIndex30(tracks: SimTracks, pos1: number): number | null {
  const index1 = new Map(tracks.m1.map((f, i) => [f.id, i]))
  let shown: number | null = null
  tracks.m30.forEach((f, i) => {
    const at = f.sync_frame_id ? index1.get(f.sync_frame_id) : undefined
    if (at !== undefined && at <= pos1) shown = i
  })
  if (shown !== null) return shown
  const first = tracks.m30[0]
  const firstIsSynced = first?.sync_frame_id ? index1.has(first.sync_frame_id) : false
  return first && !firstIsSynced ? 0 : null
}
