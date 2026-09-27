import { Fragment, useEffect, useRef, useState } from 'react'
import { api, type Page, type RemindFolder, type RemindNote, type RemindVideo, type Stroke } from '../api/client'
import { NoteEditor } from './NoteEditor'

const APPROACH_STEPS = [
  {
    before: '',
    key: '물량을 아직 많이 넘기지 않았다',
    after: '',
    tone: 'premise',
    tag: '전제',
    comment: '차트·거래량으로 본 판단이다. 실제 보유 물량을 확정할 수는 없다.',
    detail: {
      summary: '상세 보기 — 소거법으로 종목 선정',
      lead: '“아직 안 넘겼다”를 증명하려 하기보다, 물량을 많이 넘긴 경우를 먼저 찾아 걸러낸다(소거법).',
      itemsTitle: '물량을 넘기는 구간의 예 (해당하면 제외)',
      items: [
        <>
          <strong>고점에서 돌파 이후</strong>
        </>,
        <>
          <strong>상승하면서 거래량이 엄청 많이 터질 때</strong>
        </>,
      ],
    },
  },
  {
    before: '현재 구간이 ',
    key: '실제 매집',
    after: '이라면',
    tone: 'hypothesis',
    tag: '가설',
    comment: '매집 자체도 하나의 가설이다. 차트와 거래량만으로 실제 주체의 물량이나 의도를 확정할 수 없다.',
  },
  {
    before: '이후 가격은 ',
    key: '매집 구간 위',
    after: '로 나와야 한다',
    tone: 'expect',
    tag: '예상 출력',
    comment: '확정된 사실이 아니다. ①·②가 맞을 경우 기대하는 관찰 결과이며, 실제 출력과 비교해 검증한다.',
  },
  {
    before: '예상 출력과 ',
    key: '실제 가격',
    after: '을 비교한다',
    tone: 'verify',
    tag: '검증',
    comment: '예상 출력과 실제 움직임이 일치하는 동안만 포지션을 유지한다. 불일치하면 가설을 폐기한다.',
    subs: [
      {
        no: '4-1',
        tone: 'ok',
        body: (
          <>
            <strong>실제 가격이 위로 진행</strong> → 가설 hit
          </>
        ),
      },
      {
        no: '4-2',
        tone: 'fail',
        body: (
          <>
            <strong>돌파 실패, 재차 하락</strong> → 내 모델의 예상 출력이 나오지 않았다 ⇒{' '}
            <em>(내가 산 이유가 사라지는 순간이 나갈 이유이다)</em> 수비 들어와서 <strong>PASS</strong> (빠른 손절)
          </>
        ),
      },
    ],
  },
]

const NO_TRADE_CHARTS = [
  {
    itemId: '5a95385d-8fe5-4867-ae23-3e089da7959b',
    pageId: '699c9a02-ac66-422e-9272-f89c4f7ad716',
    date: '(26.09.24)',
    name: '스마트 로지스틱 글로벌',
    timeframe: '1분봉',
    note: '저렇게 올렸다가 바로 떨어지는 차트. 바로 노리지 말 것. 대부분 이런 걸 노렸다가 FAIL.',
  },
  {
    itemId: '4dc26e35-a250-4bf8-8146-edf318077c12',
    pageId: 'e4db8ae3-a1fe-46ba-8f54-16bf189ea5f1',
    date: '(26.09.24)',
    name: '이지고 테크놀러지',
    timeframe: '3분봉',
    note: '눌림에 잡았는데, 이후 다시 매집을 했는지 올라왔다가 미세한 거래량만 터트리고 죽었다.',
  },
]

function uploadUrl(path: string): string {
  return `/uploads/${path.split('/').map(encodeURIComponent).join('/')}`
}

