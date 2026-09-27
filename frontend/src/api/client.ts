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

export interface CodeInfo {
  id: string
  code: string
  description: string
  created_at: number
}

export const FORMULA_CATEGORIES = ['기술적지표', '신호검색', '강세약세'] as const
export type FormulaCategory = (typeof FORMULA_CATEGORIES)[number]

export interface FormulaInfo {
  id: string
  category: string
  name: string
  content: string
  created_at: number
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

export type PageKind = 'chart' | 'insight'
export type PageResult = '' | 'pass' | 'fail'
export type MaSpacing = '' | 'converge' | 'diverge'
export type PeriodSymmetry = '' | 'after' | 'before'
export type LeadingSpan2 = '' | 'digested' | 'undigested'

export interface Page {
  id: string
  item_id: string
  kind: PageKind
  result: PageResult
  ma_spacing: MaSpacing
  period_symmetry: PeriodSymmetry
  accumulation_checked: boolean
  leading_span2: LeadingSpan2
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
export const ROOT_STUDY_PLAN_ID = '__STUDY_ROOT__'

export interface StudyPlanNode {
  id: string
  name: string
  parent_id: string | null
  child_ids: string[]
  start_date: string | null
  end_date: string | null
  result_html: string
}

export interface InsightEntry {
  page_id: string
  item_id: string
  item_name: string
  category_id: string
  category_path: string
  content_html: string
  updated_at: number
  image_a: ImageSlot | null
  result: PageResult
  ma_spacing: MaSpacing
  period_symmetry: PeriodSymmetry
  accumulation_checked: boolean
  leading_span2: LeadingSpan2
}

export interface RemindNote {
  id: string
  note_html: string
}

export interface RemindVideo {
  id: string
  title: string
  path: string
  created_at: number
}

export interface RemindFolderVideo {
  name: string
  path: string
  size: number
  modified: number
}

export interface RemindFolder {
  folder: string
  videos: RemindFolderVideo[]
}

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
  moveItemToCategory: (id: string, category_id: string) =>
    request<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify({ category_id }) }),
  deleteItem: (id: string) => request<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),

  listPages: (item_id: string) => request<Page[]>(`/api/pages?item_id=${item_id}`),
  getPage: (id: string) => request<Page>(`/api/pages/${id}`),
  createPage: (item_id: string, kind: PageKind = 'chart') =>
    request<Page>('/api/pages', { method: 'POST', body: JSON.stringify({ item_id, kind }) }),
  listInsights: () => request<InsightEntry[]>('/api/pages/insights'),
  updatePageNote: (id: string, column: 'a' | 'b', note_html: string) =>
    request<Page>(`/api/pages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(column === 'a' ? { note_html_a: note_html } : { note_html_b: note_html }),
    }),
  updatePageResult: (id: string, result: PageResult) =>
    request<Page>(`/api/pages/${id}`, { method: 'PATCH', body: JSON.stringify({ result }) }),
  updatePageChecklist: (
    id: string,
    patch: {
      ma_spacing?: MaSpacing
      period_symmetry?: PeriodSymmetry
      accumulation_checked?: boolean
      leading_span2?: LeadingSpan2
    },
  ) => request<Page>(`/api/pages/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
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

  listCodeInfos: () => request<CodeInfo[]>('/api/code-infos'),
  createCodeInfo: (code: string, description: string) =>
    request<CodeInfo>('/api/code-infos', { method: 'POST', body: JSON.stringify({ code, description }) }),
  updateCodeInfo: (id: string, patch: { code?: string; description?: string }) =>
    request<CodeInfo>(`/api/code-infos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCodeInfo: (id: string) => request<{ ok: boolean }>(`/api/code-infos/${id}`, { method: 'DELETE' }),

  listFormulaInfos: () => request<FormulaInfo[]>('/api/formula-infos'),
  createFormulaInfo: (category: string, name: string, content: string) =>
    request<FormulaInfo>('/api/formula-infos', { method: 'POST', body: JSON.stringify({ category, name, content }) }),
  updateFormulaInfo: (id: string, patch: { category?: string; name?: string; content?: string }) =>
    request<FormulaInfo>(`/api/formula-infos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteFormulaInfo: (id: string) => request<{ ok: boolean }>(`/api/formula-infos/${id}`, { method: 'DELETE' }),

  listStudyPlanNodes: () => request<StudyPlanNode[]>('/api/study-plan-nodes'),
  createStudyPlanNode: (name: string, parent_id: string = ROOT_STUDY_PLAN_ID) =>
    request<StudyPlanNode>('/api/study-plan-nodes', { method: 'POST', body: JSON.stringify({ name, parent_id }) }),
  renameStudyPlanNode: (id: string, name: string) =>
    request<StudyPlanNode>(`/api/study-plan-nodes/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateStudyPlanDates: (id: string, patch: { start_date?: string; end_date?: string }) =>
    request<StudyPlanNode>(`/api/study-plan-nodes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  updateStudyPlanResult: (id: string, result_html: string) =>
    request<StudyPlanNode>(`/api/study-plan-nodes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ result_html }),
    }),
  moveStudyPlanNode: (id: string, direction: 'up' | 'down') =>
    request<{ ok: boolean }>(`/api/study-plan-nodes/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),
  deleteStudyPlanNode: (id: string) =>
    request<{ ok: boolean }>(`/api/study-plan-nodes/${id}`, { method: 'DELETE' }),

  getRemindNote: () => request<RemindNote>('/api/remind/note'),
  updateRemindNote: (note_html: string) =>
    request<RemindNote>('/api/remind/note', { method: 'PATCH', body: JSON.stringify({ note_html }) }),
  getRemindFolder: () => request<RemindFolder>('/api/remind/folder'),
  listRemindVideos: () => request<RemindVideo[]>('/api/remind/videos'),
  uploadRemindVideo: (title: string, file: File) => {
    const form = new FormData()
    form.append('title', title)
    form.append('file', file)
    return request<RemindVideo>('/api/remind/videos', { method: 'POST', body: form })
  },
  renameRemindVideo: (id: string, title: string) =>
    request<RemindVideo>(`/api/remind/videos/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  deleteRemindVideo: (id: string) =>
    request<{ ok: boolean }>(`/api/remind/videos/${id}`, { method: 'DELETE' }),
}
