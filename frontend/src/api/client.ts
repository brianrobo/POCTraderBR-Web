export interface Category {
  id: string
  name: string
  parent_id: string | null
  child_ids: string[]
  item_ids: string[]
  urls: string[]
  note_html: string
}

export const MAX_CATEGORY_URLS = 10

export interface Item {
  id: string
  name: string
  category_id: string
  page_ids: string[]
  description: string
}

export interface Todo {
  id: string
  date: string
  text: string
  done: boolean
}

export interface Stroke {
  kind: 'path' | 'text'
  color: string
  width: number
  points: [number, number][]
  text: string
  font_size: number
  x: number
  y: number
}

export interface ImageSlot {
  path: string
  strokes: Stroke[]
}

export type ImageSlotKey = 'a' | 'a2' | 'b' | 'b2'
export type PageLayout = '2' | '4'

export interface Page {
  id: string
  item_id: string
  note_html_a: string
  note_html_b: string
  updated_at: number
  layout: PageLayout
  image_a: ImageSlot | null
  image_a2: ImageSlot | null
  image_b: ImageSlot | null
  image_b2: ImageSlot | null
  stock_name_a: string
  stock_name_a2: string
  stock_name_b: string
  stock_name_b2: string
}

export const ROOT_CATEGORY_ID = '__ROOT__'

const STOCK_NAME_FIELD: Record<ImageSlotKey, keyof Page> = {
  a: 'stock_name_a',
  a2: 'stock_name_a2',
  b: 'stock_name_b',
  b2: 'stock_name_b2',
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: options?.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : undefined,
    ...options,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(detail.detail ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listCategories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string, parent_id: string = ROOT_CATEGORY_ID) =>
    request<Category>('/api/categories', { method: 'POST', body: JSON.stringify({ name, parent_id }) }),
  renameCategory: (id: string, name: string) =>
    request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateCategoryUrls: (id: string, urls: string[]) =>
    request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ urls }) }),
  updateCategoryNote: (id: string, note_html: string) =>
    request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ note_html }) }),
  moveCategory: (id: string, direction: 'up' | 'down') =>
    request<{ ok: boolean }>(`/api/categories/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) }),
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, { method: 'DELETE' }),

  listItems: () => request<Item[]>('/api/items'),
  createItem: (name: string, category_id: string) =>
    request<Item>('/api/items', { method: 'POST', body: JSON.stringify({ name, category_id }) }),
  renameItem: (id: string, name: string) =>
    request<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateItemDescription: (id: string, description: string) =>
    request<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify({ description }) }),
  moveItem: (id: string, direction: 'up' | 'down') =>
    request<{ ok: boolean }>(`/api/items/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) }),
  deleteItem: (id: string) => request<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),

  listPages: (item_id: string) => request<Page[]>(`/api/pages?item_id=${item_id}`),
  getPage: (id: string) => request<Page>(`/api/pages/${id}`),
  createPage: (item_id: string) =>
    request<Page>('/api/pages', { method: 'POST', body: JSON.stringify({ item_id }) }),
  updatePageNote: (id: string, column: 'a' | 'b', note_html: string) =>
    request<Page>(`/api/pages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(column === 'a' ? { note_html_a: note_html } : { note_html_b: note_html }),
    }),
  updatePageLayout: (id: string, layout: PageLayout) =>
    request<Page>(`/api/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ layout }) }),
  updateStockName: (id: string, slot: ImageSlotKey, name: string) =>
    request<Page>(`/api/pages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [STOCK_NAME_FIELD[slot]]: name }),
    }),
  deletePage: (id: string) => request<{ ok: boolean }>(`/api/pages/${id}`, { method: 'DELETE' }),

  uploadImage: (pageId: string, slot: ImageSlotKey, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Page>(`/api/pages/${pageId}/image/${slot}`, { method: 'POST', body: form })
  },
  deleteImage: (pageId: string, slot: ImageSlotKey) =>
    request<Page>(`/api/pages/${pageId}/image/${slot}`, { method: 'DELETE' }),
  updateStrokes: (pageId: string, slot: ImageSlotKey, strokes: Stroke[]) =>
    request<Page>(`/api/pages/${pageId}/strokes/${slot}`, { method: 'PUT', body: JSON.stringify({ strokes }) }),

  listTodos: (date: string) => request<Todo[]>(`/api/todos?date=${date}`),
  createTodo: (date: string, text: string) =>
    request<Todo>('/api/todos', { method: 'POST', body: JSON.stringify({ date, text }) }),
  updateTodo: (id: string, patch: { text?: string; done?: boolean }) =>
    request<Todo>(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTodo: (id: string) => request<{ ok: boolean }>(`/api/todos/${id}`, { method: 'DELETE' }),
}
