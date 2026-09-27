import { useEffect, useState } from 'react'
import { api, type InsightEntry, type LeadingSpan2, type MaSpacing, type PeriodSymmetry } from '../api/client'
import { AnnotatedChart, uploadUrl } from './AnnotatedChart'

const COLUMNS: { key: 'pass' | 'fail'; label: string }[] = [
  { key: 'pass', label: '성공(PASS)' },
  { key: 'fail', label: '실패(FAIL)' },
]

function pct(n: number, total: number): string {
  return total === 0 ? '-' : `${Math.round((n / total) * 100)}%`
}

function StatsTable({ entries }: { entries: InsightEntry[] }) {
  const pass = entries.filter((e) => e.result === 'pass')
  const fail = entries.filter((e) => e.result === 'fail')
  const rows: { label: string; count: (list: InsightEntry[]) => number }[] = [
    { label: '기간대칭 · 이후', count: (list) => list.filter((e) => e.period_symmetry === 'after').length },
    { label: '기간대칭 · 이전', count: (list) => list.filter((e) => e.period_symmetry === 'before').length },
    { label: '이평 이격 · 수렴', count: (list) => list.filter((e) => e.ma_spacing === 'converge').length },
    { label: '이평 이격 · 벌어짐', count: (list) => list.filter((e) => e.ma_spacing === 'diverge').length },
    { label: '매집구간 체크', count: (list) => list.filter((e) => e.accumulation_checked).length },
    { label: '선행2 · 소화', count: (list) => list.filter((e) => e.leading_span2 === 'digested').length },
    { label: '선행2 · 미소화', count: (list) => list.filter((e) => e.leading_span2 === 'undigested').length },
  ]
  return (
    <table className="one-min-stats">
      <thead>
        <tr>
          <th>체크리스트</th>
          <th className="pass">PASS (n={pass.length})</th>
          <th className="fail">FAIL (n={fail.length})</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className="pass">
              {r.count(pass)} / {pass.length} ({pct(r.count(pass), pass.length)})
            </td>
            <td className="fail">
              {r.count(fail)} / {fail.length} ({pct(r.count(fail), fail.length)})
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function OneMinComparePage() {
  const [entries, setEntries] = useState<InsightEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = () => api.listInsights().then(setEntries)

  useEffect(() => {
    refresh().then(() => setLoading(false))
  }, [])

  const updateEntry = (pageId: string, patch: Partial<InsightEntry>) => {
    setEntries((prev) => prev.map((e) => (e.page_id === pageId ? { ...e, ...patch } : e)))
  }

  const toggleMaSpacing = async (e: InsightEntry, next: MaSpacing) => {
    const value = e.ma_spacing === next ? '' : next
    await api.updatePageChecklist(e.page_id, { ma_spacing: value })
    updateEntry(e.page_id, { ma_spacing: value })
  }

  const togglePeriodSymmetry = async (e: InsightEntry, next: PeriodSymmetry) => {
    const value = e.period_symmetry === next ? '' : next
    await api.updatePageChecklist(e.page_id, { period_symmetry: value })
    updateEntry(e.page_id, { period_symmetry: value })
  }

  const toggleLeadingSpan2 = async (e: InsightEntry, next: LeadingSpan2) => {
    const value = e.leading_span2 === next ? '' : next
    await api.updatePageChecklist(e.page_id, { leading_span2: value })
    updateEntry(e.page_id, { leading_span2: value })
  }

  const toggleAccumulation = async (e: InsightEntry) => {
    const value = !e.accumulation_checked
    await api.updatePageChecklist(e.page_id, { accumulation_checked: value })
    updateEntry(e.page_id, { accumulation_checked: value })
  }

  if (loading) return <div className="page-view-loading">로딩 중...</div>

  const classified = entries.filter((e) => e.result === 'pass' || e.result === 'fail')

  return (
    <div className="one-min-wrap">
      <div className="one-min-stats-bar">
        <h2 className="remind-heading">체크리스트 통계</h2>
        <StatsTable entries={classified} />
      </div>
      <div className="one-min-page">
        {COLUMNS.map((col) => {
          const items = classified.filter((e) => e.result === col.key)
          return (
            <div key={col.key} className={`one-min-column ${col.key}`}>
              <div className="one-min-column-header">
                <h2 className={`one-min-column-title ${col.key}`}>
                  {col.label} ({items.length})
                </h2>
              </div>
              <div className="one-min-column-scroll">
                {items.length === 0 ? (
                  <div className="empty-state">
                    인사이트 페이지에서 결과를 {col.key === 'pass' ? 'PASS' : 'FAIL'}로 지정하면 여기 나타납니다.
                  </div>
                ) : (
                  items.map((e) => (
                    <div key={e.page_id} className="one-min-card">
                      <div className="one-min-card-head">
                        <span className="one-min-card-title">{e.item_name}</span>
                      </div>
                      {e.image_a ? (
                        <AnnotatedChart
                          src={uploadUrl(e.image_a.path)}
                          strokes={e.image_a.strokes}
                          alt={e.item_name}
                        />
                      ) : (
                        <div className="empty-state">첨부된 화면이 없습니다.</div>
                      )}
                      <div className="insight-checklist">
                        <span className="insight-checklist-item">
                          <span className="insight-checklist-label">기간대칭</span>
                          <button
                            type="button"
                            className={`checklist-btn green ${e.period_symmetry === 'after' ? 'active' : ''}`}
                            onClick={() => togglePeriodSymmetry(e, 'after')}
                          >
                            이후
                          </button>
                          <button
                            type="button"
                            className={`checklist-btn red ${e.period_symmetry === 'before' ? 'active' : ''}`}
                            onClick={() => togglePeriodSymmetry(e, 'before')}
                          >
                            이전
                          </button>
                        </span>
                        <span className="insight-checklist-item">
                          <span className="insight-checklist-label">이평 이격</span>
                          <button
                            type="button"
                            className={`checklist-btn green ${e.ma_spacing === 'converge' ? 'active' : ''}`}
                            onClick={() => toggleMaSpacing(e, 'converge')}
                          >
                            수렴
                          </button>
                          <button
                            type="button"
                            className={`checklist-btn red ${e.ma_spacing === 'diverge' ? 'active' : ''}`}
                            onClick={() => toggleMaSpacing(e, 'diverge')}
                          >
                            벌어짐
                          </button>
                        </span>
                        <label className="insight-checklist-item">
                          <input type="checkbox" checked={e.accumulation_checked} onChange={() => toggleAccumulation(e)} />
                          매집구간 체크
                        </label>
                        <span className="insight-checklist-item">
                          <span className="insight-checklist-label">선행2</span>
                          <button
                            type="button"
                            className={`checklist-btn green ${e.leading_span2 === 'digested' ? 'active' : ''}`}
                            onClick={() => toggleLeadingSpan2(e, 'digested')}
                          >
                            소화
                          </button>
                          <button
                            type="button"
                            className={`checklist-btn red ${e.leading_span2 === 'undigested' ? 'active' : ''}`}
                            onClick={() => toggleLeadingSpan2(e, 'undigested')}
                          >
                            미소화
                          </button>
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
