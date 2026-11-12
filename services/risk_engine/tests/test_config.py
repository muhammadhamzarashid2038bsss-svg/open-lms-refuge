"""Configuration is checked before the service will score anyone."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.config import ConfigError, load_config
from app.main import create_app
from tests.builders import body, repeated


def _write(path, **overrides) -> None:
    values = {
        "absence": "0.5",
        "missing": "0.3",
        "grade": "0.2",
        "watch": "40",
        "high": "70",
        "streak": "5",
        "excused": "0.25",
    }
    values.update(overrides)
    path.write_text(
        "\n".join(
            [
                "[weights]",
                f"absence = {values['absence']}",
                f"missing_assignments = {values['missing']}",
                f"grade_trend = {values['grade']}",
                "",
                "[thresholds]",
                f"watch = {values['watch']}",
                f"high = {values['high']}",
                "",
                "[absence]",
                f"full_streak = {values['streak']}",
                f"excused_weight = {values['excused']}",
                "",
            ]
        ),
        encoding="utf-8",
    )


def test_default_configuration_uses_the_starting_estimates():
    settings = load_config()
    assert settings.weight_absence == Decimal("0.5")
    assert settings.weight_missing == Decimal("0.3")
    assert settings.weight_grade == Decimal("0.2")
    assert settings.watch == Decimal("40")
    assert settings.high == Decimal("70")
    assert settings.full_streak == Decimal("5")
    assert settings.excused_weight == Decimal("0.25")


def test_changing_weights_changes_the_score(tmp_path):
    config_path = tmp_path / "config.toml"
    _write(config_path, absence="1", missing="0", grade="0")
    with TestClient(create_app(config_path)) as client:
        payload = client.post("/score", json=body(attendance=repeated("absent", 5))).json()
    assert payload["score"] == 100
    assert payload["risk_level"] == "High"


def test_changing_the_watch_threshold_changes_the_level(tmp_path):
    config_path = tmp_path / "config.toml"
    _write(config_path, watch="60", high="80")
    with TestClient(create_app(config_path)) as client:
        payload = client.post("/score", json=body(attendance=repeated("absent", 5))).json()
    # The default Watch level is 40, so this score of 50 would usually be Watch.
    assert payload["score"] == 50
    assert payload["risk_level"] is None


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"absence": "-0.1", "missing": "0.6", "grade": "0.5"}, "cannot be negative"),
        ({"absence": "1.5", "missing": "0", "grade": "0"}, "must be from 0 to 1"),
        ({"absence": "0.2", "missing": "0.2", "grade": "0.2"}, "must add up to 1"),
        ({"watch": "40", "high": "40"}, "lower than the High threshold"),
        ({"watch": "80", "high": "70"}, "lower than the High threshold"),
        ({"watch": "-1", "high": "70"}, "from 0 to 100"),
        ({"watch": "40", "high": "101"}, "from 0 to 100"),
        ({"streak": "0"}, "whole number of at least 1"),
        ({"streak": "2.5"}, "whole number of at least 1"),
        ({"excused": "1.5"}, "from 0 to 1"),
    ],
)
def test_invalid_configuration_is_rejected(tmp_path, overrides, fragment):
    config_path = tmp_path / "config.toml"
    _write(config_path, **overrides)
    with pytest.raises(ConfigError, match=fragment):
        load_config(config_path)
    with pytest.raises(ConfigError):
        create_app(config_path)


def test_unexpected_and_missing_configuration_fields_are_rejected(tmp_path):
    broken = tmp_path / "extra.toml"
    broken.write_text(
        "\n".join(
            [
                "[weights]",
                "absence = 0.5",
                "missing_assignments = 0.3",
                "grade_trend = 0.2",
                "secret_note = 1",
                "",
                "[thresholds]",
                "watch = 40",
                "high = 70",
                "",
                "[absence]",
                "full_streak = 5",
                "excused_weight = 0.25",
                "",
            ]
        ),
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="Unexpected config field"):
        load_config(broken)

    missing = tmp_path / "missing.toml"
    missing.write_text("[weights]\nabsence = 0.5\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="missing"):
        load_config(missing)

    garbage = tmp_path / "garbage.toml"
    garbage.write_text("this is not toml", encoding="utf-8")
    with pytest.raises(ConfigError, match="not valid TOML"):
        load_config(garbage)
