# Open LMS Refugee – Future Improvements Backlog

These are potential improvements identified during development and testing. They are not confirmed defects or approved requirements for the current development phase. Review them against the PRD and Execution Plan before implementation.

## 1. Past-Date Session Creation

**Observation:** The timetable currently allows teachers to create sessions for dates that have already passed.

**Possible improvement:** Consider adding a warning when a teacher schedules a session in the past. The system could still allow it when necessary for correcting or entering historical timetable information, but should make the selected past date clear.

## 2. Display the Full Date in the Session Creation Form

**Observation:** The timetable displays both the weekday and exact date on its day cards. However, the session creation form displays only the weekday.

**Possible improvement:** Display the full date in the session creation form, for example, "Monday, 9 November 2026". This would help teachers confirm the exact date before creating a session and reduce scheduling mistakes.

## 3. Consolidated Timetable for Learners

**Observation:** Teachers currently manage timetables separately for each section. Learners also access their course materials through individual section or course pages.

**Possible improvement:** Provide learners with one consolidated weekly timetable showing all sessions from every section or course in which they are enrolled. This would allow learners to see their complete weekly schedule in one place without opening each course timetable separately.

Individual course material pages can remain separate.

## 4. Detect Scheduling Conflicts Between Sections

**Observation:** The current timetable prevents overlapping sessions within the same section. However, it may allow two different sections to schedule sessions at the same time.

**Possible improvement:** Introduce additional scheduling conflict checks across sections. In particular, the system should prevent a teacher assigned to multiple sections from being scheduled to teach two sessions at the same time.

If physical classrooms are introduced later, the system could also check whether the same room has been assigned to overlapping sessions.

## 5. Review Timetable Overlap Protection

**Observation:** The current implementation checks for overlapping sessions within the same section. However, the behavior when two teachers submit overlapping sessions at almost the same time has not been verified.

**Possible improvement:** Review whether simultaneous timetable submissions could bypass the existing overlap checks. Ensure that the system reliably prevents conflicting sessions, even when multiple users create sessions at the same time.

## 6. Direct Weekly Timetable Access from the Learner Homepage

**Observation:** Learners currently need to open a course, navigate to its course materials page, and then click the "Weekly Timetable" option to access the timetable.

**Possible improvement:** Add a separate "My Weekly Timetable" option to the learner homepage. This should open a consolidated timetable showing sessions from all the learner's enrolled sections. Keep the existing "Weekly Timetable" option on individual course materials pages for easier access to a particular course's schedule.

**Reason:** This makes the timetable easier to find and reduces the number of steps learners need to take to check their weekly schedule.

---

## Priority and Status

| Improvement | Priority |
|---|---|
| Past-date session warning | Low |
| Full date in creation form | Low |
| Consolidated learner timetable | Medium |
| Cross-section teacher scheduling conflicts | High before a real pilot |
| Protection against simultaneous scheduling conflicts | High before a real pilot |

**Important:** These improvements are not confirmed defects. They are observations and potential enhancements identified during Day 5 testing. Review them again before implementing them, and check the PRD and remaining execution plan to avoid duplicating features already planned.