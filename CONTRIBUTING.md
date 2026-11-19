# Contributing

Open LMS Refuge is a prototype learning system for community learning centres that teach refugee learners. It favours offline attendance, small uploads, and collecting as little personal information as possible.

Contributions are welcome. There is no separate issue tracker, maintainer team, or code of conduct in this repository yet. Open a GitHub issue or a pull request on the repository you cloned, or write to the person who shared the project with you.

## Useful contributions

- A bug report with the steps that caused it, what you expected, and what happened.
- A failing test that shows a sync, permission, export, or scoring mistake.
- A small fix that matches the behaviour described in [docs/PRD.md](docs/PRD.md) and [docs/DECISIONS.md](docs/DECISIONS.md).
- Clearer setup notes, when you have run the commands yourself and can say what worked.
- Privacy review comments that point at a specific file or screen.

Please do not add quizzes, proctoring, analytics, or a new personal-data field unless that work is already agreed. Phase 2 and Phase 3 items in the requirements are not a request to build them now.

## Set up a development copy

Follow [README.md](README.md). In short:

```bash
npm install
cp .env.example .env
npm run db:dev
```

Put the addresses from `npx prisma dev ls` into `.env`, then:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Use the synthetic demo accounts in [docs/DATABASE.md](docs/DATABASE.md). Do not point `DATABASE_URL` at a database that holds real learner records.

The full test suite needs the separate PostgreSQL database in [docs/TEST_DATABASE.md](docs/TEST_DATABASE.md). URL checks do not:

```bash
npm run test:url
```

After the test database is configured:

```bash
npm run db:test:verify
npm test
```

Python tests for the scoring service:

```bash
cd services/risk_engine
.\.venv\Scripts\python.exe -m pytest
```

Before a pull request, also run `npm run lint`. Run `npm run build` if you changed a page, the service worker, or a server action.

## How to work

- Keep changes small and related to one behaviour.
- Explain, in a comment or the pull request, why a choice matters for a centre with weak internet or a shared phone.
- Add or update a test when you change sync, conflicts, risk scoring, permissions, or exports.
- Do not commit `.env`, `.env.test`, keys, or database dumps.
- Do not put a secret in a `NEXT_PUBLIC_` variable. That prefix sends it to the browser.
- Write commit messages in the existing style: `feat`, `fix`, `docs`, `test`, or `chore`, with a short reason.

## Reporting a bug or an idea

Say which page you used, the role you signed in as, and whether the phone was offline. Quote the message on screen. If a test fails, paste the test name and the assertion, not a dump of the database.

Suggestions are most useful when they describe a classroom problem. This project records real educator feedback only in [docs/USER_FEEDBACK.md](docs/USER_FEEDBACK.md), and only with permission. Do not add invented quotations, centre names, or results there.

## Protect learner information

Use synthetic or anonymised examples only. Never put real refugee learner records, real names, phone numbers, photos of learners, identity documents, or centre lists into:

- issues and pull requests
- test fixtures
- screenshots
- commit messages
- demo data

The demo seed and the tests already use fake names such as Demo Learner 01 and addresses that end in `.invalid`. Follow that pattern.

Do not add fields for legal status, home address, or an exact date of birth. Progress notes and grade comments are free text. Do not encourage staff to store a family story there. Read [docs/PRIVACY.md](docs/PRIVACY.md) before changing anything that leaves the server, including exports, the risk request, and file upload.
