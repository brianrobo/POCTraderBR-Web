import { useMemo, useState, type ReactNode } from 'react'
import type { SimAnswer, SimOutcome } from '../api/client'
import { SimFrameNav, useArrowKeys } from './SimFrameNav'

/** What a replay step needs for quizzing — a captured frame or a price bar.
 * `id` only matters on quiz steps. */
export interface QuizStep {
  id: string
  is_quiz: boolean
  quiz_outcome: SimOutcome
  quiz_note: string
  /** Index of the step a quiz's watched range starts at — the quiz step
   * itself when left out. */
  quiz_from?: number
}

export const PLAIN_STEP: QuizStep = { id: '', is_quiz: false, quiz_outcome: '', quiz_note: '' }

/** How a quiz is put: the question, and what its answers and outcomes are called. */
export interface QuizWording {
  question: string
  answer: Record<SimAnswer, string>
  outcome: Record<Exclude<SimOutcome, ''>, string>
  ungraded: string
}

/** Would you buy here? — the quiz frames of a captured scenario. */
export const BUY_WORDING: QuizWording = {
  question: '이 지점에서 매수하시겠습니까?',
  answer: { buy: '매수', skip: '패스' },
  outcome: { profit: '매수했다면 수익', loss: '매수했다면 손실' },
  ungraded: '결과가 아직 지정되지 않았습니다 (편집에서 수익/손실을 지정하세요).',
}

/** Will price rise from here? — the quiz ranges of a price-data scenario. */
export const RISE_WORDING: QuizWording = {
  question: '이후 가격이 상승할까요?',
  answer: { buy: '상승', skip: '하락' },
  outcome: { profit: '이후 상승', loss: '이후 하락' },
  ungraded: '정답이 아직 지정되지 않았습니다 (편집에서 상승/하락을 지정하세요).',
}

export interface QuizReview {
  index: number
  step: QuizStep
  choice: SimAnswer
  /** The aftermath runs up to this step: where the next quiz begins, or the end. */
  until: number
  /** Whether enough of the aftermath has been seen to show how it turned out. */
  shown: boolean
}

export type QuizRun = ReturnType<typeof useQuizRun>

/**
 * One practice run over `steps`, one candle step at a time. Steps past a quiz
 * point stay locked until its answer is chosen; the following steps then show
 * how it played out, and the stored outcome confirms the answer.
 */
export function useQuizRun(steps: QuizStep[], record: (step: QuizStep, choice: SimAnswer) => Promise<unknown>) {
  const last = steps.length - 1
  const [pos, setPos] = useState(0)
  // This run's choices by step id; a fresh run starts empty.
  const [answers, setAnswers] = useState<Record<string, SimAnswer>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const quizIndexes = useMemo(() => steps.flatMap((s, i) => (s.is_quiz ? [i] : [])), [steps])
  const openQuiz = quizIndexes.find((i) => !(steps[i].id in answers))
  const maxIndex = openQuiz ?? last
  const at = Math.max(0, Math.min(pos, maxIndex))
  const step = steps[at] as QuizStep | undefined

  useArrowKeys((delta) => setPos(Math.max(0, Math.min(at + delta, maxIndex))))

  const pending = step !== undefined && step.is_quiz && !(step.id in answers)

  // The most recent answered quiz at or before the current step.
  const reviewIndex = quizIndexes.filter((i) => i <= at && steps[i].id in answers).at(-1)
  let review: QuizReview | null = null
  if (reviewIndex !== undefined) {
    const reviewed = steps[reviewIndex]
    const next = quizIndexes.find((i) => i > reviewIndex)
    const nextFrom = next === undefined ? last : (steps[next].quiz_from ?? next)
    // A next quiz whose range began before this answer leaves nothing in between.
    const until = nextFrom > reviewIndex ? nextFrom : (next ?? last)
    review = {
      index: reviewIndex,
      step: reviewed,
      choice: answers[reviewed.id],
      until,
      shown: revealed[reviewed.id] || at >= until,
    }
  }

  // The open quiz's range, while it is still being watched on the way to its question.
  const openFrom = openQuiz === undefined ? undefined : steps[openQuiz].quiz_from
  const watching =
    openQuiz !== undefined && openFrom !== undefined && at >= openFrom && at < openQuiz
      ? { from: openFrom, to: openQuiz }
      : null

  const answer = async (choice: SimAnswer) => {
    if (!step) return
    await record(step, choice)
    setAnswers((prev) => ({ ...prev, [step.id]: choice }))
  }

  const reveal = () => {
    if (review) setRevealed((prev) => ({ ...prev, [review.step.id]: true }))
  }

  const restart = () => {
    setPos(0)
    setAnswers({})
    setRevealed({})
  }

  return {
    at,
    maxIndex,
    setPos,
    answers,
    pending,
    watching,
    review,
    answer,
    reveal,
    restart,
    quizCount: quizIndexes.length,
    answeredCount: quizIndexes.filter((i) => steps[i].id in answers).length,
    gradedCount: quizIndexes.filter((i) => steps[i].id in answers && steps[i].quiz_outcome).length,
    correctCount: quizIndexes.filter((i) => isCorrect(steps[i], answers[steps[i].id])).length,
  }
}

