# Privacy

This note explains what this version of Open LMS Refuge stores, where it is stored, and what leaves the centre's own application. It is a description of the software. It is not legal advice, and it is not a claim that the software meets any particular law.

A learning centre must decide whether this prototype is appropriate for its learners, and it must review the consent sheet in [pilot/INFORMATION_AND_CONSENT_TEMPLATE.md](pilot/INFORMATION_AND_CONSENT_TEMPLATE.md) before any real use.

## Data minimization

Learner profiles store a learner code, a nickname, and an age band. Age bands are ranges such as 12–14 or 15–17. The app does not have a field or a form that asks for:

- legal or immigration status
- a home address
- an exact date of birth or a birth year

A class meeting link is a Google Meet, Zoom, or Jitsi address for that class. It is not a learner's home address. A centre record stores a name, a short code, and a time zone. It does not store a street address.

The database can also store an optional gender, from a fixed list, and an optional phone number that only a director of that centre can read. The current screens do not ask for either value. The synthetic demo seed writes a gender for some fake learners and leaves the phone option turned off. There is no screen that saves a new phone number.

These limits do not stop every possible collection. A teacher can type a legal status, an address, or a date of birth into a progress note or a grade comment. A homework photo or PDF can show the same information. The app does not scan notes or files for sensitive content.

## Information the application handles

### Collected by the current screens

| Information | Where it is entered | Where it is stored | Sent outside this app? |
| --- | --- | --- | --- |
| Staff email, display name, and password | Staff sign-in, and password reset by an admin or director. Demo accounts come from the seed. | The password is stored as a hash. The plain password is not stored. | No. |
| Learner code, nickname, age band, and PIN | Learner sign-in. Demo profiles come from the seed. There is no registration form. | The PIN is stored as a hash. | The learner code is sent to the risk service when a director runs a score. The nickname, age band, and PIN are not. |
| Attendance and a closed absence reason | The attendance screen, including offline. Reasons are Illness, Family care, Transport or cost, Family circumstances (details not recorded), and Unknown. | PostgreSQL, and on the phone until and after sync. | Dates, statuses, and a yes/no family-circumstances flag go to the risk service. The reason words do not. |
| Grades and an optional grade comment | The gradebook and the offline record editor. The comment can be up to 500 characters. | PostgreSQL, with older versions kept. A waiting edit is also on the phone. | Points and maximums can go to the risk service. The comment does not. |
| Homework files | The learner homework page. Large photos are reduced on the phone first. | The file waits in IndexedDB. Metadata is in PostgreSQL. The bytes go to Cloudflare R2 only when that storage is configured. | The file bytes go to R2 when it is configured. They are not sent to the risk service. |
| Progress notes and skill gaps | The teacher record editor. The note can be up to 2,000 characters. Skill gaps are a fixed list plus one centre-defined tag. | PostgreSQL, with older versions kept. A waiting edit is also on the phone. | No. The note text is shown inside a handoff report to the assigned recipient. |
| Courses, materials, and the timetable | Teachers and directors. | PostgreSQL. A video item is a link, not an embedded player. | Opening a meeting link or a web link is the browser visiting that site. The app does not attach the roster to that request. |
| Risk scores and check-in notes | A director starts a run and may later write a note of up to 160 characters or choose a dismissal reason. | PostgreSQL. | The scoring request described below is sent to the Python service. The saved flag stays in this app. |
| Handoff reports | Created when a teacher is switched off or a section assignment ends. | PostgreSQL. Opening the report shows nicknames, learner codes, attendance, grades, skill gaps, and the linked note text. | No external service. The recipient can print the page from the browser. |
| Donor exports | A director or admin downloads a CSV or PDF. | The file is downloaded. An audit row records the export. | The file goes to the person who downloaded it. It is not sent to a funder automatically. |
| Audit records | Written for views or changes of grades, progress notes, handoff reports, risk flags, exports, accounts, homework submissions, skill tags, and stored funder requirements. Attendance is an allowed type, and the demo seed includes sample attendance rows. The live attendance save does not write an audit row for each mark. | PostgreSQL. The visible details are short tokens such as an action and a count. Note text is not copied into the log. | No. |
| Shared-phone handover | A staff member releases a locked phone and types a reason of 10 to 200 characters. | PostgreSQL. The screen asks them not to type a PIN or a family story. The text is not checked. | No. |

### Supported by the database, not by a current screen

- Optional gender, stored only if that centre option is on.
- Optional phone number, readable by the director if a row exists.
- A funder-requirement reason of 10 to 200 characters. The server function and the table exist. There is no page that creates or edits the requirement. The reason is not copied into the export file.
- Lesson-completion rows. Handoff reports can display them. Teachers have no screen to record them.

Sign-in sessions store who signed in, when the session was last used, when it expires, and whether it was revoked. The browser cookie holds only a sealed session id. A session ends after 8 hours, or after 30 minutes without a page load. Failed sign-ins increment a counter stored under a SHA-256 hash of the email, learner code, or network address. The raw value is not stored in that counter.

## Free text and uploaded files

Progress notes, grade comments, check-in notes, handover reasons, course summaries, and reading-list text are ordinary text. Skill-tag names reject a short list of phrases such as "legal status" and "asylum". Note bodies do not.

Centres should tell staff not to write legal status, identity-document numbers, home addresses, exact birth dates, or sensitive family stories into these boxes.

