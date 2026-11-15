import { useCallback, useEffect, useState } from 'react'
import {
  api,
  type InsightKind,
  type InsightMap,
  type InsightNode,
  type InsightQuiz,
  type InsightStance,
  type InsightStatus,
} from '../api/client'
import {
  KIND_NAME,
  QUIZ_OUTCOME_NAME,
  STATUS_NAME,
  childrenOf,
  descendantsOf,
  flattenTree,
  pathOf,
  quizFrames,
  tally,
  type Tally,
} from '../lib/insights'
import { formatBarTime } from '../lib/simBars'
import { InsightLinker } from './InsightLinker'

interface Props {
  /** The node shown on the right; null shows the quizzes not filed under any node yet. */
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOpenQuiz: (scenarioId: string, quizId: string) => void
}

const KINDS: InsightKind[] = ['', 'buy', 'avoid', 'wait']
const STATUSES: InsightStatus[] = ['candidate', 'confirmed', 'dropped']
const STANCES: { value: InsightStance; label: string }[] = [
  { value: 'support', label: '지지' },
  { value: 'counter', label: '반례' },
]

function quizTimes(quiz: InsightQuiz): string {
  return quiz.start_time === quiz.bar_time
    ? formatBarTime(quiz.bar_time)
    : `${formatBarTime(quiz.start_time)} ~ ${formatBarTime(quiz.bar_time)}`
}

function tallyText(t: Tally): string {
  const rate = t.graded > 0 ? ` · 연습 정답 ${t.correct}/${t.graded} (${Math.round((t.correct / t.graded) * 100)}%)` : ''
  return `지지 ${t.support} · 반례 ${t.counter}${rate}`
}

function QuizHead({ quiz, onOpen }: { quiz: InsightQuiz; onOpen: () => void }) {
  return (
    <>
      <span className="insight-quiz-name">{quiz.scenario_name}</span>
      <span>{quizFrames(quiz)}</span>
      <span className="sim-dim">{quizTimes(quiz)}</span>
      <span className={`insight-outcome ${quiz.outcome}`}>정답 {QUIZ_OUTCOME_NAME[quiz.outcome]}</span>
      {quiz.graded_count > 0 && (
        <span className="sim-dim">
          연습 정답 {quiz.correct_count}/{quiz.graded_count}
        </span>
      )}
      <button type="button" onClick={onOpen}>
        시뮬레이터에서 열기
      </button>
    </>
  )
}

function QuizNote({ quiz }: { quiz: InsightQuiz }) {
  return quiz.note ? (
    <div className="insight-quiz-note">{quiz.note}</div>
  ) : (
    <div className="sim-hint">해설이 아직 없습니다 — 시뮬레이터 편집 화면의 "선택한 퀴즈"에서 적습니다.</div>
  )
}

