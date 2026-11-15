from __future__ import annotations

import time
import uuid
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

ROOT_CATEGORY_ID = "__ROOT__"
ROOT_STUDY_PLAN_ID = "__STUDY_ROOT__"
REMIND_NOTE_ID = "__REMIND__"
BUY_CHECKLIST_SETTINGS_ID = "__BUY_CHECKLIST__"


def new_id() -> str:
    return str(uuid.uuid4())


def now() -> float:
    return time.time()


class Stroke(BaseModel):
    """A single chart annotation — either a freehand path or a text label.

    Both kinds share one list per image slot; `kind` tells them apart.
    Old stored data has no `kind` key, which defaults to "path" so it
    keeps loading unchanged.
    """

    kind: Literal["path", "text"] = "path"
    color: str = "#222222"
    width: float = 3.0
    points: List[Tuple[float, float]] = Field(default_factory=list)
    text: str = ""
    font_size: float = 20.0
    x: float = 0.0
    y: float = 0.0


class ImageSlot(BaseModel):
    path: str
    strokes: List[Stroke] = Field(default_factory=list)


IMAGE_SLOTS = ("a", "a2", "b", "b2")
LAYOUTS = ("2", "4")


PAGE_KINDS = ("chart", "insight")


class Page(BaseModel):
    id: str
    item_id: str
    kind: Literal["chart", "insight"] = "chart"
    result: Literal["", "pass", "fail"] = ""
    ma_spacing: Literal["", "converge", "diverge"] = ""
    period_symmetry: Literal["", "after", "before"] = ""
    accumulation_checked: bool = False
    leading_span2: Literal["", "digested", "undigested"] = ""
    note_html_a: str = ""
    note_html_b: str = ""
    updated_at: float = Field(default_factory=now)
    layout: str = "2"
    image_a: Optional[ImageSlot] = None
    image_a2: Optional[ImageSlot] = None
    image_b: Optional[ImageSlot] = None
    image_b2: Optional[ImageSlot] = None
    stock_name_a: str = ""
    stock_name_a2: str = ""
    stock_name_b: str = ""
    stock_name_b2: str = ""
    clip_url: Optional[str] = None
    do_not_buy: bool = False
    do_not_buy_category: Literal["", "volume_passed", "spike_dump", "accumulation_unclear"] = ""


class InsightEntry(BaseModel):
    """A read-only rollup row for the cross-item "인사이트 모아보기" feed."""

    page_id: str
    item_id: str
    item_name: str
    category_id: str
    category_path: str
    content_html: str
    updated_at: float
    image_a: Optional[ImageSlot] = None
    image_b: Optional[ImageSlot] = None
    result: Literal["", "pass", "fail"] = ""
    ma_spacing: Literal["", "converge", "diverge"] = ""
    period_symmetry: Literal["", "after", "before"] = ""
    accumulation_checked: bool = False
    leading_span2: Literal["", "digested", "undigested"] = ""
    clip_url: Optional[str] = None
    do_not_buy: bool = False
    do_not_buy_category: Literal["", "volume_passed", "spike_dump", "accumulation_unclear"] = ""


class Item(BaseModel):
    id: str
    name: str
    category_id: str
    page_ids: List[str] = Field(default_factory=list)
    description: str = ""


MAX_CATEGORY_URLS = 10


class Category(BaseModel):
    id: str
    name: str
    parent_id: Optional[str] = None
    child_ids: List[str] = Field(default_factory=list)
    item_ids: List[str] = Field(default_factory=list)
    urls: List[str] = Field(default_factory=list)
    note_html: str = ""


class Todo(BaseModel):
    id: str
    date: str  # "YYYY-MM-DD"
    text: str
    done: bool = False


class CodeInfo(BaseModel):
    id: str
    code: str
    description: str = ""
    created_at: float = Field(default_factory=now)


FORMULA_CATEGORIES = ("기술적지표", "신호검색", "강세약세")


class FormulaInfo(BaseModel):
    id: str
    category: str
    name: str
    content: str = ""
    created_at: float = Field(default_factory=now)


class RemindNote(BaseModel):
    """Single global note reviewed before trading — no list, just one block."""

    id: str
    note_html: str = ""


class RemindVideo(BaseModel):
    id: str
    title: str
    path: str
    created_at: float = Field(default_factory=now)


class RemindFolderVideo(BaseModel):
    """A video file found in the on-disk drop folder (not a DB row)."""

    name: str
    path: str
    size: int
    modified: float


class RemindFolder(BaseModel):
    folder: str
    videos: List[RemindFolderVideo] = Field(default_factory=list)


class BuyChecklistSettings(BaseModel):
    """User-edited descriptions for the 매수 체크 items (only entries that
    differ from the built-in default are kept, so improving a default later
    still reaches users who never customized it)."""

    id: str
    descriptions: dict[str, str] = Field(default_factory=dict)


