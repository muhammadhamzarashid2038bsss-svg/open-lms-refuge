# Changelog

This log follows the development days in [docs/DEV_LOG.md](docs/DEV_LOG.md) and the Git history. Dates are the days recorded in the log or on the commits. It summarises finished work. It does not treat a planned requirement as a finished feature.

There is no release. `package.json` still says 0.1.0 because that is the starting project number, not a published release.

## 23–24 October 2026 · Project start

- Created the Next.js app, added the product requirements, the MIT licence, and environment-variable examples.
- Kept secrets out of Git. The first commit is the Create Next App commit on 23 October 2026. The project files were committed on 24 October 2026.

## 3–4 November 2026 · Day 2 · Database

- Added the Phase 1 PostgreSQL schema through Prisma, including sync metadata for grades and notes and a separate queue for homework files.
- Added a synthetic demo centre: 30 learners and fake attendance and grades.
- Added tests that attendance rows cannot be edited in place.
- Development used Prisma's local Postgres. A cloud database was not connected.

## 4–5 November 2026 · Day 3 · Sign-in and roles

- Added sign-in with iron-session, separate home pages for admins, directors, teachers, and learners, and server-side permission checks.
- Added a lockout after repeated failed sign-ins.
- Added shared-phone sign-out that locks unsent local records instead of deleting them.

## 5–6 November 2026 · Day 4 · Courses and materials

- Teachers and directors can manage courses, sections, and materials.
- Learners can open materials for their own sections, including whole-course materials.
- The demo seed was split into shorter database transactions after a timeout.

## 6–7 November 2026 · Day 5 · Timetable

- Added the weekly timetable, with in-person, live online, and pre-recorded sessions.
- Live sessions can store a Google Meet, Zoom, or Jitsi link.
- Learners see **Today's classes** on their home page.
- Fixed a sign-in redirect loop that could trap the browser on the opening page.

## 7–8 November 2026 · Day 6 · Attendance screen

- Added the attendance sheet with Present, Absent, Late, and Excused.
- Absence reasons are a fixed list. There is no free-text family story.
- Corrections add a new attendance event. They do not overwrite the earlier one.

## 8–9 November 2026 · Day 7 · Offline phone and kiosk shell

- Made the app installable and cached the public attendance shell for offline opening.
- Added IndexedDB storage for rosters, attendance events, and the phone lock.
- Sign-out writes the lock before it asks the server to revoke the session.
- The production build loaded the kiosk shell while the browser was offline.
- Chrome refused persistent storage during that test, so the app correctly refused to claim that a new offline attendance mark had been saved.

## 9 November 2026 · Day 8 · Attendance sync

- Added foreground sync. The signed-in page sends saved attendance when it can reach the server.
- Added gzip for attendance batches, with a plain-JSON fallback, size limits, and retries.
- The server rejects another website's upload and ignores identity fields supplied by the phone.
- Automated tests passed. A full manual browser-to-database check was still blocked by the storage limitation from Day 7.

## 10 November 2026 · Day 9 · Offline grades, notes, and conflicts

- Two phones can edit the same grade or progress note offline. The server keeps both versions and asks a teacher to choose.
- Ordering uses version vectors, not the phone clock.
- Grade and note edits can be saved when the browser reports enough space, with a warning if it will not promise to keep them. Attendance still asks for the stronger storage promise.

## 10 November 2026 · Day 10 · Gradebook and homework files

- Teachers can create Paper, Digital, Both, and in-class exam assignments and use one gradebook.
- Learners can queue a JPEG, PNG, WebP, or PDF. Large photos are reduced in the browser. PDFs are not.
- The server is written to store files in private Cloudflare R2 and to check size and SHA-256 before accepting them.
- No real R2 bucket was created. Upload tests used a stand-in, not a live bucket.

## 11 November 2026 · Day 11 · Performance dashboard

- Added learner, section, and centre views of attendance, grade trajectory, and file receipt.
- Teachers see their own sections. Directors see their centre. A teacher assigned to a different section is refused.

## 12 November 2026 · Day 12 · Progress notes

- Added progress notes with skill gaps and centre-defined skill tags.
- Note views can be audited without copying the note text into the audit log.
- Opening the notes list does not count as opening every note.
- A phone workflow for lesson completion was deferred. The database table exists. Teachers cannot fill it in from the app.

