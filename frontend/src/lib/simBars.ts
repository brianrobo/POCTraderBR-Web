// Price-bar helpers for the data-driven simulator: 30-minute candles built
// from 1-minute bars, moving averages, and time labels. `t` is the exchange
// wall-clock time read as UTC (epoch seconds), so every clock/date here uses
// the UTC getters.

export interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export const MA_PERIODS = [5, 10, 20, 60, 120] as const

// The user's HTS indicator for the lower pane: M = ((H+L)/2) * V / 70000.
const AMOUNT_DIVISOR = 70000

/**
 * Traded amount of a bar (the export's own amount column is empty). Like the
 * HTS indicator it is worked out from the bar it is drawn on, so a 30-minute
 * candle uses its own high, low and volume rather than a sum of its minutes.
 */
export function tradedAmount(bar: Bar): number {
  return (((bar.h + bar.l) / 2) * bar.v) / AMOUNT_DIVISOR
}

const HALF_HOUR = 1800
// US sessions open at 04:00; overnight bars run past midnight on the previous session.
const SESSION_START = 4 * 3600

/** API rows [time, open, high, low, close, volume] → bars. */
export function decodeBars(rows: number[][]): Bar[] {
  return rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
}

/** Start time of the 30-minute candle that the time `t` falls in. */
export function bucket30(t: number): number {
  return t - (t % HALF_HOUR)
}

/**
 * 30-minute candles of the 1-minute bars `bars[0..upto]`, each stamped with
 * its start time (15:30 holds 15:30–15:59, as the HTS labels them). The last
 * one is still forming unless `upto` happens to close it — nothing past
 * `upto` is looked at.
 */
export function aggregate30(bars: Bar[], upto: number = bars.length - 1): Bar[] {
  const out: Bar[] = []
  let cur: Bar | undefined
  for (let i = 0; i <= upto && i < bars.length; i++) {
    const b = bars[i]
    const start = bucket30(b.t)
    if (!cur || cur.t !== start) {
      cur = { t: start, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }
      out.push(cur)
    } else {
      cur.h = Math.max(cur.h, b.h)
      cur.l = Math.min(cur.l, b.l)
      cur.c = b.c
      cur.v += b.v
    }
  }
  return out
}

/** Simple moving average of the closes; null until `period` bars exist. */
export function movingAverage(bars: Bar[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c
    if (i >= period) sum -= bars[i - period].c
    out.push(i >= period - 1 ? sum / period : null)
  }
  return out
}

/** Index of the bar at time `t`, or of the first bar after it; -1 past the end. */
export function indexAtOrAfter(bars: Bar[], t: number): number {
  let lo = 0
  let hi = bars.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].t < t) lo = mid + 1
    else hi = mid
  }
  return lo < bars.length ? lo : -1
}

/**
 * Index of the bar a practice run begins at: where the earliest quiz range
 * starts, or the replay start while there are no quizzes.
 */
export function practiceStart(bars: Bar[], replayFrom: number, quizStarts: number[]): number {
  const from = quizStarts.length > 0 ? Math.min(...quizStarts) : replayFrom
  return Math.max(0, indexAtOrAfter(bars, from))
}

/**
 * Indices of the first and last 1-minute bars, among `bars[0..upto]`, of the
 * 30-minute candle that starts at `t`; null when it has none.
 */
export function barsOf30(bars: Bar[], t: number, upto: number = bars.length - 1): [number, number] | null {
  const from = indexAtOrAfter(bars, t)
  const next = indexAtOrAfter(bars, t + HALF_HOUR)
  const to = Math.min(upto, (next < 0 ? bars.length : next) - 1)
  return from < 0 || to < from ? null : [from, to]
}

export interface SessionStart {
  /** e.g. "11/13" */
  label: string
  index: number
}

/** Midnight of the trading session that the time `t` belongs to. */
export function sessionDay(t: number): number {
  return Math.floor((t - SESSION_START) / 86400) * 86400
}

/** The first bar of each trading session. */
export function sessionStarts(bars: Bar[]): SessionStart[] {
  const out: SessionStart[] = []
  let day = NaN
  bars.forEach((b, index) => {
    const d = sessionDay(b.t)
    if (d === day) return
    day = d
    out.push({ label: formatDate(d), index })
  })
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "11/13" */
export function formatDate(t: number): string {
  const d = new Date(t * 1000)
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
}

/** "26.11.13" — how scenarios are named. */
export function formatScenarioDate(t: number): string {
  const d = new Date(t * 1000)
  return `${pad(d.getUTCFullYear() % 100)}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`
}

/** "09:57" */
export function formatClock(t: number): string {
  const d = new Date(t * 1000)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** "11/13 09:57" */
export function formatBarTime(t: number): string {
  return `${formatDate(t)} ${formatClock(t)}`
}

// 02:00 on the nth Sunday of a month, as exchange wall-clock time.
function nthSunday(year: number, month: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay()
  return Date.UTC(year, month, 1 + ((7 - firstWeekday) % 7) + (n - 1) * 7, 2) / 1000
}

/**
 * Korean time of a bar time, in the same wall-clock-as-UTC form. Bar times are
 * US Eastern wall-clock time, 13 hours behind Korea during US daylight time
 * (second Sunday of March to first Sunday of November) and 14 otherwise.
 */
export function toKst(t: number): number {
  const year = new Date(t * 1000).getUTCFullYear()
  const daylight = t >= nthSunday(year, 2, 2) && t < nthSunday(year, 10, 1)
  return t + (daylight ? 13 : 14) * 3600
}

export interface Aftermath {
  /** The quiz bar's close — the price a buy there is measured from. */
  entry: number
  high: number
  highTime: number
  low: number
  lowTime: number
  last: number
  lastTime: number
}

/** How price moved over `bars[from+1..to]` relative to the close of `bars[from]`. */
export function aftermath(bars: Bar[], from: number, to: number): Aftermath | null {
  if (from < 0 || to <= from || to >= bars.length) return null
  let hi = bars[from + 1]
  let lo = bars[from + 1]
  for (let i = from + 2; i <= to; i++) {
    if (bars[i].h > hi.h) hi = bars[i]
    if (bars[i].l < lo.l) lo = bars[i]
  }
  return {
    entry: bars[from].c,
    high: hi.h,
    highTime: hi.t,
    low: lo.l,
    lowTime: lo.t,
    last: bars[to].c,
    lastTime: bars[to].t,
  }
}

/** "+12.3%" */
export function formatPct(value: number, base: number): string {
  const pct = (value / base - 1) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}
