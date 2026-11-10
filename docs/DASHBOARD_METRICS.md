# Dashboard metrics

Approved rules for the Day 11 performance dashboard (LMS-7). The pages explain these rules in plain language. This file is the version the tests check.

The handoff seed stores a separate trend label. That label compares the first two scores with the last two. It is not this rule.

The Day 14–15 risk score is a different calculation. This dashboard does not produce it.

## Who can see a page

The server checks every section and every learner before it returns numbers.

- A teacher sees sections assigned to them today. The assignment has a start date and an optional end date. An ended assignment does not grant access.
- A director sees every section in their own center.
- A learner, an admin, a switched-off account, and a director from another center receive no performance data.
- A guessed section id or learner id returns the same empty result as a missing page.
- Learner-facing performance pages are out of Day 11.

## Grades

Every assignment kind uses one current `GradeEntry`: Paper, Digital, Both, and In-class exam. The percent is `points ÷ maximum × 100`. Assignments keep their own maximum marks. Raw points are not averaged together.

A missing grade stays out of every average. It is not stored as zero.

An open grade conflict stays visible as **Needs review**, with the same provisional mark the gradebook shows. That mark stays out of the average and out of the trajectory until a teacher resolves it.

A learner’s grade average is the mean of their settled percents. The section grade average gives every learner with at least one settled mark the same weight. A learner with one mark counts the same as a learner with four. Learners with no settled mark stay out of the section average.

Grade history rows are edits of one mark, including both sides of a conflict. They are not extra assignments.

## Submissions and grades stay separate

A grade does not prove that a paper assignment was handed in. Paper can be collected in class and marked later.

| Kind | Grade column | File column |
| --- | --- | --- |
| Paper, in-class exam | Graded, Awaiting grade, or Needs review | Not a file submission |
| Digital | Graded, Awaiting grade, or Needs review | The file status below |
| Both | The paper-mark status | The digital file status, shown separately |

File status uses the latest submission for that learner and assignment, ordered by the server update time. The words match the gradebook:

- Stored: Submitted
- Queued: Waiting to upload
- Uploading: Uploading
- Failed: Upload failed
- No row: Not submitted

Only a stored file counts as submitted. A queued, uploading, or failed file is not submitted.

Overdue applies only to the file on a Digital or Both assignment. The file is overdue when it has a due date in the past and it is not stored. An assignment with no due date is never overdue. The teacher form can save an assignment without a due date, so those rows say **No due dates set** instead of 0% overdue.

There is no per-learner “this assignment does not apply” field. The current file counts above still expect every active learner to have every Digital or Both assignment. Withdrawn and completed enrollments stay off the roster, matching the gradebook.

The file column is the current upload status. It uses the latest submission row. That status is separate from the receipt trend below.

## File receipts over time

This is a received-by-now rate. It is not an on-time rate, and it is not the academic trajectory. Improving, Steady, and Declining are not used here.

Paper and in-class exams are left out. A grade is not proof that paper was handed in. Digital and Both assignments contribute only the file side.

A learner-assignment pair is received when at least one submission is stored and has a receipt time. If several stored rows exist, the page shows the earliest receipt time. A file that arrives after the due date still counts as received, and that receipt time stays visible. A queued, uploading, or failed file is not received. A stored row with no receipt time is not received.

The denominator is past-due Digital and Both assignments for learners who are active in the section now. A learner is expected only when their enrollment date, in the center timezone, is on or before the assignment due date. An assignment that was already due before the learner enrolled is left out of the rate. The rate is a history of the current roster. It does not include learners who have left.

The database cannot mark one assignment as exempt for one learner.

A future due date stays out of the rate. The row can still say Received when a file arrived early. An assignment with no due date stays out of the rate and is never called overdue.

Dates and receipt times use `Center.timezone`, the same IANA timezone the timetable already uses. Stored instants stay in UTC. If that timezone cannot be read, the page says **The center clock could not be read.** It does not guess a timezone.

The section table has one row per file assignment, earliest due date first. Each past-due row shows expected files, received files, and the received-by-now rate. The learner table has one row per file assignment, with the result and the receipt time.

When fewer than two past-due file assignments have an expected learner, the page says the rows are not enough to compare earlier and later work. Two or more can be compared by reading down the table. No chart library is added.

## Attendance

An eligible session for a learner is a class that meets all of these:

- The status is Scheduled or Held. Held is included because a class that already met is still an eligible session. The demo stores past classes as Held.
- The start time is already in the past. The server clock decides this.
- The class date, in the center’s timezone, is on or after the learner’s enrollment date and, when a withdrawal date exists, on or before that date.