## 12 November 2026 · Day 13 · Teacher handoff and audit log

- Switching off a teacher, or ending a section assignment, prepares a transition report in the same database transaction.
- The report goes to the only other current teacher on that section, or to the centre director when there is not exactly one.
- Directors and assigned recipients can open the report. Administrators who switch the account off cannot read the note text through the handoff.
- Added an audit log screen for directors and admins.
- Printing uses the browser's print dialog. The app records the print request. It cannot know whether a PDF was saved.

## 12 November 2026 · Day 14 · Risk-scoring service

- Added a separate Python FastAPI service that scores attendance, missing work, and grade trend.
- The service rejects extra fields such as names and notes.
- It was not connected to the website yet. Fifty-five pytest tests passed, and six synthetic requests were tried by hand.

## 12–13 November 2026 · Day 15 · Director check-ins

- The website calls the Python service from the server when a director starts a run.
- Results are saved as check-in suggestions. The director can mark a check-in done or dismiss it. Nothing happens automatically.
- A failed call does not invent a score.
- The learner code sent to the service is the centre's own learner code. The Day 14 and Day 15 notes called it anonymous. Later review of the code showed that the centre can match that code back to the learner. [docs/PRIVACY.md](docs/PRIVACY.md) uses that more precise description.

## 13–15 November 2026 · Days 16 and 17 · Donor exports

- Added aggregate CSV and PDF exports for directors and admins, with HMAC-SHA-256 pseudonyms and small-group suppression.
- Pseudonymized learner-level rows are offered only when an active funder requirement is already stored. There is still no screen to create that requirement.
- The Day 16 log recorded 421 passing Vitest tests. The Day 17 log later recorded 429. This review did not re-run the suite. The Prisma development database was left in place.
- A director's manual export check found no learner names in the aggregate file. The pseudonymized warning could not be clicked in the demo centre because that centre had no active funder requirement.

## Day 18 · 16 November 2026 · Architecture documentation and technical decisions

This milestone is the documentation commit. `docs/DEV_LOG.md` does not yet contain a Day 18 entry. No application feature was added or released on this day.

- Documented the implemented architecture and the technical decisions, including what is not built: quizzes, lesson-completion sync, a funder-requirement screen, a live R2 bucket, and encryption of phone storage.

Planned work that is not in this changelog as a finished feature includes in-app learner registration, learner erasure, quizzes, a teacher AI assistant, exam proctoring, and a hosted production deployment.

## 23 November 2026 · Teacher handoff recipient

- A director or administrator names the incoming teacher when switching a teacher off or ending a section assignment.
- If a director names nobody, that director receives the report. An administrator's blank choice works only when the centre has exactly one active director.
- The named teacher is added to the current classes so they can open the report. The departing teacher's class rows are kept and closed immediately, including one that started today, so switching the account back on does not reopen them. Giving that teacher the same section again the same UTC day is refused with a clear message. An ordinary section reassignment that started today still lasts until the end of that UTC day.
- A director or administrator can assign an active teacher to a section that has no current teacher. That assignment starts today, does not create another handoff report, and leaves older assignment rows and reports unchanged.
- Staffed and unstaffed sections are managed in one place, Manage section assignments. A shared display name is shown with the teacher's email so accounts such as the synthetic Lock Test teachers can be told apart.

## 26 November 2026 · Learner-level export confirmation

- Aggregate CSV and PDF remain the usual grant export.
- A pseudonymized learner-level file is still offered only when an active funder requirement is already stored. The Export page does not collect a funder name.
- Before that file can be downloaded, the director or administrator must confirm that it is still sensitive and is not anonymous. The server refuses the download without that confirmation.
- The audit row records that the confirmation was given. It does not store the warning text, the funder reason, or a learner code.
- A director can record and turn off a learner-level requirement for their own centre. An administrator can do that for any centre. The form asks for an explanation and an optional short reference. It does not ask for a funder name. Turning the requirement off blocks the next learner-level download.
- The Export page puts the aggregate download first. Recording a requirement stays in a closed section underneath. A learner-level download without the confirmation returns to this page with an error and does not start a file.
