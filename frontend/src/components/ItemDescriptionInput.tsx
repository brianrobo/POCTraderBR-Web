import { useEffect, useRef, useState } from 'react'
import { api, type Item } from '../api/client'

interface Props {
  item: Item
  onRefresh: () => void
}

export function ItemDescriptionInput({ item, onRefresh }: Props) {
  const [value, setValue] = useState(item.description)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    setValue(item.description)
  }, [item.id, item.description])

  const handleChange = (next: string) => {
    setValue(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      await api.updateItemDescription(item.id, next)
      onRefresh()
    }, 500)
  }

  return (
    <input
      type="text"
      className="item-description-input"
      placeholder="이 아이템에 대한 간단한 설명"
      value={value}
      onChange={(e) => handleChange(e.target.value)}
    />
  )
}
