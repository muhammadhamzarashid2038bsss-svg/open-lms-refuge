# Open LMS Refuge

Open LMS Refuge is an open-source school management system and learning app for community learning centres that teach refugee learners. It is built for shared phones, weak internet, small mobile-data budgets, volunteer teachers who change often, and families who have strong reasons to limit what a centre stores about them.

It is a working prototype, not a finished product in daily use at a centre. The sections below say what works, what only partly works, and what is still planned.

## Why this exists

Standard learning platforms such as Moodle and Canvas often assume that students have a laptop, reliable Wi-Fi, and the documents needed for formal school. For many refugee learners in Malaysia, those assumptions do not hold.

Refugee children in Malaysia generally cannot enter the public-school system. Many depend on community learning centres run by NGOs, volunteers, and local educators, often with very little funding. Families may also lack secure documentation and have good reasons to worry about sharing personal information. A list of learner names that leaves a centre by mistake can create serious privacy and safety risks. Day-to-day classroom organisation is hard as well. Some informal schools still use WhatsApp groups to arrange lessons, share materials, and talk to learners.

I know this from my own family. While I was studying online at the University of the People on organised platforms such as Moodle and Brightspace, my sister was studying at an informal online school in Malaysia. I watched her spend hours looking for lost Zoom links in long WhatsApp chats. I watched her teachers use five minutes of a forty-minute class just to take attendance out loud. I watched her try to find PDFs and homework that had been lost in those chats.

Modern learning platforms solve many problems. They are not necessarily built for the constraints of refugee education: serious privacy concerns, unreliable internet, limited mobile data, and old or shared devices. I decided to build an open learning system for those constraints.

I contacted more than 15 learning centres by WhatsApp and email and asked for their input. Many centres are underfunded and understaffed, and some may also be careful about conversations that involve sensitive information. Almost none had time to reply. One centre was interested, but it was already busy with testing sessions and other work. Asking busy educators to explain their problems was not working. I decided to build a functioning prototype first. A real product is easier for a busy centre to review than a vague idea.

This repository does not name those centres, and it does not include their replies. [docs/USER_FEEDBACK.md](docs/USER_FEEDBACK.md) is empty until a centre chooses to give feedback that can be recorded.

## How real-world constraints shaped the design

Each large technical choice comes from a constraint a centre actually faces. The prototype is still evolving. The status table later on this page separates what works from what is only partly built.

### Weak or missing internet, and shared phones

Attendance can be recorded on the phone and sent later. The phone keeps marks in IndexedDB, a browser database, and sends them when the signed-in page can reach this app's server. A separate attendance kiosk lists classes that were opened while the phone was online, and it can record attendance offline. The installed app opens that attendance screen directly. It is an attendance screen, not a locked mode for the whole application.

Shared-phone safeguards lock the screen on sign-out so the next person does not see the previous person's classes through the app. Pending attendance is kept until the server confirms it. Confirmed marks stay on the phone as well, so a later correction still has a record to point at. The lock does not encrypt or delete those records.

### Volunteer teachers leaving

When a volunteer leaves, what they know about each learner can leave with them. If an administrator or centre director switches a teacher off, the app prepares one transition report for each section that teacher still teaches. The report stores attendance, grade trend, lesson completion when those records exist, skill gaps, and a link to the progress-note version from that moment. Later edits to a note do not replace that linked text.

If exactly one other active teacher is already on that section, the report is assigned to them. Otherwise it is assigned to the centre director. A newly arriving volunteer is not identified or given the report automatically. Assigning that new volunteer is still a possible future improvement. A director or administrator can also end a section assignment and name the next teacher. That separate action creates its own report.

There is no phone screen yet for teachers to record lesson completion. The report can show lesson rows that already exist in the database, including demo data. It cannot show a checklist the teacher has no way to fill in.

### Expensive mobile data

Large JPEG, PNG, and WebP homework photos are reduced in the browser before they join the upload queue, and they stay in the same format. The target is about 500 KB when the writing can stay readable, and the hard limit is 1 MB. Smaller photos and PDFs are not recompressed.

Attendance saved on the phone is gzip-compressed before upload when the browser can do that and the compressed batch is within 32 KB. If compression is missing or the gzip result is too large while the plain text still fits, the same attendance is sent as ordinary JSON. Grade edits, progress notes, and note-view receipts are sent as ordinary JSON.

Course items that point to a video are stored as links. The app does not embed video or start it automatically.

### Privacy and fear of data exposure

Learner profiles store a learner code, a nickname, and an age band. The app has no dedicated field or form for legal status, a home address, or an exact date of birth. Sensitive details can still be typed into a progress note or a grade comment, or shown inside a homework photo. The app does not scan notes or files for that information.

