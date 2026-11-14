// Picks which frames of a live screen capture are worth keeping as simulator
// frames: one per stable screen state, i.e. one per candle step. The screen
// has to hold still for `settleMs` before a state counts, so half-drawn
// redraws and anything in motion (a passing cursor) are skipped, and a state
// that matches the last kept one is never kept twice.

export interface FrameChangeOptions {
  /** Per-channel difference (0-255) above which a pixel counts as changed. */
  pixelThreshold: number
  /** Share of all pixels that must change before two frames count as different. */
  minChangedRatio: number
  /** How long a screen state must hold still before it is kept. */
  settleMs: number
}

export const DEFAULT_FRAME_CHANGE_OPTIONS: FrameChangeOptions = {
  pixelThreshold: 24,
  minChangedRatio: 0.0001,
  settleMs: 250,
}

/** Compare two same-sized RGBA buffers (as returned by getImageData). */
export function framesDiffer(a: Uint8ClampedArray, b: Uint8ClampedArray, opts: FrameChangeOptions): boolean {
  if (a.length !== b.length) return true
  const t = opts.pixelThreshold
  const need = Math.max(4, Math.ceil((a.length / 4) * opts.minChangedRatio))
  let changed = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > t || Math.abs(a[i + 1] - b[i + 1]) > t || Math.abs(a[i + 2] - b[i + 2]) > t) {
      if (++changed >= need) return true
    }
  }
  return false
}

export class FrameChangeDetector {
  private readonly opts: FrameChangeOptions
  private held: Uint8ClampedArray | null = null
  private heldSince = 0
  private heldDecided = false
  private kept: Uint8ClampedArray | null = null

  constructor(opts: FrameChangeOptions = DEFAULT_FRAME_CHANGE_OPTIONS) {
    this.opts = opts
  }

  /**
   * Feed the next captured frame. `changed` says the screen now shows a new
   * state (the caller should hold on to this frame's pixels); `keepPrevious`
   * says the state held until now turned out worth keeping, so the caller
   * must save the pixels it was holding *before* replacing them.
   */
  push(data: Uint8ClampedArray, t: number): { changed: boolean; keepPrevious: boolean } {
    if (!this.held) {
      this.hold(data, t)
      return { changed: true, keepPrevious: false }
    }
    if (!framesDiffer(data, this.held, this.opts)) return { changed: false, keepPrevious: false }
    const keepPrevious = !this.heldDecided && t - this.heldSince >= this.opts.settleMs && this.keepHeld()
    this.hold(data, t)
    return { changed: true, keepPrevious }
  }

  /**
   * Check whether the currently held state has been still long enough to
   * keep. `force` skips the wait — for the last state when capture stops.
   */
  settle(t: number, force = false): boolean {
    if (!this.held || this.heldDecided) return false
    if (!force && t - this.heldSince < this.opts.settleMs) return false
    return this.keepHeld()
  }

  private hold(data: Uint8ClampedArray, t: number): void {
    this.held = data
    this.heldSince = t
    this.heldDecided = false
  }

  private keepHeld(): boolean {
    this.heldDecided = true
    if (!this.held) return false
    if (this.kept && !framesDiffer(this.held, this.kept, this.opts)) return false
    this.kept = this.held
    return true
  }
}
