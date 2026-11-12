"""Request and response shapes.

The request is strict on purpose. A field that is not listed here is rejected,
even when it is a name, a phone number, or a note. The service is not a place
to store a family's story.

Grade `resolved` defaults to false so an omitted flag cannot quietly enter the
trend. The family-circumstances flag defaults to false so an ordinary absence
is still counted; the caller must set the flag when that closed category applies.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# A code such as LNR-0014. The hyphen and the digit make a plain personal name
# fail validation. This is an anonymous code, not a display name.
LEARNER_CODE = re.compile(r"^[A-Z]{2,12}-[A-Z0-9]{2,16}$")
# Immutable ids used only to order rows that share a date. Not a person's name.
OBJECT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")

SessionStatus = Literal["present", "late", "absent", "excused", "cancelled", "unmarked"]
RiskLevel = Literal["Watch", "High", "Insufficient data"]


def _reject_bool(value: object) -> object:
    # JSON true must not become the number 1. True is a subclass of int in Python.
    if isinstance(value, bool):
        raise ValueError("Use a number, not true or false.")
    return value


class SessionMark(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    session_date: date
    status: SessionStatus
    family_circumstances: bool = False

    @field_validator("session_id")
    @classmethod
    def session_id_shape(cls, value: str) -> str:
        if not OBJECT_ID.fullmatch(value):
            raise ValueError("Use a session id made of letters, digits, and simple separators.")
        return value

    @model_validator(mode="after")
    def family_flag_only_on_absences(self) -> SessionMark:
        # The flag is a yes/no for one closed category. It is not a reason text.
        # Present, late, cancelled, and blank sessions cannot carry it.
        if self.family_circumstances and self.status not in ("absent", "excused"):
            raise ValueError(
                "family_circumstances is only valid when status is absent or excused."
            )
        return self


class AssignmentCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected: int = Field(ge=0)
    missing: int = Field(ge=0)

    @field_validator("expected", "missing", mode="before")
    @classmethod
    def counts_are_numbers(cls, value: object) -> object:
        return _reject_bool(value)

    @model_validator(mode="after")
    def missing_cannot_exceed_expected(self) -> AssignmentCounts:
        if self.missing > self.expected:
            raise ValueError("Missing assignments cannot be greater than expected assignments.")
        return self


class GradeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assessment_id: str
    assessment_date: date | None = None
    points: Decimal | None = None
    maximum: Decimal | None = None
    resolved: bool = False

    @field_validator("assessment_id")
    @classmethod
    def assessment_id_shape(cls, value: str) -> str:
        if not OBJECT_ID.fullmatch(value):
            raise ValueError("Use an assessment id made of letters, digits, and simple separators.")
        return value

    @field_validator("points", "maximum", mode="before")
    @classmethod
    def marks_are_decimal(cls, value: object) -> object:
        if value is None:
            return None
        value = _reject_bool(value)
        if isinstance(value, Decimal):
            return value
        if isinstance(value, (int, float, str)):
            # str() of a JSON number such as 0.5 is "0.5", so the percentage stays exact.
            return Decimal(str(value))
        return value

    @model_validator(mode="after")
    def marks_fit_a_percentage(self) -> GradeInput:
        # A percentage above 100 or below 0 would make "decline / 10" meaningless.
        # Refuse the request so one bad mark is not quietly dropped or quietly kept.
        if self.points is not None and self.maximum is None:
            raise ValueError("A grade needs its maximum score so it can become a percentage.")
        if self.maximum is not None and self.maximum <= 0:
            raise ValueError("The maximum score must be greater than zero.")
        if self.points is not None and self.points < 0:
            raise ValueError("A grade below zero is not a valid mark.")
        if (
            self.points is not None
            and self.maximum is not None
            and self.points > self.maximum
        ):
            raise ValueError("A grade cannot be above its maximum score.")
        return self


class ThresholdInput(BaseModel):
    """Watch and High levels for one scoring request.

    A center director can change these. The service checks the numbers itself.
    Weights are not accepted here, so a threshold change cannot retune the formula.
    """

    model_config = ConfigDict(extra="forbid")

    watch: Decimal
    high: Decimal

    @field_validator("watch", "high", mode="before")
    @classmethod
    def thresholds_are_numbers(cls, value: object) -> object:
        value = _reject_bool(value)
        if isinstance(value, Decimal):
            return value
        if isinstance(value, (int, float, str)):
            return Decimal(str(value))
        return value

    @model_validator(mode="after")
    def watch_is_below_high(self) -> ThresholdInput:
        if not self.watch.is_finite() or not self.high.is_finite():
            raise ValueError("Thresholds must be finite numbers.")
        if self.watch < 0 or self.high < 0 or self.watch > 100 or self.high > 100:
            raise ValueError("Thresholds must be from 0 to 100.")
        if self.watch >= self.high:
            raise ValueError("The Watch threshold must be lower than the High threshold.")
        return self


class ScoreRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "learner_code": "LNR-0014",
                    "as_of": "2026-04-30",
                    "attendance": [
                        {
                            "session_id": "s1",
                            "session_date": "2026-04-06",
                            "status": "absent",
                            "family_circumstances": False,
                        },
                        {
                            "session_id": "s2",
                            "session_date": "2026-04-08",
                            "status": "absent",
                            "family_circumstances": False,
                        },
                        {
                            "session_id": "s3",
                            "session_date": "2026-04-13",
                            "status": "absent",
                            "family_circumstances": False,
                        },
                        {
                            "session_id": "s4",
                            "session_date": "2026-04-15",
                            "status": "absent",
                            "family_circumstances": False,
                        },
                        {
                            "session_id": "s5",
                            "session_date": "2026-04-20",
                            "status": "absent",
                            "family_circumstances": False,
                        },
                    ],
                    "assignments": {"expected": 4, "missing": 0},
                    "grades": [],
                }
            ]
        },
    )

    learner_code: str
    as_of: date
    attendance: list[SessionMark] = Field(default_factory=list)
    assignments: AssignmentCounts | None = None
    grades: list[GradeInput] = Field(default_factory=list)
    # Empty means "use the levels in config.toml". A center sends its own
    # Watch and High levels here. Weights stay in the configuration file.
    thresholds: ThresholdInput | None = None

    @field_validator("learner_code")
    @classmethod
    def anonymous_code(cls, value: str) -> str:
        if not LEARNER_CODE.fullmatch(value) or not any(character.isdigit() for character in value):
            raise ValueError(
                "Use an anonymous learner code such as LNR-0014. Do not send a name."
            )
        return value

    @model_validator(mode="after")
    def ids_are_unique(self) -> ScoreRequest:
        _unique((mark.session_id for mark in self.attendance), "session_id")
        _unique((grade.assessment_id for grade in self.grades), "assessment_id")
        return self


def _unique(values, label: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ValueError(f"Each {label} must be unique. Repeated id: {value}.")
        seen.add(value)


class AbsenceReading(BaseModel):
    available: bool
    value: float | None = None
    detail: str
    longest_weighted_run: float | None = None
    recorded_sessions: int = 0
    family_circumstances_count: int = 0


class MissingReading(BaseModel):
    available: bool
    value: float | None = None
    detail: str
    missing: int | None = None
    expected: int | None = None


class ExcludedGrades(BaseModel):
    ungraded_or_missing: int = 0
    unresolved: int = 0
    no_academic_date: int = 0
    outside_lookback: int = 0


class GradeReading(BaseModel):
    available: bool
    value: float | None = None
    detail: str
    valid_in_window: int = 0
    span_days: int | None = None
    early_median: float | None = None
    recent_median: float | None = None
    decline: float | None = None
    excluded: ExcludedGrades


class IndicatorSet(BaseModel):
    absence: AbsenceReading
    missing_assignments: MissingReading
    grade_trend: GradeReading


class AppliedConfiguration(BaseModel):
    """The numbers that actually produced this result.

    The learning app stores these with the flag. A later threshold change
    does not rewrite an older result.
    """

    model_config = ConfigDict(extra="forbid")

    calculation_version: Literal["day14-v1"]
    weight_absence: float
    weight_missing: float
    weight_grade: float
    watch: float
    high: float


class ScoreResponse(BaseModel):
    learner_code: str
    score: float | None
    risk_level: RiskLevel | None
    usable_data_points: int
    minimum_usable_data_points: int
    indicators: IndicatorSet
    reasons: list[str]
    check_in_suggested: bool
    note: str
    applied: AppliedConfiguration


class HealthResponse(BaseModel):
    status: Literal["ok"]
