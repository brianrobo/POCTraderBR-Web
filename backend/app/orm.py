from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class CategoryORM(Base):
    __tablename__ = "categories"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[Optional[str]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    position: Mapped[int] = mapped_column(default=0)
    urls: Mapped[str] = mapped_column(Text, default="[]")
    note_html: Mapped[str] = mapped_column(Text, default="")


class ItemORM(Base):
    __tablename__ = "items"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))
    position: Mapped[int] = mapped_column(default=0)
    description: Mapped[str] = mapped_column(Text, default="")


class PageORM(Base):
    __tablename__ = "pages"

    id: Mapped[str] = mapped_column(primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id"))
    position: Mapped[int] = mapped_column(default=0)
    kind: Mapped[str] = mapped_column(Text, default="chart")
    result: Mapped[str] = mapped_column(Text, default="")
    ma_spacing: Mapped[str] = mapped_column(Text, default="")
    period_symmetry: Mapped[str] = mapped_column(Text, default="")
    accumulation_checked: Mapped[bool] = mapped_column(default=False)
    leading_span2: Mapped[str] = mapped_column(Text, default="")
    note_html_a: Mapped[str] = mapped_column(Text, default="")
    note_html_b: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[float] = mapped_column(default=0.0)
    layout: Mapped[str] = mapped_column(Text, default="2")
    image_a_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_a_strokes: Mapped[str] = mapped_column(Text, default="[]")
    image_a2_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_a2_strokes: Mapped[str] = mapped_column(Text, default="[]")
    image_b_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_b_strokes: Mapped[str] = mapped_column(Text, default="[]")
    image_b2_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_b2_strokes: Mapped[str] = mapped_column(Text, default="[]")
    clip_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    do_not_buy: Mapped[bool] = mapped_column(default=False)
    do_not_buy_category: Mapped[str] = mapped_column(Text, default="")
    stock_name_a: Mapped[str] = mapped_column(Text, default="")
    stock_name_a2: Mapped[str] = mapped_column(Text, default="")
    stock_name_b: Mapped[str] = mapped_column(Text, default="")
    stock_name_b2: Mapped[str] = mapped_column(Text, default="")


class TodoORM(Base):
    __tablename__ = "todos"
    __table_args__ = (Index("ix_todos_date", "date"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    date: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    done: Mapped[bool] = mapped_column(default=False)
    position: Mapped[int] = mapped_column(default=0)


class CodeInfoORM(Base):
    __tablename__ = "code_infos"

    id: Mapped[str] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[float] = mapped_column(default=0.0)


class FormulaInfoORM(Base):
    __tablename__ = "formula_infos"

    id: Mapped[str] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[float] = mapped_column(default=0.0)


class RemindNoteORM(Base):
    __tablename__ = "remind_note"

    id: Mapped[str] = mapped_column(primary_key=True)
    note_html: Mapped[str] = mapped_column(Text, default="")


class RemindVideoORM(Base):
    __tablename__ = "remind_videos"

    id: Mapped[str] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[float] = mapped_column(default=0.0)


class BuyChecklistSettingsORM(Base):
    __tablename__ = "buy_checklist_settings"

    id: Mapped[str] = mapped_column(primary_key=True)
    descriptions_json: Mapped[str] = mapped_column(Text, default="{}")


class BuyCheckLogORM(Base):
    __tablename__ = "buy_check_log"

    id: Mapped[str] = mapped_column(primary_key=True)
    created_at: Mapped[float] = mapped_column(default=0.0)
    verdict: Mapped[str] = mapped_column(Text)
    answers_json: Mapped[str] = mapped_column(Text, default="{}")
    symbol: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ChartPatternORM(Base):
    """One studied pattern (concept diagram + its real-chart examples),
    built up incrementally from the Warrior Trading chart-pattern PDF."""

    __tablename__ = "chart_patterns"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    pdf_group: Mapped[str] = mapped_column(Text, default="")  # e.g. "1" from the source PDF
    position: Mapped[int] = mapped_column(default=0)
    concept_image_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    example_image_paths: Mapped[str] = mapped_column(Text, default="[]")  # JSON string[]
    notes_html: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[float] = mapped_column(default=0.0)


class SimScenarioORM(Base):
    """One replayable chart flow for the Virtual Simul tab. A 'frames'
    scenario is two ordered runs of captured frames (30-minute and 1-minute
    chart, one frame per candle step) with some 1-minute frames marked as quiz
    points; a 'bars' scenario replays imported 1-minute price data instead,
    with the charts drawn by the app (see SimBarSetORM)."""

    __tablename__ = "sim_scenarios"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    stock_name: Mapped[str] = mapped_column(Text, default="")  # the stock's name, shown under `name`
    kind: Mapped[str] = mapped_column(Text, default="frames")  # frames/bars
    position: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[float] = mapped_column(default=0.0)


class SimFrameORM(Base):
    __tablename__ = "sim_frames"
    __table_args__ = (Index("ix_sim_frames_scenario", "scenario_id"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("sim_scenarios.id"))
    track: Mapped[str] = mapped_column(Text, default="1m")  # 30m/1m
    position: Mapped[int] = mapped_column(default=0)  # order within its track
    image_path: Mapped[str] = mapped_column(Text)
    label: Mapped[str] = mapped_column(Text, default="")  # e.g. the bar time, shown under the chart
    # 30m frames only: the 1m frame from which this frame is shown during
    # replay. Not a ForeignKey — deleting the 1m frame re-points it instead.
    sync_frame_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_quiz: Mapped[bool] = mapped_column(default=False)
    quiz_outcome: Mapped[str] = mapped_column(Text, default="")  # ''/profit/loss — what buying here led to
    quiz_note: Mapped[str] = mapped_column(Text, default="")


class SimAttemptORM(Base):
    __tablename__ = "sim_attempts"
    __table_args__ = (Index("ix_sim_attempts_scenario", "scenario_id"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("sim_scenarios.id"))
    frame_id: Mapped[str] = mapped_column(ForeignKey("sim_frames.id"))
    answer: Mapped[str] = mapped_column(Text)  # buy/skip
    created_at: Mapped[float] = mapped_column(default=0.0)


class SimBarSetORM(Base):
    """The price data behind a 'bars' scenario: every 1-minute bar of the
    imported file. Replay starts at `replay_from`; the bars before it are the
    history already on the chart at that moment."""

    __tablename__ = "sim_bar_sets"

    scenario_id: Mapped[str] = mapped_column(ForeignKey("sim_scenarios.id"), primary_key=True)
    symbol: Mapped[str] = mapped_column(Text, default="")
    source_name: Mapped[str] = mapped_column(Text, default="")  # the imported file's name
    # JSON [[time, open, high, low, close, volume], ...], oldest first — see price_files.Bar.
    bars_json: Mapped[str] = mapped_column(Text, default="[]")
    replay_from: Mapped[int] = mapped_column(default=0)  # a bar's time
    # JSON list of the shapes drawn on the 1-minute chart — see models.SimDrawing.
    drawings_json: Mapped[str] = mapped_column(Text, default="[]")


class SimBarQuizORM(Base):
    """A quiz of a 'bars' scenario — the counterpart of a quiz frame. The
    replay is watched from the bar at `start_time` up to the one at `bar_time`,
    where the question is asked; the two are the same bar for a quiz about a
    single moment."""

    __tablename__ = "sim_bar_quizzes"
    __table_args__ = (Index("ix_sim_bar_quizzes_scenario", "scenario_id"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("sim_scenarios.id"))
    start_time: Mapped[int] = mapped_column(default=0)  # 0 (rows from before ranges): same as bar_time
    bar_time: Mapped[int] = mapped_column(default=0)
    outcome: Mapped[str] = mapped_column(Text, default="")  # ''/profit/loss — whether price rose afterwards
    note: Mapped[str] = mapped_column(Text, default="")
    # JSON of the reading drawn on the chart by "My Insight" ('' when there is none) — see models.SimQuizInsight.
    insight_json: Mapped[str] = mapped_column(Text, default="")


class SimBarAttemptORM(Base):
    __tablename__ = "sim_bar_attempts"
    __table_args__ = (Index("ix_sim_bar_attempts_scenario", "scenario_id"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("sim_scenarios.id"))
    quiz_id: Mapped[str] = mapped_column(ForeignKey("sim_bar_quizzes.id"))
    answer: Mapped[str] = mapped_column(Text)  # buy/skip
    created_at: Mapped[float] = mapped_column(default=0.0)


class InsightNodeORM(Base):
    """One node of the insight map: a tree of what the simulator quizzes
    taught, gathered until common rules show. A node is a grouping, a rule, or
    both — whatever has children groups them."""

    __tablename__ = "insight_nodes"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[Optional[str]] = mapped_column(ForeignKey("insight_nodes.id"), nullable=True)
    position: Mapped[int] = mapped_column(default=0)  # order among its siblings
    kind: Mapped[str] = mapped_column(Text, default="")  # ''/buy/avoid/wait
    status: Mapped[str] = mapped_column(Text, default="candidate")  # candidate/confirmed/dropped
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[float] = mapped_column(default=0.0)


class InsightEvidenceORM(Base):
    """A simulator quiz that an insight node rests on — or one that went
    against it ('counter')."""

    __tablename__ = "insight_evidence"
    __table_args__ = (
        Index("ix_insight_evidence_node", "node_id"),
        Index("ix_insight_evidence_quiz", "quiz_id"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("insight_nodes.id"))
    scenario_id: Mapped[str] = mapped_column(ForeignKey("sim_scenarios.id"))
    quiz_id: Mapped[str] = mapped_column(ForeignKey("sim_bar_quizzes.id"))
    stance: Mapped[str] = mapped_column(Text, default="support")  # support/counter
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[float] = mapped_column(default=0.0)


class OneMinNoteORM(Base):
    __tablename__ = "one_min_notes"

    id: Mapped[str] = mapped_column(primary_key=True)
    column: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[float] = mapped_column(default=0.0)


class StudyPlanNodeORM(Base):
    __tablename__ = "study_plan_nodes"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[Optional[str]] = mapped_column(ForeignKey("study_plan_nodes.id"), nullable=True)
    position: Mapped[int] = mapped_column(default=0)
    start_date: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    end_date: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    result_html: Mapped[str] = mapped_column(Text, default="")
