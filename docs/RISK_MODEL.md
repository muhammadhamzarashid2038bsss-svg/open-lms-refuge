# Risk score

This service suggests when a person may want to check in with a learner. It does not decide that a learner will leave, and it does not label anyone. A director or teacher reads the reasons and chooses what to do. Nothing happens automatically.

The weights and the Watch and High levels are starting estimates. They need to be calibrated with real learning centers before a center relies on them. Until then, treat every flag as a prompt for a human conversation.

Day 14 calculates the score only. It does not store flags, connect to the learning app, or show a director screen. Those steps are later work.

## What the service is allowed to see

The request may contain:

- An anonymous learner code, such as `LNR-0014`.
- The scoring date. This is a calendar date, not a phone clock time.
- Class sessions, each with a date, a status, and a yes/no flag for "Family circumstances (details not recorded)".
- Two assignment counts: how many were expected, and how many of those are missing.
- Grade rows: an assessment id, the academic date of the assessment, points, the maximum points, and whether the grade is resolved.

The service refuses any other field. That includes names, nicknames, contact details, addresses, progress notes, and any free-text story about an absence or a family. A rejected request does not copy those values into the error or the log.

The family-circumstances flag is a yes/no. It is not a place to write what happened.

## The score

When there is enough evidence:

`Risk score = 100 × (0.5 × absence indicator + 0.3 × missing-assignment indicator + 0.2 × grade-trend indicator)`

Each indicator is from 0 to 1. A valid score is from 0 to 100.

The starting levels are:

- **High:** 70 or above.
- **Watch:** 40 or above, and below High.
- **Below 40:** a score is shown, and no risk level is assigned.

An indicator that cannot be calculated is **unavailable**. It is not stored as 0 in the response, because 0 would look like a good result. Inside the formula, an unavailable indicator contributes no points. The original weights stay as they are. They are not redistributed onto the indicators that do exist. A full absence indicator is still 50 points, not 100, when the other two indicators are unavailable.

## Usable records

A score needs at least **3 usable records**. A usable record is one of:

- A session marked present, late, absent, or excused, including a family-circumstances absence.
- One expected assignment. The missing count is not added again.
- One settled grade with an academic date on or before the scoring date.

These do not count:

- A cancelled session.
- A blank (unmarked) session.
- An expected-assignment count of zero.
- A grade that is ungraded, unresolved, invalid, or missing its academic date.
- A grade dated after the scoring date.

If fewer than 3 usable records were sent, the response says **Insufficient data** and the score is empty.

If 3 or more records were sent but none of the three indicators can be calculated, the response is also **Insufficient data**. A number of 0 would look like a good result, and the service will not invent one.

A family-circumstances check-in can still be returned when the score is withheld.

## Absence indicator

The indicator is the longest weighted run of absences, divided by 5, and capped at 1.

Sessions are ordered by the class date, then by the session id. The order of the list, the database insert time, and the phone clock are not used.

Walk the ordered sessions:

1. **Cancelled.** Remove the session. It does not add weight and it does not end the run. The class did not happen.
2. **Unmarked.** Add nothing. End the run. A blank is not an absence. If a blank were skipped, the absences on either side would be glued together and the blank would be treated as continued absence.
3. **Present or late.** Add nothing. End the run. A late arrival is attendance, not an absence.
4. **Absent or excused, with the family-circumstances flag.** Add nothing. End the run. Set "Check-in suggested". Ending the run matters: if the session were removed like a cancellation, it would glue unexcused absences into a longer run and the score could rise because of that mark.
5. **Absent, without that flag.** Add 1.
6. **Excused, without that flag.** Add 0.25. This is an ordinary excuse, such as illness, family care, transport, or unknown. The service does not accept those words, because it does not accept reason text. The caller sends `excused` and leaves the family flag false.

The longest running total is kept. Then:

`Absence indicator = min(1, longest run / 5)`

Worked examples, using the starting values:

- Five unexcused absences in a row weigh 5. The indicator is 1. The score contribution is 50.
- Eight unexcused absences still produce 1, not more than 1.
- Four unexcused absences weigh 4. The indicator is 0.8. The contribution is 40, which is the Watch level when nothing else adds points.
- Five ordinary excused absences weigh 1.25. The indicator is 0.25. The contribution is 12.5. That is a quarter of the five-unexcused result, and it is not the same number.
- Five family-circumstances absences weigh 0. The indicator is 0. The contribution is 0. Check-in suggested is returned.
- Absent, cancelled, absent, cancelled, absent, cancelled, absent, cancelled, absent is still five unexcused in a row. The indicator is 1.
- The same pattern with unmarked sessions, or with family-circumstances absences, between the unexcused marks produces a longest run of 1. The indicator is 0.2.

If every session is cancelled or unmarked, the absence indicator is unavailable. That is not treated as good attendance.

