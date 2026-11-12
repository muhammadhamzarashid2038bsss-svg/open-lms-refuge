"""Absence indicator. Ordinary excuses use the 25% weight. Family circumstances do not."""

from datetime import date, timedelta

from tests.builders import body, mark, repeated


def test_five_consecutive_unexcused_absences_fill_the_indicator(client):
    response = client.post("/score", json=body(attendance=repeated("absent", 5)))
    assert response.status_code == 200
    payload = response.json()
    assert payload["indicators"]["absence"]["value"] == 1
    assert payload["indicators"]["absence"]["longest_weighted_run"] == 5
    assert payload["score"] == 50
    assert payload["risk_level"] == "Watch"
    assert payload["check_in_suggested"] is False


def test_more_than_five_unexcused_absences_stay_capped_at_one(client):
    response = client.post("/score", json=body(attendance=repeated("absent", 8)))
    payload = response.json()
    assert payload["indicators"]["absence"]["value"] == 1
    assert payload["score"] == 50
    assert 0 <= payload["score"] <= 100


def test_excused_illness_contributes_at_a_quarter_of_unexcused(client):
    # The service does not accept reason text. An excused mark without the
    # family-circumstances flag is an ordinary excuse, such as illness.
    excused = client.post("/score", json=body(attendance=repeated("excused", 5)))
    unexcused = client.post("/score", json=body(attendance=repeated("absent", 5)))
    excused_body = excused.json()
    unexcused_body = unexcused.json()
    assert excused_body["indicators"]["absence"]["value"] == 0.25
    assert unexcused_body["indicators"]["absence"]["value"] == 1
    assert excused_body["score"] == 12.5
    assert unexcused_body["score"] == 50
    assert excused_body["score"] == unexcused_body["score"] * 0.25

    four_excused = client.post("/score", json=body(attendance=repeated("excused", 4))).json()
    four_unexcused = client.post("/score", json=body(attendance=repeated("absent", 4))).json()
    assert four_excused["indicators"]["absence"]["value"] == 0.2
    assert four_unexcused["indicators"]["absence"]["value"] == 0.8
    assert four_excused["score"] != four_unexcused["score"]


def test_family_circumstances_do_not_raise_the_score_and_suggest_a_check_in(client):
    three_unexcused = repeated("absent", 3)
    unexcused_only = client.post("/score", json=body(attendance=three_unexcused)).json()
    # Dates fall after the three unexcused sessions, so they cannot split that run.
    with_family = three_unexcused + [
        mark("f1", date(2026, 4, 30), "absent", family=True),
        mark("f2", date(2026, 5, 1), "excused", family=True),
    ]
    combined = client.post("/score", json=body(attendance=with_family)).json()
    assert unexcused_only["score"] == 30
    assert combined["score"] == 30
    assert combined["check_in_suggested"] is True
    assert combined["indicators"]["absence"]["family_circumstances_count"] == 2
    assert any("Check-in suggested" in reason for reason in combined["reasons"])
    assert any("do not raise the score" in reason for reason in combined["reasons"])
    assert "dropout" not in combined["note"].lower()

    only_family = client.post(
        "/score", json=body(attendance=repeated("absent", 5, family=True))
    ).json()
    assert only_family["indicators"]["absence"]["value"] == 0
    assert only_family["score"] == 0
    assert only_family["score"] < unexcused_only["score"]
    assert only_family["check_in_suggested"] is True


def test_family_circumstances_between_absences_cannot_lengthen_the_run(client):
    woven = []
    day = date(2026, 4, 1)
    for index in range(5):
        woven.append(mark(f"u{index}", day, "absent"))
        day += timedelta(days=1)
        woven.append(mark(f"f{index}", day, "absent", family=True))
        day += timedelta(days=1)
    response = client.post("/score", json=body(attendance=woven)).json()
    plain = client.post("/score", json=body(attendance=repeated("absent", 5))).json()
    assert response["indicators"]["absence"]["value"] == 0.2
    assert response["score"] < plain["score"]
    assert response["check_in_suggested"] is True


def test_family_check_in_when_data_is_insufficient(client):
    response = client.post(
        "/score",
        json=body(attendance=[mark("s1", date(2026, 4, 20), "absent", family=True)]),
    )
    payload = response.json()
    assert response.status_code == 200
    assert payload["risk_level"] == "Insufficient data"
    assert payload["score"] is None
    assert payload["usable_data_points"] == 1
    assert payload["check_in_suggested"] is True
    assert any("Check-in suggested" in reason for reason in payload["reasons"])
    assert any("Insufficient data" in reason for reason in payload["reasons"])


def test_cancelled_sessions_are_excluded_and_do_not_break_a_run(client):
    sessions = []
    day = date(2026, 4, 1)
    for index in range(5):
        sessions.append(mark(f"a{index}", day, "absent"))
        day += timedelta(days=1)
        sessions.append(mark(f"c{index}", day, "cancelled"))
        day += timedelta(days=1)
    payload = client.post("/score", json=body(attendance=sessions)).json()
    assert payload["indicators"]["absence"]["value"] == 1
    assert payload["indicators"]["absence"]["recorded_sessions"] == 5
    assert payload["usable_data_points"] == 5

    cancelled_only = client.post(
        "/score", json=body(attendance=repeated("cancelled", 4))
    ).json()
    assert cancelled_only["indicators"]["absence"]["available"] is False
    assert cancelled_only["score"] is None
    assert cancelled_only["risk_level"] == "Insufficient data"


def test_unmarked_sessions_are_not_absences_and_end_the_run(client):
    sessions = []
    day = date(2026, 4, 1)
    for index in range(5):
        sessions.append(mark(f"a{index}", day, "absent"))
        day += timedelta(days=1)
        sessions.append(mark(f"u{index}", day, "unmarked"))
        day += timedelta(days=1)
    payload = client.post("/score", json=body(attendance=sessions)).json()
    assert payload["indicators"]["absence"]["value"] == 0.2
    assert payload["indicators"]["absence"]["recorded_sessions"] == 5
    assert "not counted as an absence" in payload["indicators"]["absence"]["detail"]


def test_present_and_late_end_an_absence_run(client):
    day = date(2026, 4, 1)
    sessions = [
        mark("a1", day, "absent"),
        mark("a2", day + timedelta(days=1), "absent"),
        mark("late", day + timedelta(days=2), "late"),
        mark("a3", day + timedelta(days=3), "absent"),
        mark("a4", day + timedelta(days=4), "absent"),
        mark("a5", day + timedelta(days=5), "absent"),
    ]
    payload = client.post("/score", json=body(attendance=sessions)).json()
    assert payload["indicators"]["absence"]["longest_weighted_run"] == 3
    assert payload["indicators"]["absence"]["value"] == 0.6


def test_academic_date_orders_attendance_not_list_order(client):
    # The list shows five absences and then a present. The class dates put the
    # present in the middle, so the longest run is 3, not 5.
    present_day = date(2026, 4, 10)
    sessions = [
        mark("a1", date(2026, 4, 6), "absent"),
        mark("a2", date(2026, 4, 8), "absent"),
        mark("a3", date(2026, 4, 13), "absent"),
        mark("a4", date(2026, 4, 15), "absent"),
        mark("a5", date(2026, 4, 20), "absent"),
        mark("p1", present_day, "present"),
    ]
    payload = client.post("/score", json=body(attendance=sessions)).json()
    assert payload["indicators"]["absence"]["longest_weighted_run"] == 3
    assert payload["indicators"]["absence"]["value"] == 0.6