A homework photograph or PDF is stored as the file. It may show a face, a document, or an address. The app does not read text out of the picture.

## Phones and shared devices

The phone uses IndexedDB, a browser database named `olr-local`, and a `localStorage` key named `olr.device.v1`. IndexedDB can hold the class roster, including nicknames and learner codes, attendance marks, grade and note edits, homework file bytes, and note-view receipts.

These stores are not encrypted. Anyone who can open the browser's storage tools can read them. The application lock hides the class list after sign-out. It does not scramble the data, and it does not delete unsent attendance, grades, notes, or homework files. Confirmed attendance also stays on the phone so a later correction still has the earlier mark.

A browser may refuse to promise that it will keep stored data. When that happens for attendance, the app does not claim the mark was saved.

## External services

This version does not use a third-party login provider or an analytics service. Staff and learners sign in against this app's own database.

### Risk-scoring service

A director can start a scoring run from **Check-in suggestions**. The Next.js server then calls the Python service at `RISK_SERVICE_URL`. If that address or the shared key is missing, no score is invented and no request is sent.

The request contains:

- the centre's real learner code
- the scoring date
- attendance rows with a synthetic id, a date, a status, and a yes/no family-circumstances flag
- how many file assignments were expected and how many are missing
- grade points, maximums, and whether the mark is settled, under synthetic ids
- the centre's Watch and High thresholds

It does not contain learner names, phone numbers, progress-note text, grade comments, or the database ids of the learner, the class, or the assignment. The Python service rejects any extra field.

The learner code is the same code printed on the learner's profile. The centre can match it back to that person. Do not describe it as anonymous. Dates plus an attendance pattern can also be distinctive in a small class.

The service is used only for that director-started run. There is no daily automatic job in this version.

### Cloudflare R2

When `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` are all set, the browser uploads a homework file directly to a private R2 bucket using a short-lived link. The object name is `submissions/` plus an id. The link between that id and the learner stays in PostgreSQL. The picture or PDF itself can still contain personal information.

If any of those four settings is empty, the app says file storage is unavailable. The file stays on the phone. No public folder is used instead. This repository does not contain a configured bucket. See [STORAGE.md](STORAGE.md).

## Exports

Directors and admins can download a report. Teachers and learners cannot. The server allows only a fixed set of fields. Names, learner codes, phone numbers, notes, and database ids are not in that set.

**Aggregate report.** This is the default. It contains centre counts for a date range: registered learners, retention, attendance, and assignment completion, plus age-band counts. Gender counts are included only when that centre has the gender option turned on. A count below the centre's minimum, 5 by default, is shown as `<5`. If hiding only one cell would let a reader recover it by subtracting the other cells from the total, one more cell is hidden. Overlapping date ranges and outside knowledge can still narrow a hidden group. The report text says so.

**Pseudonymized learner-level report.** This is offered only when the centre already has an active funder requirement. Each learner row in that mode contains a pseudonym and nothing else. The pseudonym is HMAC-SHA-256 of a version label, the scope, a report or requirement id, and the learner code, using `EXPORT_SECRET`. The secret stays on the server and is not written into the file. A new report normally produces a new pseudonym. The same pseudonym is reused across reports only when the saved requirement says cross-report linkage is required.

The aggregate totals are still in that file. The learner-level rows do not add age or gender onto the same line as the pseudonym. The screen warns that pseudonymized learner-level data is still sensitive and is not anonymous. Someone who has the secret and a learner code can recompute the pseudonym. The whole learner list is withheld when the registered group is smaller than the minimum, because the number of rows would reveal that size.

Nothing in the app emails or uploads a report to a funder.

## Who can see what

- A learner can see their own profile, their sections, today's classes, their materials, and their homework page.
- A teacher can see the sections they are assigned to now, including attendance, grades, notes, and a handoff report assigned to them for one of those sections.
- A director can see their own centre, including optional phone numbers, check-in suggestions, handoff reports, and exports.
- An administrator can manage accounts, reset passwords, switch accounts off, and export a centre. An administrator does not get grades, progress notes, or handoff note text through those permission checks.

Hiding a link is not the check. The server repeats the check on the page and on the API.

Audit records show that an allowed person viewed or changed something the log covers. They do not stop that person from reading a record they are allowed to open. They do not contain the note text. Marking attendance is not, by itself, written to this log.

## Retention and deletion

Staff and learner accounts are switched off. They are not deleted, so older records still have an author. Switching a teacher off also revokes their sign-in sessions and prepares the handoff reports described above. Switching the same teacher off again does not create a second set of reports.

This version has no action that erases a learner profile, their attendance, their notes, or their files.

The app does delete some narrower things:

- a homework object that fails the size or checksum check, when the server created that object
- a class session or a course resource that an authorised person removes
- a failed-sign-in counter after a successful sign-in

There is no general retention period in the software. A centre that needs one must define it outside this prototype.

## Limitations

- Phone storage is not encrypted. Sign-out hides records in the app and leaves them in the browser.
- Free-text fields and uploaded files can hold information the profile form never asks for.
- The risk service receives a learner code the centre can link back to a person.
- Pseudonyms are not anonymous. Small-group suppression does not survive every overlapping report or every outside fact.
- There is no learner-erasure workflow and no in-app registration form.
- This document does not claim legal compliance, guaranteed anonymity, or complete security.
