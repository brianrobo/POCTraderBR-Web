import { api, type InsightMap, type InsightStance } from '../api/client'
import { flattenTree, pathOf } from '../lib/insights'

interface Props {
  map: InsightMap
  quizId: string
  /** After a link or a node was added, changed or removed. */
  onChanged: () => void | Promise<unknown>
}

const STANCE_NAME: Record<InsightStance, string> = { support: '지지', counter: '반례' }

// The insight nodes one simulator quiz is filed under: a chip per node
// (support or counter-example), and a picker that files it under one more.
export function InsightLinker({ map, quizId, onChanged }: Props) {
  const links = map.evidence.filter((e) => e.quiz_id === quizId)
  const linked = new Set(links.map((e) => e.node_id))
  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  const open = flattenTree(map.nodes).filter((row) => !linked.has(row.node.id))

  const link = async (nodeId: string) => {
    await api.linkInsightQuiz(nodeId, quizId)
    await onChanged()
  }

  const linkNew = async () => {
    const name = window.prompt('새 인사이트 항목 이름 (인사이트 맵의 맨 위 단계에 후보로 만들어집니다)')?.trim()
    if (!name) return
    const node = await api.addInsightNode(name)
    await link(node.id)
  }

  return (
    <span className="insight-linker">
      {links.map((e) => (
        <span key={e.id} className={`insight-chip ${e.stance}`} title={pathOf(map.nodes, e.node_id).join(' › ')}>
          <span className="insight-chip-name">{byId.get(e.node_id)?.name}</span>
          <button
            type="button"
            title="지지 사례 / 반례 바꾸기"
            onClick={async () => {
              await api.updateInsightEvidence(e.id, { stance: e.stance === 'support' ? 'counter' : 'support' })
              await onChanged()
            }}
          >
            {STANCE_NAME[e.stance]}
          </button>
          <button
            type="button"
            title="연결 해제"
            onClick={async () => {
              await api.deleteInsightEvidence(e.id)
              await onChanged()
            }}
          >
            ✕
          </button>
        </span>
      ))}
      {open.length > 0 && (
        <select
          className="insight-select"
          aria-label="인사이트 항목 연결"
          value=""
          onChange={(e) => {
            if (e.target.value) void link(e.target.value)
          }}
        >
          <option value="">항목에 연결…</option>
          {open.map(({ node, depth }) => (
            <option key={node.id} value={node.id}>
              {'\u00A0\u00A0'.repeat(depth) + node.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" onClick={linkNew}>
        + 새 항목
      </button>
    </span>
  )
}
