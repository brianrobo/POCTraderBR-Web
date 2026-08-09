import { useEffect, useState } from 'react'
import { api, type Category, type Item } from './api/client'
import { TreeNavigator } from './components/TreeNavigator'
import { PageView } from './components/PageView'
import './App.css'

export default function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const refresh = async () => {
    const [cats, its] = await Promise.all([api.listCategories(), api.listItems()])
    setCategories(cats)
    setItems(its)
  }

  useEffect(() => {
    refresh()
  }, [])

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h1 className="app-title">POCTraderBR</h1>
        <TreeNavigator
          categories={categories}
          items={items}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
          onRefresh={refresh}
        />
      </aside>
      <main className="main-panel">
        {selectedItem ? (
          <>
            <h2 className="item-title">{selectedItem.name}</h2>
            <PageView item={selectedItem} />
          </>
        ) : (
          <div className="empty-state">왼쪽에서 폴더/아이템을 선택하거나 새로 만드세요.</div>
        )}
      </main>
    </div>
  )
}