Cancelled sessions are left out. A future session is left out. A cancelled session is never an absence.

The current status is the latest attendance event for that learner and session. Order is the server receipt time, then the time the row was stored, then the record id. The phone clock is ignored. A correction replaces the older status. A repeated upload cannot add a second event. Older events stay in history and are not counted again.

| Count | Meaning |
| --- | --- |
| Present, Late, Absent, Excused | The current recorded status |
| Unmarked | An eligible session with no attendance event |

Unmarked is its own count. It is never labeled Absent.

**Confirmed attendance rate** = (Present + Late) ÷ eligible sessions.

**Attendance recording coverage** = (Present + Late + Absent + Excused) ÷ eligible sessions.

The denominator of both rates is every eligible session, including unmarked ones. Unmarked sessions are still not called absences. Coverage shows how much of that denominator has a recorded status.

When the learner has eligible sessions and none of them has a recorded status, both rates display **No attendance recorded yet**. They do not display 0%.

When there are no eligible sessions, both rates display **No eligible sessions yet**.

When at least one status is recorded, the rates display as percents rounded to one decimal, even if Present + Late is zero because the recorded statuses are Absent or Excused.

A section rate pools every learner’s counts, then uses the same two formulas. The section grade average is the one place that gives each learner equal weight.

Example: 10 eligible sessions, with Present 6, Late 1, Absent 1, Excused 1, and Unmarked 1. Confirmed attendance = 7 ÷ 10 = 70.0%. Recording coverage = 9 ÷ 10 = 90.0%. Unmarked stays 1. A cancelled session and a future session are outside the 10.

Example: 10 eligible sessions and no recorded status. The page says **No attendance recorded yet**. Unmarked is 10.

## Academic trajectory

Attendance does not enter the trajectory. Cancelled sessions and unmarked rows cannot change the label.

The labels are Improving, Steady, Declining, and Insufficient data.

1. **Lookback.** The 8 most recent settled marks in this section. With 4 to 8 settled marks, use all of them.
2. **Percent.** `points ÷ maximum × 100`.
3. **Order.** Oldest to newest by the assignment due date. When the due date is empty, use the date the assignment was created on the server. Ties use that created date, then the assignment id. The phone clock is not used.
4. **Settled mark.** A current grade, a maximum above zero, and no open conflict. A missing grade is left out. A file without a grade is left out. An open conflict is left out.
5. **Minimum.** 4 settled marks. Fewer than 4 is Insufficient data.
6. **Split.** Sort the lookback from oldest to newest. When the count is odd, leave the chronological middle mark out of both halves. Compare the later half with the earlier half. Each half then has at least 2 marks.
7. **Middle value.** Sort the half. When the half has an odd count, use the middle value. When the half has an even count, including a half of 4, use the arithmetic mean of the two middle values.
8. **Thresholds, in percentage points.** Exactly 10 counts.
   - **Improving:** the later middle value is at least 10 above the earlier middle value, and at least two later marks are each at least 10 above the earlier middle value.
   - **Declining:** the later middle value is at least 10 below the earlier middle value, and at least two later marks are each at least 10 below the earlier middle value.
   - **Steady:** there are at least 4 settled marks, and neither of those is true.

One low mark can move the middle value when a half has only two marks. It cannot meet the requirement that two later marks moved. The label stays Steady.

The section page counts learners in each label. It does not collapse the section into one word.

### Worked examples

**Improving.** 50%, 55%, 70%, 78%. Earlier middle value 52.5. Later middle value 74. The rise is 21.5, and both later marks are at least 10 above 52.5.

**Steady, including one low mark.** 80%, 82%, 84%, 40%. Earlier middle value 81. Later middle value 62, a drop of 19. Only the 40 is at least 10 below 81. The label is Steady.

**Declining.** 80%, 78%, 60%, 55%. Earlier middle value 79. Later middle value 57.5. Both later marks are at least 10 below 79.

**Insufficient data.** Three settled marks, plus a stored file with no grade. The file is not a fourth mark.

**Even half of four.** Sorted percents 60, 70, 80, 100. The two middle values are 70 and 80. The middle value of the half is 75, which is their arithmetic mean.

## What the pages show

Tables only. No chart library is added. A chart would be another download on a cheap phone, and these counts fit in a table.

- Teacher section page: one row per learner, with grade average, awaiting-grade count, file counts, both attendance rates, and the trajectory label. A second table lists file receipts in due-date order.
- Teacher learner page: one row per assignment, with the grade status and the file status in separate columns, the trajectory numbers, a file-receipt table, and one current attendance status per eligible session.
- Director center page: one row per section.
- Director section and learner pages use the same tables. The server checks the director’s center on each request.