Omitting the family flag means the absence is not in that category. The caller must set the flag when the closed category applies. Forgetting it counts the absence in the normal way, so an unexcused absence is not hidden.

## Missing assignments

`Missing-assignment indicator = missing / expected`

The result is capped at 1.

- The counts must be whole numbers, zero or greater.
- Missing cannot be greater than expected. That request is rejected.
- Ungraded work and work that is not yet due must not be included in either count. The request has no field for them. An extra field is rejected.
- Expected of 0 does not divide by zero. The indicator is unavailable. Zero expected work is not treated as completed work, and it adds no usable records.
- If the assignment counts are omitted entirely, the indicator is unavailable. That is not treated as completed work.

A learner can be attending every session and still have every expected assignment missing. Attendance does not cancel the missing-work indicator. With the starting weights, 4 of 4 assignments missing and no absence run produces a score of 30. That is below Watch.

## Grade trend

This is the approved calculation. Do not change it without asking the project owner.

**Lookback.** The 8 weeks ending on the scoring date. A grade is inside the window when it falls on the scoring date or on one of the 56 days before it. A grade 57 days before the scoring date is outside the window.

**Order.** Academic assessment date, oldest first. When several grades share a date, their immutable assessment ids are sorted in ascending character order. List order, database insert order, update time, phone time, and sync time are not used.

**What counts as a valid grade.**

- `resolved` must be true. The field defaults to false, so an omitted flag cannot enter the trend.
- It needs an academic date.
- Points and a maximum are both present.
- Points are from 0 through the maximum, including a genuine 0.
- The maximum is greater than 0.

Each valid grade is turned into a percentage: `points / maximum × 100`. A mark of 8 out of 10 is 80. A mark of 0 out of 10 is 0 and is kept. Percentages are not adjusted for how hard the assessment was. A drop from an easy task to a hard task can look like a decline.

Grades that are unresolved, ungraded, or missing an academic date are left out of the median. They are counted in the response so the omission is visible. A mark below 0, a maximum that is not positive, or a mark above its maximum is rejected. The score is not calculated around a mark that cannot sit on the 0 to 100 scale.

**Minimums.** At least 6 valid grades inside the window, and the first and last of those grades at least 28 days apart. Otherwise the grade-trend indicator is unavailable. It is not treated as steady performance.

**Comparison.**

- Early performance is the median of the 3 earliest valid grades in the window.
- Recent performance is the median of the 3 latest valid grades in the window.
- The median of three percentages is the middle one after sorting. The lowest of the three cannot set it, and neither can the highest.
- Grades sitting between those two groups are not part of either median.

`Decline = max(0, early median − recent median)`

`Grade-trend indicator = min(1, decline / 10)`

- A decline of 0 points is 0.
- A decline of 5 points is 0.5.
- A decline of 10 points or more is 1.

An improvement does not reduce any other part of the score. The grade indicator stops at 0.

One isolated low grade does not fill this indicator. In the latest three grades 79, 40, and 78, the middle value is 78. The 40 drops out. Against an early middle value of 81, the decline is 3 and the indicator is 0.3.

## Check-in language

The response includes the learner code, the score when one can be calculated, the level, each indicator's value and whether it is available, and plain-language reasons.

When any sent session has the family-circumstances flag, the reasons include **Check-in suggested**. Those absences do not raise the score. The suggestion can appear even when the score is withheld for insufficient data. Nothing is scheduled automatically.

The response also says that these are starting estimates and that a person decides. The word used for the concern is a check-in, not a prediction.

## Configuration

The starting numbers live in `services/risk_engine/config.toml`.

- Absence weight 0.5, missing-assignment weight 0.3, grade-trend weight 0.2.
- Watch 40, High 70.
- Five unexcused absences fill the absence indicator.
- An ordinary excused absence weighs 0.25.

The service reads this file at startup and refuses to start when:

- A weight is negative or above 1.
- The three weights do not add up to 1.
- A threshold is outside 0 to 100.
- Watch is equal to or higher than High.
- The excused weight is outside 0 to 1.
- The full-streak length is not a whole number of at least 1.
- A section or field is missing, or an unknown field is present.

The "at least 3 usable records" rule is fixed in the program. It is not in the editable file, so a config change cannot quietly lower that guard.

## What this score does not do

- It does not predict the future.
- It does not mean a learner is leaving the center.
- It does not turn a stable low grade into a decline. Early 30 and recent 30 is a decline of 0.
- It does not notice a drop that happens in the unused middle of the window and then recovers, or a late drop that stays above the early median. It measures the net change from the first three grades to the last three.
- It does not adjust for assessment difficulty.
- It does not see names, notes, or family stories.
- It is not connected to the learning app yet, and it has no login. Do not put it on the public internet.
