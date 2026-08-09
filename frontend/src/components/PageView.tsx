import { useEffect, useState } from 'react'
import { api, type Item, type Page } from '../api/client'
import { NoteEditor } from './NoteEditor'
import { ChartCanvas } from './ChartCanvas'

interface Props {
  item: Item
}

export function PageView({ item }: Props) {
  const [pages, setPages] = useState<Page[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const list = await api.listPages(item.id)
    setPages(list)
    setSelectedPageId((prev) => (prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? null)))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const addPage = async () => {
    const p = await api.createPage(item.id)
    setPages((prev) => [...prev, p])
    setSelectedPageId(p.id)
  }

  const removePage = async (id: string) => {
    if (!window.confirm('이 페이지를 삭제할까요?')) return
    await api.deletePage(id)
    await load()
  }

  const updatePage = (updated: Page) => {
    setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  const selectedPage = pages.find((p) => p.id === selectedPageId) ?? null

  if (loading) return <div className="page-view-loading">로딩 중...</div>

  return (
    <div className="page-view">
      <div className="page-tabs">
        {pages.map((p, idx) => (
          <button
            key={p.id}
            type="button"
            className={`page-tab ${p.id === selectedPageId ? 'active' : ''}`}
            onClick={() => setSelectedPageId(p.id)}
          >
            페이지 {idx + 1}
            <span
              className="page-tab-close"
              onClick={(e) => {
                e.stopPropagation()
                removePage(p.id)
              }}
            >
              ✕
            </span>
          </button>
        ))}
        <button type="button" className="page-tab-add" onClick={addPage}>
          + 페이지
        </button>
      </div>
      {selectedPage ? (
        <div className="page-body">
          <NoteEditor
            key={selectedPage.id}
            html={selectedPage.note_html}
            onSave={async (html) => {
              const updated = await api.updatePageNote(selectedPage.id, html)
              updatePage(updated)
            }}
          />
          <div className="charts-row">
            <ChartCanvas key={`${selectedPage.id}-a`} page={selectedPage} slot="a" onPageUpdate={updatePage} />
            <ChartCanvas key={`${selectedPage.id}-b`} page={selectedPage} slot="b" onPageUpdate={updatePage} />
          </div>
        </div>
      ) : (
        <div className="page-empty">
          <button type="button" onClick={addPage}>
            + 첫 페이지 추가
          </button>
        </div>
      )}
    </div>
  )
}
