"""A request may set Watch and High. It may not set the weights."""

from fastapi.testclient import TestClient

from app.main import create_app
from tests.builders import body, repeated


def test_request_thresholds_change_the_level_and_not_the_score(client):
    # Five unexcused absences score 50 with the approved weights.
    low_watch = client.post(
        "/score",
        json=body(attendance=repeated("absent", 5), thresholds={"watch": 30, "high": 45}),
    ).json()
    assert low_watch["score"] == 50
    assert low_watch["risk_level"] == "High"
    assert low_watch["applied"]["watch"] == 30
    assert low_watch["applied"]["high"] == 45
    assert low_watch["applied"]["weight_absence"] == 0.5
    assert low_watch["applied"]["weight_missing"] == 0.3
    assert low_watch["applied"]["weight_grade"] == 0.2
    assert low_watch["applied"]["calculation_version"] == "day14-v1"
    assert "High level of 45" in " ".join(low_watch["reasons"])

    high_watch = client.post(
        "/score",
        json=body(attendance=repeated("absent", 5), thresholds={"watch": 60, "high": 80}),
    ).json()
    assert high_watch["score"] == 50
    assert high_watch["risk_level"] is None
    assert high_watch["applied"]["watch"] == 60
    assert "Watch level of 60" in " ".join(high_watch["reasons"])


def test_omitted_thresholds_keep_the_configuration_file(client):
    payload = client.post("/score", json=body(attendance=repeated("absent", 5))).json()
    assert payload["score"] == 50
    assert payload["risk_level"] == "Watch"
    assert payload["applied"]["watch"] == 40
    assert payload["applied"]["high"] == 70


def test_invalid_request_thresholds_are_rejected(client):
    cases = (
        {"watch": -1, "high": 70},
        {"watch": 40, "high": 101},
        {"watch": 70, "high": 70},
        {"watch": 80, "high": 70},
        {"watch": True, "high": 70},
    )
    for thresholds in cases:
        response = client.post(
            "/score",
            json=body(attendance=repeated("present", 3), thresholds=thresholds),
        )
        assert response.status_code == 422
        assert "True" not in response.text


def test_a_request_cannot_replace_the_weights(client):
    response = client.post(
        "/score",
        json=body(
            attendance=repeated("absent", 5),
            extra={"weights": {"absence": 1, "missing_assignments": 0, "grade_trend": 0}},
        ),
    )
    assert response.status_code == 422


def test_request_thresholds_do_not_follow_a_different_config_file(tmp_path):
    # The file says Watch 60. The request says Watch 40. The request wins.
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        "\n".join(
            [
                "[weights]",
                "absence = 0.5",
                "missing_assignments = 0.3",
                "grade_trend = 0.2",
                "",
                "[thresholds]",
                "watch = 60",
                "high = 90",
                "",
                "[absence]",
                "full_streak = 5",
                "excused_weight = 0.25",
                "",
            ]
        ),
        encoding="utf-8",
    )
    with TestClient(create_app(config_path)) as client:
        client.headers.update({"X-Risk-Service-Key": "test-risk-key"})
        payload = client.post(
            "/score",
            json=body(attendance=repeated("absent", 5), thresholds={"watch": 40, "high": 70}),
        ).json()
    assert payload["score"] == 50
    assert payload["risk_level"] == "Watch"
    assert payload["applied"]["weight_absence"] == 0.5
