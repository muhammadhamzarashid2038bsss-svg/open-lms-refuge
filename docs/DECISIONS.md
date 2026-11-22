# Technical decision log

Choices that change how the app stores data, syncs a phone, or builds a donor file. Each entry is backed by the requirements, the development log, the schema, the code, or a commit. A reason written in those sources is labeled **documented**. A reason inferred by reading the code, where nobody wrote it down at the time, is labeled **reconstructed**.

Where a decision date cannot be tied to a meeting or a log entry, the date is the earliest verifiable implementation date. The requirement text for several of these choices is already in `docs/PRD.md` in commit `abd8d57` on 2026-10-24. That date is when the text entered this repository. It is not proof of a separate design meeting.

This log describes the system on `main` at the start of Day 18, commit `0d2acd0`.

## 1. IndexedDB versus LocalStorage

**Decision:** Live phone data is stored in the IndexedDB database `olr-local`. localStorage key `olr.device.v1` remains a read-only backup of the older device queue. This version of the app reads that key and does not write it.

**Why:** Documented. The requirements say IndexedDB replaces the HTML5 LocalStorage named in v1 because LocalStorage is small, about 5 MB, and easy to lose. The Day 7 log on 2026-11-08 says IndexedDB fits attendance events, rosters, snapshots, and device records, and that it is not encrypted automatically. The code comments in `lib/device/local-db.ts` add a constraint the requirements do not: the two stores cannot be saved in one step, so the copy is verified by reading it back, and the original key is never deleted.

**Alternatives considered:** Documented. The v1 requirements named LocalStorage as the phone store. The current requirements replace that choice. No other storage engine is named in the repository.

**Trade-offs:** IndexedDB can hold structured rows and homework file bytes, which a short localStorage string cannot. The backup key can still diverge from IndexedDB. When it does, the phone stops instead of guessing which copy is right. Anyone who can open this browser's storage tools can read both stores. A granted persistence promise does not stop the browser from deleting IndexedDB later.

**Date:** Requirement text: 2026-10-24, commit `abd8d57`. Documented implementation narrative: Day 7 log, 2026-11-08. Earliest verifiable IndexedDB code: commit `e711a08` on 2026-11-08. The device-queue key itself is older: `lib/device/shared-device.ts` was added in commit `29a483e` on 2026-11-05.

## 2. Version vectors versus timestamps

**Decision:** Grades and progress notes carry a version vector: a map from device id to that device's save count for the one record. The server compares vectors. It accepts a save only when the sending device raised its own count and left every other count unchanged. Concurrent vectors are kept as two full copies. The phone clock is stored and is not used to pick a winner.

**Why:** Documented. The requirements say phone clocks are often wrong, so ordering never relies on the timestamp alone. The schema comment on `GradeEntry.versionVector` says the same thing. The Day 2 log on 2026-11-03 describes the scoreboard. The Week 2 review on 2026-11-10 records that both copies were kept when two browsers edited the same record, and that a later edit worked after a teacher resolved the conflict.

**Alternatives considered:** Documented. Ordering by the phone timestamp alone is the alternative the requirements and the code comments reject. `deviceRecordedAt` and `recordedAt` are still stored so a person can read them. The repository does not record an evaluation of other conflict algorithms by name.

**Trade-offs:** Two offline phones cannot silently wipe each other. The cost is a human step: an assigned teacher must choose the shown copy, the other copy, or a merged value. Until then the screen shows the copy the server received later, by `syncedAt`. A vector that raises another device's count is rejected. Attendance does not use vectors, because a correction is a new row.

**Date:** Requirement text: 2026-10-24, commit `abd8d57`. Design note: Day 2 log, 2026-11-03. Columns first shipped in commit `b7ca0f5` on 2026-11-04. Comparison and resolution shipped in commit `f467859` on 2026-11-10. The 2026-11-03 log is the design note, not the date the comparison code ran.

## 3. Append-only attendance records

**Decision:** An attendance mark is inserted and then left unchanged. A correction is a new row with its own `clientEventId`. The database trigger `attendance_records_append_only` rejects updates. It rejects deletes unless the local demo reset has set `app.allow_demo_reset` for that one transaction.

**Why:** Documented. The requirements say a correction is a new record and never an overwrite. The Week 1 review on 2026-11-06 gives the example of Absent later corrected to Present, with the original row kept. The schema comment states the same rule. The current mark used by reports is the row the server received last.

