import { useRef, useState } from 'react'
import { api, type SimPriceFileInfo, type SimScenario } from '../api/client'
import { formatBarTime, formatClock, formatDate, formatScenarioDate, sessionDay } from '../lib/simBars'

interface Props {
  onCreated: (scenario: SimScenario) => void
  onCancel: () => void
}

// New scenario: pick an exported 1-minute price file, then the day to replay.
// Both charts are drawn from that one file, so nothing else has to be set up;
// capturing chart screenshots stays available for when there is no file.
export function SimScenarioAdd({ onCreated, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<SimPriceFileInfo | null>(null)
  // Start time of the session to replay.
  const [picked, setPicked] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [stockName, setStockName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const choose = async (next: File | undefined) => {
    if (!next) return
    setError(null)
    setInfo(null)
    setPicked(null)
    setFile(next)
    try {
      const found = await api.inspectSimPriceFile(next)
      setInfo(found)
      setPicked(found.sessions.at(-1)?.start ?? null)
    } catch (e) {
      setFile(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const session = info?.sessions.find((s) => s.start === picked)
  const historyBars = info?.sessions.filter((s) => s.start < (picked ?? 0)).reduce((n, s) => n + s.bar_count, 0) ?? 0
  const defaultName = info && picked !== null ? `${formatScenarioDate(sessionDay(picked))} ${info.symbol}`.trim() : ''

  const create = async () => {
    if (!file || picked === null) return
    setBusy(true)
    setError(null)
    try {
      onCreated(await api.importSimScenario(file, picked, name.trim(), stockName.trim()))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const createFromCapture = async () => {
    const captureName = window.prompt('시나리오 이름 (예: 26.11.13 FCUV)')
    if (!captureName) return
    onCreated(await api.createSimScenario(captureName))
  }

  return (
    <div className="sim-body">
      <section
        className="sim-quiz-editor sim-add"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void choose(e.dataTransfer.files[0])
        }}
      >
        <div className="sim-quiz-row">
          <span className="sim-pane-title">① 가격 데이터 파일</span>
          <input
            ref={fileInput}
            type="file"
            accept=".xls,.cdt"
            style={{ display: 'none' }}
            onChange={(e) => {
              void choose(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button type="button" onClick={() => fileInput.current?.click()}>
            파일 선택
          </button>
          {file ? (
            <span>{file.name}</span>
          ) : (
            <span className="sim-dim">
              영웅문 차트에서 저장한 1분봉 데이터 파일(.xls 또는 .cdt)을 고르거나 여기로 끌어다 놓으세요.
            </span>
          )}
        </div>
        {info && (
          <div className="sim-hint">
            {info.symbol} · 1분봉 {info.bar_count.toLocaleString()}개 · {formatBarTime(info.sessions[0].start)} ~{' '}
            {formatBarTime(info.sessions[info.sessions.length - 1].end)}. 30분봉·5분봉은 이 1분봉을 묶어서 그리므로 파일은
            하나면 됩니다.
          </div>
        )}
        {error && <div className="sim-warn">{error}</div>}

        {info && (
          <>
            <div className="sim-quiz-row">
              <span className="sim-pane-title">② 연습할 날짜</span>
              {info.sessions.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  className={s.start === picked ? 'active' : ''}
                  onClick={() => setPicked(s.start)}
                >
                  {formatDate(sessionDay(s.start))} · {s.bar_count}봉
                </button>
              ))}
            </div>
            {session && (
              <div className="sim-hint">
                {formatClock(session.start)} ~ {formatClock(session.end)} · 고가 {session.high.toFixed(4)} · 저가{' '}
                {session.low.toFixed(4)}.{' '}
                {historyBars > 0 ? (
                  `이 날짜보다 앞선 ${historyBars.toLocaleString()}봉은 차트의 과거로 깔립니다.`
                ) : (
                  <span className="sim-warn">
                    이 날짜보다 앞선 데이터가 파일에 없어, 시작할 때 이동평균선과 차트의 과거가 비어 보입니다.
                  </span>
                )}
              </div>
            )}

            <div className="sim-quiz-row">
              <span className="sim-pane-title">③ 이름</span>
              <input
                type="text"
                className="sim-label-input"
                placeholder={defaultName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
              />
            </div>

            <div className="sim-quiz-row">
              <span className="sim-pane-title">④ 종목명</span>
              <input
                type="text"
                className="sim-label-input sim-stock-input"
                placeholder="한글 종목명 (선택) — 목록에서 이름 아래에 표시됩니다"
                value={stockName}
                onChange={(e) => setStockName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
              />
            </div>
          </>
        )}

        <div className="sim-quiz-row">
          <button type="button" className="active" disabled={!file || picked === null || busy} onClick={create}>
            시나리오 만들기
          </button>
          <button type="button" onClick={onCancel}>
            취소
          </button>
        </div>
      </section>

      <div className="sim-hint">
        가격 데이터 파일을 구할 수 없는 차트는{' '}
        <button type="button" onClick={createFromCapture}>
          화면 캡쳐 방식으로 만들기
        </button>{' '}
        — 차트 화면을 한 봉씩 캡쳐해서 넣는 방식입니다.
      </div>
    </div>
  )
}