class BuyCheckLogEntry(BaseModel):
    """One row per 매수 체크 verdict (blocked/review) or 작전 타임 start —
    mirrors the desktop app's append-only check_log.jsonl."""

    id: str
    created_at: float = Field(default_factory=now)
    verdict: Literal["blocked", "review"]
    answers: dict[str, Optional[Literal["yes", "no"]]] = Field(default_factory=dict)
    symbol: Optional[str] = None
    note: Optional[str] = None


class ChartPattern(BaseModel):
    id: str
    name: str
    pdf_group: str = ""
    position: int = 0
    concept_image_url: Optional[str] = None
    example_image_urls: List[str] = Field(default_factory=list)
    notes_html: str = ""
    created_at: float = Field(default_factory=now)


class SimFrame(BaseModel):
    """One captured chart frame of a simulator scenario, on either the
    30-minute or the 1-minute track. Replay steps through the 1m track; a 30m
    frame comes into view once replay reaches its `sync_frame_id` 1m frame.
    A quiz frame is a buy-or-not decision point; `quiz_outcome` records what
    buying there led to, which is what an answer gets graded against."""

    id: str
    scenario_id: str
    track: Literal["30m", "1m"] = "1m"
    position: int = 0
    image_url: str
    label: str = ""
    sync_frame_id: Optional[str] = None
    is_quiz: bool = False
    quiz_outcome: Literal["", "profit", "loss"] = ""
    quiz_note: str = ""


class SimAttempt(BaseModel):
    """One practice answer at a quiz frame. `result` is derived from the
    frame's current outcome rather than stored, so re-grading a frame also
    re-grades its past attempts ('' while the outcome is still unset)."""

    id: str
    scenario_id: str
    frame_id: str
    answer: Literal["buy", "skip"]
    result: Literal["", "correct", "wrong"] = ""
    created_at: float = Field(default_factory=now)


class SimScenario(BaseModel):
    id: str
    name: str
    stock_name: str = ""  # the stock's name, shown under `name` in the list
    kind: Literal["frames", "bars"] = "frames"
    position: int = 0
    created_at: float = Field(default_factory=now)
    frame_count_30m: int = 0
    frame_count_1m: int = 0
    bar_count: int = 0  # 'bars' scenarios: 1-minute bars from the replay start on
    quiz_count: int = 0
    graded_count: int = 0
    correct_count: int = 0


class SimScenarioDetail(SimScenario):
    frames: List[SimFrame] = Field(default_factory=list)
    attempts: List[SimAttempt] = Field(default_factory=list)


class SimInsightBand(BaseModel):
    """A price band shaded across the chart, e.g. where buyers are stuck."""

    lo: float
    hi: float
    color: str = "#8a2be2"
    text: str = ""
    start: int = 0  # frame the band begins at; 0: the whole chart
    label_frame: int = 0  # frame the text starts at; 0: the left edge


class SimInsightZone(BaseModel):
    """A span of frames shaded over the full height of the chart."""

    start: int
    end: int
    color: str = "#ff8c00"
    opacity: float = 0.22
    text: str = ""
    text_price: float = 0  # price the text hangs from; 0: the top of the chart


class SimInsightLevel(BaseModel):
    """A dashed line at a price, over a span of frames."""

    price: float
    start: int
    end: int
    color: str = "#0b6b2e"
    text: str = ""
    label_frame: int = 0  # frame the text starts at; 0: `start`


class SimInsightLine(BaseModel):
    """A vertical line at the right edge of a frame — a moment of decision."""

    frame: int
    color: str = "#111111"
    text: str = ""
    text_price: float = 0  # price the text hangs from; 0: the top of the chart
    side: Literal["left", "right"] = "right"  # which side of the line the text is on


class SimInsightBracket(BaseModel):
    """The distance between two prices, drawn at a frame."""

    frame: int
    lo: float
    hi: float
    color: str = "#b00020"
    text: str = ""


class SimInsightMark(BaseModel):
    """A label pointing at one bar: at its high ('above') or its low ('below').
    `len` and `dx` (pixels) say how far up or down and sideways the text sits."""

    frame: int
    text: str
    side: Literal["above", "below"] = "above"
    len: int = 24
    dx: int = 0
    bold: bool = False


class SimQuizInsight(BaseModel):
    """What the 1-minute chart shows for a quiz when "My Insight" is on: the
    reading of the quiz drawn over the bars. Frames are bar numbers counted
    from 1 (frame N is bars[N-1]), as the simulator shows them."""

    # Frames to bring into view when it is turned on; 0: around the quiz range.
    view_start: int = 0
    view_end: int = 0
    bands: List[SimInsightBand] = Field(default_factory=list)
    zones: List[SimInsightZone] = Field(default_factory=list)
    levels: List[SimInsightLevel] = Field(default_factory=list)
    vlines: List[SimInsightLine] = Field(default_factory=list)
    brackets: List[SimInsightBracket] = Field(default_factory=list)
    marks: List[SimInsightMark] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)  # the reading in words, listed under the chart


