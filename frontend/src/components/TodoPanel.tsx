import { useEffect, useState } from 'react'
import { api, type Todo } from '../api/client'

function formatDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function displayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${y.slice(2)}.${m}.${d}`
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return formatDate(d)
}

export function TodoPanel() {
  const [today, setToday] = useState(() => formatDate(new Date()))
  const [date, setDate] = useState(today)
  const [todos, setTodos] = useState<Todo[]>([])
  const [newText, setNewText] = useState('')

  // Roll over to the new day if this stays open across midnight.
  useEffect(() => {
    const id = window.setInterval(() => setToday(formatDate(new Date())), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    api.listTodos(date).then(setTodos)
  }, [date])

  const addTodo = async () => {
    const text = newText.trim()
    if (!text) return
    const created = await api.createTodo(date, text)
    setTodos((prev) => [...prev, created])
    setNewText('')
  }

  const toggleDone = async (todo: Todo) => {
    const updated = await api.updateTodo(todo.id, { done: !todo.done })
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? updated : t)))
  }

  const removeTodo = async (id: string) => {
    await api.deleteTodo(id)
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  const isToday = date === today

  return (
    <div className="todo-panel">
      <div className="todo-panel-header">
        <button type="button" onClick={() => setDate((d) => addDays(d, -1))}>
          ◀
        </button>
        <span className="todo-panel-date">
          {displayDate(date)}
          {isToday && <span className="todo-panel-today-badge">오늘</span>}
        </span>
        <button type="button" onClick={() => setDate((d) => addDays(d, 1))}>
          ▶
        </button>
        {!isToday && (
          <button type="button" className="todo-panel-jump-today" onClick={() => setDate(today)}>
            오늘
          </button>
        )}
      </div>
      <div className="todo-list">
        {todos.map((t) => (
          <div className="todo-row" key={t.id}>
            <input type="checkbox" checked={t.done} onChange={() => toggleDone(t)} />
            <span className={`todo-text ${t.done ? 'done' : ''}`}>{t.text}</span>
            <button type="button" onClick={() => removeTodo(t.id)}>
              ✕
            </button>
          </div>
        ))}
        {todos.length === 0 && <div className="todo-empty">할 일이 없습니다</div>}
      </div>
      <div className="todo-add-row">
        <input
          type="text"
          placeholder="할 일 추가"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTodo()
          }}
        />
        <button type="button" onClick={addTodo}>
          +
        </button>
      </div>
    </div>
  )
}
