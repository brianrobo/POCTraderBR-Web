import { useEffect, useMemo } from 'react'
import { api, type SimFrame, type SimScenarioDetail } from '../api/client'
import { splitTracks, syncedIndex30 } from '../lib/simSync'
import { QuizRunBar, QuizRunPanels, useQuizRun } from './SimQuizRun'

interface Props {
  detail: SimScenarioDetail
  onAttempt: () => void
}

const PRELOAD_AHEAD = 3

// Replays a captured scenario one frame at a time; the quiz flow itself
// (locking, questions, results) lives in SimQuizRun.
export function SimPractice({ detail, onAttempt }: Props) {
  const tracks = useMemo(() => splitTracks(detail.frames), [detail.frames])
  const usesM1 = tracks.m1.length > 0
  const steps = usesM1 ? tracks.m1 : tracks.m30
  const last = steps.length - 1

  const run = useQuizRun(steps, async (step, choice) => {
    await api.createSimAttempt(step.id, choice)
    onAttempt()
  })
  const at = run.at
  const frame = steps[at] as SimFrame | undefined

  useEffect(() => {
    for (let i = at + 1; i <= Math.min(at + PRELOAD_AHEAD, last); i++) new Image().src = steps[i].image_url
  }, [at, last, steps])

  const synced30 = usesM1 ? syncedIndex30(tracks, at) : null
  const frame30 = usesM1 ? (synced30 === null ? undefined : tracks.m30[synced30]) : frame

  if (steps.length === 0) {
    return <div className="empty-state">아직 프레임이 없습니다. 편집에서 차트를 캡쳐하세요.</div>
  }

  return (
    <div className="sim-body">
      <div className="sim-panes">
        <section className="sim-pane">
          <div className="sim-pane-head">
            <span className="sim-pane-title">30분봉</span>
            {frame30?.label && <span className="sim-pane-label">{frame30.label}</span>}
          </div>
          <div className="sim-stage">
            {frame30 ? (
              <img src={frame30.image_url} alt="30분봉 차트" />
            ) : (
              <div className="empty-state">
                {tracks.m30.length === 0 ? '30분봉 프레임이 없습니다.' : '이 시점에 표시할 30분봉 프레임이 없습니다.'}
              </div>
            )}
          </div>
        </section>

        <section className="sim-pane">
          <div className="sim-pane-head">
            <span className="sim-pane-title">1분봉</span>
            {usesM1 && frame?.label && <span className="sim-pane-label">{frame.label}</span>}
          </div>
          <div className="sim-stage">
            {usesM1 && frame ? (
              <img src={frame.image_url} alt="1분봉 차트" />
            ) : (
              <div className="empty-state">1분봉 프레임이 없습니다.</div>
            )}
          </div>
        </section>
      </div>

      <QuizRunBar run={run} count={steps.length} />
      <QuizRunPanels run={run} stepName={(i) => `#${i + 1} 프레임`} />
    </div>
  )
}