// Read-only render of a chart image with its saved pen/text annotations.
// Strokes are stored in the image's native pixel coordinates, so an SVG whose
// viewBox is the image's natural size lines up at any display width.
function AnnotatedChart({ src, strokes, alt }: { src: string; strokes: Stroke[]; alt: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  return (
    <div className="annotated-chart">
      <img
        className="remind-chart-img"
        src={src}
        alt={alt}
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
      {size && (
        <svg className="annotated-chart-overlay" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          {strokes.map((s, i) =>
            s.kind === 'text' ? (
              <text
                key={i}
                x={s.x}
                y={s.y}
                fontSize={s.font_size}
                fill={s.color}
                fontFamily="'Times New Roman', serif"
                dominantBaseline="text-before-edge"
              >
                {s.text}
              </text>
            ) : (
              <path
                key={i}
                d={s.points.map(([x, y], j) => `${j === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')}
                stroke={s.color}
                strokeWidth={s.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}
        </svg>
      )}
    </div>
  )
}

interface Props {
  onOpenPage: (itemId: string, pageId: string) => void
}

export function RemindPage({ onOpenPage }: Props) {
  const [note, setNote] = useState<RemindNote | null>(null)
  const [videos, setVideos] = useState<RemindVideo[]>([])
  const [folder, setFolder] = useState<RemindFolder | null>(null)
  const [uploading, setUploading] = useState(false)
  const [chartPages, setChartPages] = useState<Record<string, Page | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFolder = () => api.getRemindFolder().then(setFolder)

  useEffect(() => {
    api.getRemindNote().then(setNote)
    api.listRemindVideos().then(setVideos)
    loadFolder()
    NO_TRADE_CHARTS.forEach((ch) => {
      api
        .getPage(ch.pageId)
        .then((p) => setChartPages((prev) => ({ ...prev, [ch.pageId]: p })))
        .catch(() => setChartPages((prev) => ({ ...prev, [ch.pageId]: null })))
    })
  }, [])

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const title = window.prompt('동영상 제목', file.name.replace(/\.[^.]+$/, ''))
    if (!title) return
    setUploading(true)
    try {
      const v = await api.uploadRemindVideo(title, file)
      setVideos((prev) => [...prev, v])
    } catch (err) {
      window.alert((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const renameVideo = async (v: RemindVideo) => {
    const title = window.prompt('동영상 제목 변경', v.title)
    if (!title || title === v.title) return
    const updated = await api.renameRemindVideo(v.id, title)
    setVideos((prev) => prev.map((x) => (x.id === v.id ? updated : x)))
  }

  const removeVideo = async (v: RemindVideo) => {
    if (!window.confirm(`"${v.title}" 동영상을 삭제할까요?`)) return
    await api.deleteRemindVideo(v.id)
    setVideos((prev) => prev.filter((x) => x.id !== v.id))
  }

  return (
    <div className="remind-page">
      <div className="remind-left">
        <section className="remind-steps">
          <div className="remind-module">
            <div className="remind-module-title">세력주 매매 모듈</div>
            <div className="remind-module-flow">
              <span className="remind-module-chip">관찰</span>
              <span className="remind-module-arrow">→</span>
              <span className="remind-module-chip">가설</span>
              <span className="remind-module-arrow">→</span>
              <span className="remind-module-chip">진입</span>
              <span className="remind-module-arrow">→</span>
              <span className="remind-module-chip">검증</span>
              <span className="remind-module-arrow">→</span>
              <span className="remind-module-chip exit">불일치 시 즉시 종료</span>
            </div>
            <div className="remind-verify-text">
              “세력이 앞으로 뭘 할까?”를 맞히는 게임이 아니라,{' '}
              <strong>“내 가설과 실제 움직임이 일치하는 동안만 포지션을 유지하는 게임”</strong>이다.
            </div>
          </div>

          <h2 className="remind-heading">Approach Step</h2>
          <div className="remind-steps-flow">
            {APPROACH_STEPS.map((s, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <div className="remind-steps-row remind-arrow-row">
                    <span className="remind-step-arrow">↓</span>
                  </div>
                )}
                <div className="remind-steps-row">
                  <div className="remind-step-col">
                    <div className="remind-step">
                      <span className="remind-step-no">{i + 1}</span>
                      <span>
                        {s.before}
                        <strong>{s.key}</strong>
                        {s.after}
                      </span>
                    </div>
                    {s.detail && (
                      <details className="remind-detail">
                        <summary>{s.detail.summary}</summary>
                        <div className="remind-detail-lead">{s.detail.lead}</div>
                        <div className="remind-detail-title">{s.detail.itemsTitle}</div>
                        <ul>
                          {s.detail.items.map((item, j) => (
                            <li key={j}>{item}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {s.subs?.map((sub) => (
                      <div key={sub.no} className={`remind-substep ${sub.tone}`}>
                        <span className="remind-substep-no">{sub.no}</span>
                        <span>{sub.body}</span>
                      </div>
                    ))}
                  </div>
                  <div className={`remind-step-comment tone-${s.tone}`}>
                    <span className="remind-step-tag">{s.tag}</span>
                    <span>{s.comment}</span>
                  </div>
                </div>
              </Fragment>
            ))}
          </div>

          <div className="remind-nogo">
            <div className="remind-nogo-title">생각 금지</div>
            <div className="remind-nogo-item">
              <span className="remind-nogo-mark">✗</span>
              <div>
                <div className="remind-nogo-quote">“왜 안 올라가지? 조금만 더 기다려보자”</div>
                <div className="remind-nogo-instead">
                  → <strong>“내 모델의 예상 출력이 나오지 않았다”</strong>로 본다.
                </div>
              </div>
            </div>
            <div className="remind-nogo-item">
              <span className="remind-nogo-mark">✗</span>
              <div>
                <div className="remind-nogo-quote">한 번 실패했으니 매집 가설 자체가 영원히 틀렸다</div>
                <div className="remind-nogo-instead">
                  → 틀린 것은 <strong>그 시점의 진입 시나리오</strong>다. 다시 구조가 만들어지면 새로운 관측으로 다시
                  판단하고, <strong>재진입은 새로운 거래</strong>로 취급한다.
                </div>
              </div>
            </div>
          </div>

          <div className="remind-verify">
            <div className="remind-verify-note">항상 예상대로 가지 않는다 — 이 점이 매매 시스템의 핵심이다.</div>
            <div className="remind-verify-callout">
              빠른 패스(손절) 원칙과 그대로 결합된다. <strong>진입 조건과 손절 조건은 서로 다른 규칙이 아니다.</strong>
            </div>
          </div>
        </section>

        <section className="remind-note-col">
          <h2 className="remind-heading">매매 전 리마인드</h2>
          {note ? (
            <NoteEditor html={note.note_html} onSave={(html) => api.updateRemindNote(html)} />
          ) : (
            <div className="page-view-loading">로딩 중...</div>
          )}
        </section>
      </div>

      <div className="remind-right">
        <section className="remind-charts">
          <h2 className="remind-heading danger">절대 바로 매매하면 안 되는 차트</h2>
          {NO_TRADE_CHARTS.map((ch) => {
            const page = chartPages[ch.pageId]
            const img = page?.image_b
            return (
              <div key={ch.pageId} className="remind-chart-card">
                <div className="remind-chart-head">
                  <span className="remind-chart-title">
                    {ch.date} {ch.name}
                  </span>
                  <span className="remind-chart-fail">FAIL</span>
                  <span className="remind-chart-tf">{ch.timeframe}</span>
                  <button
                    type="button"
                    className="remind-chart-open"
                    onClick={() => onOpenPage(ch.itemId, ch.pageId)}
                  >
                    원본 보기
                  </button>
                </div>
                {img ? (
                  <AnnotatedChart
                    src={uploadUrl(img.path)}
                    strokes={img.strokes}
                    alt={`${ch.name} ${ch.timeframe}`}
                  />
                ) : page === null ? (
                  <div className="remind-video-empty">원본 차트를 찾을 수 없습니다.</div>
                ) : (
                  <div className="remind-video-empty">불러오는 중...</div>
                )}
                <div className="remind-chart-note">{ch.note}</div>
              </div>
            )
          })}
        </section>

        <section className="remind-video-col">
          <div className="remind-video-header">
            <h2 className="remind-heading">영상 폴더</h2>
            <button type="button" onClick={loadFolder}>
              새로고침
            </button>
          </div>
          {folder && (
            <>
              <div className="remind-folder-path">
                이 폴더에 영상 파일을 복사해 넣으면 아래에 나타납니다.
                <code>{folder.folder}</code>
              </div>
              {folder.videos.length === 0 ? (
                <div className="remind-video-empty">폴더에 영상 파일이 없습니다.</div>
              ) : (
                folder.videos.map((v) => (
                  <div key={v.path} className="remind-video-card">
                    <div className="remind-video-title-row">
                      <span className="remind-video-title">{v.name.replace(/\.[^.]+$/, '')}</span>
                    </div>
                    <video
                      className="remind-video-player"
                      src={`${uploadUrl(v.path)}?v=${Math.floor(v.modified)}`}
                      controls
                      preload="metadata"
                    />
                  </div>
                ))
              )}
            </>
          )}

          <div className="remind-video-header">
            <h2 className="remind-heading">업로드한 동영상</h2>
            <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? '업로드 중...' : '+ 동영상 추가'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={onFileChosen}
            />
          </div>
          {videos.length === 0 ? (
            <div className="remind-video-empty">등록된 동영상이 없습니다.</div>
          ) : (
            videos.map((v) => (
              <div key={v.id} className="remind-video-card">
                <div className="remind-video-title-row">
                  <span className="remind-video-title" title="더블클릭하여 제목 변경" onDoubleClick={() => renameVideo(v)}>
                    {v.title}
                  </span>
                  <button type="button" title="삭제" onClick={() => removeVideo(v)}>
                    ✕
                  </button>
                </div>
                <video className="remind-video-player" src={uploadUrl(v.path)} controls preload="metadata" />
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