**Alternatives considered:** Documented. Updating the same row in place is the alternative the trigger and the Week 1 review reject. The demo-reset switch is a narrow exception for rebuilding synthetic data. The schema says application code must not set that switch.

**Trade-offs:** History survives a mistaken tap and a retried upload. The table grows by one row per correction. The phone must keep enough local history to know which earlier event a correction points at. Confirmed rows are marked acknowledged on the phone and are not deleted. That retention is described as a discrepancy in `docs/architecture.md` because the requirements can be read as allowing deletion after confirmation.

**Date:** Requirement text: 2026-10-24, commit `abd8d57`. Trigger shipped in commit `b7ca0f5` on 2026-11-04, which is earlier than the Week 1 write-up. Documented rationale in the log: 2026-11-06. Kiosk history shipped in commit `62c86c7` on 2026-11-07.

## 4. Local cache and privacy choices

**Decision:** The phone keeps unsent and confirmed records in IndexedDB under the account that wrote them. Sign-out writes a lock and then asks the server to revoke the session. The lock hides the queue on screen. It does not encrypt, delete, or move the rows. A different account is blocked while waiting items remain and no handover note points at that lock.

**Why:** Documented. `lib/device/shared-device.ts` says logout must not delete records that have not been sent, and must lock the phone so the next person cannot read them on screen. `lib/device/local-db.ts` and `lib/device/file-queue.ts` say IndexedDB is not encrypted and that logout does not delete file rows. The Day 7 log records the same limit. The handover row on the server stores a reason, a count, and a device label, and the schema says it does not contain the records, a PIN, or a password.

**Alternatives considered:** No encryption design is recorded in the repository. This entry does not treat encryption as an option that was formally rejected. The recorded choice is the lock, the account fields on each row, and the comments that say the stores are readable.

**Trade-offs:** A shared phone can keep marks that have not reached the server, which matters when the connection drops during sign-out. The same browser profile still holds every account's rows. Filtering by `centerId` and `userId` is an application rule. Browser storage tools can read past it. The offline session snapshot uses the phone clock with an offset measured when the class was loaded. The code says that check is not a security boundary. Ending the server session is.

**Date:** Documented in the Day 7 log on 2026-11-08 and in the code comments added with commit `e711a08` that day. The lock-before-revoke order shipped in commit `d89ce75` on 2026-11-09. The server handover table shipped in commit `29a483e` on 2026-11-05.

## 5. Separate file-upload and submission queue

**Decision:** Homework bytes use their own phone store, `fileQueue`, and their own server table, `file_upload_queue`. They are not members of the JSON sync batch. A retry uses `clientSubmissionId`. The database stores size, MIME type, a SHA-256 checksum, and a private storage key. It does not store the bytes.

**Why:** Documented. The schema comment says a photo must not block attendance and a retry must not duplicate the gradebook row. The Day 2 log on 2026-11-03 records the separate queue. The Week 2 review on 2026-11-10 explains that photographs are larger and can fail partway, so they have their own IndexedDB queue and a foreground upload. The file stays on the phone until the server has read the stored bytes and the checksum matches.

**Alternatives considered:** Documented. Putting the file bytes inside the compressed JSON batch is the alternative those sources reject. `JsonSyncEntityType` has no file value.

**Trade-offs:** Attendance can sync while a photo is still waiting. The phone must have room for the bytes, and logout will not remove them. A real Cloudflare R2 bucket is not configured in this repository. When the storage settings are empty, the app says file storage is unavailable. `docs/STORAGE.md` and the Day 10 log record that real-bucket testing is still pending.

**Date:** Schema comment and table: commit `b7ca0f5` on 2026-11-04. Design note: Day 2 log, 2026-11-03. Phone queue: commit `cc998df` on 2026-11-10, which raised IndexedDB from version 2 to version 3. Documented rationale for the phone queue: Week 2 review, 2026-11-10.

## 6. HMAC versus plain hashing for pseudonymization

**Decision:** Learner codes that appear in a donor file are turned into pseudonyms with HMAC-SHA-256 and `EXPORT_SECRET`. The key stays on the server. A plain SHA-256 hash of the learner code is not used. The implementation uses Node's built-in `crypto`, not Crypto-JS.