interface BarProps {
  run: QuizRun
  count: number
  /** Number the first step is counted from (default 1). */
  first?: number
  /** A remark shown ahead of the score. */
  note?: ReactNode
}

/** ◀ slider ▶, the run's score, and the restart button. */
export function QuizRunBar({ run, count, first, note }: BarProps) {
  return (
    <div className="sim-practice-bar">
      <SimFrameNav count={count} index={run.at} max={run.maxIndex} first={first} onIndex={run.setPos} />
      {note && <span className="sim-dim sim-run-note">{note}</span>}
      {run.quizCount > 0 && (
        <span className="sim-dim">
          퀴즈 {run.answeredCount} / {run.quizCount}
          {run.gradedCount > 0 && ` · 정답 ${run.correctCount} / ${run.gradedCount}`}
        </span>
      )}
      <button type="button" onClick={run.restart}>
        처음부터 다시
      </button>
    </div>
  )
}

interface PanelsProps {
  run: QuizRun
  /** How a step is called in the result line, e.g. "#5 프레임". */
  stepName: (index: number) => string
  /** Extra lines under a shown result. */
  resultDetail?: (review: QuizReview) => ReactNode
  wording?: QuizWording
}

/** The last answer's result and, at an open quiz point, the question. */
export function QuizRunPanels({ run, stepName, resultDetail, wording = BUY_WORDING }: PanelsProps) {
  const { review } = run
  return (
    <>
      {review && (
        <div className={`sim-result ${review.shown ? resultClass(review.step, review.choice) : ''}`}>
          <span>
            {stepName(review.index)} 선택: <strong>{wording.answer[review.choice]}</strong>
          </span>
          {!review.shown ? (
            <>
              <span className="sim-dim">→ 키로 이후 흐름을 확인하세요.</span>
              <button type="button" onClick={run.reveal}>
                결과 보기
              </button>
            </>
          ) : (
            <>
              <span>{outcomeText(wording, review.step, review.choice)}</span>
              {resultDetail?.(review)}
              {review.step.quiz_note && <span className="sim-result-note">{review.step.quiz_note}</span>}
            </>
          )}
        </div>
      )}

      {run.pending && (
        <div className="sim-question">
          <span>{wording.question}</span>
          <button type="button" className="sim-buy" onClick={() => run.answer('buy')}>
            {wording.answer.buy}
          </button>
          <button type="button" className="sim-skip" onClick={() => run.answer('skip')}>
            {wording.answer.skip}
          </button>
        </div>
      )}
    </>
  )
}

function isCorrect(step: QuizStep, choice: SimAnswer | undefined): boolean {
  if (!choice || !step.quiz_outcome) return false
  return (choice === 'buy') === (step.quiz_outcome === 'profit')
}

function resultClass(step: QuizStep, choice: SimAnswer): string {
  if (!step.quiz_outcome) return ''
  return isCorrect(step, choice) ? 'correct' : 'wrong'
}

function outcomeText(wording: QuizWording, step: QuizStep, choice: SimAnswer): string {
  if (!step.quiz_outcome) return wording.ungraded
  return `${wording.outcome[step.quiz_outcome]} — ${isCorrect(step, choice) ? '정답' : '오답'}`
}
