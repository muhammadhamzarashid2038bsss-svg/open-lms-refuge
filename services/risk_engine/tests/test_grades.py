"""Approved grade trend: six percentages, four-week span, median of three, decline / 10."""

from datetime import timedelta

from tests.builders import AS_OF, SIDE_SPLIT, body, flat_grades, grade, load_example, repeated


def _post(client, grades, attendance=None):
    return client.post(
        "/score",
        json=body(attendance=attendance, grades=grades),
    ).json()


def test_decline_of_zero_five_and_ten_points(client):
    steady = _post(client, flat_grades(80), attendance=repeated("present", 3))
    assert steady["indicators"]["grade_trend"]["decline"] == 0
    assert steady["indicators"]["grade_trend"]["value"] == 0

    five = []
    early = AS_OF - timedelta(days=28)
    for index, points in enumerate((80, 80, 80, 75, 75, 75)):
        day = early if index < SIDE_SPLIT else AS_OF
        five.append(grade(f"d{index}", day, points))
    five_body = _post(client, five, attendance=repeated("present", 3))
    assert five_body["indicators"]["grade_trend"]["decline"] == 5
    assert five_body["indicators"]["grade_trend"]["value"] == 0.5

    ten = []
    for index, points in enumerate((90, 90, 90, 80, 80, 80)):
        day = early if index < SIDE_SPLIT else AS_OF
        ten.append(grade(f"t{index}", day, points))
    ten_body = _post(client, ten, attendance=repeated("present", 3))
    assert ten_body["indicators"]["grade_trend"]["decline"] == 10
    assert ten_body["indicators"]["grade_trend"]["value"] == 1


def test_a_larger_decline_is_capped_at_one(client):
    early = AS_OF - timedelta(days=28)
    grades = []
    for index, points in enumerate((95, 95, 95, 40, 40, 40)):
        day = early if index < SIDE_SPLIT else AS_OF
        grades.append(grade(f"c{index}", day, points))
    payload = _post(client, grades, attendance=repeated("present", 3))
    assert payload["indicators"]["grade_trend"]["decline"] == 55
    assert payload["indicators"]["grade_trend"]["value"] == 1
    assert payload["score"] <= 100


def test_isolated_low_grade_does_not_trigger_a_slope_flag(client):
    payload = client.post("/score", json=load_example("isolated_low_grade.json")).json()
    trend = payload["indicators"]["grade_trend"]
    assert trend["available"] is True
    assert trend["early_median"] == 81
    assert trend["recent_median"] == 78
    assert trend["recent_median"] != 40
    assert trend["decline"] == 3
    assert trend["value"] == 0.3
    # Three unexcused absences contribute 30. The isolated 40 adds 6, for 36.
    # If that 40 became the recent median, the grade indicator would fill and
    # the score would reach Watch. It stays below Watch.
    assert payload["score"] == 36
    assert payload["risk_level"] is None
    assert payload["check_in_suggested"] is False


def test_fewer_than_six_grades_leave_the_indicator_unavailable(client):
    grades = flat_grades(80)[:5]
    payload = _post(client, grades, attendance=repeated("present", 3))
    trend = payload["indicators"]["grade_trend"]
    assert trend["available"] is False
    assert trend["value"] is None
    assert trend["valid_in_window"] == 5
    assert "not treated as steady performance" in trend["detail"]
    assert "original weights" in trend["detail"]
    assert payload["score"] == 0


def test_span_under_four_weeks_leaves_the_indicator_unavailable(client):
    too_close = flat_grades(80, days_apart=27)
    close = _post(client, too_close, attendance=repeated("present", 3))
    assert close["indicators"]["grade_trend"]["available"] is False
    assert close["indicators"]["grade_trend"]["span_days"] == 27
    assert close["indicators"]["grade_trend"]["value"] is None

    enough = flat_grades(80, days_apart=28)
    wide = _post(client, enough, attendance=repeated("present", 3))
    assert wide["indicators"]["grade_trend"]["available"] is True
    assert wide["indicators"]["grade_trend"]["span_days"] == 28


def test_grades_outside_the_eight_week_window_are_excluded(client):
    inside = AS_OF - timedelta(days=56)
    outside = AS_OF - timedelta(days=57)
    in_window = [grade(f"i{index}", inside if index < 3 else AS_OF, 80) for index in range(6)]
    kept = _post(client, in_window, attendance=repeated("present", 3))
    assert kept["indicators"]["grade_trend"]["available"] is True
    assert kept["indicators"]["grade_trend"]["valid_in_window"] == 6

    too_old = [grade(f"o{index}", outside if index < 3 else AS_OF, 80) for index in range(6)]
    dropped = _post(client, too_old, attendance=repeated("present", 3))
    trend = dropped["indicators"]["grade_trend"]
    assert trend["available"] is False
    assert trend["valid_in_window"] == 3
    assert trend["excluded"]["outside_lookback"] == 3


