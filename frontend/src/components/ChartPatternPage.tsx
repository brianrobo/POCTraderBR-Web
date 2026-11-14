import { useEffect, useRef, useState } from 'react'
import { api, type ChartPattern } from '../api/client'
import { NoteEditor } from './NoteEditor'

// One pattern (from the Warrior Trading chart-pattern PDF) = one tree item:
// a concept diagram, its real-chart examples, and a notes block — built up
// one at a time as each pattern gets reviewed.
export function ChartPatternPage() {
  const [patterns, setPatterns] = useState<ChartPattern[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const exampleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.listChartPatterns().then((list) => {
      setPatterns(list)
      setLoading(false)
    })
  }, [])

  const selected = patterns.find((p) => p.id === selectedId) ?? null

  const applyUpdate = (updated: ChartPattern) => {
    setPatterns((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
  }

  const addPattern = async () => {
    const name = window.prompt('패턴 이름')
    if (!name) return
    const pdfGroup = window.prompt('PDF 그룹 번호 (예: 1) — 없으면 빈칸', '') ?? ''
    const created = await api.createChartPattern(name, pdfGroup)
    setPatterns((prev) => [...prev, created])
    setSelectedId(created.id)
  }

  const renamePattern = async (p: ChartPattern) => {
    const name = window.prompt('패턴 이름 변경', p.name)
    if (!name || name === p.name) return
    applyUpdate(await api.updateChartPattern(p.id, { name }))
  }

  const addExample = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selected) return
    applyUpdate(await api.addChartPatternExample(selected.id, file))
  }

  const selectPattern = (id: string) => {
    setSelectedId(id)
    setPreviewIndex(null)
  }

  if (loading) return <div className="page-view-loading">로딩 중...</div>

  return (
    <div className="chartpat-layout">
      <aside className="chartpat-sidebar">
        <div className="chartpat-sidebar-head">
          <h2 className="remind-heading">차트 패턴</h2>
          <button type="button" onClick={addPattern}>
            + 추가
          </button>
        </div>
        <div className="chartpat-tree">
          {patterns.length === 0 ? (
            <div className="empty-state">아직 등록된 패턴이 없습니다.</div>
          ) : (
            patterns.map((p) => (
              <div
                key={p.id}
                className={`chartpat-tree-row ${selectedId === p.id ? 'selected' : ''}`}
                onClick={() => selectPattern(p.id)}
              >
                <span
                  className="chartpat-tree-label"
                  title="더블클릭하여 이름 변경"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    renamePattern(p)
                  }}
                >
                  {p.pdf_group && <span className="chartpat-tree-group">{p.pdf_group}</span>}
                  {p.name}
                </span>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="chartpat-main">
        {!selected ? (
          <div className="empty-state">왼쪽에서 패턴을 선택하거나 새로 추가하세요.</div>
        ) : (
          <>
          <div className="chartpat-content">
          <div className="chartpat-detail">
            <h2 className="item-title">
              {selected.pdf_group && `[${selected.pdf_group}] `}
              {selected.name}
            </h2>

            <div className="chartpat-section">
              <div className="chartpat-section-head">
                <h3 className="remind-heading">개념 설명</h3>
              </div>
              {selected.concept_image_url ? (
                <img className="chartpat-concept-image" src={selected.concept_image_url} alt="개념 설명" />
              ) : (
                <div className="empty-state">아직 개념 설명 이미지가 없습니다.</div>
              )}
            </div>

            <div className="chartpat-section">
              <div className="chartpat-section-head">
                <h3 className="remind-heading">실제 차트 예시 ({selected.example_image_urls.length})</h3>
                <input
                  ref={exampleInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={addExample}
                />
                <button type="button" onClick={() => exampleInputRef.current?.click()}>
                  + 예시 추가
                </button>
              </div>
              {selected.example_image_urls.length === 0 ? (
                <div className="empty-state">아직 예시 이미지가 없습니다.</div>
              ) : (
                <div className="chartpat-examples-thumbs">
                  {selected.example_image_urls.map((url, i) => (
                    <img
                      key={url}
                      src={url}
                      alt={`예시 ${i + 1}`}
                      className={previewIndex === i ? 'selected' : ''}
                      onClick={() => setPreviewIndex(i)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="chartpat-section">
              <h3 className="remind-heading">메모</h3>
              <NoteEditor
                key={selected.id}
                html={selected.notes_html}
                onSave={async (html) => applyUpdate(await api.updateChartPattern(selected.id, { notes_html: html }))}
              />
            </div>
          </div>
          </div>
          <div className="chartpat-preview-pane">
            {previewIndex !== null ? (
              <img src={selected.example_image_urls[previewIndex]} alt={`예시 ${previewIndex + 1} 확대`} />
            ) : (
              <div className="empty-state">왼쪽 예시 썸네일을 클릭하면 여기에 크게 보입니다.</div>
            )}
          </div>
          </>
        )}
      </main>
    </div>
  )
}
