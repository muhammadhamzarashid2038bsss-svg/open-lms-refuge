# Risk score service

This is a small Python service that calculates a supportive check-in score. It is separate from the Next.js learning app. It does not read the database, and it does not store flags.

It accepts an anonymous learner code and numbers only. It refuses names, contact details, and notes. Read `docs/RISK_MODEL.md` in the project root for the formulas and the limits of the score.

The weights are starting estimates. A person decides whether to check in. Do not put this service on the public internet.

The Next.js server calls `POST /score`. A browser does not. Set `RISK_SERVICE_API_KEY` to the same long random string used in the repository `.env`. The scoring endpoint refuses a missing or wrong key. `GET /health` stays open and returns no learner data. Bind this process to `127.0.0.1`. There is no CORS permission.

A center may send `thresholds.watch` and `thresholds.high` on the request. The service checks those numbers. They change the Watch and High labels only. The weights stay in `config.toml`.

Python 3.14.6 is the version this folder was set up with. FastAPI 0.162.5, Pydantic 2.14.3, and pytest 9.2.0 all support Python 3.14.

## One-time setup (Windows PowerShell)

Open PowerShell in this folder (`services\risk_engine`).

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The commands above call the virtual environment by its path. That avoids a PowerShell restriction that sometimes blocks `Activate.ps1`.

If you prefer an activated prompt:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Run the tests

From this same folder:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

## Start the service

```powershell
$env:RISK_SERVICE_API_KEY = "the-same-value-as-in-dotenv"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

If that variable is already set in the shell, the command above is not needed. When it is unset, the service reads `RISK_SERVICE_API_KEY` from the repository `.env` file. It does not print the value.

The samples below also need the header `X-Risk-Service-Key`. Without it, `POST /score` returns 401.

Then open:

- Health check: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
- Interactive documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

In the documentation page, open `POST /score`, choose **Try it out**, and paste one of the sample files below. The samples are synthetic. They are not real learners.

Stop the service with Ctrl+C in the same PowerShell window.

## Sample: five unexcused absences

File: `examples/five_unexcused.json`

Five unexcused absences fill the absence indicator. With the starting weights the score is **50**, which is **Watch**. Four expected assignments are all present, so missing work adds nothing. No grades were sent, so the grade trend is unavailable and adds nothing. Its weight is not moved onto the other indicators.

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/score -ContentType "application/json" -Headers @{ "X-Risk-Service-Key" = $env:RISK_SERVICE_API_KEY } -InFile .\examples\five_unexcused.json
```

## Sample: family circumstances, not enough other records

File: `examples/family_circumstances_only.json`

One absence is marked family circumstances. The score is withheld as **Insufficient data**. **Check-in suggested** is still returned. The absence does not raise a numerical score.

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/score -ContentType "application/json" -Headers @{ "X-Risk-Service-Key" = $env:RISK_SERVICE_API_KEY } -InFile .\examples\family_circumstances_only.json
```

## Sample: one isolated low grade

File: `examples/isolated_low_grade.json`

The latest grades are 79, 40, and 78. The middle value is 78, so the 40 does not set the trend. The early middle value is 81. The decline is 3 points and the grade indicator is 0.3. Together with three unexcused absences the score is **36**, which is below Watch and has no risk level.

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/score -ContentType "application/json" -Headers @{ "X-Risk-Service-Key" = $env:RISK_SERVICE_API_KEY } -InFile .\examples\isolated_low_grade.json
```

## Dependencies

Pinned in `requirements.txt`:

| Package | Version | Role |
| --- | --- | --- |
| fastapi | 0.162.5 | The web service |
| pydantic | 2.14.3 | Request checking |
| uvicorn | 0.54.0 | Runs the service |
| pytest | 9.2.0 | Tests |
| httpx2 | 2.16.0 | Lets the tests call the service without a network port |
| ruff | 0.17.4 | Lint check |

Uvicorn is installed without its optional extras, so auto-reload is not included. Start it with the command above.

Check style with:

```powershell
.\.venv\Scripts\python.exe -m ruff check app tests
```
