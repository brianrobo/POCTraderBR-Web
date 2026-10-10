import { useEffect, useState } from 'react'
import { api, type Item, type Page } from '../api/client'
import { NoteEditor } from './NoteEditor'
import { ChartCanvas } from './ChartCanvas'
import { ClipRecorder } from './ClipRecorder'

interface Props {
  item: Item
  jumpToPageId?: string | null
}

export function PageView({ item, jumpToPageId }: Props) {
  const [pages, setPages] = useState<Page[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async (preferPageId?: string | null) => {
    setLoading(true)
    const list = await api.listPages(item.id)
    setPages(list)
    const preferred = preferPageId && list.some((p) => p.id === preferPageId) ? preferPageId : null
    setSelectedPageId((prev) => preferred ?? (prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? null)))
    setLoading(false)
  }

  useEffect(() => {
    load(jumpToPageId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, jumpToPageId])

  const addPage = async () => {
    const p = await api.createPage(item.id, 'chart')
    setPages((prev) => [...prev, p])
    setSelectedPageId(p.id)
  }

  const addInsight = async () => {
    const p = await api.createPage(item.id, 'insight')
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

  const toggleResult = async (page: Page, next: 'pass' | 'fail') => {
    updatePage(await api.updatePageResult(page.id, page.result === next ? '' : next))
  }

  const toggleMaSpacing = async (page: Page, next: 'converge' | 'diverge') => {
    updatePage(await api.updatePageChecklist(page.id, { ma_spacing: page.ma_spacing === next ? '' : next }))
  }

  const togglePeriodSymmetry = async (page: Page, next: 'after' | 'before') => {
    updatePage(await api.updatePageChecklist(page.id, { period_symmetry: page.period_symmetry === next ? '' : next }))
  }

  const toggleLeadingSpan2 = async (page: Page, next: 'digested' | 'undigested') => {
    updatePage(await api.updatePageChecklist(page.id, { leading_span2: page.leading_span2 === next ? '' : next }))
  }

  const toggleAccumulation = async (page: Page) => {
    updatePage(await api.updatePageChecklist(page.id, { accumulation_checked: !page.accumulation_checked }))
  }

  const toggleDoNotBuy = async (page: Page) => {
    updatePage(await api.updatePageDoNotBuy(page.id, !page.do_not_buy))
  }

  const setLayout = async (id: string, layout: '2' | '4') => {
    try {
      const updated = await api.updatePageLayout(id, layout)
      updatePage(updated)
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  if (loading) return <div className="page-view-loading">로딩 중...</div>

  let chartCount = 0
  let insightCount = 0

  return (
    <div className="page-view">
      <div className="page-tabs">
        {pages.map((p) => {
          const label =
            p.kind === 'insight'
              ? `💡 인사이트 ${++insightCount}${p.result ? ` · ${p.result.toUpperCase()}` : ''}`
              : `페이지 ${++chartCount}`
          return (
            <button
              key={p.id}
              type="button"
              className={`page-tab ${p.kind === 'insight' ? 'insight' : ''} ${p.id === selectedPageId ? 'active' : ''}`}
              onClick={() => setSelectedPageId(p.id)}
            >
              {label}
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
          )
        })}
        <button type="button" className="page-tab-add" onClick={addPage}>
          + 페이지
        </button>
        <button type="button" className="page-tab-add insight" onClick={addInsight}>
          + 인사이트
        </button>
      </div>
      {selectedPage ? (
        selectedPage.kind === 'insight' ? (
          <div className="page-body insight-page-body">
            <div className="insight-result-bar">
              <span className="insight-result-label">결과</span>
              <button
                type="button"
                className={`result-btn pass ${selectedPage.result === 'pass' ? 'active' : ''}`}
                onClick={() => toggleResult(selectedPage, 'pass')}
              >
                PASS
              </button>
              <button
                type="button"
                className={`result-btn fail ${selectedPage.result === 'fail' ? 'active' : ''}`}
                onClick={() => toggleResult(selectedPage, 'fail')}
              >
                FAIL
              </button>
              {!selectedPage.result && <span className="insight-result-hint">아직 미정</span>}
              <button
                type="button"
                className={`do-not-buy-toggle ${selectedPage.do_not_buy ? 'active' : ''}`}
                onClick={() => toggleDoNotBuy(selectedPage)}
              >
                🚫 사면 안되는 종목
              </button>
            </div>
            <div className="insight-checklist">
              <span className="insight-checklist-item">
                <span className="insight-checklist-label">기간대칭</span>
                <button
                  type="button"
                  className={`checklist-btn green ${selectedPage.period_symmetry === 'after' ? 'active' : ''}`}
                  onClick={() => togglePeriodSymmetry(selectedPage, 'after')}
                >
                  이후
                </button>
                <button
                  type="button"
                  className={`checklist-btn red ${selectedPage.period_symmetry === 'before' ? 'active' : ''}`}
                  onClick={() => togglePeriodSymmetry(selectedPage, 'before')}
                >
                  이전
                </button>
              </span>
              <span className="insight-checklist-item">
                <span className="insight-checklist-label">이평 이격</span>
                <button
                  type="button"
                  className={`checklist-btn green ${selectedPage.ma_spacing === 'converge' ? 'active' : ''}`}
                  onClick={() => toggleMaSpacing(selectedPage, 'converge')}
                >
                  수렴
                </button>
                <button
                  type="button"
                  className={`checklist-btn red ${selectedPage.ma_spacing === 'diverge' ? 'active' : ''}`}
                  onClick={() => toggleMaSpacing(selectedPage, 'diverge')}
                >
                  벌어짐
                </button>
              </span>
              <label className="insight-checklist-item">
                <input type="checkbox" checked={selectedPage.accumulation_checked} onChange={() => toggleAccumulation(selectedPage)} />
                매집구간 체크
              </label>
              <span className="insight-checklist-item">
                <span className="insight-checklist-label">선행2</span>
                <button
                  type="button"
                  className={`checklist-btn green ${selectedPage.leading_span2 === 'digested' ? 'active' : ''}`}
                  onClick={() => toggleLeadingSpan2(selectedPage, 'digested')}
                >
                  소화
                </button>
                <button
                  type="button"
                  className={`checklist-btn red ${selectedPage.leading_span2 === 'undigested' ? 'active' : ''}`}
                  onClick={() => toggleLeadingSpan2(selectedPage, 'undigested')}
                >
                  미소화
                </button>
              </span>
            </div>
            <NoteEditor
              key={`${selectedPage.id}-insight`}
              html={selectedPage.note_html_a}
              onSave={async (html) => {
                const updated = await api.updatePageNote(selectedPage.id, 'a', html)
                updatePage(updated)
              }}
            />
            <div className="insight-charts">
              <ChartCanvas
                key={`${selectedPage.id}-a`}
                page={selectedPage}
                slot="a"
                label=""
                onPageUpdate={updatePage}
              />
              <ChartCanvas
                key={`${selectedPage.id}-b`}
                page={selectedPage}
                slot="b"
                label="돌파 확대"
                onPageUpdate={updatePage}
              />
            </div>
            <ClipRecorder
              key={`${selectedPage.id}-clip`}
              pageId={selectedPage.id}
              clipUrl={selectedPage.clip_url}
              onChange={updatePage}
              itemName={item.name}
            />
          </div>
        ) : (
          <div className="page-body">
            <div className="layout-toggle">
              <button
                type="button"
                className={selectedPage.layout === '2' ? 'active' : ''}
                onClick={() => setLayout(selectedPage.id, '2')}
              >
                2단
              </button>
              <button
                type="button"
                className={selectedPage.layout === '4' ? 'active' : ''}
                onClick={() => setLayout(selectedPage.id, '4')}
              >
                4단
              </button>
            </div>
            <div className="page-columns">
              <div className="page-column">
                <NoteEditor
                  key={`${selectedPage.id}-note-a`}
                  html={selectedPage.note_html_a}
                  onSave={async (html) => {
                    const updated = await api.updatePageNote(selectedPage.id, 'a', html)
                    updatePage(updated)
                  }}
                />
                <div className="column-charts">
                  <ChartCanvas
                    key={`${selectedPage.id}-a`}
                    page={selectedPage}
                    slot="a"
                    label={selectedPage.layout === '4' ? 'A 상단' : 'A'}
                    onPageUpdate={updatePage}
                  />
                  {selectedPage.layout === '4' && (
                    <ChartCanvas
                      key={`${selectedPage.id}-a2`}
                      page={selectedPage}
                      slot="a2"
                      label="A 하단"
                      onPageUpdate={updatePage}
                    />
                  )}
                </div>
              </div>
              <div className="page-column">
                <NoteEditor
                  key={`${selectedPage.id}-note-b`}
                  html={selectedPage.note_html_b}
                  onSave={async (html) => {
                    const updated = await api.updatePageNote(selectedPage.id, 'b', html)
                    updatePage(updated)
                  }}
                />
                <div className="column-charts">
                  <ChartCanvas
                    key={`${selectedPage.id}-b`}
                    page={selectedPage}
                    slot="b"
                    label={selectedPage.layout === '4' ? 'B 상단' : 'B'}
                    onPageUpdate={updatePage}
                  />
                  {selectedPage.layout === '4' && (
                    <ChartCanvas
                      key={`${selectedPage.id}-b2`}
                      page={selectedPage}
                      slot="b2"
                      label="B 하단"
                      onPageUpdate={updatePage}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )
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
