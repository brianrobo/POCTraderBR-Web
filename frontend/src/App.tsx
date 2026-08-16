import { useEffect, useRef, useState } from 'react'
import { api, type Category, type Item } from './api/client'
import { TreeNavigator } from './components/TreeNavigator'
import { PageView } from './components/PageView'
import { CategoryNoteView } from './components/CategoryNoteView'
import { ItemDescriptionInput } from './components/ItemDescriptionInput'
import { TodoPanel } from './components/TodoPanel'
import './App.css'

const LAST_SELECTION_KEY = 'poctrader:lastSelection'
const SIDEBAR_WIDTH_KEY = 'poctrader:sidebarWidth'
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 600
const DEFAULT_SIDEBAR_WIDTH = 280

type Selection = { type: 'item' | 'category'; id: string } | null

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

  const selectedItemId = selection?.type === 'item' ? selection.id : null
  const selectedCategoryId = selection?.type === 'category' ? selection.id : null

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null

  return (
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
            <PageView item={selectedItem} />
          </>
        ) : selectedCategory ? (
          <CategoryNoteView category={selectedCategory} onRefresh={refresh} />
        ) : (
          <div className="empty-state">왼쪽에서 폴더/아이템을 선택하거나 새로 만드세요.</div>
        )}
      </main>
    </div>
  )
}
