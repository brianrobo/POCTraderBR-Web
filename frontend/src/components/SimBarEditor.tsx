import { useMemo, useState, type FormEvent } from 'react'
import { api, type SimBarData, type SimBarQuiz, type SimDrawing, type SimOutcome } from '../api/client'
import { aftermath, decodeBars, formatBarTime, indexAtOrAfter, practiceStart, sessionStarts } from '../lib/simBars'
import type { ChartMark } from './SimBarChart'
import { AftermathLine, SimBarPanes } from './SimBarPanes'
import { SimFrameNav, useArrowKeys } from './SimFrameNav'

interface Props {
  data: SimBarData
  updateData: (fn: (d: SimBarData) => SimBarData) => void
  onListChanged: () => void
}

const OUTCOMES: { value: SimOutcome; label: string }[] = [
  { value: 'profit', label: '상승' },
  { value: 'loss', label: '하락' },
  { value: '', label: '미정' },
]

const OUTCOME_NAME: Record<SimOutcome, string> = { profit: '상승', loss: '하락', '': '미정' }

interface RangeFormProps {
  /** Frame numbers the fields start with; empty for a new quiz. */
  from: string
  to: string
  /** How many frames there are. */
  count: number
  /** Frame number of the bar being viewed. */
  now: number
  submit: string
  onSubmit: (from: number, to: number) => void
}

/** First and last frame number of a quiz range; the same number twice is a quiz about that one moment. */
function RangeForm({ from, to, count, now, submit, onSubmit }: RangeFormProps) {
  const [first, setFirst] = useState(from)
  const [last, setLast] = useState(to)
  const a = Number(first)
  const b = Number(last)
  const valid =
    first !== '' && last !== '' && Number.isInteger(a) && Number.isInteger(b) && a >= 1 && a <= b && b <= count
  const send = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onSubmit(a, b)
    // Out of the number field, so ←/→ step through the bars again.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }
  const field = (value: string, set: (v: string) => void, name: string) => (
    <>
      <input
        type="number"
        className="sim-frame-input"
        min={1}
        max={count}
        placeholder={name}
        aria-label={`${name} 프레임`}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
      <button type="button" title={`지금 보고 있는 봉 (프레임 ${now})`} onClick={() => set(String(now))}>
        지금
      </button>
    </>
  )
  return (
    <form className="sim-range-form" onSubmit={send}>
      <span className="sim-dim">프레임</span>
      {field(first, setFirst, '시작')}
      <span>~</span>
      {field(last, setLast, '끝')}
      <button type="submit" disabled={!valid || (first === from && last === to)}>
        {submit}
      </button>
    </form>
  )
}

