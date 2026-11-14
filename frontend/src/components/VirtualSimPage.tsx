import { useEffect, useState } from 'react'
import { api, type VirtualSimNote } from '../api/client'
import { NoteEditor } from './NoteEditor'
import { SimulatorPage } from './SimulatorPage'

type View = 'simulator' | 'research'

// Two views: the frame simulator (captured chart flows replayed as a buy /
// pass quiz) and the research note on real-historical-data simulators
// (2026-11-07 kickoff) that this tab started as.
export function VirtualSimPage() {
  const [view, setView] = useState<View>('simulator')

  return (
    <div className="virtualsim-root">
      <div className="virtualsim-subtabs">
        <button type="button" className={view === 'simulator' ? 'active' : ''} onClick={() => setView('simulator')}>
          시뮬레이터
        </button>
        <button type="button" className={view === 'research' ? 'active' : ''} onClick={() => setView('research')}>
          리서치 노트
        </button>
      </div>
      {view === 'simulator' ? <SimulatorPage /> : <ResearchNote />}
    </div>
  )
}

function ResearchNote() {
  const [note, setNote] = useState<VirtualSimNote | null>(null)

  useEffect(() => {
    api.getVirtualSimNote().then(setNote)
  }, [])

  return (
    <div className="virtualsim-page">
      <h2 className="remind-heading">Virtual Simul — 리서치</h2>
      {note ? (
        <NoteEditor html={note.note_html} onSave={(html) => api.updateVirtualSimNote(html)} />
      ) : (
        <div className="page-view-loading">로딩 중...</div>
      )}
    </div>
  )
}
