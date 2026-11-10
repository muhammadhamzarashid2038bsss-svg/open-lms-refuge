# Open LMS Refugee – Future Improvements Backlog

These are potential improvements, confirmed issues, and outstanding verification tasks identified during development and testing through Day 10.

They are not automatically approved requirements for the current development phase. Review each item against the PRD, Execution Plan V3, and real educator feedback before implementation.

The backlog distinguishes between:

- **Confirmed issue:** A behavior or limitation identified in the current implementation.
- **Unverified acceptance:** A required behavior that has not yet been demonstrated sufficiently.
- **Usability improvement:** An opportunity to make an existing feature easier to understand or use.
- **Pre-pilot requirement:** A security, reliability, or integration check that must be completed before the relevant feature is used with real learner data.

---

## 1. Timetable and Scheduling Improvements (Identified During Day 5)

### 1. Past-Date Session Creation Warning

**Observation:** The timetable currently allows teachers to create sessions for dates that have already passed.

**Possible improvement:** Consider adding a warning when a teacher schedules a session in the past. The system could still allow it when necessary for correcting or entering historical timetable information, but should make the selected past date clear.

**Priority:** Low  
**Status:** Not implemented

### 2. Display the Full Date in the Session Creation Form

**Observation:** The timetable displays both the weekday and exact date on its day cards. However, the session creation form displays only the weekday.

**Possible improvement:** Display the full date in the session creation form, for example, "Monday, 9 November 2026". This would help teachers confirm the exact date before creating a session and reduce scheduling mistakes.

**Priority:** Low  
**Status:** Not implemented

### 3. Consolidated Weekly Timetable for Learners

**Observation:** Learners currently access timetables through individual section or course pages. They may need to navigate through several pages to see their complete weekly schedule.

**Possible improvement:** Provide a separate "My Weekly Timetable" option on the learner homepage. It should show all sessions from every section or course in which the learner is enrolled.

Keep the existing individual section timetable access for learners who want to view a particular course or section.

**Reason:** This makes the timetable easier to find and allows learners to see their complete weekly schedule in one place.

**Priority:** Medium  
**Status:** Not implemented

*Note: This combines the previous Consolidated Timetable and Direct Weekly Timetable Access items to avoid duplication.*

### 4. Detect Scheduling Conflicts Between Sections

**Observation:** The current timetable prevents overlapping sessions within the same section. However, it may allow two different sections to schedule sessions at the same time.

**Possible improvement:** Introduce additional scheduling conflict checks across sections. In particular, the system should prevent a teacher assigned to multiple sections from being scheduled to teach two sessions at the same time.

If physical classrooms are introduced later, the system could also check whether the same room has been assigned to overlapping sessions.

**Priority:** High before a real pilot  
**Status:** Not implemented

### 5. Review Timetable Overlap Protection Against Simultaneous Submissions

**Observation:** The current implementation checks for overlapping sessions within the same section. However, the behavior when two teachers submit overlapping sessions at almost the same time has not been verified.

**Possible improvement:** Review whether simultaneous timetable submissions could bypass the existing overlap checks. Ensure that the system reliably prevents conflicting sessions, even when multiple users create sessions at the same time.

**Priority:** High before a real pilot  
**Status:** Not verified

---

## 2. Attendance History and Synchronization Improvements (Identified During Days 6–8)

### 6. Improve Session History Ordering for Bulk Attendance Saves

**Observation:** When a teacher saves attendance for several learners at once, the resulting events appear in an unpredictable order in Session History. However, when the teacher subsequently corrects an individual learner's attendance, the correction correctly appears as the latest event.

**Technical finding:** The current history ordering uses server receipt time, database creation time, and finally the randomly generated database record ID. Events created together in one transaction can share the same timestamps, leaving the random ID to determine their display order.

**Possible improvement:** Introduce a reliable server-side ordering mechanism for attendance events. Preserve the intended order of events within a bulk save while ensuring later corrections appear after the original events.

Do not use phone timestamps to determine the order because device clocks may be incorrect.

**Priority:** High  
**Status:** Confirmed ordering issue; solution not implemented

### 7. Persist Attendance Correction Relationships in the Server Database

**Observation:** The local attendance records preserve correction references and sequence information. The synchronization payload also sends the correction references, and the server validates them. However, the server database does not currently store an explicit relationship between the original attendance event and its correction.

**Possible improvement:** Introduce an additive database change to preserve the correction relationship after synchronization.

