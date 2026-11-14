# Architecture decisions

Short record of choices that affect how the app runs locally and in production.

## DATABASE_POOL_MAX for local Prisma Postgres

**Decision:** Read `DATABASE_POOL_MAX` when constructing `PrismaPg` in `lib/db.ts`. When unset, the driver keeps its default pool size.

**Why:** `npx prisma dev` serves a local Postgres proxy that effectively allows **one client connection at a time**. A larger pool (or parallel test workers) opens a second connection and fails with `P1017` / “Server has closed the connection”, especially during long `prisma db seed` transactions.

**Local setup:** Set `DATABASE_POOL_MAX=1` in `.env` while using `prisma dev`. Vitest is configured to run test **files** one at a time for the same reason.

**Rejected:** Relying only on `connection_limit` in the URL string — the pg adapter pool uses `max`, not that query parameter.

## Report-scoped pseudonyms for donor exports

**Decision:** A donor file is built on the server from the center's PostgreSQL rows. The caller supplies a date range, not the learner facts, the suppression minimum, or a report id. The server creates a new random report id for every download.

Learner codes are turned into pseudonyms with HMAC-SHA-256 and `EXPORT_SECRET`. The key must be 64 lowercase hexadecimal characters, which is what `crypto.randomBytes(32).toString("hex")` prints. Checking that shape does not prove the key was random. It rejects the example placeholder and ordinary passwords. A plain SHA-256 hash of a learner code is not used: codes are short and the hash method is public, so someone can try `LNR-0001`, `LNR-0002`, and so on until a value in the file matches. HMAC mixes in the secret first. Without the key, the same guess does not match. The key stays on the server.

The default HMAC input is the report id plus the learner code. The same learner keeps one pseudonym inside that file. The next download gets a new report id, so the pseudonym changes.

**Pseudonymized is not anonymous.** A pseudonymized file still has one row per learner. Someone who knows a learner code and the secret can check a guess. An aggregate file has no learner rows at all. Aggregate is the default.

**Funder approval:** A learner-level file is refused unless this center has an active `FunderRequirement` row, created by a director of that center or an admin. The row records the funder, a short reference, why learner-level rows are required, whether cross-report linkage is required, who approved it, and when. A typed id or a note in the request is not approval. Asking for learner-level rows does not turn on linkage. Linkage stays off unless that saved row says it is required. The audit row stores the short reference and the linkage flag. It does not store the reason text or any learner code. The demo seed does not invent a funder requirement.

**Small groups:** The center's saved `smallGroupSuppressionMin` is the only threshold. A stored value outside 2–100 stops the export. Every published count is a count of learners. A count below the minimum, including zero, is shown as `<` plus the minimum, so the default looks like `<5`. A percentage is published only when the learner group in the numerator and the learner group left over are both at least the minimum. That hides 0% and 100%. If exactly one demographic cell is hidden, the next smallest cell is hidden too, so one hidden number cannot be recovered by subtracting the others from the total. Two hidden cells still reveal only their sum.

This does not make re-identification impossible. A later export with an overlapping date range can be subtracted from this one. Someone who already knows part of a hidden group can learn the rest. Age and gender stay in separate tables and are not crossed on a learner row.

**Counts:** A learner is counted once even with two sections. An active enrollment stays open from its start date. A withdrawn enrollment includes the withdrawn date and stops after it. A completed enrollment includes `completedOn`, written by `completeEnrollment` when a director or admin marks an active enrollment completed. That day still counts. `updatedAt` is not the completion date, because a later edit of the same row would move it. A completed row saved before this column existed can have an empty date. The export does not invent one. That learner is left out of the registered count. If their enrollment date is on or before the end of the report, the cohort, the retained count, and the retention rate all say `Completion date missing` instead of a number. The selected dates are calendar dates in the center's timezone. Class and due instants are converted with that timezone, including daylight-saving changes. Enrollment dates are the calendar dates stored in PostgreSQL and are not shifted again.

Attendance uses the mark the server received last (`syncedAt`, then `createdAt`, then id). The phone's clock is not the order. Present and Late are confirmed. Absent and Excused are recorded and are not confirmed. The denominator is those recorded sessions only. An unmarked session is left out of the numerator and the denominator. It is not called an absence, and it does not lower the rate. If every eligible session is unmarked, or there is no eligible session, the recorded group is zero. The donor file uses the center's `<` label for those attendance figures. It does not say that attendance was never recorded, and it does not say that no session was eligible, because either sentence would reveal that the hidden count is exactly zero. It does not show 0 or 0.0%. Cancelled and future sessions are left out. When a recorded rate is hidden because a learner group is too small, the session totals are hidden too.

The Performance Dashboard uses the same two formulas. Attendance rate is Present and Late divided by recorded marks. Attendance coverage is recorded marks divided by every eligible session, so a blank sheet stays in coverage and out of the rate. The shared example is 7 attended, 1 absent, 1 excused, and 1 unmarked: rate 77.8%, coverage 90.0%. A donor file can still hide that percent when a learner group is below the center minimum. The dashboard shows the percent to the director, because that page is not a donor file.

**Snapshot:** The local database defaults to Read Committed. In that mode each query can see a commit that landed after the previous query, so the enrollment read and the attendance read could disagree. The export sets Repeatable Read on its one transaction. PostgreSQL then shows every read the rows that were committed before the transaction's first query. The audit insert uses that same transaction, so it commits with the file or not at all. This is not Serializable. Two exports at the same moment can still describe two different snapshots.

Assignment completion uses stored evidence only. Paper and in-class exams count as complete when there is a settled grade and no open conflict. There is no separate "handed in" flag. Digital work counts when the latest submission is stored. Hybrid work needs both. An assignment with no due date, or a maximum of zero points, is left out, matching the gradebook rule that an undated task is never overdue. A grade does not, by itself, prove a paper was physically handed in. It is the only evidence the database has.

**Rejected:** Hashing a learner code with no key. One lifetime pseudonym for every learner. Letting the caller supply facts, a report id, or the suppression minimum. Publishing a completion count of zero when fewer than the minimum learners finished. Calling small-group suppression a guarantee against re-identification.
