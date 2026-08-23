import { useEffect, useState } from 'react'
import { api, type StudyPlanNode } from '../api/client'
import { NoteEditor } from './NoteEditor'

interface Props {
  node: StudyPlanNode
  onRefresh: () => void
}

function statusInfo(node: StudyPlanNode): { label: string; cls: string } {
  if (node.end_date) return { label: '완료', cls: 'status-done' }
  if (node.start_date) return { label: '진행중', cls: 'status-progress' }
  return { label: '미착수', cls: 'status-none' }
}

export function StudyPlanDetail({ node, onRefresh }: Props) {
  const [startDate, setStartDate] = useState(node.start_date ?? '')
  const [endDate, setEndDate] = useState(node.end_date ?? '')

  useEffect(() => {
    setStartDate(node.start_date ?? '')
    setEndDate(node.end_date ?? '')
  }, [node.id, node.start_date, node.end_date])

  const saveStart = async (value: string) => {
    setStartDate(value)
    await api.updateStudyPlanDates(node.id, { start_date: value })
    onRefresh()
  }

  const saveEnd = async (value: string) => {
    setEndDate(value)
    await api.updateStudyPlanDates(node.id, { end_date: value })
    onRefresh()
  }

  const saveResult = async (html: string) => {
    await api.updateStudyPlanResult(node.id, html)
    onRefresh()
  }

  const status = statusInfo(node)

  return (
    <div className="study-plan-detail">
      <div className="study-plan-detail-header">
        <h2 className="item-title">{node.name}</h2>
        <span className={`status-badge ${status.cls}`}>{status.label}</span>
      </div>
      <div className="study-plan-dates">
        <label>
          시작일
          <input type="date" value={startDate} onChange={(e) => saveStart(e.target.value)} />
        </label>
        <label>
          완료일
          <input type="date" value={endDate} onChange={(e) => saveEnd(e.target.value)} />
        </label>
      </div>
      <div className="study-plan-result-label">결과 / 진행 내용</div>
      <NoteEditor key={node.id} html={node.result_html} onSave={saveResult} />
    </div>
  )
}
