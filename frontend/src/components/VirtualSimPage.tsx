import { useState } from 'react'
import { InsightMapPage } from './InsightMapPage'
import { SimulatorPage } from './SimulatorPage'

type View = 'simulator' | 'insights'

const VIEWS: { value: View; label: string }[] = [
  { value: 'simulator', label: '시뮬레이터' },
  { value: 'insights', label: '인사이트 맵' },
]

// Two views: the simulator (a day's chart flow replayed as a quiz) and the
// insight map that gathers what each quiz taught into a tree of rules.
export function VirtualSimPage() {
  const [view, setView] = useState<View>('simulator')
  // Kept here so the map comes back to the same node after a look at a quiz in the simulator.
  const [insightId, setInsightId] = useState<string | null>(null)
  // The quiz the simulator opens on, when it was reached from the insight map.
  const [openQuiz, setOpenQuiz] = useState<{ scenarioId: string; quizId: string } | null>(null)

  return (
    <div className="virtualsim-root">
      <div className="virtualsim-subtabs">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            className={view === v.value ? 'active' : ''}
            onClick={() => {
              setOpenQuiz(null)
              setView(v.value)
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === 'simulator' ? (
        <SimulatorPage open={openQuiz} />
      ) : (
        <InsightMapPage
          selectedId={insightId}
          onSelect={setInsightId}
          onOpenQuiz={(scenarioId, quizId) => {
            setOpenQuiz({ scenarioId, quizId })
            setView('simulator')
          }}
        />
      )}
    </div>
  )
}