Donor exports use HMAC-SHA-256 pseudonyms and small-group suppression. A count based on fewer learners than the centre's minimum, 5 by default, is shown as `<5`. These steps reduce what a report reveals. They do not make a report anonymous. A pseudonymized learner-level file must still be treated as sensitive. The risk-scoring service does not receive learner names or note text. It does receive the centre's real learner code, which the centre can match back to the learner.

### Classroom organisation that currently lives in WhatsApp

Courses, materials, and the weekly timetable live in one app. Learners see **Today's classes** on their home page, with a **Join** button when a live class has a meeting link. Materials for a section are listed with that section. The aim is to shorten the search through old chat messages. The app does not replace WhatsApp for every conversation a centre has with families.

## Features and project phases

The product requirements in [docs/PRD.md](docs/PRD.md) sort the work into three phases: Phase 1, Pilot Core; Phase 2, Pilot & Expansion; and Phase 3, Extended Features. A row in that document is not the same as a finished screen.

| Feature | Requirement | Phase | What exists now |
| --- | --- | --- | --- |
| Staff and learner sign-in, roles, and home pages | SYS-1 | Phase 1 | Works. Staff use email and a password. Learners use a centre code, a learner code, and a 4-digit PIN. |
| Courses, sections, and learning materials | LMS-1 | Phase 1. Saving a resource on the phone is Phase 2. | Works for links and files the server can already store. Saving materials for offline reading is not built. |
| Weekly timetable and Today's classes | LMS-2 | Phase 1 for the schedule and links. Offline media is Phase 2. | Works. Live classes can store a Google Meet, Zoom, or Jitsi link. |
| Attendance kiosk and offline marks | LMS-3 | Phase 1. Automatic tracking of online classes is Phase 2. | The kiosk and offline save exist. A browser may refuse to save attendance if it will not promise to keep the data. |
| Attendance sync | FEAT-1 | Phase 1 | Partly works. Automated tests cover compression, fallback to plain JSON, and server storage. Full offline-to-database browser verification remains unfinished. |
| Shared-phone lock and handover | SYS-1 | Phase 1 | The screen lock and a staff handover note exist. Local records are not encrypted or deleted on sign-out. |
| Grades, homework files, and the gradebook | LMS-4 | Phase 1 | Gradebook entries and the learner file queue work. A real Cloudflare R2 bucket has not been created, so a live file upload is not confirmed. |
| Progress notes and skill gaps | FEAT-2 | Phase 1 | Works, including offline edits and conflicts. Custom skill tags are chosen from a centre list. |
| Teacher handoff reports | FEAT-2 | Phase 1 | A report is created when a teacher is switched off or a section is reassigned. A brand-new volunteer is not chosen automatically. |
| Performance dashboard | LMS-7 | Phase 1 | Works for assigned teachers and the director of that centre. |
| Risk score and check-in suggestions | FEAT-3 | Phase 1 | Works when the Python service is configured and a director starts a run. There is no daily automatic run. |
| Donor CSV and PDF exports | FEAT-4 | Phase 1 | Aggregate export works for a director or admin. Learner-level export needs a funder requirement that is already stored. There is no screen to create that requirement. |
| Quizzes | LMS-5 | Phase 2 | Not built. |
| Low-bandwidth AI help for teachers | LMS-8 | Phase 2 | Not built. |
| Exam Integrity Suite (exam browser and photo proctoring) | LMS-6 | Phase 3 | Not built. The requirements say this needs a separate privacy review before any work starts. |

## Setup and local development

These commands are the ones defined in this repository. Development so far has used Prisma's local Postgres, started with `prisma dev`, not a cloud database. I have not re-run this full setup while writing this page. If a command fails, treat the message on screen as the source of truth and check [docs/DATABASE.md](docs/DATABASE.md) and [docs/TEST_DATABASE.md](docs/TEST_DATABASE.md).

### What you need

- Node.js and npm. The app uses Next.js 16.4.2, React 19, and Prisma 7, as listed in `package.json`. This repository does not pin a Node version in an `engines` field.
- For the risk score only: Python. The risk-service folder was set up with Python 3.14.6. See [services/risk_engine/README.md](services/risk_engine/README.md).
- For the full automated test suite: PostgreSQL 18 on port 5433, as described in [docs/TEST_DATABASE.md](docs/TEST_DATABASE.md). The app itself does not need that test database.

### Install

```bash
git clone <your-repository-url>
cd open-lms-refuge
npm install
```

`npm install` downloads the JavaScript libraries the app needs.

### Environment file

```bash
cp .env.example .env
```

On Windows PowerShell you can copy the file with `Copy-Item .env.example .env`.

Open `.env` and replace the placeholder secrets. Never commit `.env`. The important names are:

