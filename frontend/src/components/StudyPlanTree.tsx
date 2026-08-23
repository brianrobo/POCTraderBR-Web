import { useState } from 'react'
import { api, ROOT_STUDY_PLAN_ID, type StudyPlanNode } from '../api/client'

interface Props {
  nodes: StudyPlanNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRefresh: () => void
}

function statusClass(node: StudyPlanNode): string {
  if (node.end_date) return 'status-done'
  if (node.start_date) return 'status-progress'
  return 'status-none'
}

export function StudyPlanTree({ nodes, selectedId, onSelect, onRefresh }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT_STUDY_PLAN_ID]))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addChild = async (parentId: string) => {
    const name = window.prompt('노드 이름')
    if (!name) return
    await api.createStudyPlanNode(name, parentId)
    setExpanded((prev) => new Set(prev).add(parentId))
    onRefresh()
  }

  const rename = async (id: string, current: string) => {
    const name = window.prompt('이름 변경', current)
    if (!name || name === current) return
    await api.renameStudyPlanNode(id, name)
    onRefresh()
  }

  const remove = async (id: string) => {
    if (!window.confirm('이 노드를 삭제할까요? (하위 노드가 없어야 합니다)')) return
    try {
      await api.deleteStudyPlanNode(id)
      onRefresh()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  const move = async (id: string, direction: 'up' | 'down') => {
    await api.moveStudyPlanNode(id, direction)
    onRefresh()
  }

  const render = (id: string, depth: number): React.ReactNode => {
    const node = byId.get(id)
    if (!node) return null
    const isExpanded = expanded.has(id)
    const siblingIds = node.parent_id ? (byId.get(node.parent_id)?.child_ids ?? []) : []
    const idx = siblingIds.indexOf(id)
    return (
      <div key={id} className="tree-node">
        <div
          className={`tree-row ${selectedId === id ? 'selected' : ''}`}
          style={{ paddingLeft: depth * 14 }}
          onClick={() => onSelect(id)}
        >
          <button
            className="tree-toggle"
            onClick={(e) => {
              e.stopPropagation()
              toggle(id)
            }}
          >
            {node.child_ids.length > 0 ? (isExpanded ? '▾' : '▸') : ' '}
          </button>
          <span className={`status-dot ${statusClass(node)}`} title="진행 상태" />
          <span
            className="tree-label"
            title={id !== ROOT_STUDY_PLAN_ID ? '더블클릭하여 이름 변경' : undefined}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (id !== ROOT_STUDY_PLAN_ID) rename(id, node.name)
            }}
          >
            {node.name}
          </span>
          <span className="tree-actions">
            <button
              title="하위 노드 추가"
              onClick={(e) => {
                e.stopPropagation()
                addChild(id)
              }}
            >
              +
            </button>
            {id !== ROOT_STUDY_PLAN_ID && (
              <>
                <button
                  title="위로 이동"
                  disabled={idx <= 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    move(id, 'up')
                  }}
                >
                  ▲
                </button>
                <button
                  title="아래로 이동"
                  disabled={idx === -1 || idx === siblingIds.length - 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    move(id, 'down')
                  }}
                >
                  ▼
                </button>
                <button
                  title="삭제"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(id)
                  }}
                >
                  ✕
                </button>
              </>
            )}
          </span>
        </div>
        {isExpanded && node.child_ids.map((childId) => render(childId, depth + 1))}
      </div>
    )
  }

  return <div className="tree-navigator">{render(ROOT_STUDY_PLAN_ID, 0)}</div>
}
