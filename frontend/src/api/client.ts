export interface Category {
  id: string
  name: string
  parent_id: string | null
  child_ids: string[]
  item_ids: string[]
}

export interface Item {
  id: string
  name: string
  category_id: string
  page_ids: string[]
}

export interface Stroke {
  color: string
  width: number
  points: [number, number][]
}

export interface ImageSlot {
  path: string
  strokes: Stroke[]
}

export interface Page {
  id: string
  item_id: string
  note_html: string
  updated_at: number
  image_a: ImageSlot | null
  image_b: ImageSlot | null
}

export const ROOT_CATEGORY_ID = '__ROOT__'

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
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, { method: 'DELETE' }),

  listItems: () => request<Item[]>('/api/items'),
  createItem: (name: string, category_id: string) =>
    request<Item>('/api/items', { method: 'POST', body: JSON.stringify({ name, category_id }) }),
  renameItem: (id: string, name: string) =>
    request<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteItem: (id: string) => request<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),

  listPages: (item_id: string) => request<Page[]>(`/api/pages?item_id=${item_id}`),
  getPage: (id: string) => request<Page>(`/api/pages/${id}`),
  createPage: (item_id: string) =>
    request<Page>('/api/pages', { method: 'POST', body: JSON.stringify({ item_id }) }),
  updatePageNote: (id: string, note_html: string) =>
    request<Page>(`/api/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ note_html }) }),
  deletePage: (id: string) => request<{ ok: boolean }>(`/api/pages/${id}`, { method: 'DELETE' }),

  uploadImage: (pageId: string, slot: 'a' | 'b', file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Page>(`/api/pages/${pageId}/image/${slot}`, { method: 'POST', body: form })
  },
  deleteImage: (pageId: string, slot: 'a' | 'b') =>
    request<Page>(`/api/pages/${pageId}/image/${slot}`, { method: 'DELETE' }),
  updateStrokes: (pageId: string, slot: 'a' | 'b', strokes: Stroke[]) =>
    request<Page>(`/api/pages/${pageId}/strokes/${slot}`, { method: 'PUT', body: JSON.stringify({ strokes }) }),
}