**Why:** Documented. The requirements specify HMAC-SHA-256 with a secret kept outside the code, and they drop Crypto-JS because that library was no longer treated as actively maintained. `lib/export/pseudonym.ts` explains the guessing problem: learner codes are short and a public hash with no secret can be tried until a value in the file matches. HMAC mixes the secret in first. The Day 16 log on 2026-11-13 to 2026-11-15 records the same lesson, including that a pseudonymized file is not anonymous.

**Alternatives considered:** Documented. Plain SHA-256 of the learner code is rejected in the code comment and in the export decision that shipped with the feature. Crypto-JS is the library named and not used in the requirements. The key-shape check accepts 64 lowercase hexadecimal characters and rejects the example placeholder. The comment in `lib/export/secret.ts` says that shape does not prove the key was random.

**Trade-offs:** Without the secret, guessing a code does not reproduce the pseudonym. With the secret, a known code can be checked against the file. The secret must be protected on the server. `server-only` stops a client component from importing the export folder. The check of the key's shape will also reject a long passphrase that is not 64 hex characters, even if that passphrase is hard to guess.

**Date:** Requirement text: 2026-10-24, commit `abd8d57`. Implementation: commit `9274935` on 2026-11-15. Day 16 log: 2026-11-13 to 2026-11-15.

## 7. Report-scoped pseudonyms

**Decision:** The default HMAC input includes a new random report id, so the same learner gets one pseudonym inside one file and a different pseudonym on the next download. A stable pseudonym across reports is used only when a saved `FunderRequirement` has `crossReportLinkage` set. The requirement id then replaces the report id. The caller cannot choose that id, and asking for learner-level rows does not turn linkage on.

**Why:** Documented. `lib/export/pseudonym.ts` says two downloads should not line up by themselves. The funder row is the only switch for linkage. The Day 16 log records report scope as the default. The Day 17 log records that learner-level export stays off unless an active funder requirement exists. The audit row stores the short reference and the linkage flag, and it does not store the reason text, because free text can name a person.

**Alternatives considered:** Documented in the export notes that shipped on 2026-11-15. One lifetime pseudonym for every learner was rejected there. Letting the caller supply a report id was rejected there. The code matches that note: `exportCenterReport` generates the report id with `randomUUID()`, and the HTTP route does not read a report id from the form.

**Trade-offs:** A single file still contains the same aggregate figures as an aggregate download: retention, attendance, coverage, assignment completion, and separate age and gender counts. The learner row itself contains only the pseudonym. Linkage across reports is possible only after a director or admin has saved a requirement that asks for it. There is no screen for that save. `approveFunderRequirement` is a server function, and the Export page can only select a row that already exists. A pseudonymized file remains re-identifiable by someone who has the secret and a learner code.

**Date:** Implementation and the written export note: commit `9274935` on 2026-11-15. Funder-requirement table: migration `20261113160000_funder_requirements`. Day 17 log, which covers the approval gate: 2026-11-15.

## 8. Small-group suppression and its limitations

**Decision:** The center's `smallGroupSuppressionMin` is the only threshold. The default is 5, printed as `<5`. A stored value outside 2–100 stops the export. Counts below the minimum, including zero, use that label. A percentage is published only when both the group being measured and the group left over are at least the minimum. If exactly one breakdown cell is hidden, the next smallest cell is hidden too. The report text says overlapping exports and outside knowledge can still narrow a hidden group.

**Why:** Documented. The requirements ask for figures based on fewer than 5 learners to be shown as `<5`, with an adjustable threshold. The schema default and the export code implement that, and they add the floor of 2 and the ceiling of 100. `lib/export/suppression.ts` explains complementary suppression: one hidden cell can otherwise be recovered by subtracting the visible cells from the total. The same file says this does not close every path. The limitation string is stored on the file as `EXPORT_LIMITATION`.

**Alternatives considered:** Documented. The export notes reject publishing a completion count of zero when fewer than the minimum learners finished, and they reject calling suppression a guarantee against re-identification. The dashboard may show 0% coverage or a sentence that nobody was marked. The donor file uses the `<` label instead, because that sentence would reveal that the hidden count is exactly zero.

**Trade-offs:** Small classes are harder to read out of one table. They are not safe from a second export with an overlapping date range, or from someone who already knows part of the group. Two hidden cells reveal their sum. Breakdown cells whose count is zero are omitted before complementary suppression, so a missing category is not printed as zero. Coverage is also withheld when the attendance-rate counts are withheld, because the coverage numerator is that same recorded-session count. Aggregate remains the default. A pseudonymized learner list is omitted entirely when the registered group is below the minimum.

