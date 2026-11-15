import { useMemo } from 'react'
import { api, type SimBarData, type SimDrawing } from '../api/client'
import { aftermath, decodeBars, practiceStart } from '../lib/simBars'
import type { QuizInsight } from '../lib/simInsight'
import type { ChartMark } from './SimBarChart'
import { AftermathLine, SimBarPanes } from './SimBarPanes'
import { PLAIN_STEP, QuizRunBar, QuizRunPanels, RISE_MARK, RISE_WORDING, useQuizRun, type QuizStep } from './SimQuizRun'

interface Props {
  data: SimBarData
  updateData: (fn: (d: SimBarData) => SimBarData) => void
  onAttempt: () => void
}

/** A quiz range as frame numbers — the bars counted from the start of the file. */
function frameSpan(from: number, to: number): string {
  return from === to ? `프레임 ${from + 1}` : `프레임 ${from + 1}~${to + 1}`
}

// Replays a price-data scenario one 1-minute bar at a time. A run begins
// where the first quiz range does (at the replay start while there are no
// quizzes); the bars before that are only there as chart history. Each quiz
// range is watched up to its last bar, where the question is asked.
export function SimBarPractice({ data, updateData, onAttempt }: Props) {
  const bars = useMemo(() => decodeBars(data.bars), [data.bars])
  const start = useMemo(
    () =>
      practiceStart(
        bars,
        data.replay_from,
        data.quizzes.map((q) => q.start_time),
      ),
    [bars, data.replay_from, data.quizzes],
  )

  const steps = useMemo(() => {
    const indexOf = new Map(bars.map((b, i) => [b.t, i]))
    const quizAt = new Map(data.quizzes.map((q) => [q.bar_time, q]))
    return bars.slice(start).map((bar, i): QuizStep => {
      const quiz = quizAt.get(bar.t)
      if (!quiz) return PLAIN_STEP
      return {
        id: quiz.id,
        is_quiz: true,
        quiz_outcome: quiz.outcome,
        quiz_note: quiz.note,
        quiz_from: Math.max(0, (indexOf.get(quiz.start_time) ?? start + i) - start),
      }
    })
  }, [bars, start, data.quizzes])

  const run = useQuizRun(steps, async (step, choice) => {
    await api.createSimBarAttempt(step.id, choice)
    onAttempt()
  })

  // Quiz points reached so far: the choice made there, or "?" while it is open.
  const { answers } = run
  const marks = useMemo(
    () =>
      data.quizzes.map((q): ChartMark => {
        const choice = answers[q.id]
        return choice
          ? { t: q.bar_time, text: RISE_MARK[choice], kind: choice }
          : { t: q.bar_time, text: '?', kind: 'quiz' }
      }),
    [data.quizzes, answers],
  )
  const ranges = useMemo(() => data.quizzes.map((q) => ({ from: q.start_time, to: q.bar_time })), [data.quizzes])
  // "My Insight" draws the insight of the last quiz answered in this run —
  // never one still to be answered, which it would give away.
  const quizInsight = useMemo((): QuizInsight | null => {
    const shown = data.quizzes.findLast((q) => q.insight && answers[q.id])
    if (!shown?.insight) return null
    const indexOf = (t: number) => Math.max(0, bars.findIndex((b) => b.t === t))
    return { quizId: shown.id, from: indexOf(shown.start_time), to: indexOf(shown.bar_time), insight: shown.insight }
  }, [bars, data.quizzes, answers])

  const setDrawings = (next: SimDrawing[]) => {
    updateData((d) => ({ ...d, drawings: next }))
    void api.setSimDrawings(data.scenario_id, next)
  }

  if (bars.length === 0) return <div className="empty-state">가격 데이터가 없습니다.</div>

  const { watching } = run

  return (
    <div className="sim-body">
      <SimBarPanes
        bars={bars}
        now={start + run.at}
        marks={marks}
        ranges={ranges}
        drawings={data.drawings}
        onDrawings={setDrawings}
        insight={quizInsight}
        insightHint={
          data.quizzes.some((q) => q.insight)
            ? '해석이 있는 퀴즈에 답한 뒤에 볼 수 있습니다'
            : '이 시나리오의 퀴즈에 등록된 해석이 없습니다'
        }
      />
      <QuizRunBar
        run={run}
        count={steps.length}
        first={start + 1}
        note={
          watching &&
          `퀴즈 구간 ${frameSpan(start + watching.from, start + watching.to)} — ${start + watching.to + 1}에서 답합니다`
        }
      />
      <QuizRunPanels
        run={run}
        wording={RISE_WORDING}
        stepName={(i) => frameSpan(start + (steps[i].quiz_from ?? i), start + i)}
        resultDetail={(review) => {
          const after = aftermath(bars, start + review.index, start + review.until)
          return after && <AftermathLine after={after} />
        }}
      />
    </div>
  )
}
