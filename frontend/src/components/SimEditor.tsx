import { useMemo, useRef, useState } from 'react'
import { api, type SimFrame, type SimOutcome, type SimScenarioDetail, type SimTrack } from '../api/client'
import { splitTracks } from '../lib/simSync'
import { SimFrameCapture } from './SimFrameCapture'
import { SimFrameNav, useArrowKeys } from './SimFrameNav'

interface Props {
  detail: SimScenarioDetail
  updateDetail: (fn: (d: SimScenarioDetail) => SimScenarioDetail) => void
  onListChanged: () => void
  reload: () => Promise<void>
}

const TRACK_NAME: Record<SimTrack, string> = { '30m': '30분봉', '1m': '1분봉' }

const OUTCOMES: { value: SimOutcome; label: string }[] = [
  { value: 'profit', label: '수익 (매수가 정답)' },
  { value: 'loss', label: '손실 (패스가 정답)' },
  { value: '', label: '미정' },
]

function clampIndex(i: number, count: number): number {
  return Math.max(0, Math.min(i, count - 1))
}

type FramePatch = Parameters<typeof api.updateSimFrame>[1]

// Builds a scenario: the two charts are captured (or uploaded) separately,
// each 30m frame is tied to the 1m frame at which it should appear, and
// frames of the replay track are marked as quiz points.
export function SimEditor({ detail, updateDetail, onListChanged, reload }: Props) {
  const tracks = useMemo(() => splitTracks(detail.frames), [detail.frames])
  const [index, setIndex] = useState<Record<SimTrack, number>>({ '30m': 0, '1m': 0 })
  const [active, setActive] = useState<SimTrack>('1m')
  const [busy, setBusy] = useState<string | null>(null)
  const fileInput30 = useRef<HTMLInputElement>(null)
  const fileInput1 = useRef<HTMLInputElement>(null)

  const framesOf = (t: SimTrack) => (t === '30m' ? tracks.m30 : tracks.m1)
  const indexOf = (t: SimTrack) => clampIndex(index[t], framesOf(t).length)
  const current = (t: SimTrack) => framesOf(t)[indexOf(t)] as SimFrame | undefined
  const goTo = (t: SimTrack, i: number) => {
    setIndex((prev) => ({ ...prev, [t]: clampIndex(i, framesOf(t).length) }))
  }

  useArrowKeys((delta) => goTo(active, indexOf(active) + delta))

  const cur30 = current('30m')
  const cur1 = current('1m')

  // Replay steps through the 1m track when there is one; quiz points live there.
  const quizTrack: SimTrack = tracks.m1.length > 0 ? '1m' : '30m'
  const quizFrame = current(quizTrack)
  const quizPoints = framesOf(quizTrack)
    .map((frame, i) => ({ frame, i }))
    .filter(({ frame }) => frame.is_quiz)

  const index1ById = useMemo(() => new Map(tracks.m1.map((f, i) => [f.id, i])), [tracks.m1])
  const syncIndexOf = (f: SimFrame) => (f.sync_frame_id ? index1ById.get(f.sync_frame_id) : undefined)
  const syncAt = cur30 ? syncIndexOf(cur30) : undefined
  const unsynced = tracks.m30.filter((f, i) => i > 0 && syncIndexOf(f) === undefined).length

  const addFrame = (frame: SimFrame) => {
    updateDetail((d) => (d.id === frame.scenario_id ? { ...d, frames: [...d.frames, frame] } : d))
  }

  const patchFrame = async (id: string, patch: FramePatch) => {
    const updated = await api.updateSimFrame(id, patch)
    updateDetail((d) => ({ ...d, frames: d.frames.map((f) => (f.id === updated.id ? updated : f)) }))
    onListChanged()
  }

  const deleteFrame = async (frame: SimFrame) => {
    const next = await api.deleteSimFrame(frame.id)
    updateDetail(() => next)
    onListChanged()
  }

  const clearTrack = async (track: SimTrack) => {
    if (!window.confirm(`${TRACK_NAME[track]} 프레임 ${framesOf(track).length}개를 모두 삭제할까요?`)) return
    const next = await api.clearSimFrames(detail.id, track)
    updateDetail(() => next)
    onListChanged()
  }

  const uploadFiles = async (track: SimTrack, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    e.target.value = ''
    if (files.length === 0) return
    try {
      for (const [i, file] of files.entries()) {
        setBusy(`${TRACK_NAME[track]} 이미지 올리는 중... ${i + 1} / ${files.length}`)
        addFrame(await api.addSimFrame(detail.id, track, file, file.name))
      }
    } finally {
      setBusy(null)
      await reload()
    }
  }

  const renderPane = (track: SimTrack) => {
    const frames = framesOf(track)
    const frame = current(track)
    const fileInput = track === '30m' ? fileInput30 : fileInput1
    return (
      <section className={`sim-pane ${active === track ? 'active' : ''}`} onPointerDown={() => setActive(track)}>
        <div className="sim-pane-head">
          <span className="sim-pane-title">{TRACK_NAME[track]}</span>
          <SimFrameCapture scenarioId={detail.id} track={track} onFrame={addFrame} onDone={reload} />
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => uploadFiles(track, e)}
          />
          <button type="button" title="파일 이름 순서대로 추가됩니다" onClick={() => fileInput.current?.click()}>
            이미지 추가
          </button>
          {frames.length > 0 && (
            <button type="button" className="danger" onClick={() => clearTrack(track)}>
              전체 삭제
            </button>
          )}
        </div>

        <div className="sim-stage">
          {frame ? (
            <img src={frame.image_url} alt={`${TRACK_NAME[track]} 프레임 ${indexOf(track) + 1}`} />
          ) : (
            <div className="empty-state">아직 프레임이 없습니다. 화면 캡쳐로 차트를 한 봉씩 넘기며 담으세요.</div>
          )}
          {frame?.is_quiz && track === quizTrack && <span className="sim-quiz-badge">퀴즈</span>}
        </div>

        <SimFrameNav count={frames.length} index={indexOf(track)} onIndex={(i) => goTo(track, i)} />

        {frame && (
          <div className="sim-pane-foot">
            <input
              key={`${frame.id}:${frame.label}`}
              type="text"
              className="sim-label-input"
              placeholder="시간 라벨 (예: 17:30)"
              defaultValue={frame.label}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              onBlur={(e) => {
                if (e.target.value !== frame.label) void patchFrame(frame.id, { label: e.target.value })
              }}
            />
            <button type="button" className="danger" onClick={() => deleteFrame(frame)}>
              프레임 삭제
            </button>
          </div>
        )}

        {track === '30m' && cur30 && cur1 && (
          <div className="sim-pane-foot sim-sync">
            {syncAt !== undefined ? (
              <>
                <span>
                  1분봉 #{syncAt + 1}
                  {tracks.m1[syncAt].label && ` (${tracks.m1[syncAt].label})`}부터 표시
                </span>
                <button type="button" onClick={() => goTo('1m', syncAt)}>
                  보기
                </button>
                <button type="button" onClick={() => patchFrame(cur30.id, { sync_frame_id: '' })}>
                  해제
                </button>
              </>
            ) : (
              <span className="sim-warn">동기화 안 됨</span>
            )}
            <button
              type="button"
              disabled={syncAt === indexOf('1m')}
              onClick={() => patchFrame(cur30.id, { sync_frame_id: cur1.id })}
            >
              지금 1분봉 #{indexOf('1m') + 1}에 맞추기
            </button>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="sim-body">
      <div className="sim-hint">
        ① 30분봉·1분봉을 각각 화면 캡쳐 → ② 30분봉 프레임마다 그 봉이 나타날 1분봉 프레임에 맞추기 → ③{' '}
        {TRACK_NAME[quizTrack]} 프레임에 퀴즈 지점 지정. ←/→ 키는 테두리가 강조된 쪽 차트를 넘깁니다.
        {busy && <span className="sim-busy"> {busy}</span>}
        {unsynced > 0 && tracks.m1.length > 0 && (
          <span className="sim-warn"> 동기화 안 된 30분봉 프레임 {unsynced}개 (연습 화면에 나오지 않습니다)</span>
        )}
      </div>

      <div className="sim-panes">
        {renderPane('30m')}
        {renderPane('1m')}
      </div>

      <section className="sim-quiz-editor">
        <div className="sim-quiz-row">
          <span className="sim-pane-title">퀴즈 지점</span>
          {quizPoints.length === 0 ? (
            <span className="sim-dim">아직 없습니다.</span>
          ) : (
            quizPoints.map(({ frame, i }) => (
              <button
                key={frame.id}
                type="button"
                className={frame.id === quizFrame?.id ? 'active' : ''}
                onClick={() => {
                  setActive(quizTrack)
                  goTo(quizTrack, i)
                }}
              >
                #{i + 1}
                {frame.quiz_outcome === 'profit' ? ' 수익' : frame.quiz_outcome === 'loss' ? ' 손실' : ' 미정'}
              </button>
            ))
          )}
        </div>

        {quizFrame && (
          <>
            <div className="sim-quiz-row">
              <label className="sim-check">
                <input
                  type="checkbox"
                  checked={quizFrame.is_quiz}
                  onChange={(e) => patchFrame(quizFrame.id, { is_quiz: e.target.checked })}
                />
                {TRACK_NAME[quizTrack]} #{indexOf(quizTrack) + 1} 프레임에서 매수 여부를 묻기
              </label>
              {quizFrame.is_quiz && (
                <>
                  <span className="sim-dim">여기서 매수했다면:</span>
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={quizFrame.quiz_outcome === o.value ? 'active' : ''}
                      onClick={() => patchFrame(quizFrame.id, { quiz_outcome: o.value })}
                    >
                      {o.label}
                    </button>
                  ))}
                </>
              )}
            </div>
            {quizFrame.is_quiz && (
              <textarea
                key={quizFrame.id}
                className="sim-quiz-note"
                rows={2}
                placeholder="해설 — 답을 고른 뒤 결과와 함께 보여집니다"
                defaultValue={quizFrame.quiz_note}
                onBlur={(e) => {
                  if (e.target.value !== quizFrame.quiz_note) void patchFrame(quizFrame.id, { quiz_note: e.target.value })
                }}
              />
            )}
          </>
        )}
      </section>
    </div>
  )
}