**Date:** The center column shipped in commit `b7ca0f5` on 2026-11-04. The suppression rules shipped in commit `9274935` on 2026-11-15. The coverage dependency, hiding coverage when the recorded-session count is withheld, is in commit `a4fc7f1` on 2026-11-15. Day 16 log: 2026-11-13 to 2026-11-15.

## 9. Coarse absence reasons

**Decision:** Absent and Excused may carry one code from a fixed list: Illness, Family care, Transport or cost, Family circumstances (details not recorded), and Unknown. There is no free-text reason column. Present and Late cannot carry a reason in the application. Family circumstances does not store a story. In the risk service it suggests a human check-in and does not raise the numeric score.

**Why:** Documented. The requirements list those five reasons and say the system never records legal status or free-text details about a family's situation. The Day 6 log on 2026-11-07 records the same list and the absence of a free-text box. The attendance tests reject a free-text reason and reject a reason attached to Present.

**Alternatives considered:** Documented. A free-text family story is the alternative the requirements and the Day 6 log reject. The database check is wider than the screen: it only forces Present to have an empty reason, and it allows a reason on Late. That difference is recorded in `docs/architecture.md`. It was not a written decision to allow Late reasons. The application refuses them.

**Trade-offs:** Reports and the risk score can tell illness from transport without storing a narrative. A center cannot record a situation that does not fit the five codes, except as Unknown or as family circumstances with no details. The Late gap means a direct database write could store a reason the screens will not send.

**Date:** Requirement text: 2026-10-24, commit `abd8d57`. Enum and database check: commit `b7ca0f5` on 2026-11-04. Screen and tests: Day 6 log, 2026-11-07, commit `62c86c7`.

## 10. Excluding legal-status information from the data model

**Decision:** The database has no column for immigration status, legal status, an identity-document number, a home address, or an exact birth date. A learner row stores a learner code, a first name or nickname, an age band, and section membership. A center may turn on gender, from a fixed list, and a director-only phone number. The phone number is a separate table and is not exported.

**Why:** Documented. The requirements under SYS-2 list what is collected and what is never collected. The opening comment in `prisma/schema.prisma` repeats that list. `tests/phase1-schema.test.ts` queries the catalog for column names matching address, passport, immigration, birth date, identity document, legal status, and similar names, and expects no rows.

**Alternatives considered:** The requirements forbid collecting legal status. The repository does not record a prototype that stored it and was later removed. The first migration creates the schema without those columns.

**Trade-offs:** A donor or a risk score cannot slice learners by legal status, which is the point of the rule. Staff also cannot use this database as a case file. Optional phone numbers exist only when a center enables them, and a database rule rejects a phone row when the switch is off. Progress-note and grade-comment columns are length-limited academic text. They are a poor place for a life story, and the screens that write them say so. The columns can still hold whatever a person types inside the length limit.

**Date:** Requirement text: 2026-10-24, commit `abd8d57`. Earliest verifiable schema: commit `b7ca0f5` on 2026-11-04. The catalog test is in `tests/phase1-schema.test.ts`, added with that schema work.

## 11. Reachability is a health request, not the phone's online flag

**Decision:** Attendance sync treats the server as reachable only when `GET /api/sync/health` returns HTTP 200, a JSON content type, and a body of exactly `{"status":"ok"}`. `navigator.onLine` is accepted by the classifier and ignored.

**Why:** Documented. The requirements say the app checks whether it can actually reach the server, not only whether the phone says it is online. `lib/sync/health.ts` says a phone often reports the opposite of what the school server can do. The Day 8 work, commit `09c651f` on 2026-11-09, is the first sync upload that uses this check.

**Alternatives considered:** Documented. Trusting `navigator.onLine` is the alternative the health module rejects. A redirect or an HTML sign-in page is classified as unavailable, so a login page is not treated as a successful sync.

**Trade-offs:** The phone does not upload into a dead session or a captive portal that only looks online. Sync runs only while a signed-in page is open. There is no background upload after the page is gone. A health check that fails leaves the marks pending and schedules a retry.

**Date:** Requirement text: 2026-10-24, commit `abd8d57`. Implementation: commit `09c651f` on 2026-11-09.

## 12. Sealed session cookie

**Decision:** The browser cookie holds an `AuthSession` id sealed with `iron-session`. Logout sets `revokedAt`. A session also ends after 8 hours, or after 30 minutes without a page load. Those limits use the server clock. Passwords and PINs are hashed with Node's `scrypt`.

