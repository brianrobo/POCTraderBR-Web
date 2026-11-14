from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .db import SessionLocal, ensure_schema
from .models import (
    BUY_CHECKLIST_SETTINGS_ID,
    REMIND_NOTE_ID,
    ROOT_CATEGORY_ID,
    ROOT_STUDY_PLAN_ID,
    VIRTUAL_SIM_NOTE_ID,
)
from .orm import BuyChecklistSettingsORM, CategoryORM, RemindNoteORM, StudyPlanNodeORM, VirtualSimNoteORM
from .paths import ASSETS_DIR, DATA_DIR, REMIND_VIDEO_DIR
from .routers import (
    assets,
    buy_checklist,
    categories,
    chart_patterns,
    items,
    one_min_notes,
    pages,
    remind,
    reference,
    sim,
    study_plan,
    todos,
    virtual_sim,
)

# Seeded once when the virtual_sim_note row is first created — a snapshot of
# the 2026-11-07 research into real-historical-data trading simulators
# (use vs. build). Meant to be edited/extended in place from the tab itself.
VIRTUAL_SIM_SEED_HTML = """
<h3>과거 실데이터 기반 매매 시뮬레이터 — 쓸지 만들지 리서치</h3>
<p>Warrior Trading 자체 시뮬레이터부터 확인했는데, 예상과 달리 <strong>실시간(live) 데이터</strong> 기반이고 과거 데이터 리플레이 기능은 없었다. 대신 실제로 "과거 실제 시세를 재생해서 가상매매"하는 툴/사이트들을 찾아봄.</p>
<h3>과거 데이터 리플레이 기반 시뮬레이터</h3>
<ul>
<li><strong>TradingSim</strong> — 최근 3년치 틱 단위 리플레이, Level 2·Time&amp;Sales 포함, 1만 개 이상 종목(미국주식/선물/암호화폐). 유료(연간 플랜, 7일 무료체험). <a href="https://www.tradingsim.com/day-trading-simulator">tradingsim.com</a></li>
<li><strong>simul8or</strong> — 무료, 가입/이메일 불필요. 가상자금 $100,000으로 시작하는 리플레이형 시뮬레이터. <a href="https://simul8or.com/">simul8or.com</a></li>
<li><strong>MultiCharts</strong> — 전문가용 유료 플랫폼. 과거 Level 2 데이터(직접 보유 or 다운로드)로 리플레이, 주문·DOM·지표까지 지원. <a href="https://www.multicharts.com/features/simulator/">multicharts.com</a></li>
<li><strong>TradesViz</strong> — 트레이딩 저널 겸용. 하루 1종목 무료 "히든 데이터" 드릴 제공, 날짜 지정 전체 리플레이는 유료 플랜. <a href="https://www.tradesviz.com/stock-simulator/">tradesviz.com</a></li>
<li><strong>TraderSync</strong> — 저널+리플레이 결합, 4년치 리플레이 데이터 보유 주장(자체 페이지 출처). <a href="https://tradersync.com/the-best-day-trading-simulator/">tradersync.com</a></li>
<li><strong>Webull Paper Trading</strong> — 무료, 실시간 Level 1 + 리플레이 모드 제공(직접 확인 필요).</li>
<li><strong>ChartMini</strong> — 무료지만 제한적: 주식은 일봉 리플레이만 가능, 분봉 인트라데이 시뮬레이터는 외환/암호화폐만 지원 — 1분봉 매매 연습 용도로는 부적합. <a href="https://chartmini.com/market-replay">chartmini.com</a></li>
</ul>
<h3>참고용 (리플레이 여부 직접 확인 못함)</h3>
<ul>
<li>Thinkorswim paperMoney, TradeStation — 비교글에서 상위권으로 언급되지만 과거 틱 리플레이 여부 불확실.</li>
<li>DAS Trader, Bookmap, Trade Ideas — 검색에 결과가 안 나와서 확인 못함. 커뮤니티에서 자주 언급되는 툴이라 직접 사이트 확인 필요.</li>
</ul>
<p><strong>주의</strong>: 위 설명 상당수가 벤더 자체 마케팅/제휴 비교글 기반 — "틱 단위 진짜 리플레이"인지 "분봉/일봉만 리플레이"인지는 가입 전 직접 확인 필요. 1분봉 눌림목/매집구간 분석 스타일이면 TradingSim이나 simul8or(무료)가 우선 테스트 후보.</p>
<h3>직접 만드는 경우 (메모)</h3>
<p>아직 미정리 — 과거 분봉 데이터 소스(무료/유료 API), 재생 엔진 설계, 기존 POCTraderBR 트레이딩 노트와의 연동 방식 등을 여기 이어서 정리.</p>
"""

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

DATA_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
REMIND_VIDEO_DIR.mkdir(parents=True, exist_ok=True)

ensure_schema()

with SessionLocal() as _session:
    if _session.get(CategoryORM, ROOT_CATEGORY_ID) is None:
        _session.add(CategoryORM(id=ROOT_CATEGORY_ID, name="Root", parent_id=None, position=0))
        _session.commit()
    if _session.get(StudyPlanNodeORM, ROOT_STUDY_PLAN_ID) is None:
        _session.add(StudyPlanNodeORM(id=ROOT_STUDY_PLAN_ID, name="학습 계획", parent_id=None, position=0))
        _session.commit()
    if _session.get(RemindNoteORM, REMIND_NOTE_ID) is None:
        _session.add(RemindNoteORM(id=REMIND_NOTE_ID, note_html=""))
        _session.commit()
    if _session.get(BuyChecklistSettingsORM, BUY_CHECKLIST_SETTINGS_ID) is None:
        _session.add(BuyChecklistSettingsORM(id=BUY_CHECKLIST_SETTINGS_ID, descriptions_json="{}"))
        _session.commit()
    if _session.get(VirtualSimNoteORM, VIRTUAL_SIM_NOTE_ID) is None:
        _session.add(VirtualSimNoteORM(id=VIRTUAL_SIM_NOTE_ID, note_html=VIRTUAL_SIM_SEED_HTML))
        _session.commit()

app = FastAPI(title="POCTraderBR Web")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(categories.router)
app.include_router(items.router)
app.include_router(pages.router)
app.include_router(assets.router)
app.include_router(todos.router)
app.include_router(reference.router)
app.include_router(study_plan.router)
app.include_router(remind.router)
app.include_router(one_min_notes.router)
app.include_router(buy_checklist.router)
app.include_router(virtual_sim.router)
app.include_router(sim.router)
app.include_router(chart_patterns.router)

app.mount("/uploads", StaticFiles(directory=str(ASSETS_DIR)), name="uploads")

# In production the frontend is built and served by this same process/port,
# so the LAN deployment is a single uvicorn process on one port.
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
