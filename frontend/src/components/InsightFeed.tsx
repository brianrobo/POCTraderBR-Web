import { useEffect, useState } from 'react'
import { api, type InsightEntry, type PageResult } from '../api/client'
import { ChartComparisonImages } from './AnnotatedChart'
import { ClipPlayer } from './ClipRecorder'

interface Props {
  onOpen: (itemId: string, pageId: string) => void
}

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type Filter = 'all' | 'pass' | 'fail' | 'none'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'pass', label: 'PASS' },
  { key: 'fail', label: 'FAIL' },
  { key: 'none', label: '미분류' },
]

const FILTER_KEY = 'poctrader:insightFilter'

function matchesFilter(result: PageResult, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'none') return result === ''
  return result === filter
}

function loadFilter(): Filter {
  const raw = localStorage.getItem(FILTER_KEY)
  return raw === 'pass' || raw === 'fail' || raw === 'none' ? raw : 'all'
}

export function InsightFeed({ onOpen }: Props) {
  const [entries, setEntries] = useState<InsightEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>(loadFilter)

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, filter)
  }, [filter])

  useEffect(() => {
    api.listInsights().then((list) => {
      setEntries(list)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="page-view-loading">로딩 중...</div>

  const visible = entries.filter((e) => matchesFilter(e.result, filter))

  return (
    <div className="insight-feed">
      <div className="insight-filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`insight-filter-btn ${f.key} ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {entries.filter((e) => matchesFilter(e.result, f.key)).length}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <div className="empty-state">
          아직 인사이트가 없습니다. 아이템의 "+ 인사이트" 탭에서 작성해보세요.
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">이 분류에 해당하는 인사이트가 없습니다.</div>
      ) : (
        visible.map((e) => (
          <div key={e.page_id} className="insight-card" onClick={() => onOpen(e.item_id, e.page_id)}>
            <div className="insight-card-header">
              <span className="insight-card-path">
                {e.result && <span className={`insight-result-badge ${e.result}`}>{e.result.toUpperCase()}</span>}
                {e.category_path ? `${e.category_path} > ` : ''}
                {e.item_name}
              </span>
              <span className="insight-card-date">{formatDate(e.updated_at)}</span>
            </div>
            <div className="insight-card-content" dangerouslySetInnerHTML={{ __html: e.content_html }} />
            <div className="insight-feed-chart">
              <ChartComparisonImages imageA={e.image_a} imageB={e.image_b} itemName={e.item_name} />
              {e.clip_url && <ClipPlayer url={e.clip_url} />}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
