import { Fragment, useEffect, useRef, useState } from 'react'
import { api, type Page, type RemindFolder, type RemindNote, type RemindVideo } from '../api/client'
import { AnnotatedChart, uploadUrl } from './AnnotatedChart'
import { NoteEditor } from './NoteEditor'

interface MantraExtra {
  link?: string
  points?: string[]
  quote?: string
  paragraphs?: string[]
  sections?: { heading: string; points: string[] }[]
  image?: string
}

interface Mantra {
  title: string
  detail: string
  extras?: MantraExtra[]
}

const MANTRAS: Mantra[] = [
  {
    title: '무한 행동력',
    detail: '오직 행동만이 인생을 바꿀 수 있다 / 움직이는 바보가 멈춘 천재 이긴다',
    extras: [
      {
        link: 'https://www.instagram.com/p/DdyAX3Ak0HS/?img_index=10&stkn=MXA2bWkzMXcxdnVzMQ==',
        points: [
          '돈은 속도를 좋아하고, 가난은 망설임을 좋아한다',
          'Prince는 1,000곡 중 6곡만, Picasso는 5만 점 중 4점만 알려짐 — 많이 만들고 시도하고 실패해야 한다',
          '완벽함을 고민하기보다는 서툴더라도 움직이는 것이 현명하다',
          '생각이 길어질수록 두려움만 커진다',
          '타인의 신뢰를 기다리기 전에 자기 자신을 먼저 믿어야 한다',
        ],
        image: '/remind/believe-in-yourself.png',
      },
      {
        quote: '행동하지 않으면 인생은 바뀌지 않는다. - 브라이언 트레이시',
        paragraphs: [
          '성공에 필요한 모든 지식과 기술은 후천적으로 배울 수 있다는 단순하지만 강력한 진리였다.',
          '해고당했던 쓰라린 경험들로 인해, 스스로 아무것도 이룰 수 없을 거라 단정 지어버렸다. 평생 가난하게 살며 친구 집을 전전하는 것이 내 운명이라고 믿었다.',
          '하버드를 비롯한 유수의 대학교에서 선천적인 지능과 우수한 성적이 성공에 미치는 영향에 대해 연구했지만, 결과적으로 그중 어떤 요소도 성공과 직접적인 연관성을 보이지 않았다. 학위도, 언어 능력도, 재산도 없이 빈털터리로 미국에 와서 백만장자가 된 사람은 정말 많다.',
          '성공은 교육, 기술, 집안, 심지어 운과도 아무런 연관이 없다. 성공은 전적으로 개인의 행동에 의해 좌우된다. 그리고 모든 개인에게는 특별한 일을 해낼 능력이 있다.',
          '당신의 자아는 어린 시절 부모가 당신을 대하는 방식에 의해 처음 형성된다. 어렸을 때부터 부정적인 생각에 노출되면 나이가 들수록 점점 부정적으로 변할 수밖에 없다. 그렇다고 어린 시절 양육 환경만 탓하고 있을 수는 없는 노릇 아닌가? 1인분의 삶을 오롯이 책임지는 어른이 된 이상, 자기 자신에 대한 긍정적인 인식과 잠재력에 대해 열린 마음을 지녀야 한다.',
          '당신의 배경과 현재 상황이 어떻든 언젠가 분명 홀로 운전석에 앉아야 하는 순간이 온다. 인생이라는 차의 운전대를 잡고 어디로 향할 것인지 선택해야 하는 것이다. 어떤 마음으로 어떻게 바라보고 어떤 길을 선택할지는 모두 당신에게 달렸다. 당신이 허락하지 않는 한 과거의 어떤 것도 지금의 당신에게 아무런 영향을 끼치지 못한다는 사실을 늘 기억하길 바란다.',
        ],
      },
    ],
  },
  {
    title: '절실함',
    detail: '5만원이 없어서 졸라 불쌍해했던, 악을 갖게 한',
  },
  {
    title: '극상위권',
    detail: '단 한 번도 1등을 놓친 적이 없음. 방법을 아니깐',
    extras: [
      {
        link: 'https://youtu.be/OsR8KlXA9aI?si=5hC623HWYl3g7TwE',
        points: ['현우진 삶의 자세 | 동기부여 | 공부자극'],
        sections: [
          {
            heading: '1. 학습 및 삶의 태도 (0:00 - 1:43)',
            points: [
              '기준(Standard) 높이기: 주변의 평범한 수준에 맞추려 하지 말고, 더 높은 목표를 가져야 함을 강조. 주변을 보며 문제점을 발견하고 개선하는 자세가 중요.',
              '학습의 본질: 단순히 몸만 힘들게 공부하는 것이 아니라, 자신이 모르는 부분을 찾아 보완하는 것이 공부의 기본 (1:45 - 2:00).',
            ],
          },
          {
            heading: '2. 노력과 자기 관리 (2:27 - 3:52)',
            points: [
              "압도적인 1등의 습관: 항상 최상위권을 유지했던 비결로 '모르는 것을 공부하는 태도'를 꼽음.",
              '노력의 즐거움: 공부를 억지로 하는 것이 아니라, 할 일을 하나씩 해결해 나가는 과정에서 느끼는 희열을 습관화하라고 조언.',
              '재능에 대한 관점: 재능이 있더라도 노력을 해야만 그 빛을 발할 수 있으며, 노력하는 과정 자체가 중요한 능력임을 강조.',
            ],
          },
          {
            heading: '3. 변화의 방법 (3:59 - 4:22)',
            points: [
              '태도의 변화: 태도와 공부 스타일은 쉽게 바뀌지 않으므로, 단번에 바꾸려 하기보다 서서히 개선해 나가야 한다고 마무리.',
            ],
          },
        ],
      },
    ],
  },
]

