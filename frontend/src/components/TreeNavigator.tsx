import { useEffect, useState } from 'react'
import { api, MAX_CATEGORY_URLS, ROOT_CATEGORY_ID, type Category, type Item } from '../api/client'

interface Props {
  categories: Category[]
  items: Item[]
  selectedItemId: string | null
  onSelectItem: (id: string) => void
  onRefresh: () => void
}

export function TreeNavigator({ categories, items, selectedItemId, onSelectItem, onRefresh }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT_CATEGORY_ID]))
  const [linksOpenFor, setLinksOpenFor] = useState<string | null>(null)

  const catById = new Map(categories.map((c) => [c.id, c]))
  const itemById = new Map(items.map((i) => [i.id, i]))

  // Auto-expand the folder path to the selected item (e.g. one restored
  // from localStorage on load) so it's actually visible in the tree.
  useEffect(() => {
    if (!selectedItemId) return
    const item = itemById.get(selectedItemId)
    if (!item) return
    const toExpand: string[] = []
    let catId: string | undefined = item.category_id
    while (catId) {
      toExpand.push(catId)
      catId = catById.get(catId)?.parent_id ?? undefined
    }
    setExpanded((prev) => {
      if (toExpand.every((id) => prev.has(id))) return prev
      const next = new Set(prev)
      for (const id of toExpand) next.add(id)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId, categories, items])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addFolder = async (parentId: string) => {
    const name = window.prompt('폴더 이름')
    if (!name) return
    await api.createCategory(name, parentId)
    onRefresh()
  }

  const addItem = async (categoryId: string) => {
    const name = window.prompt('종목/아이템 이름')
    if (!name) return
    await api.createItem(name, categoryId)
    onRefresh()
  }

  const renameFolder = async (id: string, currentName: string) => {
    const name = window.prompt('폴더 이름 변경', currentName)
    if (!name || name === currentName) return
    await api.renameCategory(id, name)
    onRefresh()
  }

  const renameItemName = async (id: string, currentName: string) => {
    const name = window.prompt('아이템 이름 변경', currentName)
    if (!name || name === currentName) return
    await api.renameItem(id, name)
    onRefresh()
  }

  const removeFolder = async (id: string) => {
    if (!window.confirm('이 폴더를 삭제할까요? (비어있어야 합니다)')) return
    try {
      await api.deleteCategory(id)
      onRefresh()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  const removeItem = async (id: string) => {
    if (!window.confirm('이 아이템을 삭제할까요?')) return
    await api.deleteItem(id)
    onRefresh()
  }

  const moveItem = async (id: string, direction: 'up' | 'down') => {
    await api.moveItem(id, direction)
    onRefresh()
  }

  const addUrl = async (cat: Category) => {
    if (cat.urls.length >= MAX_CATEGORY_URLS) {
      window.alert(`URL은 최대 ${MAX_CATEGORY_URLS}개까지 등록할 수 있습니다.`)
      return
    }
    const url = window.prompt('URL 입력')
    if (!url) return
    await api.updateCategoryUrls(cat.id, [...cat.urls, url])
    onRefresh()
  }

  const removeUrl = async (cat: Category, index: number) => {
    await api.updateCategoryUrls(
      cat.id,
      cat.urls.filter((_, i) => i !== index),
    )
    onRefresh()
  }

  const renderCategory = (id: string, depth: number) => {
    const cat = catById.get(id)
    if (!cat) return null
    const isExpanded = expanded.has(id)
    return (
      <div key={id} className="tree-node">
        <div className="tree-row" style={{ paddingLeft: depth * 14 }}>
          <button className="tree-toggle" onClick={() => toggle(id)}>
            {isExpanded ? '▾' : '▸'}
          </button>
          <span
            className="tree-label"
            title={id !== ROOT_CATEGORY_ID ? '더블클릭하여 이름 변경' : undefined}
            onDoubleClick={() => id !== ROOT_CATEGORY_ID && renameFolder(id, cat.name)}
          >
            <span className="folder-label">{cat.name}</span>
          </span>
          <span className="tree-actions">
            <button
              title="관련 링크"
              className={linksOpenFor === id ? 'active' : ''}
              onClick={() => setLinksOpenFor(linksOpenFor === id ? null : id)}
            >
              🔗{cat.urls.length > 0 ? cat.urls.length : ''}
            </button>
            <button title="하위 폴더 추가" onClick={() => addFolder(id)}>+F</button>
            <button title="아이템 추가" onClick={() => addItem(id)}>+I</button>
            {id !== ROOT_CATEGORY_ID && (
              <button title="폴더 삭제" onClick={() => removeFolder(id)}>✕</button>
            )}
          </span>
        </div>
        {linksOpenFor === id && (
          <div className="links-panel" style={{ paddingLeft: depth * 14 + 20 }}>
            {cat.urls.map((url, i) => (
              <div className="links-panel-row" key={i}>
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
                <button title="링크 삭제" onClick={() => removeUrl(cat, i)}>
                  ✕
                </button>
              </div>
            ))}
            <button
              className="links-panel-add"
              disabled={cat.urls.length >= MAX_CATEGORY_URLS}
              onClick={() => addUrl(cat)}
            >
              + URL 추가 ({cat.urls.length}/{MAX_CATEGORY_URLS})
            </button>
          </div>
        )}
        {isExpanded && (
          <div className="tree-children">
            {cat.child_ids.map((childId) => renderCategory(childId, depth + 1))}
            {cat.item_ids.map((itemId, itemIdx) => {
              const item = itemById.get(itemId)
              if (!item) return null
              return (
                <div
                  key={itemId}
                  className={`tree-row tree-item ${selectedItemId === itemId ? 'selected' : ''}`}
                  style={{ paddingLeft: (depth + 1) * 14 }}
                  onClick={() => onSelectItem(itemId)}
                >
                  <span
                    className="tree-label"
                    title="더블클릭하여 이름 변경"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      renameItemName(itemId, item.name)
                    }}
                  >
                    {item.name}
                  </span>
                  <span className="tree-actions">
                    <button
                      title="위로 이동"
                      disabled={itemIdx === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        moveItem(itemId, 'up')
                      }}
                    >
                      ▲
                    </button>
                    <button
                      title="아래로 이동"
                      disabled={itemIdx === cat.item_ids.length - 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        moveItem(itemId, 'down')
                      }}
                    >
                      ▼
                    </button>
                    <button
                      title="아이템 삭제"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeItem(itemId)
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return <div className="tree-navigator">{renderCategory(ROOT_CATEGORY_ID, 0)}</div>
}