| Name | What it is for |
| --- | --- |
| `DATABASE_URL` | The Postgres address Prisma uses. |
| `SHADOW_DATABASE_URL` | Optional. Needed for `prisma dev`. A normal Postgres install can leave it empty. |
| `DATABASE_POOL_MAX` | Optional. Use `1` with `prisma dev`, because that local server effectively allows one connection. |
| `SESSION_SECRET` | Seals the sign-in cookie. At least 32 characters. |
| `EXPORT_SECRET` | The HMAC key for export pseudonyms. It must be 64 lowercase hex characters. |
| `RISK_SERVICE_URL` and `RISK_SERVICE_API_KEY` | Where the Next.js server calls the Python score service, and the shared key. Leave the service unstarted if you are not using check-ins. |
| `NEXT_PUBLIC_APP_URL` | The address of this website. Locally that is `http://localhost:3000`. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 for homework files. Leave them empty until a private bucket exists. Empty values make file upload say storage is unavailable. |

Generate a new random value for each secret. An example is in `.env.example`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Database

Start Prisma's local Postgres and leave it running:

```bash
npm run db:dev
```

That runs `prisma dev --detach --name open-lms-refuge`. Then run `npx prisma dev ls` and copy the printed addresses into `.env` as `DATABASE_URL` and `SHADOW_DATABASE_URL`. Set `DATABASE_POOL_MAX=1` for this local server.

Create the tables and load synthetic demo data:

```bash
npm run db:migrate
npm run db:seed
```

`db:migrate` runs `prisma migrate dev`. With the migrations already in the repository, it applies those migrations. It may ask a question if the schema and the migrations disagree. `db:seed` loads the fake Demo Learning Center. Re-running the seed deletes and rebuilds that demo centre only.

The demo sign-in values are synthetic and are listed in [docs/DATABASE.md](docs/DATABASE.md). They include `teacher.one@demo.invalid` with password `demo-password`, and learner code `LNR-0001` with PIN `1234` at centre code `DEMO`. Do not reuse these secrets for a real centre.

`npm run db:studio` opens Prisma Studio so you can look at the tables. `npm run db:generate` regenerates the Prisma client after a schema change.

### Run the website

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use **Staff sign-in** or **Learner sign-in**.

### Risk score service

This is optional. From `services/risk_engine`, follow [services/risk_engine/README.md](services/risk_engine/README.md). The service listens on `127.0.0.1:8000` and uses the same `RISK_SERVICE_API_KEY` as `.env`. The browser never calls it. The Next.js server does, and only when a director starts a check.

### Tests and production build

URL and pure logic checks that do not need the test database:

```bash
npm run test:url
```

The full Vitest suite refuses to start unless `.env.test` points at the isolated test database described in [docs/TEST_DATABASE.md](docs/TEST_DATABASE.md):

```bash
npm run db:test:verify
npm run db:test:migrate
npm run db:test:seed
npm test
```

`npm test` runs `vitest run`. The Day 16 log recorded 421 passing Vitest tests. The Day 17 log later recorded 429. This review did not re-run the suite.

Python tests, from `services/risk_engine`:

```bash
.\.venv\Scripts\python.exe -m pytest
```

