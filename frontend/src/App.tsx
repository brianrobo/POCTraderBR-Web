import { useEffect, useRef, useState } from 'react'
import { api, type Category, type Item } from './api/client'
import { TreeNavigator } from './components/TreeNavigator'
import { PageView } from './components/PageView'
import { CategoryNoteView } from './components/CategoryNoteView'
import { ItemDescriptionInput } from './components/ItemDescriptionInput'
import { TodoPanel } from './components/TodoPanel'
import { FormulaInfoPage } from './components/FormulaInfoPage'
import { StudyPlanPage } from './components/StudyPlanPage'
import { MarketHoursBar } from './components/MarketHoursBar'
import { InsightFeed } from './components/InsightFeed'
import { LiveAnalysisPage } from './components/LiveAnalysisPage'
import { RemindPage } from './components/RemindPage'
import './App.css'

const LAST_SELECTION_KEY = 'poctrader:lastSelection'
const SIDEBAR_WIDTH_KEY = 'poctrader:sidebarWidth'
const ACTIVE_TAB_KEY = 'poctrader:activeTab'
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 600
const DEFAULT_SIDEBAR_WIDTH = 280

type Tab = 'notes' | 'reference' | 'study' | 'insights' | 'live' | 'remind'
type Selection = { type: 'item' | 'category'; id: string } | null

function loadActiveTab(): Tab {
  const raw = localStorage.getItem(ACTIVE_TAB_KEY)
  return raw === 'reference' || raw === 'study' || raw === 'insights' || raw === 'live' || raw === 'remind'
    ? raw
    : 'notes'
}

function loadLastSelection(): Selection {
  const raw = localStorage.getItem(LAST_SELECTION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && (parsed.type === 'item' || parsed.type === 'category') && typeof parsed.id === 'string') {
      return parsed as Selection
    }
  } catch {
    // ignore malformed/legacy value
  }
  return null
}

function clampWidth(w: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, w))
}

function loadSidebarWidth(): number {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? clampWidth(n) : DEFAULT_SIDEBAR_WIDTH
}

export default function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [selection, setSelection] = useState<Selection>(() => loadLastSelection())
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const [activeTab, setActiveTab] = useState<Tab>(loadActiveTab)
  const [jumpToPageId, setJumpToPageId] = useState<string | null>(null)
  const widthRef = useRef(sidebarWidth)
  const resizingRef = useRef(false)

  const refresh = async () => {
    const [cats, its] = await Promise.all([api.listCategories(), api.listItems()])
    setCategories(cats)
    setItems(its)
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (selection) {
      localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify(selection))
    } else {
      localStorage.removeItem(LAST_SELECTION_KEY)
    }
  }, [selection])

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_KEY, activeTab)
  }, [activeTab])

  // Sidebar drag-to-resize. Width is tracked in a ref alongside state so the
  // final value is available for persisting on mouseup without a stale
  // closure (the listeners are attached once, not re-attached per drag).
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const width = clampWidth(e.clientX)
      widthRef.current = width
      setSidebarWidth(width)
    }
    const onMouseUp = () => {
      if (!resizingRef.current) return
      resizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current))
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const openInsight = (itemId: string, pageId: string) => {
    setSelection({ type: 'item', id: itemId })
    setJumpToPageId(pageId)
    setActiveTab('notes')
  }

  const selectedItemId = selection?.type === 'item' ? selection.id : null
  const selectedCategoryId = selection?.type === 'category' ? selection.id : null

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null

  return (
    <div className="app-root">
      <MarketHoursBar />
      <div className="top-tabs">
        <button
          type="button"
          className={activeTab === 'notes' ? 'active' : ''}
          onClick={() => setActiveTab('notes')}
        >
          트레이딩 노트
        </button>
        <button
          type="button"
          className={activeTab === 'reference' ? 'active' : ''}
          onClick={() => setActiveTab('reference')}
        >
          수식 정보
        </button>
        <button
          type="button"
          className={activeTab === 'study' ? 'active' : ''}
          onClick={() => setActiveTab('study')}
        >
          학습 계획
        </button>
        <button
          type="button"
          className={activeTab === 'insights' ? 'active' : ''}
          onClick={() => setActiveTab('insights')}
        >
          인사이트 모아보기
        </button>
        <button
          type="button"
          className={activeTab === 'live' ? 'active' : ''}
          onClick={() => setActiveTab('live')}
        >
          실시간 분석
        </button>
        <button
          type="button"
          className={activeTab === 'remind' ? 'active' : ''}
          onClick={() => setActiveTab('remind')}
        >
          Remind
        </button>
      </div>
      {activeTab === 'notes' ? (
        <div className="app-layout">
          <aside className="sidebar" style={{ width: sidebarWidth }}>
            <h1 className="app-title">POCTraderBR</h1>
            <div className="tree-scroll">
              <TreeNavigator
                categories={categories}
                items={items}
                selectedItemId={selectedItemId}
                selectedCategoryId={selectedCategoryId}
                onSelectItem={(id) => setSelection({ type: 'item', id })}
                onSelectCategory={(id) => setSelection({ type: 'category', id })}
                onRefresh={refresh}
              />
            </div>
            <TodoPanel />
          </aside>
          <div className="sidebar-resizer" onMouseDown={startResize} />
          <main className="main-panel">
            {selectedItem ? (
              <>
                <h2 className="item-title">{selectedItem.name}</h2>
                <ItemDescriptionInput item={selectedItem} onRefresh={refresh} />
                <PageView item={selectedItem} jumpToPageId={jumpToPageId} />
              </>
            ) : selectedCategory ? (
              <CategoryNoteView category={selectedCategory} onRefresh={refresh} />
            ) : (
              <div className="empty-state">왼쪽에서 폴더/아이템을 선택하거나 새로 만드세요.</div>
            )}
          </main>
        </div>
      ) : activeTab === 'reference' ? (
        <FormulaInfoPage />
      ) : activeTab === 'study' ? (
        <StudyPlanPage />
      ) : activeTab === 'insights' ? (
        <InsightFeed onOpen={openInsight} />
      ) : activeTab === 'live' ? (
        <LiveAnalysisPage />
      ) : (
        <RemindPage />
      )}
    </div>
  )
}
