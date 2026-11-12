"""Three indicators and the weighted score.

The grade-trend arithmetic is the approved rule: eight weeks, six settled
percentages, a four-week span, and the middle of the first three compared with
the middle of the last three. This file does not invent a different trend.

An indicator that cannot be calculated is reported as unavailable. It adds no
points. The other weights stay as configured. Unavailable is not a good result
and it is not a poor result.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.config import Settings
from app.schemas import (
    AbsenceReading,
    AssignmentCounts,
    ExcludedGrades,
    GradeInput,
    GradeReading,
    IndicatorSet,
    MissingReading,
    ScoreRequest,
    ScoreResponse,
    SessionMark,
)

# The product rule: fewer than three usable records is not enough for a score.
# This stays in code, not in the editable weight file, so a config edit cannot
# quietly lower the guard against false alarms.
DATA_POINT_MINIMUM = 3

# Approved grade-trend window. 8 weeks = 56 days, ending on the scoring date.
# 4 weeks = 28 days from the first usable grade in that window to the last.
LOOKBACK_DAYS = 56
MINIMUM_SPAN_DAYS = 28
GRADE_OBSERVATION_MINIMUM = 6
SIDE_COUNT = 3
DECLINE_DIVISOR = Decimal("10")
QUANTUM = Decimal("0.0001")

NOTE = (
    "Starting estimates only. A person decides whether to check in. "
    "This score does not predict that a learner will leave the center."
)


@dataclass(frozen=True)
class _AbsenceMath:
    available: bool
    value: Decimal | None
    longest: Decimal | None
    recorded_sessions: int
    family_count: int
    detail: str


@dataclass(frozen=True)
class _MissingMath:
    available: bool
    value: Decimal | None
    missing: int | None
    expected: int | None
    detail: str


@dataclass(frozen=True)
class _ValidGrade:
    assessment_id: str
    assessment_date: date
    percent: Decimal


@dataclass(frozen=True)
class _GradeMath:
    available: bool
    value: Decimal | None
    valid_in_window: int
    span_days: int | None
    early_median: Decimal | None
    recent_median: Decimal | None
    decline: Decimal | None
    excluded: ExcludedGrades
    usable_grades: int
    detail: str


def calculate(request: ScoreRequest, settings: Settings) -> ScoreResponse:
    absence = _absence(request.attendance, settings)
    missing = _missing(request.assignments)
    grades = _grades(request.grades, request.as_of)
    usable = absence.recorded_sessions
    if missing.expected:
        usable += missing.expected
    usable += grades.usable_grades

    any_available = absence.available or missing.available or grades.available
    # No calculable indicator means a numeric score would only be a guess.
    # Three old records that still cannot fill an indicator stay unscored.
    insufficient = usable < DATA_POINT_MINIMUM or not any_available

    score: Decimal | None = None
    level: str | None
    if insufficient:
        level = "Insufficient data"
    else:
        score = _quantize(
            (
                settings.weight_absence * _or_zero(absence.value)
                + settings.weight_missing * _or_zero(missing.value)
                + settings.weight_grade * _or_zero(grades.value)
            )
            * Decimal(100)
        )
        if score < 0 or score > 100:
            raise RuntimeError("The risk score fell outside 0 to 100.")
        if score >= settings.high:
            level = "High"
        elif score >= settings.watch:
            level = "Watch"
        else:
            level = None

    reasons = _reasons(
        absence=absence,
        missing=missing,
        grades=grades,
        settings=settings,
        insufficient=insufficient,
        usable=usable,
        score=score,
        level=level,
    )
    return ScoreResponse(
        learner_code=request.learner_code,
        score=None if score is None else float(score),
        risk_level=level,  # type: ignore[arg-type]
        usable_data_points=usable,
        minimum_usable_data_points=DATA_POINT_MINIMUM,
        indicators=IndicatorSet(
            absence=_absence_reading(absence),
            missing_assignments=_missing_reading(missing),
            grade_trend=_grade_reading(grades),
        ),
        reasons=reasons,
        check_in_suggested=absence.family_count > 0,
        note=NOTE,
    )


def _absence(sessions: list[SessionMark], settings: Settings) -> _AbsenceMath:
    """Longest weighted run of absences, after ordering by the class date.

    Cancelled sessions are removed first. The class did not happen, so it must
    not count and must not break the surrounding run.

    A blank (unmarked) session is not an absence. It ends the run. Skipping a
    blank would glue the absences on either side into one run and treat the
    blank as continued absence.

    A family-circumstances absence adds no weight and also ends the run. If it
    were skipped like a cancellation, it would glue unexcused absences together
    and the score could rise because of that mark.

    An ordinary excused absence, such as illness, stays inside the run and adds
    the configured quarter-weight instead of 1.
    """
    ordered = sorted(sessions, key=lambda mark: (mark.session_date, mark.session_id))
    running = Decimal(0)
    longest = Decimal(0)
    recorded = 0
    family_count = 0

    for mark in ordered:
        if mark.status == "cancelled":
            continue
        if mark.status == "unmarked":
            running = Decimal(0)
            continue
        recorded += 1
        if mark.status in ("present", "late"):
            running = Decimal(0)
            continue
        if mark.family_circumstances:
            family_count += 1
            running = Decimal(0)
            continue
        if mark.status == "absent":
            running += Decimal(1)
        else:
            running += settings.excused_weight
        if running > longest:
            longest = running

    if recorded == 0:
        return _AbsenceMath(
            available=False,
            value=None,
            longest=None,
            recorded_sessions=0,
            family_count=family_count,
            detail=(
                "The absence indicator is unavailable. No present, late, absent, "
                "or excused session was sent. Cancelled sessions and blank sessions "
                "are not treated as absences, and they are not treated as proof of "
                "good attendance."
            ),
        )

    value = longest / settings.full_streak
    if value > 1:
        value = Decimal(1)
    detail = (
        f"The longest recorded absence run weighs {_plain(longest)} "
        f"on a scale where {_plain(settings.full_streak)} consecutive unexcused "
        "absences equal 1. "
        f"An ordinary excused absence adds {_plain(settings.excused_weight)} instead of 1. "
        "Present and late marks end a run. Cancelled sessions are left out. "
        "A blank session ends a run and is not counted as an absence. "
        "This describes recorded sessions. It is not a prediction."
    )
    if family_count:
        detail += (
            f" {_count_phrase(family_count, 'family-circumstances absence')} added no weight "
            "and ended the run, so they do not raise the score."
        )
    return _AbsenceMath(
        available=True,
        value=value,
        longest=longest,
        recorded_sessions=recorded,
        family_count=family_count,
        detail=detail,
    )


def _missing(counts: AssignmentCounts | None) -> _MissingMath:
    if counts is None:
        return _MissingMath(
            available=False,
            value=None,
            missing=None,
            expected=None,
            detail=(
                "The missing-assignment indicator is unavailable because no assignment "
                "counts were sent. That is not treated as completed work."
            ),
        )
    if counts.expected == 0:
        # Dividing by zero is avoided. Zero expected work is not "nothing missing".
        return _MissingMath(
            available=False,
            value=None,
            missing=counts.missing,
            expected=0,
            detail=(
                "The missing-assignment indicator is unavailable because expected "
                "assignments are 0. Zero expected work is not treated as completed work. "
                "Ungraded assignments and assignments that are not yet due must not be "
                "included in these counts."
            ),
        )
    value = Decimal(counts.missing) / Decimal(counts.expected)
    if value > 1:
        value = Decimal(1)
    return _MissingMath(
        available=True,
        value=value,
        missing=counts.missing,
        expected=counts.expected,
        detail=(
            f"{counts.missing} of {counts.expected} expected assignments have no work. "
            "Ungraded assignments and assignments that are not yet due are not included "
            "in these counts. This is not a prediction."
        ),
    )


def _grades(grades: list[GradeInput], as_of: date) -> _GradeMath:
    excluded = ExcludedGrades()
    usable: list[_ValidGrade] = []
    in_window: list[_ValidGrade] = []
    window_start = as_of - timedelta(days=LOOKBACK_DAYS)

    for grade in grades:
        # Order matters. An open conflict is excluded even when the date or mark
        # is also missing, so a conflict is never described as a missing grade.
        if not grade.resolved:
            excluded.unresolved += 1
            continue
        if grade.assessment_date is None:
            excluded.no_academic_date += 1
            continue
        if grade.points is None or grade.maximum is None:
            excluded.ungraded_or_missing += 1
            continue
        percent = grade.points / grade.maximum * Decimal(100)
        item = _ValidGrade(grade.assessment_id, grade.assessment_date, percent)
        if item.assessment_date > as_of or item.assessment_date < window_start:
            excluded.outside_lookback += 1
            if item.assessment_date <= as_of:
                usable.append(item)
            continue
        usable.append(item)
        in_window.append(item)

    # Academic date, then the immutable id. List order, database insert order,
    # and phone clocks are not used.
    in_window.sort(key=lambda item: (item.assessment_date, item.assessment_id))
    span: int | None = None
    if len(in_window) >= 2:
        span = (in_window[-1].assessment_date - in_window[0].assessment_date).days

    enough = len(in_window) >= GRADE_OBSERVATION_MINIMUM
    covered = span is not None and span >= MINIMUM_SPAN_DAYS
    if not enough or not covered:
        if len(in_window) == 0:
            span_text = "none"
        elif span is None:
            span_text = "0"
        else:
            span_text = str(span)
        return _GradeMath(
            available=False,
            value=None,
            valid_in_window=len(in_window),
            span_days=span,
            early_median=None,
            recent_median=None,
            decline=None,
            excluded=excluded,
            usable_grades=len(usable),
            detail=(
                "The grade-trend indicator is unavailable. "
                f"Settled grades inside the 8-week window: {len(in_window)}. "
                f"Days from the first of those grades to the last: {span_text}. "
                "A result needs at least 6 settled grades spanning at least 28 days. "
                "Unavailable is not treated as steady performance, and the original "
                "weights are not given to the other indicators."
            ),
        )

    early = _median([item.percent for item in in_window[:SIDE_COUNT]])
    recent = _median([item.percent for item in in_window[-SIDE_COUNT:]])
    decline = early - recent
    if decline < 0:
        decline = Decimal(0)
    value = decline / DECLINE_DIVISOR
    if value > 1:
        value = Decimal(1)
    return _GradeMath(
        available=True,
        value=value,
        valid_in_window=len(in_window),
        span_days=span,
        early_median=early,
        recent_median=recent,
        decline=decline,
        excluded=excluded,
        usable_grades=len(usable),
        detail=(
            "Within the 8 weeks ending on the scoring date, the middle of the three "
            f"earliest grades is {_plain(early)} and the middle of the three latest "
            f"grades is {_plain(recent)}. The decline is {_plain(decline)} points, "
            "and the indicator is that decline divided by 10, capped at 1. "
            "One unusually low or high grade cannot set the middle value by itself. "
            "Grades are percentages of each assessment's own maximum. Those "
            "percentages are not adjusted for how hard each assessment was."
        ),
    )


def _median(values: list[Decimal]) -> Decimal:
    ordered = sorted(values)
    return ordered[1]


def _reasons(
    *,
    absence: _AbsenceMath,
    missing: _MissingMath,
    grades: _GradeMath,
    settings: Settings,
    insufficient: bool,
    usable: int,
    score: Decimal | None,
    level: str | None,
) -> list[str]:
    reasons = [absence.detail, missing.detail, grades.detail]
    if insufficient:
        if usable < DATA_POINT_MINIMUM:
            reasons.append(
                "Insufficient data. "
                f"Only {usable} usable record(s) were sent, and a score needs at least "
                f"{DATA_POINT_MINIMUM}. A usable record is a present, late, absent, or "
                "excused session, one expected assignment, or one settled grade with an "
                "academic date on or before the scoring date. No score is shown."
            )
        else:
            reasons.append(
                "Insufficient data. Records were sent, but none of the three indicators "
                "can be calculated from them. No score is shown. This is not treated as "
                "good performance or poor performance."
            )
    elif score is not None and level == "High":
        reasons.append(
            f"The score is {_plain(score)}, at or above the starting High level of "
            f"{_plain(settings.high)}. This suggests a prompt supportive check-in. "
            "It does not mean the learner will leave."
        )
    elif score is not None and level == "Watch":
        reasons.append(
            f"The score is {_plain(score)}, at or above the starting Watch level of "
            f"{_plain(settings.watch)}. A person should review the indicators. "
            "It does not mean the learner will leave."
        )
    elif score is not None:
        reasons.append(
            f"The score is {_plain(score)}, below the starting Watch level of "
            f"{_plain(settings.watch)}. No risk level is assigned. A person still "
            "decides whether to check in."
        )
    if not insufficient and not (absence.available and missing.available and grades.available):
        reasons.append(
            "The original weights stay in place. An unavailable indicator contributes "
            "no numerical points. That absence of evidence is not a good result."
        )
    if absence.family_count:
        reasons.append(
            "Check-in suggested. "
            f"{_count_phrase(absence.family_count, 'absence')} "
            f"{'was' if absence.family_count == 1 else 'were'} marked family circumstances, "
            "with no private details stored. Those absences do not raise the score. "
            "A supportive conversation or visit may help. Nothing happens automatically."
        )
    return reasons


def _absence_reading(result: _AbsenceMath) -> AbsenceReading:
    return AbsenceReading(
        available=result.available,
        value=_float_or_none(result.value),
        detail=result.detail,
        longest_weighted_run=_float_or_none(result.longest),
        recorded_sessions=result.recorded_sessions,
        family_circumstances_count=result.family_count,
    )


def _missing_reading(result: _MissingMath) -> MissingReading:
    return MissingReading(
        available=result.available,
        value=_float_or_none(result.value),
        detail=result.detail,
        missing=result.missing,
        expected=result.expected,
    )


def _grade_reading(result: _GradeMath) -> GradeReading:
    return GradeReading(
        available=result.available,
        value=_float_or_none(result.value),
        detail=result.detail,
        valid_in_window=result.valid_in_window,
        span_days=result.span_days,
        early_median=_float_or_none(result.early_median),
        recent_median=_float_or_none(result.recent_median),
        decline=_float_or_none(result.decline),
        excluded=result.excluded,
    )


def _or_zero(value: Decimal | None) -> Decimal:
    return Decimal(0) if value is None else value


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(QUANTUM, rounding=ROUND_HALF_UP)


def _float_or_none(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(_quantize(value))


def _count_phrase(count: int, singular: str) -> str:
    word = singular if count == 1 else f"{singular}s"
    return f"{count} {word}"


def _plain(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"