// Insight map: what each simulator quiz taught, gathered into a tree until
// common rules show. A node is filed with the quizzes it rests on (and the
// ones that went against it); a rule that keeps showing up gets confirmed.
export function InsightMapPage({ selectedId, onSelect, onOpenQuiz }: Props) {
  const [map, setMap] = useState<InsightMap | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())

  const refresh = useCallback(() => api.getInsightMap().then(setMap), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!map) return <div className="page-view-loading">로딩 중...</div>

  const selected = map.nodes.find((n) => n.id === selectedId) ?? null
  const filed = new Set(map.evidence.map((e) => e.quiz_id))
  const loose = map.quizzes.filter((q) => !filed.has(q.id))

  const toggle = (id: string) => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const addNode = async (parentId: string | null) => {
    const name = window.prompt(parentId ? '하위 항목 이름' : '항목 이름')?.trim()
    if (!name) return
    const node = await api.addInsightNode(name, parentId)
    if (parentId)
      setClosed((prev) => {
        const next = new Set(prev)
        next.delete(parentId)
        return next
      })
    await refresh()
    onSelect(node.id)
  }

  const move = async (id: string, direction: 'up' | 'down') => {
    await api.moveInsightNode(id, direction)
    await refresh()
  }

  const remove = async (node: InsightNode) => {
    if (map.nodes.some((n) => n.parent_id === node.id)) {
      window.alert('하위 항목이 있으면 삭제할 수 없습니다. 먼저 하위 항목을 옮기거나 합치세요.')
      return
    }
    const links = map.evidence.filter((e) => e.node_id === node.id).length
    const detail = links > 0 ? ` 퀴즈 ${links}개와의 연결도 지워집니다 (퀴즈는 그대로 남습니다).` : ''
    if (!window.confirm(`"${node.name}" 항목을 삭제할까요?${detail}`)) return
    await api.deleteInsightNode(node.id)
    if (selectedId === node.id) onSelect(null)
    await refresh()
  }

  return (
    <div className="chartpat-layout">
      <aside className="chartpat-sidebar insight-sidebar">
        <div className="chartpat-sidebar-head">
          <h2 className="remind-heading">인사이트</h2>
          <button type="button" onClick={() => addNode(null)}>
            + 추가
          </button>
        </div>
        <div className="chartpat-tree tree-node">
          <div className={`tree-row ${selected ? '' : 'selected'}`} onClick={() => onSelect(null)}>
            <span className="tree-toggle" />
            <span className="tree-label">취합 전 퀴즈</span>
            <span className="insight-count">{loose.length}</span>
          </div>
          {flattenTree(map.nodes, closed).map(({ node, depth, childCount }) => {
            const siblings = childrenOf(map.nodes, node.parent_id)
            const at = siblings.findIndex((s) => s.id === node.id)
            const t = tally(map, [node.id, ...descendantsOf(map.nodes, node.id)])
            return (
              <div
                key={node.id}
                className={`tree-row insight-row ${node.status} ${selectedId === node.id ? 'selected' : ''}`}
                style={{ paddingLeft: 4 + depth * 14 }}
                onClick={() => onSelect(node.id)}
              >
                <button
                  type="button"
                  className="tree-toggle"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(node.id)
                  }}
                >
                  {childCount > 0 ? (closed.has(node.id) ? '▸' : '▾') : ' '}
                </button>
                <span className={`insight-status ${node.status}`} title={STATUS_NAME[node.status]} />
                <span className="tree-label">{node.name}</span>
                {node.kind && <span className={`insight-kind ${node.kind}`}>{KIND_NAME[node.kind]}</span>}
                {t.support + t.counter > 0 && (
                  <span className="insight-count" title={`${childCount > 0 ? '하위 항목 포함 ' : ''}${tallyText(t)}`}>
                    {t.support}
                    {t.counter > 0 && ` : ${t.counter}`}
                  </span>
                )}
                <span className="tree-actions">
                  <button
                    type="button"
                    title="하위 항목 추가"
                    onClick={(e) => {
                      e.stopPropagation()
                      void addNode(node.id)
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    title="위로 이동"
                    disabled={at <= 0}
                    onClick={(e) => {
                      e.stopPropagation()
                      void move(node.id, 'up')
                    }}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    title="아래로 이동"
                    disabled={at === siblings.length - 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      void move(node.id, 'down')
                    }}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    title="삭제"
                    onClick={(e) => {
                      e.stopPropagation()
                      void remove(node)
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </aside>

      <main className="insight-main">
        {selected ? (
          <NodeDetail
            key={selected.id}
            map={map}
            node={selected}
            refresh={refresh}
            onSelect={onSelect}
            onOpenQuiz={onOpenQuiz}
            onRemove={() => remove(selected)}
          />
        ) : (
          <>
            <h2 className="insight-heading">취합 전 퀴즈</h2>
            <div className="sim-hint">
              시뮬레이터 편집 화면에서 퀴즈마다 적은 해설을 여기서 항목으로 모읍니다. 같은 이야기가 여러 퀴즈에서
              반복되면 한 항목에 모아 `확정`으로 올리고, 그 항목과 어긋난 퀴즈는 `반례`로 연결합니다. 아래는 아직 어느
              항목에도 연결하지 않은 퀴즈입니다.
            </div>
            {loose.length === 0 ? (
              <div className="empty-state">
                {map.quizzes.length === 0
                  ? '아직 퀴즈가 없습니다. 시뮬레이터에서 퀴즈를 만들면 여기에 나옵니다.'
                  : '모든 퀴즈가 항목에 연결되어 있습니다.'}
              </div>
            ) : (
              loose.map((quiz) => (
                <section key={quiz.id} className="insight-evidence">
                  <div className="sim-quiz-row">
                    <QuizHead quiz={quiz} onOpen={() => onOpenQuiz(quiz.scenario_id, quiz.id)} />
                  </div>
                  <QuizNote quiz={quiz} />
                  <div className="sim-quiz-row">
                    <span className="sim-dim">인사이트:</span>
                    <InsightLinker map={map} quizId={quiz.id} onChanged={refresh} />
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </main>
    </div>
  )
}

interface DetailProps {
  map: InsightMap
  node: InsightNode
  refresh: () => Promise<void>
  onSelect: (id: string | null) => void
  onOpenQuiz: (scenarioId: string, quizId: string) => void
  onRemove: () => void
}

function NodeDetail({ map, node, refresh, onSelect, onOpenQuiz, onRemove }: DetailProps) {
  const under = descendantsOf(map.nodes, node.id)
  // Where the node can go: anywhere but under itself.
  const others = flattenTree(map.nodes).filter((row) => row.node.id !== node.id && !under.has(row.node.id))
  const path = pathOf(map.nodes, node.id)
  const quizzes = new Map(map.quizzes.map((q) => [q.id, q]))
  const links = map.evidence.filter((e) => e.node_id === node.id)
  const linked = new Set(links.map((e) => e.quiz_id))
  const own = tally(map, [node.id])

  const patch = async (change: Parameters<typeof api.updateInsightNode>[1]) => {
    await api.updateInsightNode(node.id, change)
    await refresh()
  }

  const merge = async (intoId: string) => {
    const into = map.nodes.find((n) => n.id === intoId)
    if (!into) return
    const message = `"${node.name}" 항목을 "${into.name}"에 합칠까요? 연결된 퀴즈, 하위 항목, 설명이 옮겨지고 이 항목은 없어집니다.`
    if (!window.confirm(message)) return
    await api.mergeInsightNode(node.id, intoId)
    await refresh()
    onSelect(intoId)
  }

  const option = (row: (typeof others)[number]) => (
    <option key={row.node.id} value={row.node.id}>
      {'\u00A0\u00A0'.repeat(row.depth) + row.node.name}
    </option>
  )

  return (
    <>
      <div className="sim-quiz-row">
        <input
          key={node.name}
          type="text"
          className="insight-name"
          aria-label="항목 이름"
          defaultValue={node.name}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => {
            const name = e.target.value.trim()
            if (name && name !== node.name) void patch({ name })
            else e.target.value = node.name
          }}
        />
        <button type="button" className="danger" onClick={onRemove}>
          항목 삭제
        </button>
      </div>
      {path.length > 1 && <div className="sim-hint">{path.slice(0, -1).join(' › ')}</div>}

      <div className="sim-quiz-row">
        <span className="sim-pane-title">성격</span>
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={node.kind === kind ? 'active' : ''}
            onClick={() => patch({ kind })}
          >
            {KIND_NAME[kind]}
          </button>
        ))}
        <span className="sim-pane-title insight-gap">상태</span>
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={node.status === status ? 'active' : ''}
            onClick={() => patch({ status })}
          >
            {STATUS_NAME[status]}
          </button>
        ))}
      </div>

      <div className="sim-quiz-row">
        <span className="sim-pane-title">위치</span>
        <select
          className="insight-select"
          aria-label="상위 항목"
          value={node.parent_id ?? ''}
          onChange={(e) => patch({ parent_id: e.target.value })}
        >
          <option value="">(맨 위 단계)</option>
          {others.map(option)}
        </select>
        <span className="sim-dim">아래로 옮기기</span>
        {others.length > 0 && (
          <select
            className="insight-select insight-gap"
            aria-label="다른 항목에 합치기"
            value=""
            onChange={(e) => {
              if (e.target.value) void merge(e.target.value)
            }}
          >
            <option value="">다른 항목에 합치기…</option>
            {others.map(option)}
          </select>
        )}
      </div>

      <textarea
        key={node.description}
        className="sim-quiz-note"
        rows={3}
        aria-label="설명"
        placeholder="규칙을 한두 문장으로 — 어떤 흐름이면 어떻게 하는지"
        defaultValue={node.description}
        onBlur={(e) => {
          if (e.target.value !== node.description) void patch({ description: e.target.value })
        }}
      />

      <div className="sim-quiz-row">
        <h3 className="insight-heading">근거 퀴즈</h3>
        <span className="sim-dim">{tallyText(own)}</span>
        {under.size > 0 && (
          <span className="sim-dim">(하위 항목 포함: {tallyText(tally(map, [node.id, ...under]))})</span>
        )}
      </div>
      {links.length === 0 && (
        <div className="sim-hint">
          아직 연결한 퀴즈가 없습니다. 아래에서 고르거나, 시뮬레이터 편집 화면의 "선택한 퀴즈"에서 연결합니다.
        </div>
      )}
      {links.map((e) => {
        const quiz = quizzes.get(e.quiz_id)
        if (!quiz) return null
        return (
          <section key={e.id} className={`insight-evidence ${e.stance}`}>
            <div className="sim-quiz-row">
              {STANCES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={e.stance === s.value ? 'active' : ''}
                  onClick={async () => {
                    await api.updateInsightEvidence(e.id, { stance: s.value })
                    await refresh()
                  }}
                >
                  {s.label}
                </button>
              ))}
              <QuizHead quiz={quiz} onOpen={() => onOpenQuiz(quiz.scenario_id, quiz.id)} />
              <button
                type="button"
                onClick={async () => {
                  await api.deleteInsightEvidence(e.id)
                  await refresh()
                }}
              >
                연결 해제
              </button>
            </div>
            <QuizNote quiz={quiz} />
            <input
              key={e.comment}
              type="text"
              className="insight-comment"
              aria-label="코멘트"
              placeholder="이 퀴즈가 이 항목에 대해 말해 주는 것 (선택)"
              defaultValue={e.comment}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') ev.currentTarget.blur()
              }}
              onBlur={async (ev) => {
                if (ev.target.value === e.comment) return
                await api.updateInsightEvidence(e.id, { comment: ev.target.value })
                await refresh()
              }}
            />
          </section>
        )
      })}
      {map.quizzes.some((q) => !linked.has(q.id)) && (
        <div className="sim-quiz-row">
          <select
            className="insight-select"
            aria-label="퀴즈 연결"
            value=""
            onChange={async (e) => {
              if (!e.target.value) return
              await api.linkInsightQuiz(node.id, e.target.value)
              await refresh()
            }}
          >
            <option value="">퀴즈 연결…</option>
            {map.quizzes
              .filter((q) => !linked.has(q.id))
              .map((q) => (
                <option key={q.id} value={q.id}>
                  {q.scenario_name} · {quizFrames(q)}
                  {q.note && ` — ${q.note.length > 40 ? `${q.note.slice(0, 40)}…` : q.note}`}
                </option>
              ))}
          </select>
        </div>
      )}
    </>
  )
}
