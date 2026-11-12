"""Load and reject a risk-score configuration before the service answers anyone.

Weights and thresholds are starting guesses. They live in a file so a center can
calibrate them later without hunting through the formula. Startup is the right
moment to refuse a broken file: a bad weight should stop the service, not quietly
change who is flagged.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path

# The service folder holds config.toml. The path is based on this file so the
# score does not depend on which folder the command was launched from.
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PACKAGE_ROOT / "config.toml"

WEIGHT_KEYS = ("absence", "missing_assignments", "grade_trend")
THRESHOLD_KEYS = ("watch", "high")
ABSENCE_KEYS = ("full_streak", "excused_weight")


class ConfigError(ValueError):
    """The configuration cannot be used. The service must not start."""


@dataclass(frozen=True)
class Settings:
    weight_absence: Decimal
    weight_missing: Decimal
    weight_grade: Decimal
    watch: Decimal
    high: Decimal
    full_streak: Decimal
    excused_weight: Decimal
    source: str


def load_config(path: Path | None = None) -> Settings:
    config_path = DEFAULT_CONFIG_PATH if path is None else path
    try:
        raw_text = config_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"Could not read the risk configuration at {config_path}.") from exc
    try:
        document = tomllib.loads(raw_text)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError("The risk configuration is not valid TOML.") from exc
    if not isinstance(document, dict):
        raise ConfigError("The risk configuration must be a TOML document.")

    unknown = set(document) - {"weights", "thresholds", "absence"}
    if unknown:
        names = ", ".join(sorted(unknown))
        raise ConfigError(f"Unexpected configuration section(s): {names}.")

    weights = _table(document, "weights", WEIGHT_KEYS)
    thresholds = _table(document, "thresholds", THRESHOLD_KEYS)
    absence = _table(document, "absence", ABSENCE_KEYS)

    weight_absence = _decimal(weights["absence"], "weights.absence")
    weight_missing = _decimal(weights["missing_assignments"], "weights.missing_assignments")
    weight_grade = _decimal(weights["grade_trend"], "weights.grade_trend")
    watch = _decimal(thresholds["watch"], "thresholds.watch")
    high = _decimal(thresholds["high"], "thresholds.high")
    excused_weight = _decimal(absence["excused_weight"], "absence.excused_weight")
    full_streak = _streak_length(absence["full_streak"])

    for label, weight in (
        ("weights.absence", weight_absence),
        ("weights.missing_assignments", weight_missing),
        ("weights.grade_trend", weight_grade),
    ):
        if weight < 0:
            raise ConfigError(f"{label} cannot be negative.")
        if weight > 1:
            raise ConfigError(f"{label} must be from 0 to 1.")

    total = weight_absence + weight_missing + weight_grade
    if total != Decimal("1"):
        raise ConfigError(f"The three weights must add up to 1. They add up to {total}.")

    if watch < 0 or high < 0 or watch > 100 or high > 100:
        raise ConfigError("Thresholds must be from 0 to 100.")
    if watch >= high:
        raise ConfigError("The Watch threshold must be lower than the High threshold.")

    if excused_weight < 0 or excused_weight > 1:
        raise ConfigError("absence.excused_weight must be from 0 to 1.")

    return Settings(
        weight_absence=weight_absence,
        weight_missing=weight_missing,
        weight_grade=weight_grade,
        watch=watch,
        high=high,
        full_streak=full_streak,
        excused_weight=excused_weight,
        source=str(config_path),
    )


def _table(document: dict, name: str, allowed: tuple[str, ...]) -> dict:
    table = document.get(name)
    if not isinstance(table, dict):
        raise ConfigError(f"Config is missing [{name}].")
    unknown = set(table) - set(allowed)
    if unknown:
        names = ", ".join(sorted(unknown))
        raise ConfigError(f"Unexpected config field(s) in [{name}]: {names}.")
    missing = [key for key in allowed if key not in table]
    if missing:
        names = ", ".join(missing)
        raise ConfigError(f"Config [{name}] is missing: {names}.")
    return table


def _decimal(value: object, label: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ConfigError(f"{label} must be a number.")
    try:
        number = Decimal(str(value))
    except InvalidOperation as exc:
        raise ConfigError(f"{label} must be a number.") from exc
    if not number.is_finite():
        raise ConfigError(f"{label} must be a finite number.")
    return number


def _streak_length(value: object) -> Decimal:
    # A half-absence cannot be the definition of "five in a row".
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ConfigError(
            "absence.full_streak must be a whole number of at least 1."
        )
    return Decimal(value)
