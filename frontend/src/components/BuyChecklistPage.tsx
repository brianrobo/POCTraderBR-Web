import { Fragment, useEffect, useRef, useState } from 'react'
import { api, type BuyCheckAnswer, type BuyCheckVerdict, type BuyChecklistSettings } from '../api/client'

// Ported from the standalone BuyChecklist desktop app (D:\___POCTraderBR_BuyChecklist)
// so the 영웅문 체크리스트를 웹 서버 탭에서도 그대로 쓸 수 있게. Rules/copy mirror
// buy_checklist/rules.py and ui/app.py exactly. Window-only concerns (always-on-top,
// see-through-while-idle, saved screen position) don't apply to a browser tab and
// were dropped; everything else (lock-at-midnight, 작전 타임, verdict logging) matches.

interface CheckItem {
  id: string
  title: string
  passAnswer: BuyCheckAnswer
  defaultDescription: string
  failMessage?: string
  failTimeoutMinutes?: number
}

const CHECK_ITEMS: CheckItem[] = [
  {
    id: 'double_burst',
    title: '① 두 번 터졌냐?',
    passAnswer: 'no',
    defaultDescription:
      '큰 파동 이후 고점 돌파 과정에서 1분봉 대량거래를 동반한 돌파 시도가 2회 이상 발생했는지 확인.\n두 번 이상 터졌다면 물량 넘김/배분 가능성을 의심하여 제외.',
  },
  {
    id: 'held_open_small_wave',
    title: '② 시가 지키고 작은 파동 만들었냐?',
    passAnswer: 'yes',
    defaultDescription:
      '첫 큰 상승 파동 이후 조정 과정에서 큰 파동의 시가를 지키고, 그 위에서 작은 상승 파동을 형성했는지 확인.',
  },
  {
    id: 'accumulation_zone',
    title: '③ 매집구간 확인? 사각형 그렸나?',
    passAnswer: 'yes',
    defaultDescription: '매수 전에 매집구간을 확인하고 차트에 사각형으로 그렸는지 점검.',
  },
  {
    id: 'burst_before_breakout',
    title: '④ 돌파 전에 터졌냐?',
    passAnswer: 'no',
    defaultDescription:
      '작은 파동의 고점을 돌파하기 전에 1분봉 거래량이 연속적으로 과도하게 터졌는지 확인.\n이미 거래량이 과열됐다면 가짜 돌파/배분 가능성을 보고 제외.',
  },
  {
    id: 'recent_loss',
    title: '⑤ 매매 실패했나?',
    passAnswer: 'no',
    defaultDescription:
      '직전 매매에서 손실을 봤는지 확인.\n실패 직후에는 손실을 만회하려는 뇌동매매가 나오기 쉬우므로 매수하지 않는다.',
    failMessage: '실패 시 복구하려고 뇌동매매 금지',
    failTimeoutMinutes: 30,
  },
]

const MOTTO_LINES = ['익숙한 패턴이 나오면', '매수 시작이 아니라 체크 시작이다.']
const TRADE_NOTE_LINES = [
  '짧은 돌파 바로 익절! (이걸 반복한다)',
  '돌파 형태만 보고 매수 X (매집구간, 물량넘긴 흔적X 확인필)',
  '이격도 볼것 (들어갈때 이격도 큰부분에서는 X)',
]
const TRADE_NOTE_BEFORE = 'recent_loss'

const VERDICT_STYLE: Record<'checking' | BuyCheckVerdict, { label: string; color: string }> = {
  checking: { label: '체크 중', color: '#8a8a8a' },
  blocked: { label: '매수 금지', color: '#d93636' },
  review: { label: '매수 검토 가능', color: '#2e9d4f' },
}

const TIMEOUT_KEY = 'poctrader:buyChecklist:timeoutUntil'

type Answers = Record<string, BuyCheckAnswer | null>

function isPass(item: CheckItem, answer: BuyCheckAnswer | null | undefined): boolean | null {
  if (!answer) return null
  return answer === item.passAnswer
}

function evaluate(answers: Answers): 'checking' | BuyCheckVerdict {
  const results = CHECK_ITEMS.map((item) => isPass(item, answers[item.id]))
  if (results.some((r) => r === false)) return 'blocked'
  if (results.every((r) => r === true)) return 'review'
  return 'checking'
}

function loadTimeoutUntil(): number | null {
  const raw = Number(localStorage.getItem(TIMEOUT_KEY))
  return Number.isFinite(raw) && raw > Date.now() ? raw : null
}

function formatClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function descriptionFor(item: CheckItem, settings: BuyChecklistSettings | null): string {
  return (settings && settings.descriptions[item.id]) || item.defaultDescription
}

export function BuyChecklistPage() {
  const [settings, setSettings] = useState<BuyChecklistSettings | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [now, setNow] = useState(() => new Date())
  const [sessionDate, setSessionDate] = useState(() => new Date().toDateString())
  const [locked, setLocked] = useState(false)
  const [blinkOn, setBlinkOn] = useState(true)
  const [timeoutUntil, setTimeoutUntil] = useState<number | null>(loadTimeoutUntil)
  const [showSettings, setShowSettings] = useState(false)
  const lastVerdictRef = useRef<'checking' | BuyCheckVerdict>('checking')

  useEffect(() => {
    api.getBuyChecklistSettings().then(setSettings)
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (timeoutUntil) localStorage.setItem(TIMEOUT_KEY, String(timeoutUntil))
    else localStorage.removeItem(TIMEOUT_KEY)
  }, [timeoutUntil])

  // Date change (midnight) locks the checklist; a saved 작전 타임 that has
  // elapsed clears itself — both checked every tick, same as the desktop app.
  useEffect(() => {
    if (!locked && now.toDateString() !== sessionDate) setLocked(true)
    if (timeoutUntil && Date.now() >= timeoutUntil) {
      setTimeoutUntil(null)
      setAnswers({})
      lastVerdictRef.current = 'checking'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now])

  const isLocked = locked || timeoutUntil !== null
  const liveVerdict = evaluate(answers)
  // Blink both for the midnight lock and for a plain 매수 금지 verdict; the
  // 작전 타임 countdown stays solid (never blinked, even in the original app).
  const shouldBlink = locked || (!timeoutUntil && liveVerdict === 'blocked')

  useEffect(() => {
    const t = window.setInterval(() => setBlinkOn((prev) => (shouldBlink ? !prev : true)), 500)
    return () => window.clearInterval(t)
  }, [shouldBlink])

  // Log every time a *decision* (blocked/review) is newly reached — not on
  // every click, and not while locked/timed-out (those paths log on their
  // own trigger instead).
  useEffect(() => {
    if (locked || timeoutUntil) return
    if (liveVerdict !== lastVerdictRef.current && liveVerdict !== 'checking') {
      void api.createBuyCheckLog({ verdict: liveVerdict, answers }).catch(() => undefined)
    }
    lastVerdictRef.current = liveVerdict
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, locked, timeoutUntil])

  const startTimeout = async (minutes: number, snapshot: Answers) => {
    setTimeoutUntil(Date.now() + minutes * 60_000)
    lastVerdictRef.current = 'blocked'
    try {
      await api.createBuyCheckLog({ verdict: 'blocked', answers: snapshot, note: `작전 타임 ${minutes}분` })
    } catch {
      // logging must never get in the way of the checklist
    }
  }

  const handleAnswer = (item: CheckItem, clicked: BuyCheckAnswer) => {
    if (isLocked) return
    const current = answers[item.id] ?? null
    const nextAnswer = current === clicked ? null : clicked
    const nextAnswers = { ...answers, [item.id]: nextAnswer }
    setAnswers(nextAnswers)

    if (item.failTimeoutMinutes && isPass(item, nextAnswer) === false) {
      const minutes = item.failTimeoutMinutes
      const ok = window.confirm(
        `${item.failMessage}\n\n즉시 거래를 중단하고 ${minutes}분간 작전 타임을 시작합니다.\n시작하면 ${minutes}분 동안 체크할 수 없습니다.`,
      )
      if (ok) {
        void startTimeout(minutes, nextAnswers)
      } else {
        setAnswers((prev) => ({ ...prev, [item.id]: null })) // mis-click: undo instead of locking
      }
    }
  }

  const handleReset = () => {
    if (locked) {
      if (!window.confirm('자정이 지나 매수 금지 상태입니다.\n잠금을 해제하고 오늘 체크를 새로 시작할까요?')) return
      setLocked(false)
      setSessionDate(new Date().toDateString())
      setAnswers({})
      lastVerdictRef.current = 'checking'
      return
    }
    if (isLocked) return // 작전 타임 중에는 초기화 비활성화(아래 disabled)되므로 여기 도달하지 않음
    setAnswers({})
  }

  const saveSettings = async (descriptions: Record<string, string>) => {
    const updated = await api.updateBuyChecklistSettings(descriptions)
    setSettings(updated)
    setShowSettings(false)
  }

  if (!settings) return <div className="page-view-loading">로딩 중...</div>

  let verdictLabel: string
  if (locked) {
    verdictLabel = VERDICT_STYLE.blocked.label
  } else if (timeoutUntil) {
    const left = Math.max(Math.floor((timeoutUntil - now.getTime()) / 1000), 0)
    verdictLabel = `작전 타임 ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
  } else {
    verdictLabel = VERDICT_STYLE[liveVerdict].label
  }

  let verdictBg: string
  let verdictFg = 'white'
  if (shouldBlink) {
    if (blinkOn) {
      verdictBg = VERDICT_STYLE.blocked.color
    } else {
      verdictBg = 'transparent'
      verdictFg = VERDICT_STYLE.blocked.color
    }
  } else if (timeoutUntil) {
    verdictBg = VERDICT_STYLE.blocked.color
  } else {
    verdictBg = VERDICT_STYLE[liveVerdict].color
  }

  return (
    <div className="buychk-page">
      <div className="buychk-clock">{formatClock(now)}</div>
      <div className="buychk-motto">
        {MOTTO_LINES.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>

      <div className="buychk-body">
        {CHECK_ITEMS.map((item) => {
          const answer = answers[item.id] ?? null
          const failed = isPass(item, answer) === false
          return (
            <Fragment key={item.id}>
              {item.id === TRADE_NOTE_BEFORE && (
                <div className="buychk-trade-note">
                  <div className="buychk-trade-note-title">[매매]</div>
                  <ul>
                    {TRADE_NOTE_LINES.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="buychk-row">
                <div className="buychk-row-title" title={descriptionFor(item, settings)}>
                  {item.title}
                </div>
                <div className="buychk-row-buttons">
                  <button
                    type="button"
                    disabled={isLocked}
                    className={`buychk-answer ${answer === 'yes' ? (isPass(item, 'yes') ? 'pass' : 'fail') : ''}`}
                    onClick={() => handleAnswer(item, 'yes')}
                  >
                    예
                  </button>
                  <button
                    type="button"
                    disabled={isLocked}
                    className={`buychk-answer ${answer === 'no' ? (isPass(item, 'no') ? 'pass' : 'fail') : ''}`}
                    onClick={() => handleAnswer(item, 'no')}
                  >
                    아니오
                  </button>
                </div>
                {failed && item.failMessage && <div className="buychk-row-warning">{item.failMessage}</div>}
              </div>
            </Fragment>
          )
        })}
      </div>

      <div className="buychk-verdict" style={{ background: verdictBg, color: verdictFg }}>
        {verdictLabel}
      </div>
      <div className="buychk-actions">
        <button type="button" disabled={!locked && isLocked} onClick={handleReset}>
          {locked ? '잠금 해제' : '초기화'}
        </button>
        <button type="button" onClick={() => setShowSettings(true)}>
          설정
        </button>
      </div>

      {showSettings && (
        <BuyChecklistSettingsDialog
          descriptions={settings.descriptions}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}
    </div>
  )
}

function BuyChecklistSettingsDialog({
  descriptions,
  onClose,
  onSave,
}: {
  descriptions: Record<string, string>
  onClose: () => void
  onSave: (descriptions: Record<string, string>) => void
}) {
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(CHECK_ITEMS.map((item) => [item.id, descriptions[item.id] || item.defaultDescription])),
  )

  const restoreDefaults = () => {
    setTexts(Object.fromEntries(CHECK_ITEMS.map((item) => [item.id, item.defaultDescription])))
  }

  const save = () => {
    const next: Record<string, string> = {}
    for (const item of CHECK_ITEMS) {
      const text = (texts[item.id] ?? '').trim()
      if (text && text !== item.defaultDescription) next[item.id] = text
    }
    onSave(next)
  }

  return (
    <div className="clip-dialog-backdrop" onClick={onClose}>
      <div className="clip-dialog buychk-settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="clip-dialog-head">
          <span>설정</span>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="buychk-settings-list">
          {CHECK_ITEMS.map((item) => (
            <div key={item.id} className="buychk-settings-item">
              <div className="buychk-settings-item-title">{item.title}</div>
              <div className="buychk-settings-item-pass">통과 조건: {item.passAnswer === 'yes' ? '예' : '아니오'}</div>
              <textarea
                rows={3}
                value={texts[item.id] ?? ''}
                onChange={(e) => setTexts((prev) => ({ ...prev, [item.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="buychk-settings-actions">
          <button type="button" onClick={restoreDefaults}>
            기본값 복원
          </button>
          <span className="buychk-settings-spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="button" onClick={save}>
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
