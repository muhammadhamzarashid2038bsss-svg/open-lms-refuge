"""The scoring endpoint refuses a caller that does not have the shared key."""

from fastapi.testclient import TestClient

from app.main import create_app
from tests.builders import body, repeated

SECRET = "synthetic-service-key-not-a-learner"
WRONG = "wrong-synthetic-service-key"


def test_scoring_requires_the_service_key():
    with TestClient(create_app(api_key=SECRET)) as client:
        missing = client.post("/score", json=body(attendance=repeated("present", 3)))
        assert missing.status_code == 401
        assert SECRET not in missing.text
        assert WRONG not in missing.text

        wrong = client.post(
            "/score",
            headers={"X-Risk-Service-Key": WRONG},
            json=body(attendance=repeated("present", 3)),
        )
        assert wrong.status_code == 401
        assert SECRET not in wrong.text
        assert WRONG not in wrong.text

        accepted = client.post(
            "/score",
            headers={"X-Risk-Service-Key": SECRET},
            json=body(attendance=repeated("present", 3)),
        )
        assert accepted.status_code == 200
        assert accepted.json()["score"] == 0


def test_an_unconfigured_service_does_not_score():
    with TestClient(create_app(api_key="")) as client:
        response = client.post(
            "/score",
            headers={"X-Risk-Service-Key": SECRET},
            json=body(attendance=repeated("present", 3)),
        )
        assert response.status_code == 503
        assert SECRET not in response.text


def test_the_health_check_stays_available_without_the_key():
    # Health is only a liveness check. It returns no learner data and no key.
    with TestClient(create_app(api_key=SECRET)) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        assert SECRET not in response.text


def test_a_rejected_key_is_not_written_to_the_log(caplog):
    with TestClient(create_app(api_key=SECRET)) as client:
        with caplog.at_level("DEBUG"):
            response = client.post(
                "/score",
                headers={"X-Risk-Service-Key": WRONG},
                json=body(attendance=repeated("present", 3)),
            )
    assert response.status_code == 401
    assert SECRET not in caplog.text
    assert WRONG not in caplog.text
