"""HTTP entry points for the risk score.

Privacy: request bodies are not logged. A learner code plus an attendance
pattern can still identify someone in a small class, so the body stays out of
log files. Validation errors also leave out the rejected value, so a name sent
by mistake is not copied into the error text.

The learning app calls POST /score from its own server. Browsers do not.
There is no CORS permission for that reason. Bind local runs to 127.0.0.1.
A separate deployment should be reached over HTTPS by the Next.js server only.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import load_config
from app.schemas import HealthResponse, ScoreRequest, ScoreResponse
from app.scoring import calculate
from app.service_auth import keys_match, read_api_key


def create_app(config_path: Path | None = None, api_key: str | None = None) -> FastAPI:
    settings = load_config(config_path)
    # Fail closed. An empty key means scoring is refused, not left open.
    configured_key = read_api_key(explicit=api_key)
    app = FastAPI(
        title="Open LMS Refuge risk score",
        summary="Suggests when a supportive check-in may help.",
        description=(
            "Calculates a transparent score from attendance, missing assignments, "
            "and grade trend. A person decides what to do. The score is not a "
            "prediction, and this service does not label a learner as leaving the center. "
            "Send an anonymous learner code and numbers only."
        ),
        version="0.1.0",
    )
    app.state.settings = settings
    app.state.api_key = configured_key

    def require_service_key(x_risk_service_key: str | None = Header(default=None)) -> None:
        # The header value is not copied into the response or this message.
        expected = app.state.api_key
        if not expected:
            raise HTTPException(status_code=503, detail="The scoring service is not configured.")
        if not keys_match(x_risk_service_key or "", expected):
            raise HTTPException(status_code=401, detail="The scoring service refused the request.")

    @app.exception_handler(RequestValidationError)
    async def reject_invalid_request(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Do not return `input`. That field would echo a name or a note the
        # caller was not allowed to send.
        errors = []
        for err in exc.errors():
            location = [str(part) for part in err.get("loc", ()) if part != "body"]
            errors.append(
                {
                    "location": location,
                    "type": err.get("type", "invalid"),
                    "message": err.get("msg", "Invalid value."),
                }
            )
        return JSONResponse(
            status_code=422,
            content={
                "detail": (
                    "The request was rejected. Send only an anonymous learner code "
                    "and the numeric scoring fields."
                ),
                "errors": errors,
            },
        )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.post("/score", response_model=ScoreResponse)
    def score(body: ScoreRequest, _: None = Depends(require_service_key)) -> ScoreResponse:
        return calculate(body, settings)

    return app


app = create_app()