const APPROACH_STEPS = [
  {
    before: '',
    key: '정규장 시작 직후(KST 오후 10:30)',
    after: '에는 바로 매수하지 않는다',
    tone: 'premise',
    tag: '원칙',
    comment: '개장 직후는 방향이 정해지지 않은 변동성 구간이다. 가설을 세우고 검증한 뒤에만 진입한다.',
    detail: {
      summary: '상세 보기 — 장 시작 전후 행동',
      lead: '',
      itemsTitle: '장 시작 전후 행동',
      items: [
        <>
          <strong>KST 10:00부터 관심종목 추가</strong>
        </>,
        <>
          <strong>하지만 장 시작 시 내려버리는 경우가 있어서 미리 매수 금지</strong>
        </>,
      ],
    },
  },
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
        <section className="remind-mantras">
          {MANTRAS.map((m, i) =>
            m.extras ? (
              <details key={i} className="remind-mantra">
                <summary className="remind-mantra-row">
                  <span className="remind-mantra-title">{m.title}</span>
                  <span className="remind-mantra-detail">{m.detail}</span>
                  <span className="remind-mantra-toggle">상세 보기</span>
                </summary>
                {m.extras.map((ex, k) => (
                  <div key={k} className="remind-mantra-extra-body">
                    {ex.quote && <div className="remind-mantra-quote">{ex.quote}</div>}
                    {ex.link && (
                      <a href={ex.link} target="_blank" rel="noreferrer" className="remind-mantra-link">
                        {ex.link}
                      </a>
                    )}
                    {ex.paragraphs && (
                      <div className="remind-mantra-paragraphs">
                        {ex.paragraphs.map((p, j) => (
                          <p key={j}>{p}</p>
                        ))}
                      </div>
                    )}
                    {ex.points && (
                      <ul>
                        {ex.points.map((p, j) => (
                          <li key={j}>{p}</li>
                        ))}
                      </ul>
                    )}
                    {ex.sections?.map((sec, s) => (
                      <div key={s} className="remind-mantra-section">
                        <div className="remind-mantra-section-heading">{sec.heading}</div>
                        <ul>
                          {sec.points.map((p, j) => (
                            <li key={j}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {ex.image && <img src={ex.image} alt="" className="remind-mantra-image" />}
                  </div>
                ))}
              </details>
            ) : (
              <div key={i} className="remind-mantra">
                <div className="remind-mantra-row">
                  <span className="remind-mantra-title">{m.title}</span>
                  <span className="remind-mantra-detail">{m.detail}</span>
                </div>
              </div>
            ),
          )}
        </section>

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
                      <span className="remind-step-no">{i}</span>
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
