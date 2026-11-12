import os

import pytest
from fastapi.testclient import TestClient

# Tests share one known key. This does not change the key outside pytest.
# Production reads RISK_SERVICE_API_KEY from the server environment.
os.environ["RISK_SERVICE_API_KEY"] = "test-risk-key"

from app.main import create_app  # noqa: E402


@pytest.fixture
def client():
    with TestClient(create_app()) as test_client:
        test_client.headers.update({"X-Risk-Service-Key": "test-risk-key"})
        yield test_client
