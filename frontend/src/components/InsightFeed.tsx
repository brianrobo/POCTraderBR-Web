import { useEffect, useState } from 'react'
import { api, type InsightEntry } from '../api/client'

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

export function InsightFeed({ onOpen }: Props) {
  const [entries, setEntries] = useState<InsightEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listInsights().then((list) => {
      setEntries(list)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="page-view-loading">로딩 중...</div>

  return (
    <div className="insight-feed">
      {entries.length === 0 ? (
        <div className="empty-state">
          아직 인사이트가 없습니다. 아이템의 "+ 인사이트" 탭에서 작성해보세요.
        </div>
      ) : (
        entries.map((e) => (
          <div key={e.page_id} className="insight-card" onClick={() => onOpen(e.item_id, e.page_id)}>
            <div className="insight-card-header">
              <span className="insight-card-path">
                {e.category_path ? `${e.category_path} > ` : ''}
                {e.item_name}
              </span>
              <span className="insight-card-date">{formatDate(e.updated_at)}</span>
            </div>
            <div className="insight-card-content" dangerouslySetInnerHTML={{ __html: e.content_html }} />
          </div>
        ))
      )}
    </div>
  )
}