**Why:** Documented. The Week 1 review on 2026-11-06 says `iron-session` was chosen instead of a larger authentication framework so the app could keep learner code and PIN sign-in. `docs/DATABASE.md` records `scrypt`, and names `bcrypt` and `argon2` as maintained alternatives that were not adopted. Argon2 is described there as needing a native add-on.

**Alternatives considered:** Documented. A larger authentication framework is the alternative named in the Week 1 review. `bcrypt` and `argon2` are the hash alternatives named in `docs/DATABASE.md`. The repository does not record a trial of those libraries.

**Trade-offs:** A copied cookie stops working after revoke, which matters on a shared phone. The cookie seal is not a substitute for the phone lock: the offline class snapshot can still show a class until its copied expiry, and that offline check is not a security boundary. Five failed sign-ins lock the attempt key for 15 minutes. Unknown emails get the same message as a wrong password.

**Date:** Documented rationale: Week 1 review, 2026-11-06. Earliest verifiable sign-in and session-table commit: `29a483e` on 2026-11-05. That commit adds migration `20261104183108_auth_sessions_lockout_handover`. The folder timestamp is 2026-11-04. The commit that put it in the repository is the following day.

## 13. Repeatable Read for one export transaction

**Decision:** The donor export runs in one PostgreSQL transaction at Repeatable Read. The audit insert uses that same transaction. If the insert fails, the function rejects and there is no file to send.

**Why:** Documented. `lib/export/run.ts` says the local database defaults to Read Committed, where the enrollment read and the attendance read could see different commits. Repeatable Read shows every read the rows that were committed before the transaction's first query. The comment also says this is not Serializable.

**Alternatives considered:** Documented in that comment. Read Committed is the default being avoided for this transaction. Serializable is named and not used.

**Trade-offs:** One export's enrollment, attendance, and grades describe the same snapshot, and the audit row commits with that decision. Two exports at the same moment can still describe two different snapshots. The transaction timeout is 20 seconds, which the comment ties to the local one-connection database proxy.

**Date:** Commit `9274935` on 2026-11-15. The comment in `lib/export/run.ts` is the written rationale. No earlier log entry describes this isolation choice.

## 14. Local Prisma pool size

**Decision:** `lib/db.ts` passes `max` to the Prisma Postgres driver. A set `DATABASE_POOL_MAX` must be a positive whole number, and that number is the pool size. Zero, negative numbers, and text that is not a whole number are rejected. When the variable is unset, production uses 1. Other environments keep the driver default of 10. Local development with `npx prisma dev` still sets the pool to 1.

**Why:** Documented in this file since the export work, and in the code comment around the pool. `npx prisma dev` serves a local Postgres proxy that effectively allows one client connection at a time. A larger pool opens a second connection and fails with `P1017` during long seed transactions. Vitest runs test files one at a time for the same reason. On Vercel, each running copy is a separate process. Leaving the driver default of 10 in every copy can exhaust a small Neon database. The website uses Neon’s pooled address and `DATABASE_POOL_MAX=1`. Manual migrations use Neon’s direct address and `npm run db:migrate:deploy`.

**Alternatives considered:** Documented. Relying only on `connection_limit` in the URL was rejected because the driver pool uses `max`, not that query parameter. Leaving production unset, so the driver silently used 10, was the behavior replaced on Day 20.

**Trade-offs:** Local tests and seed runs stay inside the proxy's limit when `DATABASE_POOL_MAX=1`. A hosted database can still raise `DATABASE_POOL_MAX` on purpose. Forgetting the local setting brings back the closed-connection errors on `npx prisma dev`. Forgetting it on Vercel now opens 1 connection per copy, not 10. This choice is about connection limits, not about learner privacy.

**Date:** Commit `b49a83a` on 2026-11-06, message `Support configurable Prisma connection pool`. The written note in this log was expanded with the export commit `9274935` on 2026-11-15. The 2026-11-06 commit is the earliest verifiable implementation. The production default of 1 was added on 2026-11-22.

## Related pages

- `docs/architecture.md` — diagrams of the running system, and the places where an older sentence disagrees with the code.
- `docs/DATABASE.md` — table-by-table guide.
- `docs/STORAGE.md` — private homework files, and the bucket that is not created yet.
- `docs/PRD.md` — the original requirements. It is not a claim that every line is built.
- `docs/DEV_LOG.md` — the day-by-day notes cited above.