Future synchronization should:
- Include the original server record ID when correcting an already synchronized attendance event.
- Resolve the server record ID when correcting an event that was originally created offline.
- Store the relationship in the new attendance record.
- Preserve the original attendance event without updating or deleting it.
- Retain the append-only correction history.

**Reason:** This would allow the database to preserve the actual correction chain instead of relying on reconstructed relationships in the history display.

**Priority:** High before a real pilot  
**Status:** Confirmed server-side persistence gap; future sync enhancement required

### 8. Verify the Complete Real-Browser Offline Attendance and Synchronization Path

**Observation:** The PWA shell and IndexedDB functionality have been tested, and automated synchronization tests have passed. However, Chrome and Edge refused to grant persistent storage during earlier attendance testing. The application correctly refused to claim that an attendance mark had been safely stored.

Consequently, the full real-browser attendance workflow has not yet been demonstrated.

**Possible improvement / verification:**

1. Test offline attendance saving in a suitable real browser or device environment that meets the existing storage requirements.
2. Confirm that the attendance event is stored in IndexedDB.
3. Close and reopen the application while offline and verify that the pending event remains.
4. Reconnect to the server and synchronize the event.
5. Inspect PostgreSQL to confirm that the event appears once and has the correct offline-created indicator.
6. Interrupt synchronization and verify safe retry without duplicate records.
7. Confirm that another account cannot access the unsynchronized event.

Do not weaken the existing persistent-storage requirement just to make the test pass.

**Priority:** High before claiming complete Phase 1 offline attendance acceptance  
**Status:** Outstanding real-browser acceptance test

### 9. Complete the 30-Learner Attendance Performance Test

**Observation:** During Day 6, I manually tested attendance for 15 learners and completed the process in approximately 24 seconds.

However, Execution Plan V3 specifies a performance test involving 30 synthetic learners in under two minutes.

**Possible improvement / verification:** Repeat the timed attendance test with 30 synthetic learners. Record the actual result and confirm that speed does not compromise accuracy, readability, or accessibility.

**Priority:** Medium  
**Status:** Not yet verified against the full 30-learner benchmark

---

## 3. Shared-Device and Handover Usability Improvements (Identified During Days 6–7)

### 10. Improve Sign-Out and Waiting-Record Message Wording

**Observation:** The sign-out messages can say that attendance marks are waiting to send even when the pending-record count is zero. The phone status area can also display a waiting count of zero.

**Possible improvement:** Make the wording reflect the actual local queue state.

Examples:
- When records are pending: "3 records are still waiting to send. They remain on this phone."
- When no records are pending: "No unsent records are waiting on this phone."
- When the queue cannot be checked: Explain that the records could not be checked and that the phone must remain locked.

Preserve the existing locking and unsynchronized-data protection.

**Priority:** Low  
**Status:** Confirmed wording improvement; authorization and locking behavior must remain unchanged

### 11. Explain Handover Permissions More Clearly

**Observation:** The handover screen says that a teacher, director, or admin can write a handover note, but does not explain the restrictions on teacher permissions.

**Possible improvement:** Clarify the role permissions on the screen:

- Teachers can release a locked learner account only when the learner is enrolled in at least one section currently assigned to that teacher.
- Directors can release accounts within their center.
- Admins have the broader administrative permission.

The screen should explain why a teacher might not be authorized to release a particular learner's shared-device lock.

Do not weaken or change the existing server-side permission rules merely to simplify the interface.

**Priority:** Low  
**Status:** Confirmed usability gap; existing authorization rules remain in place

---

## 4. Digital Homework File Improvements (Identified During Day 10)

### 12. Reject Corrupt and Incomplete Uploaded Files

**Observation:** During manual testing, a 4-byte file named `sheet.jpg` was accepted into the local queue because it had a JPEG-like opening signature.

The existing file validation checks file signatures, but a valid-looking opening signature does not prove that the complete image or document can actually be opened.

**Possible improvement:** Strengthen file validation so that malformed, truncated, or corrupt images and PDFs are rejected.

Test:
- Valid JPEG, PNG, WebP, and PDF files.
- Files containing only a valid opening signature.
- Truncated JPEG, PNG, and WebP files.
- Corrupt PDFs.
- Files whose extensions or browser MIME labels do not match their actual content.

The server must independently validate files before marking a Submission as stored. It must not rely only on the browser's validation.

**Reason:** Learners and teachers should not receive a Submitted status for a file that cannot actually be opened or reviewed.

**Priority:** High before a real pilot  
**Status:** Additional validation gap identified during source review