The Day 14 log recorded 55 passing pytest tests. The Day 15 log later recorded 64. This review did not re-run them.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run lint` | Runs ESLint. |
| `npm run build` | Builds the Next.js app and the service worker. |
| `npm start` | Serves the production build. Run `npm run build` first. |

The offline kiosk was checked with a production build, not with `npm run dev`. The development log says the production service worker was tested on port 3100. This repository does not define a script that chooses that port. To try it, run `npm run build`, then `npx next start -p 3100`.

## Deployment

There is no production deployment in this repository. No demo URL, host name, or production database is configured here.

Development has used Prisma's local Postgres. A hosted Postgres database is the intended next step. The website on Vercel should use that host's pooled address. Table updates are a separate manual command, `npm run db:migrate:deploy`, using the direct address. Do not run `npm run db:migrate` or `npm run db:seed` against a hosted database. The steps are in [docs/DATABASE.md](docs/DATABASE.md). That deployment has not been completed or tested.

The requirements document names Vercel for the website, Render for the risk service, and a hosted Postgres database as a possible free-tier demo. Day 7 of the development log records that an optional Vercel deployment was skipped. Do not treat those names as a live setup.

Homework files are meant to go to a private Cloudflare R2 bucket. [docs/STORAGE.md](docs/STORAGE.md) says no bucket has been created. Until the four `R2_` values are set, the app tells the learner that file storage is unavailable and keeps the file on the phone.

The risk service is written to run on the centre's own server, or on localhost during development. It should not be exposed to the public internet. See [services/risk_engine/README.md](services/risk_engine/README.md).

If a demo server is added later, it may take a little time to wake up, so the application may respond slowly when first opened. No such server is linked from this repository today.

## Architecture

The website is a Next.js app. Pages and server checks live in the same project. PostgreSQL, through Prisma, holds the centre's records. The phone keeps a second copy in IndexedDB for attendance, grades, notes, and homework files that are still waiting to send. A service worker caches the public attendance shell so that screen can open offline. It does not cache private pages or learner records.

Attendance sync, grade and note sync, and file upload are separate. Attendance may be gzip-compressed. Grades and notes are plain JSON, with version vectors so two offline edits are both kept until a teacher resolves them. Homework bytes go to R2 only when that storage is configured. The Python risk service receives one scoring request from the Next.js server and returns a score. It does not read the database. Donor exports are built on the server and downloaded as CSV or PDF.

More detail, including the five diagrams, is in:

- [docs/architecture.md](docs/architecture.md)
- [docs/DATABASE.md](docs/DATABASE.md)
- [docs/DECISIONS.md](docs/DECISIONS.md)

The scoring rules are in [docs/RISK_MODEL.md](docs/RISK_MODEL.md). What the app stores and shares is in [docs/PRIVACY.md](docs/PRIVACY.md).

## Honest implementation status

| Status | Item |
| --- | --- |
| Works | Sign-in, role checks, course and section materials, weekly timetable, Today's classes, progress notes, skill tags, performance dashboard, aggregate CSV and PDF export, and the audit log. Attendance marking works when the browser accepts the save. |
| Works, with a condition | Risk scores, when `RISK_SERVICE_URL` and `RISK_SERVICE_API_KEY` are set and a director opens **Check-in suggestions**. Homework upload, when a private R2 bucket is configured. |
| Partly works | Attendance gzip sync. The code and automated tests cover compression, fallback to plain JSON, and server storage. A full manual test that saves a mark offline in the browser and then checks the database row is still recorded as unfinished in the Day 8 log, because Chrome refused persistent storage. |
| Partly works | Homework photo compression. Large JPEG, PNG, and WebP files are reduced before queueing. PDFs and already-small photos are not. The compression tests use a stand-in encoder. A 1.4 MB PNG was reduced to 532 KB during a manual test. |
| Partly works | The attendance kiosk. It is a real offline attendance screen. It is not a restricted mode for every page. Attendance save can be blocked when the browser will not promise to keep the data. |
| Partly works | Teacher handoff. Reports are created and assigned to the only other current teacher, or to the director. A new volunteer is not assigned automatically. Lesson completion appears when those rows already exist. Teachers have no screen to record lesson completion. |
| Partly works | Privacy of the risk request. Names and notes are not sent. The learner code is the centre's real code and can be linked back. |
| Partly works | Exports. Aggregate reports work. Pseudonymized rows are only offered when an active funder requirement is already in the database. There is no screen to create, edit, or turn off that requirement. |
| Planned | In-app learner registration. Learner accounts in the demo come from the seed. There is no registration form. |
| Planned | Learner erasure. Accounts are switched off, not deleted. There is no workflow that erases a learner's profile and history. |
| Planned | A normal screen for funder requirements. The database table and the server function exist and are covered by tests. |
| Planned | Cloud deployment, a live R2 bucket, quizzes, offline copies of course files, digital attendance import, and the Phase 2 AI assistant. |
| Not a privacy guarantee | Free-text notes, grade comments, and uploaded photos can still contain a legal status, an address, a date of birth, or a family story. Local phone storage is not encrypted. |

## AI assistance

The code for Open LMS Refuge was developed with AI assistance under my direction. I guided the project decisions, requirements, implementation work, reviews, and testing. I also wrote the project story in this README. The wording has been edited for clarity, and the technical claims were checked against the code.

## Documentation and pilot materials

- [Product requirements](docs/PRD.md)
- [Development log](docs/DEV_LOG.md)
- [Architecture](docs/architecture.md)
- [Database](docs/DATABASE.md)
- [Decision log](docs/DECISIONS.md)
- [Privacy](docs/PRIVACY.md)
- [Risk model](docs/RISK_MODEL.md)
- [Homework storage](docs/STORAGE.md)
- [Dashboard calculations](docs/DASHBOARD_METRICS.md)
- [Test database](docs/TEST_DATABASE.md)
- [Future improvements](docs/future-improvements.md)
- [User feedback](docs/USER_FEEDBACK.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Teacher quick guide](docs/pilot/TEACHER_QUICK_GUIDE.md)
- [Information and consent template](docs/pilot/INFORMATION_AND_CONSENT_TEMPLATE.md)
- [Pilot feedback form](docs/pilot/FEEDBACK_FORM.md)

The project is licensed under the MIT License. See [LICENSE](LICENSE).
