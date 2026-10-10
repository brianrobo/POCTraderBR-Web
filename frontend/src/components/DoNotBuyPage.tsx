import { useEffect, useState } from 'react'
import { api, type InsightEntry, type LeadingSpan2, type MaSpacing, type PeriodSymmetry } from '../api/client'
import { ChartComparisonImages } from './AnnotatedChart'
import { ClipDialog } from './ClipRecorder'

const CHART_SIZES = [30, 50, 60, 80] as const
const CHART_SIZE_KEY = 'poctrader:donotbuyChartSize'

function loadChartSize(): number {
  const raw = Number(localStorage.getItem(CHART_SIZE_KEY))
  return (CHART_SIZES as readonly number[]).includes(raw) ? raw : 60
}

interface Props {
  onOpenPage: (itemId: string, pageId: string) => void
}

export function DoNotBuyPage({ onOpenPage }: Props) {
  const [entries, setEntries] = useState<InsightEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [clipEntry, setClipEntry] = useState<InsightEntry | null>(null)
  const [chartSize, setChartSize] = useState<number>(loadChartSize)

  useEffect(() => {
    localStorage.setItem(CHART_SIZE_KEY, String(chartSize))
  }, [chartSize])

  useEffect(() => {
    api.listInsights().then((list) => {
      setEntries(list)
      setLoading(false)
    })
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

  const removeFromList = async (e: InsightEntry) => {
    if (!window.confirm('이 종목을 목록에서 제거할까요? (인사이트 페이지 자체는 삭제되지 않습니다)')) return
    await api.updatePageDoNotBuy(e.page_id, false)
    setEntries((prev) => prev.filter((x) => x.page_id !== e.page_id))
  }

  if (loading) return <div className="page-view-loading">로딩 중...</div>

  const list = entries.filter((e) => e.do_not_buy)

  return (
    <div className="donotbuy-wrap">
      <ClipDialog entry={clipEntry} onClose={() => setClipEntry(null)} />
      <div className="donotbuy-head">
        <h2 className="remind-heading danger">사면 안되는 종목</h2>
        <label className="donotbuy-size-label">
          보기 크기
          <select value={chartSize} onChange={(e) => setChartSize(Number(e.target.value))}>
            {CHART_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}%
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.length === 0 ? (
        <div className="empty-state">
          트레이딩 노트의 인사이트 페이지에서 "🚫 사면 안되는 종목"을 눌러 등록하면 여기 나타납니다.
        </div>
      ) : (
        <div className="donotbuy-list">
          {list.map((e) => (
            <div key={e.page_id} className="one-min-card">
              <div className="one-min-card-head">
                <span className="one-min-card-title">
                  {e.result && <span className={`insight-result-badge ${e.result}`}>{e.result.toUpperCase()}</span>}
                  {e.category_path ? `${e.category_path} > ` : ''}
                  {e.item_name}
                </span>
                <span className="one-min-card-actions">
                  <button type="button" className="remind-chart-open" onClick={() => onOpenPage(e.item_id, e.page_id)}>
                    원본 보기
                  </button>
                  <button type="button" className="danger" onClick={() => removeFromList(e)}>
                    목록에서 제거
                  </button>
                </span>
              </div>
              {e.content_html && (
                <div className="insight-card-content" dangerouslySetInnerHTML={{ __html: e.content_html }} />
              )}
              <div className="donotbuy-chart" style={{ maxWidth: `${chartSize}%` }}>
                {e.image_a || e.image_b ? (
                  <ChartComparisonImages imageA={e.image_a} imageB={e.image_b} itemName={e.item_name} />
                ) : (
                  <div className="empty-state">첨부된 화면이 없습니다.</div>
                )}
                {e.clip_url && (
                  <button type="button" className="one-min-clip-btn" onClick={() => setClipEntry(e)}>
                    ▶ 흐름 클립 보기
                  </button>
                )}
              </div>
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
          ))}
        </div>
      )}
    </div>
  )
}