### 13. Complete Real Cloudflare R2 Upload and Download Acceptance Testing

**Observation:** The private R2 storage integration, presigned URL workflow, submission finalization, authorization checks, and checksum verification have been implemented and tested using a mock storage adapter.

However, no real Cloudflare R2 bucket or credentials have been configured.

**Possible improvement / verification:** When cloud infrastructure is ready, perform end-to-end testing with a real private bucket.

Test:
1. Create the private R2 bucket and configure the required restricted CORS policy.
2. Start a digital submission from a real browser.
3. Upload an actual JPEG or PDF using the short-lived presigned URL.
4. Verify that the server reads the stored object and independently calculates its SHA-256.
5. Confirm that the Submission becomes STORED only after successful verification.
6. Test authorized teacher and learner downloads.
7. Attempt cross-learner and cross-section access using another submission ID.
8. Interrupt an upload, reconnect, request a fresh upload authorization, and retry using the same `clientSubmissionId`.
9. Verify that no duplicate Submission record is created.
10. Confirm that the phone removes its queued file only after server finalization is acknowledged.

No public file URLs should be introduced.

**Priority:** High before real digital submissions or a real pilot  
**Status:** Outstanding real-cloud integration and security acceptance tests

### 14. Verify Photo Compression Quality Using a Synthetic Worksheet

**Observation:** A 1.4 MB PNG image was successfully prepared to 532 KB. The application correctly warned that the 500 KB target had not been reached while retaining the file below the 1 MB maximum.

However, the manually tested image was an anime wallpaper rather than a worksheet. Therefore, the readability of printed text and handwriting after compression has not been demonstrated.

**Possible improvement / verification:** Test with a synthetic worksheet containing small printed text and handwritten answers.

Compare:
- The original image.
- The prepared compressed image.
- File sizes before and after preparation.
- Readability at normal viewing size.

Only pursue further compression when legibility can be preserved.

**Priority:** Medium  
**Status:** Compression demonstrated; worksheet legibility acceptance test outstanding

### 15. Verify File-Upload Retry Behavior After Reconnection

**Observation:** The learner file queue uses a foreground action called "Send pending submissions". It does not perform background uploads through the Service Worker.

**Possible improvement / verification:** Once R2 is configured, interrupt an upload, reconnect, and confirm that the learner can resume the queued submission through the foreground send action without losing the file or creating a duplicate record.

Document that the learner initiates the send process. Do not describe the current implementation as automatic background synchronization.

**Priority:** High before real digital submissions  
**Status:** Automated retry tests passed; real-R2 interruption and recovery test outstanding

---

## 5. Pre-Pilot Readiness Requirements

These are broader readiness requirements rather than requests to add unrelated features.

Before real learner information is introduced:

- Complete a specialist privacy and security review of local IndexedDB data, shared-device isolation, session expiry, logout and handover behavior.
- Document that IndexedDB is not automatically encrypted and that browser storage can still be evicted.
- Confirm the retention and recovery policy for unsynchronized attendance, grades, notes, and homework files.
- Complete real R2 upload/download and cross-learner authorization acceptance tests.
- Verify the complete offline attendance save and synchronization workflow on a suitable real device or browser.
- Use the public demo and repository with synthetic learner data only.

Do not claim production or real-pilot readiness merely because the automated tests and production build pass.

---

## Priority Summary

| Improvement | Priority | Status |
|---|---|---|
| Past-date session warning | Low | Not implemented |
| Full date in session form | Low | Not implemented |
| Consolidated learner timetable and homepage shortcut | Medium | Not implemented |
| Cross-section scheduling conflicts | High before pilot | Not implemented |
| Simultaneous scheduling conflict protection | High before pilot | Not verified |
| Session History ordering | High | Confirmed issue |
| Server-side attendance correction links | High before pilot | Confirmed gap |
| Real-browser attendance save and sync | High | Outstanding verification |
| 30-learner attendance benchmark | Medium | Not verified |
| Sign-out message wording | Low | Improvement identified |
| Handover permission explanation | Low | Improvement identified |
| Corrupt/truncated file validation | High before pilot | Additional gap identified |
| Real R2 upload/download testing | High before digital pilot | Outstanding verification |
| Worksheet compression readability | Medium | Outstanding verification |
| Real upload interruption and retry | High before digital pilot | Outstanding verification |

**Important:** These improvements are not automatically added to the current development schedule. Review them against the PRD, Execution Plan V3, real educator feedback, and the project's remaining priorities before implementation.