def test_missing_unresolved_and_undated_grades_are_excluded(client):
    early = AS_OF - timedelta(days=28)
    grades = [grade(f"g{index}", early if index < 3 else AS_OF, 80) for index in range(6)]
    grades.append(grade("conflict", AS_OF, 0, resolved=False))
    grades.append(grade("blank", AS_OF, None, maximum=None, resolved=True))
    grades.append(grade("nodate", None, 0, resolved=True))
    payload = _post(client, grades, attendance=repeated("present", 3))
    trend = payload["indicators"]["grade_trend"]
    assert trend["available"] is True
    assert trend["valid_in_window"] == 6
    assert trend["recent_median"] == 80
    assert trend["decline"] == 0
    assert trend["excluded"]["unresolved"] == 1
    assert trend["excluded"]["ungraded_or_missing"] == 1
    assert trend["excluded"]["no_academic_date"] == 1


def test_only_five_resolved_grades_when_one_is_unresolved(client):
    early = AS_OF - timedelta(days=28)
    grades = [grade(f"g{index}", early if index < 3 else AS_OF, 70) for index in range(5)]
    grades.append(grade("open", AS_OF, 10, resolved=False))
    payload = _post(client, grades, attendance=repeated("present", 3))
    assert payload["indicators"]["grade_trend"]["available"] is False
    assert payload["indicators"]["grade_trend"]["valid_in_window"] == 5
    assert payload["indicators"]["grade_trend"]["excluded"]["unresolved"] == 1


def test_genuine_zero_grades_are_included(client):
    early = AS_OF - timedelta(days=28)
    points = (0, 50, 100, 0, 40, 80)
    grades = [
        grade(f"z{index}", early if index < 3 else AS_OF, value)
        for index, value in enumerate(points)
    ]
    payload = _post(client, grades, attendance=repeated("present", 3))
    trend = payload["indicators"]["grade_trend"]
    assert trend["available"] is True
    assert trend["valid_in_window"] == 6
    assert trend["early_median"] == 50
    assert trend["recent_median"] == 40
    assert trend["decline"] == 10
    assert trend["value"] == 1


def test_grades_are_normalized_to_percentages(client):
    early = AS_OF - timedelta(days=28)
    grades = [
        grade("a", early, 8, maximum=10),
        grade("b", early, 9, maximum=10),
        grade("c", early, 10, maximum=10),
        grade("d", AS_OF, 7, maximum=10),
        grade("e", AS_OF, 7, maximum=10),
        grade("f", AS_OF, 7, maximum=10),
    ]
    trend = _post(client, grades, attendance=repeated("present", 3))["indicators"]["grade_trend"]
    assert trend["early_median"] == 90
    assert trend["recent_median"] == 70
    assert trend["decline"] == 20
    assert trend["value"] == 1
    assert "not adjusted for how hard" in trend["detail"]


def test_chronological_order_beats_list_order(client):
    early = AS_OF - timedelta(days=28)
    grades = [
        grade("d", AS_OF, 70),
        grade("e", AS_OF, 70),
        grade("f", AS_OF, 70),
        grade("a", early, 90),
        grade("b", early, 90),
        grade("c", early, 90),
    ]
    trend = _post(client, grades, attendance=repeated("present", 3))["indicators"]["grade_trend"]
    assert trend["early_median"] == 90
    assert trend["recent_median"] == 70
    assert trend["decline"] == 20


def test_same_day_grades_use_the_assessment_id_as_the_tie_breaker(client):
    early = AS_OF - timedelta(days=28)
    # Ascending ids a, b, c are the three earliest. Their median is 10.
    # A reverse-id choice would use b, c, d and a median of 90.
    grades = [
        grade("d", early, 90),
        grade("c", early, 90),
        grade("b", early, 10),
        grade("a", early, 10),
        grade("e", AS_OF, 50),
        grade("f", AS_OF, 50),
        grade("g", AS_OF, 50),
    ]
    trend = _post(client, grades, attendance=repeated("present", 3))["indicators"]["grade_trend"]
    assert trend["early_median"] == 10
    assert trend["recent_median"] == 50
    assert trend["decline"] == 0


def test_middle_grades_are_not_part_of_either_median(client):
    early = AS_OF - timedelta(days=28)
    middle = AS_OF - timedelta(days=14)
    grades = [
        grade("a", early, 90),
        grade("b", early, 90),
        grade("c", early, 90),
        grade("m1", middle, 0),
        grade("m2", middle, 0),
        grade("d", AS_OF, 80),
        grade("e", AS_OF, 80),
        grade("f", AS_OF, 80),
    ]
    trend = _post(client, grades, attendance=repeated("present", 3))["indicators"]["grade_trend"]
    assert trend["valid_in_window"] == 8
    assert trend["early_median"] == 90
    assert trend["recent_median"] == 80
    assert trend["decline"] == 10
    assert trend["value"] == 1


def test_out_of_range_grades_are_rejected(client):
    early = AS_OF - timedelta(days=28)
    below_zero = body(
        attendance=repeated("present", 3),
        grades=[grade("bad", early, -1)],
    )
    assert client.post("/score", json=below_zero).status_code == 422

    above_maximum = body(
        attendance=repeated("present", 3),
        grades=[grade("bad", early, 110, maximum=100)],
    )
    assert client.post("/score", json=above_maximum).status_code == 422

    zero_maximum = body(
        attendance=repeated("present", 3),
        grades=[grade("bad", early, 1, maximum=0)],
    )
    assert client.post("/score", json=zero_maximum).status_code == 422
