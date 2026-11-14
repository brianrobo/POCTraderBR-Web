import { useCallback, useEffect, useState } from 'react'
import { api, type SimBarData, type SimScenario, type SimScenarioDetail } from '../api/client'
import { SimBarEditor } from './SimBarEditor'
import { SimBarPractice } from './SimBarPractice'
import { SimEditor } from './SimEditor'
import { SimPractice } from './SimPractice'
import { SimScenarioAdd } from './SimScenarioAdd'

type Mode = 'edit' | 'practice'

// Simulator: each scenario replays one day's chart flow, 30-minute chart on
// the left and 1-minute chart on the right, one candle step at a time. A
// scenario is normally made from an exported price file (the charts are drawn
// from the bars); one captured from chart screenshots works the same way.
// 편집 sets it up — replay start / frames, quiz points — and 연습 replays it,
// stopping at each quiz point for a buy / pass decision.
export function SimulatorPage() {
  const [scenarios, setScenarios] = useState<SimScenario[]>([])
  const [detail, setDetail] = useState<SimScenarioDetail | null>(null)
  // The price bars of the selected scenario, when it is a 'bars' one.
  const [barData, setBarData] = useState<SimBarData | null>(null)
  const [mode, setMode] = useState<Mode>('edit')
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)

  const refreshList = useCallback(() => api.listSimScenarios().then(setScenarios), [])

  useEffect(() => {
    refreshList().then(() => setLoading(false))
  }, [refreshList])

  const select = async (id: string) => {
    const loaded = await api.getSimScenario(id)
    const bars = loaded.kind === 'bars' ? await api.getSimBars(id) : null
    setAdding(false)
    setBarData(bars)
    setDetail(loaded)
    // A scenario that already has quiz points opens in practice mode, so the
    // editor (which shows every frame) doesn't give the answers away.
    setMode(loaded.quiz_count > 0 ? 'practice' : 'edit')
  }

  const reload = async () => {
    if (!detail) return
    setDetail(await api.getSimScenario(detail.id))
    void refreshList()
  }

  const updateDetail = (fn: (d: SimScenarioDetail) => SimScenarioDetail) => {
    setDetail((prev) => (prev ? fn(prev) : prev))
  }

  const updateBarData = (fn: (d: SimBarData) => SimBarData) => {
    setBarData((prev) => (prev ? fn(prev) : prev))
  }

  const onCreated = async (created: SimScenario) => {
    await refreshList()
    await select(created.id)
  }

  const renameScenario = async (s: SimScenario) => {
    const name = window.prompt('시나리오 이름 변경', s.name)
    if (!name || name === s.name) return
    await api.renameSimScenario(s.id, name)
    await refreshList()
    if (detail?.id === s.id) setDetail({ ...detail, name })
  }

  const deleteScenario = async () => {
    if (!detail) return
    const contents = detail.kind === 'bars' ? '가격 데이터와 퀴즈 지점' : '캡쳐된 프레임'
    if (!window.confirm(`"${detail.name}" 시나리오와 ${contents}을 모두 삭제할까요?`)) return
    await api.deleteSimScenario(detail.id)
    setDetail(null)
    setBarData(null)
    await refreshList()
  }

  if (loading) return <div className="page-view-loading">로딩 중...</div>

  return (
    <div className="chartpat-layout">
      <aside className="chartpat-sidebar">
        <div className="chartpat-sidebar-head">
          <h2 className="remind-heading">시나리오</h2>
          <button type="button" className={adding ? 'active' : ''} onClick={() => setAdding(true)}>
            + 추가
          </button>
        </div>
        <div className="chartpat-tree">
          {scenarios.length === 0 ? (
            <div className="empty-state">아직 시나리오가 없습니다.</div>
          ) : (
            scenarios.map((s) => (
              <div
                key={s.id}
                className={`chartpat-tree-row ${!adding && detail?.id === s.id ? 'selected' : ''}`}
                onClick={() => select(s.id)}
              >
                <div className="sim-scn">
                  <span
                    className="sim-scn-name"
                    title="더블클릭하여 이름 변경"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      renameScenario(s)
                    }}
                  >
                    {s.name}
                  </span>
                  <span className="sim-scn-meta">
                    {s.kind === 'bars'
                      ? `가격 데이터 · 1분 ${s.bar_count}봉`
                      : `30분 ${s.frame_count_30m} · 1분 ${s.frame_count_1m}`}{' '}
                    · 퀴즈 {s.quiz_count}
                    {s.graded_count > 0 && ` · 정답 ${s.correct_count}/${s.graded_count}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="sim-main">
        {adding ? (
          <>
            <div className="sim-head">
              <h2 className="sim-head-title">새 시나리오</h2>
            </div>
            <SimScenarioAdd onCreated={onCreated} onCancel={() => setAdding(false)} />
          </>
        ) : !detail ? (
          <div className="empty-state">왼쪽에서 시나리오를 선택하거나 새로 추가하세요.</div>
        ) : (
          <>
            <div className="sim-head">
              <h2 className="sim-head-title">{detail.name}</h2>
              <button type="button" className={mode === 'practice' ? 'active' : ''} onClick={() => setMode('practice')}>
                연습
              </button>
              <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
                편집
              </button>
              {mode === 'edit' && (
                <button type="button" className="danger" onClick={deleteScenario}>
                  시나리오 삭제
                </button>
              )}
            </div>
            {barData ? (
              mode === 'edit' ? (
                <SimBarEditor key={detail.id} data={barData} updateData={updateBarData} onListChanged={refreshList} />
              ) : (
                <SimBarPractice key={detail.id} data={barData} updateData={updateBarData} onAttempt={refreshList} />
              )
            ) : mode === 'edit' ? (
              <SimEditor
                key={detail.id}
                detail={detail}
                updateDetail={updateDetail}
                onListChanged={refreshList}
                reload={reload}
              />
            ) : (
              <SimPractice key={detail.id} detail={detail} onAttempt={refreshList} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
