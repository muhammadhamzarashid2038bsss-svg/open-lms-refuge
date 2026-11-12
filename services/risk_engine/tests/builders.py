"""Synthetic request builders. Every code here is fake."""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"
AS_OF = date(2026, 4, 30)


def iso(day: date) -> str:
    return day.isoformat()


def mark(session_id: str, session_date: date, status: str, family: bool = False) -> dict:
    return {
        "session_id": session_id,
        "session_date": iso(session_date),
        "status": status,
        "family_circumstances": family,
    }


def grade(
    assessment_id: str,
    assessment_date: date | None,
    points: float | None,
    maximum: float | None = 100,
    resolved: bool = True,
) -> dict:
    return {
        "assessment_id": assessment_id,
        "assessment_date": None if assessment_date is None else iso(assessment_date),
        "points": points,
        "maximum": maximum,
        "resolved": resolved,
    }


def body(
    *,
    learner: str = "LNR-0014",
    as_of: date = AS_OF,
    attendance: list | None = None,
    assignments: dict | None = None,
    grades: list | None = None,
    include_assignments: bool = False,
) -> dict:
    payload: dict = {"learner_code": learner, "as_of": iso(as_of)}
    if attendance is not None:
        payload["attendance"] = attendance
    if include_assignments or assignments is not None:
        payload["assignments"] = assignments
    if grades is not None:
        payload["grades"] = grades
    return payload


def repeated(
    status: str, count: int, *, family: bool = False, start: date | None = None
) -> list[dict]:
    first = AS_OF - timedelta(days=count) if start is None else start
    return [
        mark(f"s{index}", first + timedelta(days=index), status, family) for index in range(count)
    ]


def flat_grades(points: float = 80, *, days_apart: int = 28, count: int = 6) -> list[dict]:
    early = AS_OF - timedelta(days=days_apart)
    grades = []
    for index in range(count):
        day = early if index < SIDE_SPLIT else AS_OF
        grades.append(grade(f"g{index}", day, points))
    return grades


# The first half of a six-grade list sits on the early day, the rest on as_of.
SIDE_SPLIT = 3


def load_example(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))
