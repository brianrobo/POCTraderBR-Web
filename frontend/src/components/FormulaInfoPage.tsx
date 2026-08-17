import { useEffect, useRef, useState } from 'react'
import { api, FORMULA_CATEGORIES, type CodeInfo, type FormulaInfo } from '../api/client'

function CodeInfoRow({
  item,
  onChanged,
  onDelete,
}: {
  item: CodeInfo
  onChanged: (i: CodeInfo) => void
  onDelete: (id: string) => void
}) {
  const [code, setCode] = useState(item.code)
  const [description, setDescription] = useState(item.description)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    setCode(item.code)
    setDescription(item.description)
  }, [item.id])

  const scheduleSave = (patch: { code?: string; description?: string }) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      const updated = await api.updateCodeInfo(item.id, patch)
      onChanged(updated)
    }, 500)
  }

  return (
    <div className="ref-row">
      <input
        className="ref-code-input"
        value={code}
        onChange={(e) => {
          setCode(e.target.value)
          scheduleSave({ code: e.target.value })
        }}
      />
      <input
        className="ref-desc-input"
        value={description}
        onChange={(e) => {
          setDescription(e.target.value)
          scheduleSave({ description: e.target.value })
        }}
      />
      <button type="button" onClick={() => onDelete(item.id)}>
        ✕
      </button>
    </div>
  )
}

function FormulaInfoRow({
  item,
  onChanged,
  onDelete,
}: {
  item: FormulaInfo
  onChanged: (f: FormulaInfo) => void
  onDelete: (id: string) => void
}) {
  const [category, setCategory] = useState(item.category)
  const [name, setName] = useState(item.name)
  const [content, setContent] = useState(item.content)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    setCategory(item.category)
    setName(item.name)
    setContent(item.content)
  }, [item.id])

  const scheduleSave = (patch: { category?: string; name?: string; content?: string }) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      const updated = await api.updateFormulaInfo(item.id, patch)
      onChanged(updated)
    }, 500)
  }

  return (
    <div className="formula-row">
      <div className="formula-row-header">
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            scheduleSave({ category: e.target.value })
          }}
        >
          {FORMULA_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          className="formula-name-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            scheduleSave({ name: e.target.value })
          }}
        />
        <button type="button" onClick={() => onDelete(item.id)}>
          ✕
        </button>
      </div>
      <textarea
        className="formula-content-input"
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          scheduleSave({ content: e.target.value })
        }}
        rows={5}
        spellCheck={false}
      />
    </div>
  )
}

export function FormulaInfoPage() {
  const [codeInfos, setCodeInfos] = useState<CodeInfo[]>([])
  const [formulaInfos, setFormulaInfos] = useState<FormulaInfo[]>([])
  const [newCode, setNewCode] = useState('')
  const [newCodeDesc, setNewCodeDesc] = useState('')
  const [newFormulaCategory, setNewFormulaCategory] = useState<string>(FORMULA_CATEGORIES[0])
  const [newFormulaName, setNewFormulaName] = useState('')
  const [newFormulaContent, setNewFormulaContent] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('전체')

  useEffect(() => {
    api.listCodeInfos().then(setCodeInfos)
    api.listFormulaInfos().then(setFormulaInfos)
  }, [])

  const addCodeInfo = async () => {
    if (!newCode.trim()) return
    const created = await api.createCodeInfo(newCode.trim(), newCodeDesc.trim())
    setCodeInfos((prev) => [...prev, created])
    setNewCode('')
    setNewCodeDesc('')
  }

  const removeCodeInfo = async (id: string) => {
    await api.deleteCodeInfo(id)
    setCodeInfos((prev) => prev.filter((c) => c.id !== id))
  }

  const addFormulaInfo = async () => {
    if (!newFormulaName.trim()) return
    const created = await api.createFormulaInfo(newFormulaCategory, newFormulaName.trim(), newFormulaContent)
    setFormulaInfos((prev) => [...prev, created])
    setNewFormulaName('')
    setNewFormulaContent('')
  }

  const removeFormulaInfo = async (id: string) => {
    await api.deleteFormulaInfo(id)
    setFormulaInfos((prev) => prev.filter((f) => f.id !== id))
  }

  const filteredFormulas =
    categoryFilter === '전체' ? formulaInfos : formulaInfos.filter((f) => f.category === categoryFilter)

  return (
    <div className="reference-page">
      <section className="reference-section">
        <h2>코드 정보</h2>
        <div className="ref-list">
          {codeInfos.map((c) => (
            <CodeInfoRow
              key={c.id}
              item={c}
              onChanged={(u) => setCodeInfos((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
              onDelete={removeCodeInfo}
            />
          ))}
          {codeInfos.length === 0 && <div className="ref-empty">등록된 코드가 없습니다</div>}
        </div>
        <div className="ref-add-row">
          <input
            className="ref-code-input"
            placeholder="코드 (예: 1234)"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
          />
          <input
            className="ref-desc-input"
            placeholder="의미"
            value={newCodeDesc}
            onChange={(e) => setNewCodeDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCodeInfo()
            }}
          />
          <button type="button" onClick={addCodeInfo}>
            + 추가
          </button>
        </div>
      </section>

      <section className="reference-section">
        <div className="reference-section-header">
          <h2>수식 정보</h2>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="전체">전체</option>
            {FORMULA_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="formula-list">
          {filteredFormulas.map((f) => (
            <FormulaInfoRow
              key={f.id}
              item={f}
              onChanged={(u) => setFormulaInfos((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
              onDelete={removeFormulaInfo}
            />
          ))}
          {filteredFormulas.length === 0 && <div className="ref-empty">등록된 수식이 없습니다</div>}
        </div>
        <div className="formula-add-form">
          <div className="formula-add-row">
            <select value={newFormulaCategory} onChange={(e) => setNewFormulaCategory(e.target.value)}>
              {FORMULA_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className="formula-name-input"
              placeholder="수식 이름"
              value={newFormulaName}
              onChange={(e) => setNewFormulaName(e.target.value)}
            />
          </div>
          <textarea
            className="formula-content-input"
            placeholder="수식 내용"
            value={newFormulaContent}
            onChange={(e) => setNewFormulaContent(e.target.value)}
            rows={4}
            spellCheck={false}
          />
          <button type="button" onClick={addFormulaInfo}>
            + 수식 추가
          </button>
        </div>
      </section>
    </div>
  )
}
