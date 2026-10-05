import { useEffect, useState } from 'react'
import { api, type InsightEntry, type LeadingSpan2, type MaSpacing, type OneMinNote, type PeriodSymmetry } from '../api/client'
import { ChartComparisonImages } from './AnnotatedChart'

const COLUMNS: { key: 'pass' | 'fail'; label: string }[] = [
  { key: 'pass', label: '성공(PASS)' },
  { key: 'fail', label: '실패(FAIL)' },
]

function pct(n: number, total: number): string {
  return total === 0 ? '-' : `${Math.round((n / total) * 100)}%`
}

const MONTH_KEY = 'poctrader:oneMinMonth'

function monthOf(itemName: string): string | null {
  const m = /^\((\d{2})\.(\d{2})\.\d{2}\)/.exec(itemName)
  return m ? `20${m[1]}-${m[2]}` : null
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${y}년 ${Number(m)}월`
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

function MyInsightNotes({
  column,
  notes,
  onAdd,
  onEdit,
  onRemove,
}: {
  column: 'pass' | 'fail'
  notes: OneMinNote[]
  onAdd: (column: 'pass' | 'fail', text: string) => void
  onEdit: (n: OneMinNote) => void
  onRemove: (n: OneMinNote) => void
}) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    onAdd(column, text)
    setDraft('')
  }

  return (
    <div className="one-min-notes">
      <div className="one-min-notes-header">My Insight</div>
      <div className="one-min-notes-add">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="느낀 점을 적어보세요"
        />
        <button type="button" onClick={submit}>
          + 추가
        </button>
      </div>
      {notes.length > 0 && (
        <div className="one-min-notes-list">
          {notes.map((n) => (
            <div key={n.id} className="one-min-note-card" onDoubleClick={() => onEdit(n)} title="더블클릭하여 수정">
              <span>{n.text}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(n)
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function OneMinComparePage() {
  const [entries, setEntries] = useState<InsightEntry[]>([])
  const [notes, setNotes] = useState<OneMinNote[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<string>(() => localStorage.getItem(MONTH_KEY) ?? 'all')
  const [clipUrl, setClipUrl] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(MONTH_KEY, selectedMonth)
  }, [selectedMonth])

  useEffect(() => {
    if (!clipUrl) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setClipUrl(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clipUrl])

  const refresh = () => api.listInsights().then(setEntries)

  useEffect(() => {
    Promise.all([refresh(), api.listOneMinNotes().then(setNotes)]).then(() => setLoading(false))
  }, [])

  const addNote = async (column: 'pass' | 'fail', text: string) => {
    const n = await api.createOneMinNote(column, text)
    setNotes((prev) => [...prev, n])
  }

  const editNote = async (n: OneMinNote) => {
    const text = window.prompt('메모 수정', n.text)
    if (text === null || text === n.text) return
    const updated = await api.updateOneMinNote(n.id, text)
    setNotes((prev) => prev.map((x) => (x.id === n.id ? updated : x)))
  }

  const removeNote = async (n: OneMinNote) => {
    if (!window.confirm('이 메모를 삭제할까요?')) return
    await api.deleteOneMinNote(n.id)
    setNotes((prev) => prev.filter((x) => x.id !== n.id))
  }

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

  const monthCounts = new Map<string, number>()
  for (const e of classified) {
    const key = monthOf(e.item_name)
    if (key) monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1)
  }
  const months = [...monthCounts.keys()].sort().reverse()
  const activeMonth = selectedMonth === 'all' || monthCounts.has(selectedMonth) ? selectedMonth : 'all'
  const scoped = activeMonth === 'all' ? classified : classified.filter((e) => monthOf(e.item_name) === activeMonth)

  return (
    <div className="one-min-wrap">
      {clipUrl && (
        <div className="clip-dialog-backdrop" onClick={() => setClipUrl(null)}>
          <div className="clip-dialog" onClick={(ev) => ev.stopPropagation()}>
            <div className="clip-dialog-head">
              <span>흐름 클립</span>
              <button type="button" onClick={() => setClipUrl(null)}>
                ✕
              </button>
            </div>
            <video className="clip-player" src={clipUrl} controls autoPlay />
          </div>
        </div>
      )}
      <div className="one-min-stats-bar">
        <div className="one-min-stats-head">
          <h2 className="remind-heading">체크리스트 통계</h2>
          <select
            className="one-min-month-select"
            value={activeMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            <option value="all">전체 ({classified.length})</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)} ({monthCounts.get(m)})
              </option>
            ))}
          </select>
        </div>
        <StatsTable entries={scoped} />
      </div>
      <div className="one-min-page">
        {COLUMNS.map((col) => {
          const items = scoped.filter((e) => e.result === col.key)
          return (
            <div key={col.key} className={`one-min-column ${col.key}`}>
              <div className="one-min-column-header">
                <h2 className={`one-min-column-title ${col.key}`}>
                  {col.label} ({items.length})
                </h2>
              </div>
              <MyInsightNotes
                column={col.key}
                notes={notes.filter((n) => n.column === col.key)}
                onAdd={addNote}
                onEdit={editNote}
                onRemove={removeNote}
              />
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
                        {e.clip_url && (
                          <button type="button" className="one-min-clip-btn" onClick={() => setClipUrl(e.clip_url)}>
                            ▶ 흐름 클립 보기
                          </button>
                        )}
                      </div>
                      {e.content_html && (
                        <div className="insight-card-content" dangerouslySetInnerHTML={{ __html: e.content_html }} />
                      )}
                      {e.image_a || e.image_b ? (
                        <ChartComparisonImages imageA={e.image_a} imageB={e.image_b} itemName={e.item_name} />
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
