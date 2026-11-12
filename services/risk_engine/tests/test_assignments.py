"""Missing assignments are a ratio. Zero expected work does not become a perfect score."""

from tests.builders import body, repeated


def test_all_assignments_missing_while_the_learner_is_attending(client):
    payload = client.post(
        "/score",
        json=body(
            attendance=repeated("present", 3),
            assignments={"expected": 4, "missing": 4},
        ),
    ).json()
    assert payload["indicators"]["absence"]["value"] == 0
    assert payload["indicators"]["missing_assignments"]["value"] == 1
    assert payload["indicators"]["grade_trend"]["available"] is False
    assert payload["score"] == 30
    assert payload["risk_level"] is None
    assert "4 of 4 expected assignments" in payload["indicators"]["missing_assignments"]["detail"]
    assert "dropout" not in " ".join(payload["reasons"]).lower()


def test_zero_expected_assignments_do_not_divide_by_zero(client):
    payload = client.post(
        "/score",
        json=body(
            attendance=repeated("present", 3),
            assignments={"expected": 0, "missing": 0},
        ),
    ).json()
    missing = payload["indicators"]["missing_assignments"]
    assert missing["available"] is False
    assert missing["value"] is None
    assert missing["expected"] == 0
    assert "not treated as completed work" in missing["detail"]
    assert payload["score"] == 0
    assert payload["risk_level"] is None


def test_partial_missing_assignments_are_a_fraction(client):
    payload = client.post(
        "/score",
        json=body(
            attendance=repeated("present", 3),
            assignments={"expected": 4, "missing": 1},
        ),
    ).json()
    assert payload["indicators"]["missing_assignments"]["value"] == 0.25


def test_impossible_assignment_counts_are_rejected(client):
    negative = client.post(
        "/score",
        json=body(attendance=repeated("present", 3), assignments={"expected": 3, "missing": -1}),
    )
    assert negative.status_code == 422

    too_many = client.post(
        "/score",
        json=body(attendance=repeated("present", 3), assignments={"expected": 2, "missing": 3}),
    )
    assert too_many.status_code == 422
    assert "cannot be greater" in too_many.text

    ungraded_field = client.post(
        "/score",
        json=body(
            attendance=repeated("present", 3),
            assignments={"expected": 3, "missing": 1, "ungraded": 2},
        ),
    )
    assert ungraded_field.status_code == 422
    assert "Extra inputs are not permitted" in ungraded_field.text
