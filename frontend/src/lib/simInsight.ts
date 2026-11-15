// What "My Insight" draws for a quiz: which bars to bring into view, and how
// much of it there is to draw while the replay has only come so far.
import type { SimQuizInsight } from '../api/client'

/** A quiz's insight with the quiz range it belongs to, as bar indexes. */
export interface QuizInsight {
  quizId: string
  from: number
  to: number
  insight: SimQuizInsight
}

/** Bars shown either side of the quiz range when the insight names no view of its own. */
const VIEW_MARGIN = 30

/** The bars to bring into view for an insight — [first, last] indexes among `count` bars. */
export function insightView(item: QuizInsight, count: number): [number, number] {
  const { view_start, view_end } = item.insight
  const given = view_start > 0 && view_end >= view_start
  const first = given ? view_start - 1 : item.from - VIEW_MARGIN
  const last = given ? view_end - 1 : item.to + VIEW_MARGIN
  const clamp = (i: number) => Math.max(0, Math.min(i, count - 1))
  return [clamp(first), clamp(last)]
}

/**
 * The part of an insight that sits on the bars up to index `now`: what is on
 * later bars is left out and spans running past `now` end there, so a replay
 * shows nothing of what comes next.
 */
export function insightUpTo(insight: SimQuizInsight, now: number): SimQuizInsight {
  const last = now + 1 // frame number of the last bar on the chart
  const span = <T extends { start: number; end: number }>(items: T[]) =>
    items.filter((x) => x.start <= last).map((x) => ({ ...x, end: Math.min(x.end, last) }))
  const reached = <T extends { frame: number }>(items: T[]) => items.filter((x) => x.frame <= last)
  return {
    ...insight,
    bands: insight.bands
      .filter((b) => b.start <= last)
      .map((b) => ({ ...b, label_frame: Math.min(b.label_frame, last) })),
    zones: span(insight.zones),
    levels: span(insight.levels).map((l) => ({ ...l, label_frame: Math.min(l.label_frame, last) })),
    vlines: reached(insight.vlines),
    brackets: reached(insight.brackets),
    marks: reached(insight.marks),
  }
}
