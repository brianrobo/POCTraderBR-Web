import type { InsightKind, InsightMap, InsightNode, InsightQuiz, InsightStatus, SimOutcome } from '../api/client'

export const KIND_NAME: Record<InsightKind, string> = { '': '분류', buy: '매수 근거', avoid: '매수 금지', wait: '대기 조건' }
export const STATUS_NAME: Record<InsightStatus, string> = { candidate: '후보', confirmed: '확정', dropped: '폐기' }
export const QUIZ_OUTCOME_NAME: Record<SimOutcome, string> = { profit: '상승', loss: '상승 안 함', '': '미정' }

/** The nodes directly under a node (null: the top level), in their order. */
export function childrenOf(nodes: InsightNode[], parentId: string | null): InsightNode[] {
  return nodes.filter((n) => n.parent_id === parentId).sort((a, b) => a.position - b.position)
}

export interface TreeRow {
  node: InsightNode
  depth: number
  childCount: number
}

/** Every node depth-first, as an open tree lists them; the nodes under a `closed` one are left out. */
export function flattenTree(nodes: InsightNode[], closed: ReadonlySet<string> = new Set()): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const node of childrenOf(nodes, parentId)) {
      const childCount = nodes.filter((n) => n.parent_id === node.id).length
      rows.push({ node, depth, childCount })
      if (!closed.has(node.id)) walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/** Ids of every node under a node. */
export function descendantsOf(nodes: InsightNode[], id: string): Set<string> {
  const found = new Set<string>()
  const walk = (parentId: string) => {
    for (const node of nodes)
      if (node.parent_id === parentId && !found.has(node.id)) {
        found.add(node.id)
        walk(node.id)
      }
  }
  walk(id)
  return found
}

/** Names from the top level down to the node. */
export function pathOf(nodes: InsightNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const names: string[] = []
  for (let node = byId.get(id); node && names.length <= nodes.length; node = byId.get(node.parent_id ?? ''))
    names.unshift(node.name)
  return names
}

export interface Tally {
  /** Quizzes linked as support / as a counter-example. */
  support: number
  counter: number
  /** Graded practice answers at those quizzes, and the correct ones — a quiz counts once. */
  graded: number
  correct: number
}

/** What the given nodes rest on: their linked quizzes and the practice answers there. */
export function tally(map: InsightMap, nodeIds: Iterable<string>): Tally {
  const ids = new Set(nodeIds)
  const quizzes = new Map(map.quizzes.map((q) => [q.id, q]))
  const out: Tally = { support: 0, counter: 0, graded: 0, correct: 0 }
  const counted = new Set<string>()
  for (const e of map.evidence) {
    if (!ids.has(e.node_id)) continue
    out[e.stance] += 1
    const quiz = quizzes.get(e.quiz_id)
    if (!quiz || counted.has(quiz.id)) continue
    counted.add(quiz.id)
    out.graded += quiz.graded_count
    out.correct += quiz.correct_count
  }
  return out
}

/** "프레임 787~846", or "프레임 787" for a quiz about a single moment. */
export function quizFrames(quiz: InsightQuiz): string {
  return quiz.start_frame === quiz.end_frame
    ? `프레임 ${quiz.end_frame}`
    : `프레임 ${quiz.start_frame}~${quiz.end_frame}`
}
