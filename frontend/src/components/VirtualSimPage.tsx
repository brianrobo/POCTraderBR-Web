import { useEffect, useState } from 'react'
import { api, type VirtualSimNote } from '../api/client'
import { NoteEditor } from './NoteEditor'

// Research notes on using/building a real-historical-data trading simulator
// (2026-11-07 kickoff). Just a single editable note for now, same shape as
// the Remind note — add structure here later if the research grows past it.
export function VirtualSimPage() {
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
