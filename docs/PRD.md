Product Requirements Document (PRD) v2
Open-Source School Management System & LMS for In-Person and Hybrid Refugee Learning Centers
Status: Draft v2, re-scoped from v1 · Owner: project founder (Product Manager and Systems Architect) · Code generation: AI-assisted with Cursor, directed and tested by the owner
1. How to read this document
Version 1 described the whole vision as a single release. Version 2 keeps every requirement from version 1, but sorts the work into three phases so that each phase can be finished, tested, and actually used by a real center. Section 10 maps every version 1 item to its place here, so nothing has been dropped silently.
Phase
Name
When
Goal
1
Pilot Core
The 4 weeks before next semester
A working, tested, documented, offline-first system that a center could try
2
Pilot & Expansion
Next semester, about 3–5 hours per week
Real-world testing with educators, plus the features that depend on what real centers need
3
Extended Features
Later, only if centers ask for them
Heavier features that carry privacy or infrastructure costs
2. Project overview
Core objective. An all-in-one School Management System (SMS) and Learning Management System (LMS) designed for informal education hubs, community learning centers (CLCs), and physical refugee schools that operate under severe constraints on infrastructure, privacy, resources, and staffing.
The problem. Standard platforms such as Moodle or Canvas assume reliable internet, a computer for every learner, trained IT staff, and stable teachers. Refugee learning centers usually have:
•shared family smartphones, prepaid mobile data, and unreliable Wi-Fi;
•paper records, paper homework, and in-person exams;
•volunteer teachers who come and go, taking their knowledge with them;
•learners and families who fear exposure of their legal situation;
•donors who require attendance and engagement data;
•almost no budget and no IT support.
Who uses it.
•Learner (STUDENT): views materials, uploads homework, sees own progress.
•Teacher (TEACHER): often a volunteer. Takes attendance, records grades, writes notes.
•Center Director (CENTER_DIRECTOR): oversees the center, reviews check-in suggestions, produces donor reports.
•Admin (ADMIN): creates accounts and manages the system.
•Funders (indirect): receive anonymized reports only. They never get system access.
3. Design principles
1.Offline first. Anything a teacher does at the classroom door must work with no internet, and sync later.
2.Privacy by design. Collect the least data possible. Never collect what could endanger a learner.
3.Built for turnover. Knowledge lives in the system, not in one volunteer’s head or notebook.
4.Simple enough for a volunteer with 10 minutes of training. Big buttons, plain language, few screens.
5.Cheap to run. Light pages, small uploads, free-tier-friendly hosting for demos.
6.Honest and transparent. Open source, documented decisions, real user feedback only, AI assistance disclosed.
7.Humans decide. Risk flags suggest a supportive check-in. They never trigger automatic action.
4. Functional requirements
Each requirement has an ID, a phase, and a priority (Must, Should, Could).
4.1 Core LMS and physical classroom functionality
LMS-1 Syllabus & Course Manager · Phase 1 · Must
•Organize courses by year, semester, and class section.
•Attach resources to a course: digital textbooks (links or PDFs), reading lists, and downloadable files, so centers print less.
•Resource types: PDF, text, textbook link, audio, video link, web link.
•Teachers manage resources for their own sections. Learners view and download resources for their own sections.
•Phase 2: a “save for offline” option that stores a resource on the learner’s device.
LMS-2 Hybrid & In-Person Classroom Dashboard · Phase 1 (schedule and links), Phase 2 (offline media) · Must
•A weekly timetable per section. Each session is labeled In-person, Live online, or Pre-recorded.
•Live online sessions store a meeting link (Google Meet, Jitsi, or Zoom) with a Join button.
•Pre-recorded micro-lessons and audio clips are listed per course and linked from sessions.
•Phase 2: offline-accessible materials and a low-bandwidth mode (audio first, no auto-playing video).
LMS-3 Lesson & Multi-Mode Attendance Tracker · Phase 1 (Kiosk Mode), Phase 2 (digital modes) · Must
•Kiosk Mode: a fast, one-tap attendance sheet for the teacher at the classroom door. Fully offline. Records are saved on the device and synced later.
•Attendance statuses: Present, Absent, Late, Excused. Optional coarse absence reason (see FEAT-3).
•Attendance records are append-only: a correction is a new record, never an overwrite.
•Phase 2: automated tracking for pre-recorded modules (lesson opened and completed events) and for live sessions (join-link clicks, plus import of the meeting platform’s attendance report as a CSV file, confirmed by the teacher).
LMS-4 Hybrid Assignment Portal · Phase 1 · Must
•Teachers record grades for paper assignments and in-class paper exams in the system, including offline.
•Learners upload digital homework (a phone photo or a file). Photos are compressed in the browser before upload to save data.
•Paper and digital results feed one gradebook per section.
LMS-5 Online Quiz Engine · Phase 2 · Should
•Teachers create quizzes (multiple choice, true/false, short answer).
•Customizable access rules: open and close times, number of attempts, time limit, and a “lab computers only” option for after-school or computer-lab use.
•Learner answers are saved on the device and synced using FEAT-1.
•Automatic grading for objective questions.
LMS-6 Exam Integrity Suite · Phase 3 · Could
•Safe Exam Browser (SEB): the server checks SEB request headers for quizzes marked “SEB required”.
•Webcam photo proctoring: periodic photos captured through browser camera permission, with explicit consent, stored securely, deleted after a set retention period, and visible only to the teacher and director.
•Built only for centers that have lab computers and agree in writing. Requires a privacy review before any work starts, because it conflicts with the project’s privacy-first principle if done carelessly.
LMS-7 Performance Dashboard · Phase 1 · Must
•Tracks grades across paper tests and digital tasks, submission trends, attendance rates, and overall academic trajectory over time.
•Per-learner and per-section views. Teachers see their sections. Directors see their whole center.
•Trajectory is shown in plain words (Improving, Steady, Declining) with the rule explained.
LMS-8 Constraint-Aware AI Assistant · Phase 2 · Should
•Low-Bandwidth AI Gateway: teacher-triggered. One AI call per teacher instruction, never one per learner. The result is stored in the database and cached on learner devices, so learners download a small piece of text once. Reusable prompt templates are stored locally so no heavy live calls are needed.
•Multilingual & ESL support: simplifies complex teacher instructions into plain English and into chosen native-language summaries for English-as-a-Second-Language learners.
•Machine-generated text is labeled as such. The teacher can edit it before publishing. Nothing is published automatically.
•Only teacher-written instruction text is ever sent to the AI service. No learner data. A monthly usage cap prevents surprise costs.
4.2 Specialized high-impact features
FEAT-1 Low-Bandwidth “Sync-When-Connected” Engine · Phase 1 · Must
Real-world problem: low-income and refugee learners rely on shared smartphones, limited prepaid data, or unreliable Wi-Fi, so standard LMS platforms crash or burn through data.
•Local caching: attendance, grade entries, progress notes (Phase 1) and quiz answers (Phase 2) are saved on the device first, using IndexedDB through a Progressive Web App. IndexedDB replaces the HTML5 LocalStorage named in v1 because LocalStorage is small (about 5 MB) and easy to lose.
•Connectivity detection: the app checks whether it can actually reach the server, not only whether the phone says it is online.
•Compressed batch upload: when connected, all unsent records go up in one compressed batch. Nothing is deleted from the device until the server confirms receipt.
•Safe retries: every record has a unique ID, so repeating an upload never creates duplicates.
•Data conflict resolution protocol: attendance and quiz answers are append-only, so they cannot conflict. Editable records (grades, notes) carry per-device version counters (a version vector, the form of vector clock used for stored data) together with a human-readable timestamp. Phone clocks are often wrong, so ordering never relies on the timestamp alone. If two devices edit the same record while offline, the server keeps both versions in history, flags a conflict, shows the later-received version meanwhile, and lets a teacher choose. No record is ever lost.
FEAT-2 Multi-Teacher Handoff & Audit Trail System · Phase 1 · Must
Real-world problem: volunteer turnover leads to lost paper records, unrecorded learning gaps, and fragmented progress tracking.
•Teachers record lesson completion status, progress notes, and skill-gap tags (reading, writing, speaking, number sense, or custom).
•When a teacher account is deactivated or a section is reassigned, the system automatically builds a Student Transition Profile for each affected learner and one section-level handoff report. Contents: progress notes, physical lesson completion, skill gaps, attendance trends, grade trends, and historical records.
•The report is assigned to the incoming teacher (or to the director if none yet) and can be printed or saved as a PDF.
•Teacher accounts are deactivated, never deleted, so history is preserved.
•Audit trail: a log of who viewed or changed grades, notes, handoff reports, risk flags, and exports, and when.
FEAT-3 Early Drop-Out Risk Scoring Algorithm · Phase 1 · Must
Real-world problem: drop-outs are rarely sudden. They start with quiet attendance drops and missed homework, often caused by family financial stress, elder care, or fear.
•A Python microservice (FastAPI) calculates a weighted score from three indicators: Risk Score = 100 × (w1 × Consecutive Unexcused Absences + w2 × Missing Assignments + w3 × Grade Slope), each indicator scaled from 0 to 1.
•Starting weights: w1 = 0.5, w2 = 0.3, w3 = 0.2, kept in a config file. These are educated starting guesses, to be calibrated with real centers. The documentation says so openly.
•Edge-case rules: excused absences count at a reduced weight (starting at 25%). An absence marked “Family circumstances (details not recorded)” does not raise the score but adds a “check-in suggested” note. Sessions that were cancelled are ignored. A learner with fewer than 3 data points gets “insufficient data” instead of a score, to prevent false positives.
•Starting levels: Watch at 40 or above, High at 70 or above, adjustable by the director.
•Privacy: the service receives only an anonymous learner code and numbers. No names, no notes, no personal details.
•Output: flagged learners appear on the director dashboard with plain-language reasons and a suggested supportive check-in (for example a home visit or a conversation). Flags can be marked “Check-in done” or dismissed with a reason. Nothing happens automatically.
•Unit testing and edge-case calibration: an automated pytest suite proves how the edge cases above change the result, including excused illness versus unexcused gaps, new learners, a single bad grade, all assignments missing while attending, and changed weights.
•The absence reason list is coarse by design: Illness, Family care, Transport or cost, Family circumstances (details not recorded), Unknown. The system never records legal status or free-text details about a family’s situation.
FEAT-4 Grant-Compliant Anonymized Data Exporter · Phase 1 · Must
Real-world problem: centers need attendance and engagement data to win donor funding (for example from UNHCR or NGO funders), but handling vulnerable learners’ data demands strict privacy.
•A built-in export engine that never outputs names, contact details, addresses, exact birth dates, or free-text notes. Only a fixed whitelist of fields can leave the database layer.
•Cryptographic PII scrubbing pipeline: learner identifiers are converted with salted SHA-256 hashing, implemented as HMAC-SHA-256 with a secret key kept outside the code, before data leaves the database layer. This keeps one learner’s records linkable within a report without revealing who they are.
•Small-group suppression: any figure based on fewer than 5 learners is shown as “<5”, so a small class cannot be re-identified from the statistics. The threshold is adjustable.
•Aggregates physical classroom activity into statistics such as “85% retention across 50 registered learners in Q3”, with optional breakdowns by the demographic fields a center chooses to collect (default: age band and gender only).
•Two modes: Aggregate report (default) and Pseudonymized learner-level file (only when a funder requires it).
•Output formats: CSV and PDF. Exports are limited to Center Director and Admin and are recorded in the audit trail.
4.3 Cross-cutting requirements
SYS-1 Accounts, roles, and permissions · Phase 1 · Must
•Roles: STUDENT, TEACHER, CENTER_DIRECTOR, ADMIN, with least-privilege access enforced on the server.
•Staff sign in with email and password (stored hashed). Learners sign in with a learner code and a simple PIN, suited to shared phones.
•Accounts are deactivated, not deleted.
SYS-2 Data minimization · Phase 1 · Must
•Collected: learner code, first name or nickname, age band, section, and optional demographic fields chosen by the center.
•Optional: contact details the center needs, stored only if needed, visible only to the director, never exported.
•Never collected: legal or immigration status, identity documents, exact home address.
5. Non-functional requirements
•Devices: works on low-cost Android phones and older browsers. Mobile-first layouts and large tap targets.
•Offline: after first load, attendance and grade entry work with no connection. Clear on-screen status: “Saved on this phone, waiting to send”.
•Data use: compressed uploads, compressed photos, no background polling, no auto-playing media.
•Language: simple English interface, written so it can be translated later.
•Security: HTTPS, hashed passwords, permissions checked on the server, secrets stored in environment variables, no real student data in the public repository or on the free demo hosting.
•Reliability: a failed sync never loses data.
•Maintainability: modular code with comments explaining why each design choice was made, and automated tests for sync, risk scoring, and exports.
•Open source: MIT license and a contribution guide.
•Accessibility: high contrast and readable text sizes.
6. Technical architecture
Layer
Choice
Why
Web app
Next.js (TypeScript) + Tailwind CSS
One codebase for pages and server logic, widely documented, works well with AI coding tools
Database
PostgreSQL + Prisma ORM
Reliable, relational, and Prisma gives readable schema files
Offline
Progressive Web App (service worker) + IndexedDB
Works offline, installable on a phone, much larger storage than LocalStorage
Sync
Gzip-compressed JSON batches to an API route
Small payloads for prepaid data
Conflict logic
Version vectors + timestamps, in one tested module
Does not trust phone clocks
Risk service
Python FastAPI + pytest
Matches the PRD, keeps the model isolated and testable
Privacy
HMAC-SHA-256 using Node’s built-in crypto
Replaces the Crypto-JS library named in v1, which is no longer actively developed as far as I know
Charts and PDF
A charting library and a server-side PDF library
Dashboard and export reports
Tests
Vitest (TypeScript) and pytest (Python)
Proof that the hard parts work
Demo hosting
Vercel (web), Render (risk service), hosted PostgreSQL
Free-tier friendly, synthetic data only. Hosting for real data is decided with each center in Phase 2
Required diagrams (Mermaid, in docs/architecture.md): (1) local storage caching, (2) offline attendance sync, (3) conflict resolution logic, (4) PII anonymization pipeline, (5) database schema relationships.
7. Engineering and open-source delivery standards
•Repository: a clean, public GitHub repository with the five diagrams above.
•Commit history: commit after every small working step. The history must be the real record of the work, with no backdating and no rewriting of history. Commit messages follow a simple pattern: feat, fix, docs, test, chore.
•README.md: the problem, how geopolitical constraints, physical classroom realities, low bandwidth, and volunteer turnover drove each architectural decision (written in the owner’s own words), setup steps, architecture summary, an honest status table of what works and what does not, and a statement that the code was written with AI assistance under the owner’s direction.
•CHANGELOG.md: a record of each release and of what changed after real feedback.
•docs/: architecture.md, DECISIONS.md (what was chosen, why, and what was rejected), DATABASE.md, RISK_MODEL.md, PRIVACY.md, USER_FEEDBACK.md.
•Real user feedback only: USER_FEEDBACK.md records feedback from real educators, with their permission, as received, including criticism. No simulated or invented feedback anywhere in the project.
•Synthetic data only in the repository and the public demo.
8. Success criteria
Phase 1 is done when:
1.A teacher can take attendance for 30 learners in under 2 minutes with no internet, and the records reach the server automatically when internet returns, with no losses and no duplicates.
2.Two offline edits to the same grade produce a visible conflict and nothing is lost.
3.Paper and digital grades appear together in the performance dashboard.
4.Deactivating a teacher produces a handoff report for the incoming teacher.
5.The risk service passes its pytest suite, including every edge case in FEAT-3, and flags use supportive wording.
6.Exports contain no names or contact details (checked by an automated test), suppress small groups, and download as CSV and PDF.
7.The build, the TypeScript tests, and pytest all pass.
8.The public repository has the README, CHANGELOG, five diagrams, DECISIONS, PRIVACY, and LICENSE files, and a demo with synthetic data is online.
Phase 2 is done when:
•At least one real group of educators has used the system and given written feedback, recorded in USER_FEEDBACK.md.
•The top issues from that feedback are fixed and listed in the CHANGELOG.
•The Phase 2 features (LMS-2 offline media, LMS-3 digital attendance, LMS-5, LMS-8) are built, in the order real needs dictate.
9. Risks and mitigations
Risk
Mitigation
Scope too large for the time available
Phases, Must/Should/Could priorities, and a cut list in the Execution Plan
AI-written code contains bugs or security holes
Small tasks, automated tests, manual checks every day, weekly “explain-it-back” reviews, and a security check before any real data is used
Real learner data exposed
Data minimization, synthetic data only in the demo, server-side permission checks, privacy review before any pilot
Teachers do not adopt it
Early interviews, one-tap design, 10-minute training, a feedback loop
Phone clocks are wrong
Ordering by version vectors, never by timestamps alone
Free hosting limits (sleeping servers, quotas)
Demo use only. Hosting for real use is planned with each center
Semester workload
Phase 2 capped at about 4 hours per week and paused during exams. The application essay has priority
Machine translation errors in some languages
Labeled as machine-generated, teacher review required, never auto-published
Overclaiming in applications
The README status table says exactly what was built, tested, and used
10. Traceability: every v1 requirement and where it went
#
v1 requirement
v2 ID
Phase
What changed
1
Syllabus & Course Manager
LMS-1
1
Kept. Offline saving of resources added in Phase 2
2
Hybrid & In-Person Classroom Dashboard
LMS-2
1 and 2
Kept. Live video through meeting links. Offline media in Phase 2
3
One-tap offline Kiosk attendance
LMS-3
1
Kept
4
Automated tracking for digital modules and live sessions
LMS-3
2
Kept, moved to Phase 2
5
Hybrid Assignment Portal (paper grades and digital uploads)
LMS-4
1
Kept
6
Online Quiz Engine with access rules
LMS-5
2
Kept, moved to Phase 2
7
Exam Integrity Suite (SEB and webcam proctoring)
LMS-6
3
Kept as optional, privacy review required
8
Performance Dashboard
LMS-7
1
Kept (the v1 plan had no build step for it)
9
Low-Bandwidth AI Gateway
LMS-8
2
Kept, teacher-triggered and cached
10
Multilingual & ESL support
LMS-8
2
Kept, with teacher review
11
Local caching, connectivity detection, compressed batch sync
FEAT-1
1
Kept. LocalStorage replaced by IndexedDB
12
Timestamped vector clocks and server-side reconciliation
FEAT-1
1
Kept as version vectors plus timestamps
13
Teacher handoff and Student Transition Profile
FEAT-2
1
Kept
14
Audit trail
FEAT-2, SYS-1
1
Kept and expanded
15
Weighted risk score with three indicators
FEAT-3
1
Kept. Reason codes made coarse for safety
16
Pytest edge-case calibration
FEAT-3
1
Kept, edge cases listed
17
Admin dashboard flags for home check-ins
FEAT-3
1
Kept, supportive wording, human decision
18
PII stripping and salted SHA-256 hashing
FEAT-4
1
Kept as HMAC-SHA-256, plus small-group suppression
19
Aggregated statistics as CSV and PDF
FEAT-4
1
Kept
20
Public repo with system design flowcharts
Section 7
1
Kept, plus a schema diagram the v1 plan was missing
21
README.md and CHANGELOG.md with constraint-driven decisions
Section 7
1
Kept
22
Logs of user testing feedback from peer educators
Section 7
1 interviews, 2 pilot
Kept, real feedback only, no simulated logs