class SimBarQuiz(BaseModel):
    """A quiz of a 'bars' scenario: the bars from `start_time` to `bar_time`
    are watched, then the question is asked at `bar_time` (the same bar for a
    quiz about a single moment). Graded like a quiz frame — 'profit' means
    price rose afterwards, and 'buy' is the answer that says so."""

    id: str
    scenario_id: str
    start_time: int
    bar_time: int
    outcome: Literal["", "profit", "loss"] = ""
    note: str = ""
    insight: Optional[SimQuizInsight] = None


class SimBarAttempt(BaseModel):
    id: str
    scenario_id: str
    quiz_id: str
    answer: Literal["buy", "skip"]
    result: Literal["", "correct", "wrong"] = ""
    created_at: float = Field(default_factory=now)


class SimDrawing(BaseModel):
    """A line, horizontal line, rectangle or ellipse drawn on the 1-minute chart
    of a 'bars' scenario, spanning two corner points (a horizontal line runs
    across the whole chart at one price: both points are where it was placed). `x` is a position along the bars
    (index into `bars`, fractional between two bars and free to run past the
    last one), `y` a price. `at` is the index of the latest bar on the chart
    when it was drawn — practice shows the drawing from that bar on."""

    id: str
    kind: Literal["line", "hline", "rect", "ellipse"]
    x1: float
    y1: float
    x2: float
    y2: float
    at: int = 0


class SimBarData(BaseModel):
    """Everything a 'bars' scenario replays. `bars` rows are
    [time, open, high, low, close, volume], oldest first, where time is the
    exchange wall-clock time read as UTC (epoch seconds)."""

    scenario_id: str
    symbol: str = ""
    source_name: str = ""
    replay_from: int = 0
    bars: List[List[float]] = Field(default_factory=list)
    quizzes: List[SimBarQuiz] = Field(default_factory=list)
    attempts: List[SimBarAttempt] = Field(default_factory=list)
    drawings: List[SimDrawing] = Field(default_factory=list)


class SimPriceSession(BaseModel):
    """One trading session found in a price file — a day a scenario can replay."""

    start: int  # time of the session's first bar; what replay_from is set to
    end: int
    bar_count: int
    high: float
    low: float


class SimPriceFileInfo(BaseModel):
    """What an exported price file holds, shown before a scenario is made of it."""

    symbol: str = ""
    source_name: str = ""
    bar_count: int = 0
    sessions: List[SimPriceSession] = Field(default_factory=list)


class InsightNode(BaseModel):
    """One node of the insight map. `kind` says what a rule is for (a reason
    to buy, a reason not to, something to wait for; '' for a plain grouping)
    and `status` how settled it is — a rule starts as a candidate and is
    confirmed once it keeps showing up."""

    id: str
    name: str
    parent_id: Optional[str] = None
    position: int = 0
    kind: Literal["", "buy", "avoid", "wait"] = ""
    status: Literal["candidate", "confirmed", "dropped"] = "candidate"
    description: str = ""
    created_at: float = Field(default_factory=now)


class InsightEvidence(BaseModel):
    """Links an insight node to a simulator quiz that supports it, or that
    went against it."""

    id: str
    node_id: str
    quiz_id: str
    stance: Literal["support", "counter"] = "support"
    comment: str = ""
    created_at: float = Field(default_factory=now)


class InsightQuiz(BaseModel):
    """A simulator quiz as the insight map shows it. Frame numbers count the
    scenario's bars from 1, as the simulator does; the counts are the practice
    answers given at this quiz."""

    id: str
    scenario_id: str
    scenario_name: str
    start_time: int
    bar_time: int
    start_frame: int = 0
    end_frame: int = 0
    outcome: Literal["", "profit", "loss"] = ""
    note: str = ""
    graded_count: int = 0
    correct_count: int = 0


class InsightMap(BaseModel):
    nodes: List[InsightNode] = Field(default_factory=list)
    evidence: List[InsightEvidence] = Field(default_factory=list)
    # Every quiz of every price-data scenario, linked to a node or not.
    quizzes: List[InsightQuiz] = Field(default_factory=list)


class OneMinNote(BaseModel):
    """A freeform 'My Insight' memo attached to either the PASS or FAIL
    column of the 1분봉 비교 page — an append-only running list, not tied to
    any single chart."""

    id: str
    column: Literal["pass", "fail"]
    text: str
    position: int = 0
    created_at: float = Field(default_factory=now)


class StudyPlanNode(BaseModel):
    """A single node in the study-plan tree. Unlike Category/Item, one node
    is both a container (can have children) and a content leaf (dates +
    result notes) at the same time — there's no separate "item" tier."""

    id: str
    name: str
    parent_id: Optional[str] = None
    child_ids: List[str] = Field(default_factory=list)
    start_date: Optional[str] = None  # "YYYY-MM-DD"
    end_date: Optional[str] = None  # "YYYY-MM-DD"
    result_html: str = ""
