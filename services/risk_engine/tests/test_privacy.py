"""The score request refuses personal fields and does not echo or log them."""

import logging

SECRET_NAME = "SYNTHETIC-PRIVATE-NAME"
SECRET_NOTE = "SYNTHETIC-PRIVATE-FAMILY-STORY"


def test_unexpected_personal_fields_are_rejected_without_echoing_them(client, caplog):
    payload = {
        "learner_code": "LNR-0014",
        "as_of": "2026-04-30",
        "name": SECRET_NAME,
        "nickname": "Sunny",
        "email": "person@example.com",
        "phone": "555-0100",
        "address": "1 Example Street",
        "notes": SECRET_NOTE,
        "absence_narrative": "A long private explanation",
        "family_details": "Details that must not be stored",
    }
    with caplog.at_level(logging.DEBUG):
        response = client.post("/score", json=payload)
    assert response.status_code == 422
    text = response.text
    assert SECRET_NAME not in text
    assert SECRET_NOTE not in text
    assert "person@example.com" not in text
    assert "555-0100" not in text
    assert "1 Example Street" not in text
    assert "Extra inputs are not permitted" in text
    assert SECRET_NAME not in caplog.text
    assert SECRET_NOTE not in caplog.text


def test_names_and_free_text_learner_codes_are_rejected(client):
    for code in ("Jane Smith", "ANNE", "LNR0014", "teacher@center.org"):
        response = client.post(
            "/score",
            json={"learner_code": code, "as_of": "2026-04-30"},
        )
        assert response.status_code == 422
        assert code not in response.text


def test_family_circumstances_flag_is_rejected_on_a_present_mark(client):
    response = client.post(
        "/score",
        json={
            "learner_code": "LNR-0014",
            "as_of": "2026-04-30",
            "attendance": [
                {
                    "session_id": "s1",
                    "session_date": "2026-04-06",
                    "status": "present",
                    "family_circumstances": True,
                }
            ],
        },
    )
    assert response.status_code == 422


def test_duplicate_ids_are_rejected(client):
    response = client.post(
        "/score",
        json={
            "learner_code": "LNR-0014",
            "as_of": "2026-04-30",
            "attendance": [
                {
                    "session_id": "s1",
                    "session_date": "2026-04-06",
                    "status": "present",
                    "family_circumstances": False,
                },
                {
                    "session_id": "s1",
                    "session_date": "2026-04-08",
                    "status": "absent",
                    "family_circumstances": False,
                },
            ],
        },
    )
    assert response.status_code == 422


def test_missing_required_fields_are_rejected(client):
    assert client.post("/score", json={}).status_code == 422
    assert client.post("/score", json={"learner_code": "LNR-0014"}).status_code == 422
