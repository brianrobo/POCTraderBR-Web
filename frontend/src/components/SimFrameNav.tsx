import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface Props {
  count: number
  index: number
  /** Highest index that may be reached (practice mode locks later frames). */
  max?: number
  /** Number the first frame is counted from (default 1). */
  first?: number
  onIndex: (index: number) => void
}

// Holding ◀/▶ down: after HOLD_DELAY_MS it steps every HOLD_INTERVAL_MS until released.
const HOLD_DELAY_MS = 350
const HOLD_INTERVAL_MS = 100

/**
 * Click handlers for a step button that also repeats while it is held down.
 * `onStep` returns false when there is nowhere left to go, which ends the repeat.
 */
function useHoldStep(onStep: (delta: number) => boolean) {
  const stepRef = useRef(onStep)
  useEffect(() => {
    stepRef.current = onStep
  })
  const release = useRef<(() => void) | null>(null)
  // True once a press has started repeating: the click that ends it is not a step of its own.
  const repeated = useRef(false)
  useEffect(() => () => release.current?.(), [])

  return (delta: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      release.current?.()
      repeated.current = false
      let interval: number | undefined
      const delay = window.setTimeout(() => {
        repeated.current = true
        const tick = () => {
          if (!stepRef.current(delta)) stop()
        }
        tick()
        interval = window.setInterval(tick, HOLD_INTERVAL_MS)
      }, HOLD_DELAY_MS)
      // The button turns disabled at the end of the range and stops getting events, so listen on the window.
      const stop = () => {
        window.clearTimeout(delay)
        window.clearInterval(interval)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', stop)
        window.removeEventListener('blur', stop)
        release.current = null
      }
      const onUp = () => {
        stop()
        // after the click this release produces, if any
        window.setTimeout(() => {
          repeated.current = false
        }, 0)
      }
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', stop)
      window.addEventListener('blur', stop)
      release.current = stop
    },
    onClick: () => {
      if (repeated.current) repeated.current = false
      else stepRef.current(delta)
    },
    // Enter/Space on the focused button repeat by themselves; a held press never ends in one of these.
    onKeyDown: () => {
      repeated.current = false
    },
  })
}

export function SimFrameNav({ count, index, max = count - 1, first = 1, onIndex }: Props) {
  const hold = useHoldStep((delta) => {
    const next = Math.min(Math.max(index + delta, 0), max)
    if (next === index) return false
    onIndex(next)
    return true
  })
  return (
    <div className="sim-nav">
      <button type="button" disabled={index <= 0} title="누르고 있으면 계속 넘어갑니다" {...hold(-1)}>
        ◀
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, count - 1)}
        value={index}
        disabled={count === 0}
        onChange={(e) => onIndex(Math.min(Number(e.target.value), max))}
      />
      <button type="button" disabled={index >= max} title="누르고 있으면 계속 넘어갑니다" {...hold(1)}>
        ▶
      </button>
      <span className="sim-nav-count">{count === 0 ? '0 / 0' : `${first + index} / ${first + count - 1}`}</span>
    </div>
  )
}

// Fields where ←/→ already mean something (caret, slider).
function usesArrowKeys(el: HTMLElement | null): boolean {
  if (!el) return false
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox'
}

const SHIFT_STEP = 10

/** ←/→ step through frames (Shift: ten at a time), unless the key was typed into a field. */
export function useArrowKeys(onStep: (delta: number) => void) {
  const stepRef = useRef(onStep)
  useEffect(() => {
    stepRef.current = onStep
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (usesArrowKeys(e.target as HTMLElement | null)) return
      e.preventDefault()
      stepRef.current((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? SHIFT_STEP : 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