// Sets up a price-data scenario: its quizzes — each a range of bars to watch
// before the question, or a single bar — and where the replay starts while
// there are none. Browsing here shows the chart up to the chosen bar, exactly
// as practice will.
export function SimBarEditor({ data, updateData, onListChanged }: Props) {
  const bars = useMemo(() => decodeBars(data.bars), [data.bars])
  const replayStart = Math.max(0, indexAtOrAfter(bars, data.replay_from))
  const runStart = useMemo(
    () =>
      practiceStart(
        bars,
        data.replay_from,
        data.quizzes.map((q) => q.start_time),
      ),
    [bars, data.replay_from, data.quizzes],
  )
  const [pos, setPos] = useState(runStart)
  const index = Math.max(0, Math.min(pos, bars.length - 1))
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState('')

  useArrowKeys((delta) => setPos(Math.max(0, Math.min(index + delta, bars.length - 1))))

  const sessions = useMemo(() => sessionStarts(bars), [bars])
  const indexOfTime = useMemo(() => new Map(bars.map((b, i) => [b.t, i])), [bars])
  const marks = useMemo(
    () => data.quizzes.map((q): ChartMark => ({ t: q.bar_time, text: OUTCOME_NAME[q.outcome], kind: 'quiz' })),
    [data.quizzes],
  )
  const ranges = useMemo(() => data.quizzes.map((q) => ({ from: q.start_time, to: q.bar_time })), [data.quizzes])

  if (bars.length === 0) return <div className="empty-state">가격 데이터가 없습니다.</div>

  const bar = bars[index]
  const last = bars.length - 1
  const session = sessions.findLast((s) => s.index <= index)
  const frameOf = (t: number) => (indexOfTime.get(t) ?? 0) + 1

  // The quiz being edited: the one picked from the list, or the one whose range the current bar is in.
  const quiz =
    data.quizzes.find((q) => q.id === picked) ?? data.quizzes.find((q) => q.start_time <= bar.t && bar.t <= q.bar_time)

  // A quiz plays out until the next one begins, or the last bar.
  let after = null
  if (quiz) {
    const end = indexOfTime.get(quiz.bar_time) ?? last
    const next = data.quizzes.find((q) => q.bar_time > quiz.bar_time)
    const nextFrom = next ? (indexOfTime.get(next.start_time) ?? last) : last
    // A next quiz whose range began before this one ended leaves nothing in between.
    const until = next && nextFrom <= end ? (indexOfTime.get(next.bar_time) ?? last) : nextFrom
    after = aftermath(bars, end, until)
  }

  const quizFrames = (q: SimBarQuiz) =>
    q.start_time === q.bar_time ? `프레임 ${frameOf(q.bar_time)}` : `프레임 ${frameOf(q.start_time)}~${frameOf(q.bar_time)}`
  const quizTimes = (q: SimBarQuiz) =>
    q.start_time === q.bar_time
      ? formatBarTime(q.bar_time)
      : `${formatBarTime(q.start_time)} ~ ${formatBarTime(q.bar_time)}`

  const setReplayStart = async () => {
    const next = await api.updateSimBars(data.scenario_id, { replay_from: bar.t })
    updateData(() => next)
    onListChanged()
  }

  // Saves a quiz range given as frame numbers; `id` moves that quiz instead of adding one.
  const saveRange = async (from: number, to: number, id?: string) => {
    const [start_time, bar_time] = [bars[from - 1].t, bars[to - 1].t]
    // Adding the very range of an existing quiz just picks that quiz.
    const clash = data.quizzes.find((q) => q.bar_time === bar_time && q.id !== id)
    if (clash && (id || clash.start_time !== start_time)) {
      setError(`프레임 ${to}에서 끝나는 퀴즈가 이미 있습니다.`)
      return
    }
    try {
      const saved = id
        ? await api.updateSimBarQuiz(id, { start_time, bar_time })
        : await api.addSimBarQuiz(data.scenario_id, start_time, bar_time)
      updateData((d) => ({
        ...d,
        quizzes: [...d.quizzes.filter((q) => q.id !== saved.id), saved].sort((x, y) => x.bar_time - y.bar_time),
      }))
      setError('')
      setPicked(saved.id)
      setPos(to - 1)
      onListChanged()
    } catch (e) {
      setError(`퀴즈를 저장하지 못했습니다: ${e instanceof Error ? e.message : e}`)
    }
  }

  const removeQuiz = async (target: SimBarQuiz) => {
    if (!window.confirm(`${quizFrames(target)} 퀴즈를 삭제할까요? 그 연습 기록도 함께 지워집니다.`)) return
    await api.deleteSimBarQuiz(target.id)
    updateData((d) => ({
      ...d,
      quizzes: d.quizzes.filter((q) => q.id !== target.id),
      attempts: d.attempts.filter((a) => a.quiz_id !== target.id),
    }))
    setPicked(null)
    onListChanged()
  }

  const patchQuiz = async (id: string, patch: Parameters<typeof api.updateSimBarQuiz>[1]) => {
    const updated = await api.updateSimBarQuiz(id, patch)
    updateData((d) => ({ ...d, quizzes: d.quizzes.map((q) => (q.id === updated.id ? updated : q)) }))
    onListChanged()
  }

  const setDrawings = (next: SimDrawing[]) => {
    updateData((d) => ({ ...d, drawings: next }))
    void api.setSimDrawings(data.scenario_id, next)
  }

  return (
    <div className="sim-body">
      <div className="sim-hint">
        {data.symbol} · {data.source_name} · 1분봉 {bars.length.toLocaleString()}개 ({formatBarTime(bars[0].t)} ~{' '}
        {formatBarTime(bars[last].t)}). 연습은 프레임 {runStart + 1} ({formatBarTime(bars[runStart].t)}
        {data.quizzes.length > 0 && ', 첫 퀴즈 구간의 시작'})부터 시작하고, 그 앞은 차트의 과거로만 보입니다. ←/→ 한 봉,
        Shift+←/→ 열 봉.
      </div>

      <SimBarPanes
        bars={bars}
        now={index}
        marks={marks}
        ranges={ranges}
        drawings={data.drawings}
        onDrawings={setDrawings}
        revealAll
      />

      <div className="sim-bar-nav">
        <SimFrameNav count={bars.length} index={index} onIndex={setPos} />
      </div>

      <div className="sim-quiz-row">
        <span className="sim-pane-title">날짜</span>
        {sessions.map((s) => (
          <button
            key={s.index}
            type="button"
            className={s.index === session?.index ? 'active' : ''}
            onClick={() => setPos(s.index)}
          >
            {s.label}
          </button>
        ))}
        <span className="sim-dim">연습 시작: {formatBarTime(bars[runStart].t)}</span>
        <button type="button" disabled={index === runStart} onClick={() => setPos(runStart)}>
          보기
        </button>
        <button
          type="button"
          disabled={index === replayStart || data.quizzes.length > 0}
          title={
            data.quizzes.length > 0
              ? '퀴즈가 있으면 연습은 첫 퀴즈 구간의 시작부터 합니다'
              : '퀴즈가 없을 때 연습을 시작할 봉'
          }
          onClick={setReplayStart}
        >
          지금 봉을 연습 시작으로
        </button>
      </div>

      <section className="sim-quiz-editor">
        <div className="sim-quiz-row">
          <span className="sim-pane-title">퀴즈</span>
          {data.quizzes.length === 0 ? (
            <span className="sim-dim">아직 없습니다. 아래에 퀴즈 구간의 프레임 번호를 넣어 추가하세요.</span>
          ) : (
            data.quizzes.map((q) => (
              <button
                key={q.id}
                type="button"
                className={q.id === quiz?.id ? 'active' : ''}
                title={quizTimes(q)}
                onClick={() => {
                  setPicked(q.id)
                  setPos(indexOfTime.get(q.bar_time) ?? index)
                }}
              >
                {quizFrames(q).replace('프레임 ', '')} {OUTCOME_NAME[q.outcome]}
              </button>
            ))
          )}
        </div>

        <div className="sim-quiz-row">
          <span className="sim-pane-title">퀴즈 추가</span>
          <RangeForm
            from=""
            to=""
            count={bars.length}
            now={index + 1}
            submit="추가"
            onSubmit={(from, to) => saveRange(from, to)}
          />
          <span className="sim-dim">
            프레임 번호는 차트 십자선 아래에 보입니다. 두 값이 같으면 그 시점에서, 다르면 그 구간의 흐름을 본 뒤
            묻습니다.
          </span>
        </div>
        {error && <div className="sim-quiz-row sim-quiz-error">{error}</div>}

        {quiz && (
          <>
            <div className="sim-quiz-row sim-quiz-picked">
              <span className="sim-pane-title">선택한 퀴즈</span>
              <RangeForm
                key={`${quiz.id}:${quiz.start_time}:${quiz.bar_time}`}
                from={String(frameOf(quiz.start_time))}
                to={String(frameOf(quiz.bar_time))}
                count={bars.length}
                now={index + 1}
                submit="구간 변경"
                onSubmit={(from, to) => saveRange(from, to, quiz.id)}
              />
              <span className="sim-dim">{quizTimes(quiz)}</span>
              <button type="button" onClick={() => removeQuiz(quiz)}>
                퀴즈 삭제
              </button>
            </div>
            <div className="sim-quiz-row sim-quiz-outcome">
              <span className="sim-dim">이후 가격 (정답):</span>
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={quiz.outcome === o.value ? 'active' : ''}
                  onClick={() => patchQuiz(quiz.id, { outcome: o.value })}
                >
                  {o.label}
                </button>
              ))}
              {after && <AftermathLine after={after} />}
            </div>
            <textarea
              key={quiz.id}
              className="sim-quiz-note"
              rows={2}
              placeholder="해설 — 답을 고른 뒤 결과와 함께 보여집니다"
              defaultValue={quiz.note}
              onBlur={(e) => {
                if (e.target.value !== quiz.note) void patchQuiz(quiz.id, { note: e.target.value })
              }}
            />
          </>
        )}
      </section>
    </div>
  )
}
