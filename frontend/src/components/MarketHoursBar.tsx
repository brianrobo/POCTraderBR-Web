import { useEffect, useState } from 'react'

type Session = 'pre' | 'regular' | 'after' | 'closed'

interface SessionInfo {
  session: Session
  label: string
  nowKst: string
  etHour: number
}

interface TimetableTick {
  etHour: number
  kst: string
  session: Session
}

const ET_ZONE = 'America/New_York'
const KST_ZONE = 'Asia/Seoul'

// US market runs 04:00 pre-market through 20:00 after-hours close, ET.
const ET_HOURS = Array.from({ length: 17 }, (_, i) => i + 4) // 4..20

// Given a wall-clock time expressed in `timeZone`, returns the Date (UTC instant)
// it corresponds to. Needed because the US market's session boundaries are fixed
// ET wall-clock times (04:00/09:30/16:00/20:00) whose UTC/KST equivalent shifts
// with EDT/EST — there is no built-in "construct a Date from a zoned time" API.
//
// Must go through Intl.DateTimeFormat.formatToParts rather than
// toLocaleString()+`new Date(string)`: that round-trip re-parses the string as
// the *browser's own local timezone*, silently mixing the viewer's local
// offset into the result (e.g. a KST browser would double-count +9h).
// formatToParts has no such dependency on the executing environment's zone.
function getUtcForZonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const part of dtf.formatToParts(utcGuess)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  const diff = asIfUtc - utcGuess.getTime()
  return new Date(utcGuess.getTime() - diff)
}

function formatKst(date: Date): string {
  return date.toLocaleTimeString('ko-KR', { timeZone: KST_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
}

function sessionForMinutes(etMinutes: number): Session {
  if (etMinutes >= 4 * 60 && etMinutes < 9 * 60 + 30) return 'pre'
  if (etMinutes >= 9 * 60 + 30 && etMinutes < 16 * 60) return 'regular'
  if (etMinutes >= 16 * 60 && etMinutes < 20 * 60) return 'after'
  return 'closed'
}

function computeSessionInfo(now: Date): SessionInfo {
  const etWeekday = now.toLocaleDateString('en-US', { timeZone: ET_ZONE, weekday: 'short' })
  const etTimeStr = now.toLocaleTimeString('en-GB', { timeZone: ET_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
  const [etH, etM] = etTimeStr.split(':').map(Number)
  const etMinutes = etH * 60 + etM
  const isWeekend = etWeekday === 'Sat' || etWeekday === 'Sun'

  const labels: Record<Session, string> = {
    pre: '프리마켓',
    regular: '정규장',
    after: '애프터마켓',
    closed: '휴장',
  }
  const session: Session = isWeekend ? 'closed' : sessionForMinutes(etMinutes)

  return {
    session,
    label: labels[session],
    nowKst: formatKst(now),
    etHour: etH,
  }
}

function computeTimetable(now: Date): TimetableTick[] {
  const etDateStr = now.toLocaleDateString('en-CA', { timeZone: ET_ZONE }) // "YYYY-MM-DD"
  const [y, m, d] = etDateStr.split('-').map(Number)
  return ET_HOURS.map((etHour) => ({
    etHour,
    kst: formatKst(getUtcForZonedTime(y, m, d, etHour, 0, ET_ZONE)),
    session: sessionForMinutes(etHour * 60),
  }))
}

// KST clock time of an ET wall-clock time today — shifts with US daylight
// saving, so it's computed rather than hard-coded.
function computeKstAtEt(now: Date, etHour: number, etMinute: number): string {
  const etDateStr = now.toLocaleDateString('en-CA', { timeZone: ET_ZONE })
  const [y, m, d] = etDateStr.split('-').map(Number)
  return formatKst(getUtcForZonedTime(y, m, d, etHour, etMinute, ET_ZONE))
}

// Columns are centered on their hour: the 9:00 and 10:00 columns meet at 9:30,
// and the 16:00 column's center is 16:00 itself.
const OPEN_LINE_LEFT_COLUMNS = ET_HOURS.indexOf(9) + 1
const CLOSE_LINE_LEFT_COLUMNS = ET_HOURS.indexOf(16) + 0.5

export function MarketHoursBar() {
  const [info, setInfo] = useState<SessionInfo>(() => computeSessionInfo(new Date()))
  const [ticks, setTicks] = useState<TimetableTick[]>(() => computeTimetable(new Date()))
  const [openKst, setOpenKst] = useState(() => computeKstAtEt(new Date(), 9, 30))
  const [closeKst, setCloseKst] = useState(() => computeKstAtEt(new Date(), 16, 0))

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date()
      setInfo(computeSessionInfo(now))
      setTicks(computeTimetable(now))
      setOpenKst(computeKstAtEt(now, 9, 30))
      setCloseKst(computeKstAtEt(now, 16, 0))
    }, 15000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="market-hours-bar">
      <div className="market-status-line">
        <span className={`market-status market-status-${info.session}`}>
          <span className="market-status-dot" />
          {info.label}
        </span>
        <span className="market-now">KST {info.nowKst}</span>
        <span className="market-open-label">
          <span className="market-open-swatch" />
          미장 개장 KST {openKst} (ET 9:30)
        </span>
        <span className="market-close-label">
          <span className="market-close-swatch" />
          정규장 종료 KST {closeKst} (ET 16:00)
        </span>
      </div>
      <div className="market-timetable">
        <div className="market-timetable-inner">
        <div
          className="market-open-line"
          style={{ left: `calc(var(--tick-w) * ${OPEN_LINE_LEFT_COLUMNS})` }}
          title={`정규장 개장 ET 9:30 = KST ${openKst}`}
        />
        <div
          className="market-close-line"
          style={{ left: `calc(var(--tick-w) * ${CLOSE_LINE_LEFT_COLUMNS})` }}
          title={`정규장 종료 ET 16:00 = KST ${closeKst}`}
        />
        <div className="market-timetable-row">
          {ticks.map((t) => (
            <span
              key={t.etHour}
              className={`market-tick market-tick-${t.session} ${t.etHour === info.etHour ? 'now' : ''}`}
            >
              {t.etHour}:00
            </span>
          ))}
        </div>
        <div className="market-timetable-row">
          {ticks.map((t) => (
            <span
              key={t.etHour}
              className={`market-tick market-tick-${t.session} ${t.etHour === info.etHour ? 'now' : ''}`}
            >
              {t.kst}
            </span>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}
