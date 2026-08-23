import { useEffect, useState } from 'react'
import { api, ROOT_STUDY_PLAN_ID, type StudyPlanNode } from '../api/client'
import { StudyPlanTree } from './StudyPlanTree'
import { StudyPlanDetail } from './StudyPlanDetail'

export function StudyPlanPage() {
  const [nodes, setNodes] = useState<StudyPlanNode[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = async () => {
    const list = await api.listStudyPlanNodes()
    setNodes(list)
  }

  useEffect(() => {
    refresh()
  }, [])

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null

  return (
    <div className="study-plan-page">
      <aside className="sidebar study-plan-tree-pane">
        <div className="tree-scroll">
          <StudyPlanTree nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} onRefresh={refresh} />
        </div>
      </aside>
      <main className="main-panel">
        {selectedNode && selectedNode.id !== ROOT_STUDY_PLAN_ID ? (
          <StudyPlanDetail node={selectedNode} onRefresh={refresh} />
        ) : (
          <div className="empty-state">왼쪽에서 계획 노드를 선택하거나 추가하세요.</div>
        )}
      </main>
    </div>
  )
}
