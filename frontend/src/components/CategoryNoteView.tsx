import { useState } from 'react'
import { api, MAX_CATEGORY_URLS, type Category } from '../api/client'
import { NoteEditor } from './NoteEditor'

interface Props {
  category: Category
  onRefresh: () => void
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function CategoryNoteView({ category, onRefresh }: Props) {
  const [newUrl, setNewUrl] = useState('')

  const saveNote = async (html: string) => {
    await api.updateCategoryNote(category.id, html)
    onRefresh()
  }

  const addUrl = async () => {
    const url = normalizeUrl(newUrl)
    if (!url) return
    if (category.urls.length >= MAX_CATEGORY_URLS) {
      window.alert(`URL은 최대 ${MAX_CATEGORY_URLS}개까지 등록할 수 있습니다.`)
      return
    }
    await api.updateCategoryUrls(category.id, [...category.urls, url])
    setNewUrl('')
    onRefresh()
  }

  const removeUrl = async (index: number) => {
    await api.updateCategoryUrls(
      category.id,
      category.urls.filter((_, i) => i !== index),
    )
    onRefresh()
  }

  return (
    <div className="category-note-view">
      <h2 className="item-title">{category.name}</h2>
      <div className="category-links">
        {category.urls.map((url, i) => (
          <div className="category-links-row" key={i}>
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
            <button type="button" onClick={() => removeUrl(i)}>
              ✕
            </button>
          </div>
        ))}
        {category.urls.length < MAX_CATEGORY_URLS && (
          <div className="category-links-add">
            <input
              type="text"
              placeholder="관련 URL 추가"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addUrl()
              }}
            />
            <button type="button" onClick={addUrl}>
              추가
            </button>
          </div>
        )}
      </div>
      <NoteEditor key={category.id} html={category.note_html} onSave={saveNote} />
    </div>
  )
}
