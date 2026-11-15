import { useCallback, useEffect, useState } from 'react'
import { api, type BackupStatus as Status } from '../api/client'

const REFRESH_MS = 10 * 60 * 1000
// The server makes a copy a day; two days without one means something is wrong.
const STALE_MS = 48 * 60 * 60 * 1000

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// When the content was last known to be safely copied: the last successful run
// (which may have found nothing new to copy), else the newest snapshot.
function lastGoodMs(status: Status): number | null {
  if (status.last_run?.ok) return status.last_run.time * 1000
  if (status.latest) return new Date(status.latest.created).getTime()
  return null
}

// Small indicator at the end of the tab bar. The content lives only on this
// PC, so a backup that quietly stopped working has to be visible.
export function BackupStatus() {
  const [status, setStatus] = useState<Status | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    api.getBackupStatus().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  if (!status) return null

  async function runNow() {
    setRunning(true)
    setError(null)
    try {
      setStatus(await api.runBackup())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      refresh()
    } finally {
      setRunning(false)
    }
  }

  const good = lastGoodMs(status)
  const failed = error ?? (status.last_run && !status.last_run.ok ? status.last_run.error ?? '알 수 없는 오류' : null)
  const warned = (status.latest?.warnings ?? 0) > 0
  let level: 'ok' | 'warn' | 'bad' = 'ok'
  let text: string
  if (running) {
    text = '백업 중…'
  } else if (failed) {
    level = 'bad'
    text = '백업 실패'
  } else if (good === null) {
    level = 'warn'
    text = '백업 없음'
  } else {
    if (Date.now() - good > STALE_MS || warned) level = 'warn'
    text = `백업 ${formatTime(good)}`
  }

  const title = [
    failed ? `실패: ${failed}` : null,
    warned ? '최근 백업에 복사하지 못한 파일이 있습니다' : null,
    good !== null ? `마지막으로 확인된 백업: ${formatTime(good)}` : '아직 백업이 없습니다',
    `위치: ${status.dest} (${status.count}개)`,
    status.same_drive ? '주의: 프로그램과 같은 드라이브입니다' : null,
    status.auto ? '서버가 하루에 한 번 자동으로 백업합니다' : '자동 백업이 꺼져 있습니다',
    '누르면 지금 백업합니다',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <button type="button" className={`backup-status ${level}`} title={title} disabled={running} onClick={runNow}>
      <span className="backup-dot" />
      {text}
    </button>
  )
}
