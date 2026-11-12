"""Score boundaries, empty input, and the synthetic examples shipped with the service."""

from datetime import timedelta

from tests.builders import AS_OF, body, flat_grades, grade, load_example, repeated


def test_health_and_docs_are_available(client):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_example_five_unexcused_absences(client):
    payload = client.post("/score", json=load_example("five_unexcused.json")).json()
    assert payload["learner_code"] == "LNR-0014"
    assert payload["indicators"]["absence"]["value"] == 1
    assert payload["indicators"]["missing_assignments"]["value"] == 0
    assert payload["indicators"]["grade_trend"]["available"] is False
    assert payload["score"] == 50
    assert payload["risk_level"] == "Watch"
    assert "starting estimates" in payload["note"].lower()
    assert "dropout" not in " ".join(payload["reasons"]).lower()
    assert "dropout" not in payload["note"].lower()


def test_example_family_circumstances_with_too_little_data(client):
    payload = client.post("/score", json=load_example("family_circumstances_only.json")).json()
    assert payload["learner_code"] == "LNR-0015"
    assert payload["score"] is None
    assert payload["risk_level"] == "Insufficient data"
    assert payload["check_in_suggested"] is True
    assert payload["indicators"]["absence"]["value"] == 0
    assert any("Check-in suggested" in reason for reason in payload["reasons"])
    assert any("do not raise the score" in reason for reason in payload["reasons"])


def test_empty_input_does_not_fabricate_a_score(client):
    response = client.post(
        "/score",
        json={"learner_code": "LNR-0099", "as_of": "2026-04-30"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["score"] is None
    assert payload["risk_level"] == "Insufficient data"
    assert payload["usable_data_points"] == 0
    assert payload["indicators"]["absence"]["available"] is False
    assert payload["indicators"]["missing_assignments"]["available"] is False
    assert payload["indicators"]["grade_trend"]["available"] is False
    assert payload["check_in_suggested"] is False


def test_records_that_cannot_fill_an_indicator_are_not_scored_as_zero(client):
    # Three settled grades on one day are real records, but they cannot fill the
    # approved grade trend. A score of 0 would look like steady performance.
    day = AS_OF - timedelta(days=7)
    grades = [grade(f"g{index}", day, 80) for index in range(3)]
    payload = client.post("/score", json=body(grades=grades)).json()
    assert payload["usable_data_points"] == 3
    assert payload["indicators"]["grade_trend"]["available"] is False
    assert payload["score"] is None
    assert payload["risk_level"] == "Insufficient data"
    assert any("not treated as" in reason for reason in payload["reasons"])


def test_score_and_indicators_stay_inside_their_ranges(client):
    low = client.post(
        "/score",
        json=body(
            attendance=repeated("present", 3),
            assignments={"expected": 1, "missing": 0},
            grades=flat_grades(80),
        ),
    ).json()
    assert low["score"] == 0
    assert low["risk_level"] is None
    for name in ("absence", "missing_assignments", "grade_trend"):
        assert low["indicators"][name]["value"] == 0

    early = AS_OF - timedelta(days=28)
    falling = [
        grade(f"h{index}", early if index < 3 else AS_OF, 90 if index < 3 else 70)
        for index in range(6)
    ]
    high = client.post(
        "/score",
        json=body(
            attendance=repeated("absent", 5),
            assignments={"expected": 1, "missing": 1},
            grades=falling,
        ),
    ).json()
    assert high["indicators"]["absence"]["value"] == 1
    assert high["indicators"]["missing_assignments"]["value"] == 1
    assert high["indicators"]["grade_trend"]["value"] == 1
    assert high["score"] == 100
    assert high["risk_level"] == "High"
    assert 0 <= high["score"] <= 100

    watch = client.post("/score", json=body(attendance=repeated("absent", 4))).json()
    assert watch["score"] == 40
    assert watch["risk_level"] == "Watch"

    at_high = client.post(
        "/score",
        json=body(
            attendance=repeated("absent", 5),
            assignments={"expected": 1, "missing": 0},
            grades=falling,
        ),
    ).json()
    assert at_high["score"] == 70
    assert at_high["risk_level"] == "High"


def test_a_score_below_watch_has_no_risk_level(client):
    payload = client.post("/score", json=body(attendance=repeated("absent", 3))).json()
    assert payload["score"] == 30
    assert payload["risk_level"] is None
    assert any("No risk level is assigned" in reason for reason in payload["reasons"])


def test_unavailable_grade_trend_does_not_redistribute_weights(client):
    payload = client.post("/score", json=body(attendance=repeated("absent", 5))).json()
    assert payload["indicators"]["grade_trend"]["available"] is False
    assert payload["indicators"]["grade_trend"]["value"] is None
    # A full absence indicator at the original 0.5 weight is 50, not 100.
    assert payload["score"] == 50
    assert any("original weights stay in place" in reason for reason in payload["reasons"])
