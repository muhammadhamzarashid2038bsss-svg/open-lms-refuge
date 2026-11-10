# Development Log

## Day 1 of 20 · 2026-10-23

### What I built

- Set up Next.js project with TypeScript and Tailwind CSS.
- Created a GitHub repository and successfully pushed my code.
- Added the PRD v2 document to the docs folder.
- Added an MIT license.
- Set up the .env and .env.example files for the database connection.
- Configured Cursor project rules so the AI knows how to help me.

### What went wrong

- I accidentally started creating my project folder inside OneDrive, which can cause issues. I had to cancel and move it to my main user folder.
- I got a scary red error in the terminal saying "running scripts is disabled." I learned I had to change a Windows PowerShell security setting.
- I got a little lost trying to find the "Rules" settings in Cursor's new layout, but eventually figured out how to use a `.cursorrules` file.
- I saw a "hydration error" in the browser console, but realized it was just a minor mismatch issue and didn't break the app.

### What I learned

- I learned that `.env` files store secret passwords (like database connections) and must NEVER be uploaded to GitHub. 
- I learned how to use Cursor's Agent mode to write code for me, and how to verify the changes it makes in the browser.

### Outreach

- Sent introductory messages to 5 organizations/educators to learn about their needs:
  1. Children's Training Centre (CTC) – School For Refugees (via WhatsApp)
  2. CEAM Learning Centers (via WhatsApp)
  3. Zotung Refugee Learning Centre (ZRLC) (via WhatsApp)
  4. Myanmar Refugee Learning Centre (MRLC) (via WhatsApp)
  5. ElShaddai Centre Berhad (via website form)
- Will follow up in 3 to 5 days if I don't hear back.

## Day 2 of 20 · 2026-11-03

### What I built

- Set up Prisma and created the entire Phase 1 database schema.
- Built complex sync metadata (version vectors) for grades and notes so offline edits won't be lost.
- Created a separate file queue for digital homework so files don't block attendance sync.
- Generated fully synthetic (fake) data: 1 center, 30 learners, 331 attendance records, and fake grades.
- Wrote and passed 8 automated tests to prove the database rejects edits to attendance and handles conflicts correctly.

### What went wrong

- Hit a roadblock getting a Cursor subscription because their Stripe billing didn't accept my digital e-wallet. I had to get creative: I used Google Pay on my phone to buy a SuperGrok subscription, then linked that to Cursor to power the AI agent.
- The AI took about 27 minutes to build the database. I was worried it was stuck and using up my weekly pool, but it successfully built the database, ran the tests, and wrote the documentation in one go.
- Noticed the AI set up a local database instead of using my Neon cloud database. I will keep using the local one for now while developing, and switch to Neon when deploying.

### What I learned

- I learned that a "version vector" is like a scoreboard that keeps track of edits made on different phones, so the server knows exactly how to merge them without losing data.
- I learned how to troubleshoot Prisma Studio when it loses its connection, and how to use the visual interface to see the fake data.
- I learned that technical problems aren't just about code; sometimes the hardest part is figuring out how to pay for and access the right tools!

## Day 3 of 20 · 2026-11-04

### What I built

- Added a secure login system using iron-session.
- Created separate dashboards for Admins, Directors, Teachers, and Learners.
- Added server-side authorization to block users from accessing pages they don't have permission for (tested by trying to access teacher URLs as a learner).
- Implemented a 15-minute lockout after 5 failed login attempts.
- Built a shared-device logout system that locks unsent local records so the next person can't see them.
- Wrote automated tests for permissions, lockouts, and data isolation.

### What went wrong

- The AI gave me the credentials for the teacher and learner, but forgot to give me the admin email. I had to find it by searching through the generated data.
- Hit a known bug where Prisma Studio and DBeaver couldn't connect to the local Prisma 7 / PostgreSQL 17 database ("Connection Reset" and "Metadata Unavailable" errors). I had to skip the visual database check and trust the automated tests instead, to avoid wasting time.

### What I learned

- I learned the difference between Authentication (who you are) and Authorization (what you are allowed to see).
- I learned that hiding a button on a screen isn't enough security; the server itself must block unauthorized users (which is why the learner got a 404 error when typing a teacher URL).
- I learned how shared devices are dangerous and why the app needs to lock down local data on logout.

## Day 4 of 20 · 2026-11-05

### What I built

- Built the Syllabus and Course Manager.
- Teachers can now create courses, assign them to sections, and add course-wide or section-specific learning materials, including links and supported file resources.
- Added the ability to create a course without an initial section and add sections later.
- Built learner-facing section pages where learners can view course materials and download supported files.
- Implemented resource visibility so that whole-course materials are available to all appropriately enrolled learners, while section-specific materials remain restricted to their respective sections.
- Added server-side authorization for course management, resource access, and file downloads.
- Updated the teacher, director, and student dashboards to provide access to the new course functionality.
- Checked the pages for mobile responsiveness and confirmed the remaining Day 4 browser tests.

### What went wrong

- When I created a course without providing a first-section name, the course was saved successfully but did not appear in the teacher's course list. The problem was that the teacher's course query only displayed courses containing sections assigned to that teacher. This was fixed so teachers can see empty courses within their center and add sections later.
- Whole-course resources appeared on teacher screens but were missing from learner screens. The problem was that these resources were stored with an empty section association, but learner queries only retrieved resources belonging directly to their sections. This was fixed in the learner section pages, learner home-page resource counts, and section API while preserving the existing authorization checks.
- The new resource visibility tests initially lacked coverage for whole-course materials. I added tests to verify that learners from both sections can see shared materials without gaining access to resources belonging exclusively to the other section.
- I also encountered Prisma database seed transaction timeouts. The original large seed transaction exceeded the transaction timeout, so the seed process was divided into fifteen shorter sequential transactions. Later, another verification revealed that a successful seed message did not always guarantee that all records were durably committed when other database clients were connected.
- To investigate the database issue, I stopped the application and other database clients, reseeded the DEMO database, and verified the results using a separate Prisma client. The expected database counts were confirmed: 30 learners, 2 sections, 6 resources, 24 class sessions, 331 attendance records, 120 grades, 2 open conflicts, and 4 submissions.
- The targeted course tests passed all 6 tests, and ESLint passed on the modified Day 4 files. However, the Phase 1 schema test suite still has 2 tests that exceed the 30-second timeout. The other 6 tests pass. These timeouts remain under investigation and are not confirmed application logic failures.

### What I learned

- I learned how server-side authorization applies to API routes, database queries, and file downloads, not just page views.
- I learned how database relationships affect resource visibility. A whole-course resource with a null section association must be included separately when retrieving resources for individual sections.
- I learned that course visibility and resource visibility must account for both the course and the learner's section enrollment.
- I learned how to use the browser's Developer Tools to simulate a mobile phone screen and test responsiveness.
- I learned that successful database seed output does not necessarily prove that transactions have been durably committed. Verifying records through a separate database client is important.
- I learned to add automated tests for both successful access and restricted access so that fixing visibility issues does not weaken existing permissions.

## Day 5 of 20 · 2026-11-06 (End of Week 1!)

### What I built

- Built the weekly timetable functionality for the Hybrid Classroom Dashboard.
- Teachers and directors can manage weekly timetables for their sections.
- Added three session types: In-person, Live online, and Pre-recorded.
- Live online sessions support Google Meet, Zoom, and Jitsi meeting links, with a Join button for learners.
- Pre-recorded sessions can link to an existing course lesson or learning resource.
- The learner home page now displays "Today's classes" in simple language, showing the sessions scheduled for the center's current day.
- Added timetable validation to prevent sessions from having an end time earlier than or equal to their start time and to prevent overlapping sessions within the same section.
- Updated navigation so teachers can access section timetables and learners can access timetables through their course pages.
- Tested the timetable on simulated mobile screens and checked basic keyboard accessibility and focus visibility.
- Added automated tests for timetable behavior and permissions.

### What went wrong

- After starting the application with `npm run dev`, the browser became stuck on the "Checking this phone..." screen and kept returning to the opening page. There were no obvious browser console or network errors. Grok investigated the problem and identified a redirect loop involving an expired sign-in cookie and the opening page's loading process. The problem was related to how redirects were handled in the application's Next.js version. This was fixed by improving the session checks, adding a session cleanup route, and changing the device checking process.
- The opening-page fix affected authentication and shared-device protection, while the timetable implementation was a separate feature. I kept these changes in two separate commits to make the Git history easier to understand and maintain.
- I initially had difficulty understanding how to test shared-device protection because the instructions asked me to create a practice record that was waiting to synchronize. However, the actual offline attendance workflow and its waiting-to-synchronize indicator are scheduled for Day 7. Day 5 did not yet provide the intended learner activity for generating a real unsynchronized attendance record, so I postponed that test until the offline workflow is implemented.
- During manual timetable testing, I noticed some possible improvements. The system allows teachers to create sessions for past dates, the session creation form displays only the weekday instead of the full date, and learners must navigate through a course page to find the weekly timetable. I also noticed that overlapping sessions are checked within individual sections, but scheduling conflicts involving teachers assigned to multiple sections may need additional protection. I recorded these observations in a separate future improvements backlog rather than treating them as Day 5 failures.
- The targeted automated test runs passed after the changes were separated into two commits. ESLint also completed without errors. It reported a warning that the CSS file did not match the supplied lint configuration, but this did not produce any lint errors.

### What I learned

- I learned how a ClassSession connects to a specific section and can link to an existing course lesson or learning resource.
- I learned that a weekly timetable needs more than displaying dates and times. It also needs validation to prevent invalid session durations and scheduling conflicts.
- I learned how to use the browser's Developer Tools to simulate different screen sizes and check keyboard accessibility and focus visibility.
- I learned that authentication, session management, and shared-device protection can affect how the application loads, even when the actual page feature is working correctly.
- I learned to separate unrelated changes into different Git commits. This makes it easier to track features and fixes independently.
- I learned to distinguish between features that are already implemented and features scheduled for later development. For example, the real offline attendance workflow and synchronization indicator will be developed in the following days.

### Week 1 Review: 3 Decisions That Shaped the Project

1. **Decision:** Used `iron-session` for managing user sessions instead of adopting a larger authentication framework.
   **Why:** This keeps session management relatively lightweight and gives the application control over its login process. It also supports the project's requirement for learners to sign in using a code or PIN instead of depending on email addresses.

2. **Decision:** Designed attendance records as append-only records.
   **Why:** Attendance history should not be silently rewritten or deleted. For example, if a teacher initially records a learner as Absent and later needs to correct the record to Present, the original record should remain available as part of the attendance history. The database tests verify that existing attendance records cannot simply be edited or deleted. Corrections should preserve the original history by using additional records or events.

3. **Decision:** Enforced authorization on the server side instead of relying only on hiding buttons and links.
   **Why:** A user could try to access another role's page or information by entering its URL directly. Server-side authorization checks ensure that users cannot access information they are not permitted to see. I tested this during Day 3 by attempting to access teacher pages as a learner.

### Week 1 Summary

During the first five development days, I established the project, created the database and synthetic data, implemented authentication and role-based access, built the course manager, and added the weekly timetable.

I also learned that developing an application involves more than writing code. Testing, database troubleshooting, security, accessibility, and understanding how different features connect are equally important.

The core timetable functionality is now implemented, and both the timetable feature and the opening-page fix have been committed and pushed to GitHub.

**Week 1 completed!**

## Day 6 of 20 · 2026-11-07

### What I built

- Built the Kiosk Mode attendance screen for teachers.
- Created large, high-contrast one-tap buttons for Present, Absent, Late, and Excused.
- Added the fixed list of five approved reasons for Absent and Excused: Illness, Family care, Transport or cost, Family circumstances (details not recorded), and Unknown. There is no free-text option for entering private family details.
- Made unmarked learners visually distinct so teachers do not accidentally assume they are present or absent.
- Built an append-only attendance history so corrections create new events without overwriting original records.
- Generated a unique `clientEventId` for each attendance event to prevent duplicate records when the same event is submitted again.
- Added server-side authorization so teachers can only record attendance for sections they are assigned to, while directors can manage attendance within their own center.
- Added a read-only session history to show original attendance events and later corrections.
- Added automated tests for attendance statuses, reason validation, duplicate event IDs, simultaneous submissions, device reuse, and learner enrollment restrictions.

### What went wrong

- During the initial database test, an older test expected 24 class sessions but found 28. I remembered creating additional class sessions during my previous manual testing. These were legitimate testing records rather than confirmed application defects, so I kept them instead of deleting them or resetting the database.
- The initial automated test review revealed several gaps in coverage. For example, the tests did not verify that Excused was actually stored with the correct status or that repeated attendance saves reused the same web kiosk device. Grok added eight more automated tests without changing the application code or database schema.
- I also encountered a recurring Vite configuration warning when running Vitest. However, it did not prevent the tests from running successfully.

### What I learned

- I learned how to build a fast and accessible interface for teachers using a phone or tablet at a classroom door. During manual testing, I was able to mark all 15 learners in just 24 seconds.
- I learned why append-only attendance records are important. When a teacher makes a mistake, the original record should remain in the database, and the correction should be stored as a new event. This preserves an accurate attendance history.
- I learned that an unmarked learner must remain different from an absent learner. The system should never automatically create an attendance record for someone the teacher has not marked.
- I learned why unique `clientEventId` values are important for preventing duplicate attendance records when a submission is repeated or retried.
- I learned that automated tests should verify what is actually stored in the database, not just whether the interface displays the correct result.
- I learned how to test keyboard accessibility by using Tab to navigate between attendance buttons and Enter to select a status.

### Outreach & Parallel Track

- **Follow-up Success:** Myanmar Refugee Learning Centre (MRLC), one of the 5 centers I contacted on Day 1, replied and is interested in my application! They want to schedule a conversation next week. 
- **New Outreach:** I contacted 10 additional learning centers globally to expand my network and gather feedback:
  1. Refugee Learning Center (RLC) - Cisarua, Indonesia
  2. Hope Learning Center (HLC) - Cisarua, West Java, Indonesia
  3. Generation Aid Learning & Tech Hub - Kakuma Refugee Camp, Kenya
  4. Apostoli Educational Center for Refugees & Migrants - Athens, Greece
  5. Cahaya Surya Bakti (CSB) Learning Centers - Johor, Malaysia
  6. The Peace Education Centre (TPEC) - Imbi, Kuala Lumpur, Malaysia
  7. Zaatari Camp Connected Learning Hubs - Zaatari Refugee Camp, Jordan
  8. Edu-Syria Academic Program Center - Amman / Mafraq, Jordan
  9. Roshan Learning Center - Jakarta, Indonesia
  10. METAdrasi Non-Formal Education Centers - Athens & Lesvos, Greece

### Testing and completion

- Manually tested all four attendance statuses and confirmed that corrections preserved the original events.
- Confirmed that the five approved reasons appear for Absent and Excused, without a free-text field.
- Verified that the session history is read-only and that all 18 manually created attendance events remained intact after automated testing.
- Confirmed that Teacher Two could not access Morning Group attendance.
- Added automated tests, bringing the targeted attendance and authorization test runs to 31 passing tests with no failures.
- Ran ESLint on all 15 modified files successfully.

## Day 7 of 20 · 2026-11-08

### What I built

- Turned the app into an installable Progressive Web App (PWA) using Serwist.
- Configured a Service Worker to cache the public kiosk shell and static application assets so the kiosk interface can load without an internet connection.
- Established strict caching boundaries to prevent authenticated pages, private API responses, and attendance data from being cached by the Service Worker.
- Created an IndexedDB database called `olr-local` with separate stores for device information, releases, locks, snapshots, rosters, and attendance events.
- Implemented a migration system to copy the existing `olr.device.v1` LocalStorage backup into IndexedDB while preserving the original backup unchanged.
- Wired the kiosk attendance system to save attendance events locally before synchronization, with storage-readiness checks to prevent the application from claiming that data was saved when the browser cannot meet the storage requirements.
- Added support for tracking locally saved records and their waiting-to-synchronize status.
- Implemented offline decision rules for sign-out, device locks, session expiry, and pending records.
- Strengthened shared-device privacy by saving the local device lock before requesting server-side session revocation.
- Added protection against another account accessing the previous user's unsynchronized records.
- Implemented authorized device handover with permission checks and handover notes.
- Preserved attendance ownership during handover so that transferring access to a phone does not transfer another user's attendance records.

### What went wrong

- During implementation, the work became more complex than the original single-stage prompt. I divided Day 7 into six stages to handle the offline decision rules, IndexedDB migration, local attendance, kiosk shell, PWA installation, and shared-device protection separately.
- Encountered browser and storage-related issues while testing. Chrome refused to grant persistent storage, returning `false` for both `navigator.storage.persisted()` and `navigator.storage.persist()`, even after installing the PWA and testing again.
- Because persistent storage was denied, the application correctly refused to save an offline attendance mark. It displayed a warning instead of falsely claiming that the attendance was saved.
- Initially, the development server on `localhost:3000` did not load the kiosk shell offline because it did not have the production Service Worker. I therefore built the production application and tested it separately on `localhost:3100`.
- Discovered that `localhost:3000` and `localhost:3100` are different browser origins, meaning their browser storage and Service Worker registrations are separate.
- The production PWA successfully activated its Service Worker, cached the public shell and static assets, and loaded the kiosk shell while Chrome was offline.
- Tested the shared-device handover system and discovered that not every teacher has permission to release another teacher's device lock. Only authorized staff, according to the server-side permission rules, can complete the handover.
- I skipped the optional Vercel deployment and physical-phone test. I focused on local development and production testing using Chrome DevTools and the installed PWA.

### What I learned

- I learned that IndexedDB is more suitable than LocalStorage for structured application data, including attendance events, rosters, snapshots, and device records. However, IndexedDB is not encrypted automatically.
- I learned that a Service Worker and IndexedDB have different responsibilities. The Service Worker caches the public application shell and static assets, while IndexedDB stores the application's local device data.
- I learned how to use Chrome DevTools to simulate offline conditions, inspect Service Worker registration, examine Cache Storage, and check browser storage permissions.
- I learned that allowing a website to save data and granting it persistent storage are two different things. A browser can allow ordinary storage while refusing to protect that storage from automatic eviction.
- I learned why an application must never display a successful save message unless the data has actually been stored.
- I learned that shared-device privacy requires more than signing out. The application must lock local data, preserve ownership of unsynchronized records, and prevent another account from accessing the previous user's information.
- I learned that device handover must be controlled by server-side permissions and must not transfer ownership of attendance records.
- I learned that an offline application must handle browser limitations honestly rather than weakening its safeguards to make a feature appear functional.

### Testing and final result

- All six Day 7 implementation stages were completed.
- The relevant Day 7 automated tests passed: 104 tests with zero failures.
- ESLint completed successfully for the Day 7 source files and tests.
- The production build completed successfully.
- The production Service Worker was activated, and the offline kiosk shell loaded successfully.
- IndexedDB migration and shared-device browser acceptance tests passed.
- Verified that the local Git branch was synchronized with `origin/main` and the working tree was clean.

### End-of-day result

Day 7 was completed with one documented browser limitation. The offline kiosk shell, caching boundaries, IndexedDB migration, and shared-device protection were verified. However, actual offline attendance saving could not be demonstrated because Chrome refused persistent storage. The application correctly blocked the save rather than risking an inaccurate confirmation. Uploading unsynchronized attendance records remains part of Day 8.

## Day 8 of 20 · 2026-11-09

### What I built

- Built the foreground **Sync-When-Connected engine** in a new `lib/sync` module. It uploads locally saved attendance records when the signed-in page can successfully reach the server.
- Added an authenticated health endpoint. The app checks for a valid JSON response from the server instead of relying only on `navigator.onLine`, because the browser can report that it is online even when the application server is unreachable.
- Built the `/api/sync` endpoint to receive attendance batches securely. The server identifies the user and centre from the authenticated session rather than trusting identity information supplied by the browser.
- Reused the existing unique `clientEventId` constraint on attendance records to make uploads idempotent. This prevents repeated uploads from creating duplicate attendance records. No database schema change or migration was needed.
- Added server-side checks for each attendance event, including the user's permissions, centre, class session, section, learner enrolment, and correction references.
- Implemented per-record results so the server can distinguish between accepted records, records already accepted, permanently rejected records, and records that can be retried.
- Added gzip compression to reduce the amount of data sent over mobile connections. Batches are limited to 25 attendance events, with payload-size limits to prevent oversized requests. Added a plain JSON fallback when compression would exceed the compressed-size limit but the uncompressed payload is still acceptable.
- Added retry handling with exponential backoff and jitter for temporary failures. Automatic retries are capped, while the user can still manually retry temporary failures using **Sync now**.
- Built a foreground sync runner that starts when the signed-in page loads, when the browser comes back online, and when a retry is due. It does not depend on background synchronization or Service Worker uploads.
- Added an **Attendance sync** status panel to signed-in pages. It displays attendance waiting to upload, permanently refused records, retry information, the last confirmed sync time, and a **Sync now** button.
- Made the acknowledgement process cautious. A local attendance record is marked as acknowledged only when the server confirms the exact submitted records and the local database update succeeds and is verified. Records are never deleted just because an upload was attempted.
- Preserved the existing shared-device protections. The sync engine uploads only pending attendance records belonging to the currently signed-in account and the actual local device. It does not upload another account's records or the separate practice activity records.
- Added tests for the sync client, server endpoint, upload runner, retry behaviour, duplicate submissions, partial failures, interrupted uploads, and shared-device isolation.

### What went wrong

- The initial architecture review showed that the database already had a unique constraint on `AttendanceRecord.clientEventId`. I did not need to introduce another database field or migration for idempotency.
- During implementation, I identified a compression edge case: a gzip payload could exceed the compressed-size limit even when the original JSON payload was still within the allowed size. The implementation was corrected to fall back to plain JSON in that situation.
- I also added a narrow same-origin check to the sync endpoint so that requests from foreign websites are refused.
- The actual browser-to-database acceptance test was not completed. Cursor tested the implementation through automated tests, but it did not perform the complete signed-in browser workflow of saving an attendance record offline, reconnecting, synchronizing it, and manually checking the resulting database record.
- This browser limitation is connected to the storage issue discovered on Day 7. Chrome refused the app's request for persistent browser storage, so the app correctly refused to save a new offline attendance mark when durable storage could not be confirmed. The sync engine cannot upload an attendance record that was never safely saved.
- The Day 7 production-build test on `localhost:3100` was necessary to verify Service Worker and offline-shell behaviour. The development origin on `localhost:3000` did not have the same production Service Worker behaviour. However, that production-origin test does not count as a completed Day 8 browser-to-database sync test.

### What I learned

- I learned that `navigator.onLine` does not prove that the application server is reachable. The app must make an actual request and check the response before attempting synchronization.
- I learned how idempotency works. Every attendance event has a unique `clientEventId`, allowing the server to recognize a repeated upload instead of creating a duplicate record.
- I learned why a sync engine must handle each record separately. One rejected or temporarily failed record should not prevent other valid records in the same batch from being processed.
- I learned that an HTTP success response alone is not enough to safely mark local records as synchronized. The app must confirm which records the server accepted and verify that the local acknowledgement was saved.
- I learned why local attendance records should not be deleted immediately after uploading. Keeping them allows the app to retry safely if the response is interrupted or local acknowledgement fails.
- I learned that compression can reduce mobile data usage, but the application still needs payload-size limits and a fallback when compression is unavailable or produces an oversized payload.
- I learned that foreground synchronization is different from background synchronization. This implementation syncs while the authenticated page is open; it does not promise to upload attendance after the app has been closed.

### Testing and final result

- The sync client tests passed: 22 tests.
- The server-side attendance sync tests passed: 20 tests.
- The sync runner and panel tests passed: 19 tests.
- The shared-device regression tests passed: 11 tests.
- **Total: 72 relevant tests passed, with 0 failures.**
- ESLint passed for the changed files.
- The tests covered duplicate uploads, authorization, partial results, retryable failures, acknowledgement rules, and shared-device isolation.
- No database reset or reseed was performed.
- No database schema migration was required.
- The local attendance records remain stored on the device after synchronization; the engine does not delete them.

### End-of-day result

Day 8 is technically complete. The sync client, authenticated server endpoint, foreground runner, status panel, retry handling, and safety checks were implemented. All 72 relevant tests passed, ESLint passed, and the work was committed and pushed to GitHub. But the full manual browser-to-database acceptance test remains pending because of the persistent-storage limitation carried over from Day 7. This is documented rather than being reported as a successful browser test. I can move on to Day 9 while keeping that acceptance check on the outstanding verification list.

## Day 9 of 20 · 2026-11-10

### What I built

- Built version-vector conflict handling for both GradeEntry and ProgressNote records.
- Implemented a version-vector comparison function that identifies whether an incoming edit is causally later, older, equal, or concurrent with the current version.
- Added per-device counters and version history so the system can track the order of edits without relying on phone timestamps.
- Implemented server-side conflict detection. When two devices make independent offline edits to the same record, the system preserves both complete versions instead of silently overwriting one.
- Created SyncConflict records and a teacher-facing conflict screen where an authorized teacher can review both versions and choose which one to keep or enter a merged version.
- Implemented conflict resolution using a new version vector that merges the previous counters and increments the resolving device's counter. The original versions and resolution history are preserved.
- Added safeguards for repeated uploads, including mutation IDs and content fingerprints, so the same edit is not applied twice.
- Added authorization checks so only an appropriately assigned teacher can edit and resolve records for their section.
- Updated the local IndexedDB database to store record mutations and per-device counters without deleting existing offline data.
- Added database-level checks to ensure conflict versions and resolution versions belong to the correct grade or progress note.
- Fixed the local record-saving behavior for grades and progress notes. Chrome and Edge refused to promise persistent storage, so these records can now still be saved when the browser reports sufficient available space. The interface displays a warning that the browser has not guaranteed it will keep the data.
- Fixed the ProgressNote editor so selecting an existing note loads its complete text, skill gaps, custom label, and original record ID. Selecting another note replaces the form content, while selecting New note clears it. Selecting a note does not automatically save anything.

### What went wrong

- The first major challenge was browser storage. Both Chrome and Edge refused to grant persistent storage, which initially prevented me from saving grade and progress note edits offline. We changed the saving behavior to allow these records to be stored when sufficient browser space is available, while keeping a clear warning that the browser has not promised to retain them. Attendance still uses the stronger persistent-storage requirement.
- My first attempt to test GradeEntry and ProgressNote conflict handling was affected by the storage restriction. After fixing the local saving behavior, I was able to save different versions in Chrome and Edge and synchronize them separately.
- During the ProgressNote test, the saved note disappeared from the records page after refreshing, even though the sync system had acknowledged it. A database investigation confirmed that the note was successfully stored, including its skill gaps and version history. The actual problem was in the editor: it loaded the saved note into the existing-note menu but did not populate the text box and skill-gap selections when the note was selected.
- The first editor fix appeared to work in development, but my browser was still using an older production build on port 3100. After rebuilding the production app, I tested the corrected behavior in both Chrome and Edge. I also added a test that renders the actual form and checks the dropdown interaction, rather than only testing the helper function.
- I used Chrome and Edge as two independent browser environments to simulate two devices editing the same records offline. This allowed me to test the complete workflow: saving different versions, synchronizing them separately, detecting conflicts, resolving them, and making another edit afterward.
- I also encountered older TypeScript errors in the sync code that were preventing the production build. These were corrected before continuing with the production browser testing.

### Testing and results

**Automated testing:**
- Added and ran tests for normal updates, concurrent grade and progress note edits, repeated uploads, equal and dominating version vectors, incorrect phone clocks, conflict resolution followed by another edit, and unauthorized access.
- Added database trigger tests to verify that original conflict versions and resolution versions belong to the correct record.
- Added tests for selecting an existing progress note, switching between notes, selecting New note, and saving an edit while retaining the original record ID.
- Final focused editor and local-record tests passed: 13 tests across 3 test files.
- TypeScript check (`npx tsc --noEmit`) passed.
- ESLint passed on the changed files.
- `git diff --check` passed.
- The production build completed successfully after the earlier TypeScript issues were corrected.

**Manual two-browser testing:**

- **GradeEntry:** Saved 75 in Chrome and 50 in Edge while both were offline. Synchronized Chrome first and Edge second. The system detected the conflict and displayed both versions. I resolved it by choosing 75. The conflict disappeared, and a later edit changing the grade to 95 was accepted without creating another conflict.
- **ProgressNote:** Created and synchronized a reading progress note, then selected that same note in both browsers. Saved different offline versions in Chrome and Edge, using "familiar words" in one version and "similar words" in the other. After synchronizing them separately, the conflict screen displayed both complete versions. I resolved the conflict by choosing the Chrome version. Both browsers displayed the selected version afterward.
- **Post-resolution ProgressNote test:** Made another edit to the resolved note in Chrome and synchronized it. No new conflict appeared, and after refreshing Edge, it also displayed the latest version.

Both GradeEntry and ProgressNote successfully passed the manual two-browser conflict detection, resolution, and subsequent-edit tests.

### What I learned

- I learned what a Version Vector is: it allows the system to track which device made changes and the causal order of those changes without relying on phone clocks, which may be incorrect.
- I learned the difference between a normal update and a concurrent edit. A later edit can be accepted normally when it follows the previous version, but two independent offline edits create a conflict that requires a human decision.
- I learned that a conflict is not necessarily a system failure. It is a situation where the system must preserve the different versions and allow an authorized person to decide what should happen.
- I learned that synchronization acknowledging an edit does not automatically mean the user interface is displaying the saved record correctly. The database, synchronization process, and editor must all work together.
- I also learned that browser storage permissions are important for offline applications. Saving something in IndexedDB does not guarantee that the browser will keep it permanently, even when the save operation succeeds.

## Day 10 of 20 · 2026-11-10 (End of Week 2!)

### What I built

- Built the Hybrid Assignment Portal, allowing teachers to create assignments marked as Paper, Digital, or Both. Preserved the existing In-class exam assignment type.
- Added a new `BOTH` assignment kind to the Prisma schema through a small, additive database migration. Existing assignment records were preserved without resetting or reseeding the database.
- Built a section gradebook with one row per learner and columns for the section's assignments. It displays existing grades, maximum marks, conflict information, and digital submission status in one table.
- Implemented offline paper grade entry by reusing the existing GradeEntry local-saving functionality, the Day 8 record synchronization engine, and the Day 9 version-vector conflict handling. No separate grading or synchronization system was created.
- Built the teacher assignment creation form with server-side authorization so teachers can only create assignments for sections they are currently assigned to.
- Built the server-side digital homework submission system using Cloudflare R2 as the selected private storage provider. The implementation uses the official AWS SDK v3 because R2 provides an S3-compatible API.
- Created authenticated API routes for starting a submission, uploading a file through a short-lived authorized URL, confirming the upload, and requesting a short-lived download link.
- Implemented server-side file verification. The server checks the actual stored file size and independently calculates its SHA-256 checksum. A submission is marked as stored only after the file passes verification and the database confirms the finalization.
- Added file validation for JPEG, PNG, WebP, and PDF, with a maximum stored file size of 1 MB. Unsupported formats such as SVG, HTML, executables, and archives are rejected.
- Built the learner-facing Homework files page, allowing learners to see their Digital and Both assignments and select files from their devices.
- Implemented browser-side photo compression using browser-native image processing. The target is to reduce photographs below 500 KB when readability can be preserved. PDFs are not compressed.
- Created a separate offline file-upload queue in IndexedDB. Upgraded the existing `olr-local` database from version 2 to version 3 by adding only the new `fileQueue` store and its indexes, without deleting or replacing existing attendance or record stores.
- Added file ownership checks using the signed-in account, centre, learner, and local device. The existing shared-device lock and storage-readiness safeguards are reused.
- Implemented a foreground file-upload process that is completely separate from the JSON attendance and grade synchronization batches. It handles upload authorization, progress, retries, expired upload links, duplicate submissions, and server finalization.
- Ensured that a queued file remains on the phone after an upload attempt. The local file is removed only after the server confirms that the submission is finalized and marked as stored.
- Extended the teacher's section gradebook to show digital submission statuses: Not submitted, Waiting to upload, Uploading, Submitted, and Upload failed.
- Corrected a gradebook status issue where a file waiting in the server queue was initially displayed as Uploading. The system now distinguishes between a file waiting to upload and one actually being uploaded.

### What went wrong

- The initial architecture audit revealed that the database already contained the Assignment, Submission, GradeEntry, and FileUploadQueueItem models. However, teachers could not create assignments through the application, and there was no learner-facing digital homework upload interface. I reused the existing database structures rather than creating unnecessary duplicate tables.
- The existing assignment type supported Paper, Digital, and In-class exam, but not Both. I therefore added Both as a new enum value through an additive migration. The migration was applied successfully without resetting or reseeding the database.
- During the paper gradebook testing, I discovered an existing grade conflict for Demo Learner 03. I deliberately avoided changing that conflicting record and used other learners for the ten-mark offline synchronization test.
- During the initial learner file testing, I used a small 4-byte JPEG named `sheet.jpg`. It was accepted and saved locally, but it did not provide a meaningful photo-compression test. I later selected a larger 1.4 MB PNG to test the actual preparation process.
- The photo-compression test reduced the 1.4 MB image to 532 KB. The application did not force the image below 500 KB because doing so could affect readability. It retained the prepared image because it was still below the 1 MB maximum and displayed a warning explaining that the 500 KB target had not been reached. However, the selected picture was an anime wallpaper rather than a worksheet, so I did not independently verify handwriting readability.
- The first teacher gradebook test used Chrome, but the existing shared-device lock prevented me from switching directly from the learner account to Teacher One because an older unsynchronized record was still present. I did not bypass the protection or clear browser data. Instead, I used Edge as a separate browser environment to test the teacher gradebook.
- During the teacher gradebook test, the fourth learner's seeded digital submission appeared as Uploading. A read-only database investigation showed that its actual state was `QUEUED`, with no upload attempts or errors. I corrected the status mapping so the teacher now sees Waiting to upload instead.
- The development database proxy stopped accepting connections during testing. It was restarted without resetting or reseeding the database. The existing demo data remained intact.
- A development overlay also reported a hydration difference in the existing attendance status line during one page reload. The attendance component was not changed as part of Day 10.
- The biggest remaining limitation is that I did not create a real Cloudflare account, bucket, or credentials. Therefore, the R2 integration was tested using a mock storage service rather than a real cloud upload. Actual browser uploads, downloads, CORS configuration, and server-side verification against a real R2 object remain to be tested.

### What I learned

- I learned that different types of offline data require different synchronization approaches. Small structured records such as attendance and grades can use JSON batches, but photographs and documents require a separate file-upload process.
- I learned why a file should not be removed from the phone immediately after a successful upload request. The server must independently verify the stored file and confirm the Submission record before the application acknowledges completion.
- I learned how presigned URLs work. They allow the server to authorize a temporary upload or download without exposing permanent storage credentials or making learner files publicly accessible.
- I learned that SHA-256 checksums can be used to verify that the file received by the server matches the file originally selected by the learner. The server must calculate its own checksum instead of trusting the phone's claim.
- I learned how IndexedDB can store actual file data using Blob objects, while keeping file submissions separate from attendance and grade mutations. I also learned why database upgrades must preserve existing local records.
- I learned that image compression involves balancing file size and readability. Reducing a photograph as much as possible is not useful if it makes handwritten work impossible to read.
- I learned that a unified gradebook does not mean every type of work needs the same record. A digital submission is evidence of completed work, while its grade remains a separate GradeEntry record.
- I learned that browser storage warnings must be communicated honestly. A file can be saved in IndexedDB without the browser promising to retain it permanently.

### Testing and final result

**Paper assignment and gradebook testing:**
- Manually opened the Morning Group section gradebook and confirmed that it displayed 15 learners, their learner codes, four seeded assignments, and existing grades.
- Created a separate Paper assignment for the offline grade-entry test.
- Entered ten marks while Chrome was offline. The application displayed the warning that the edits were on the phone and waiting to send, but the browser had not promised to keep them.
- Reconnected to the internet and clicked Send saved edits. The application confirmed that the records had been sent.
- Refreshed the gradebook and confirmed that all ten marks remained displayed correctly.
- Skipped Learner 03 because of the existing unresolved grade conflict.

**Assignment creation testing:**
- Confirmed that teachers can create Paper, Digital, and Both assignments.
- Created a temporary Both assignment in the browser and verified that it appeared as a separate gradebook column. I removed that temporary assignment after testing.

**Learner file-upload and offline queue testing:**
- Signed in as Learner 01 and opened the Homework files page.
- Confirmed that the Digital assignment appeared while the Paper assignment was excluded.
- Selected an SVG file and confirmed that the application rejected it because its format was unsupported.
- Selected the initial small `sheet.jpg` test file. It was saved locally with a waiting-to-send warning.
- Refreshed the page and signed out and back in as the same learner. The queued file remained visible.
- Selected a larger 1.4 MB PNG photograph. The browser prepared it to 532 KB and saved it in the local queue. The application correctly warned that the 500 KB target had not been reached, but the file was still below the 1 MB maximum.
- Did not click Send pending submissions because real Cloudflare R2 storage had not been configured.

**Teacher gradebook and submission-status testing:**
- Opened the Morning Group gradebook in Edge as Teacher One.
- Confirmed that the first three learners displayed Submitted for their seeded Demo photo homework records.
- Investigated the fourth learner's record and confirmed that its database status was `QUEUED`, not `UPLOADING`.
- Corrected the status display and manually verified that the fourth learner now showed Waiting to upload, while the remaining learners showed Not submitted.
- Confirmed that the teacher-facing gradebook distinguishes between a digital file submission and its separate grade.

**Automated testing and verification:**
- Gradebook tests: 11 passed.
- Submission backend tests: 18 passed.
- Learner file and offline queue tests: 14 passed.
- Local database tests: 10 passed.
- Local record-edit tests: 7 passed.
- **Total: 60 tests passed across 5 test files, with 0 failures.**

Additional checks:
- TypeScript (`npx tsc --noEmit`) passed.
- ESLint passed on the changed source and test files.
- `git diff --check` reported no whitespace errors.
- The production build completed successfully, including the new learner homework page, teacher gradebook page, and submission API routes.
- Confirmed that the production build did not perform a database reset, migration, or reseed.
- Confirmed that the existing attendance synchronization and Day 9 version-vector code were preserved.

**Real Cloudflare R2 testing remains pending.** The implementation has not yet been tested against a real bucket. Actual presigned uploads and downloads, bucket CORS, server verification of real uploaded objects, and interrupted real uploads still require cloud configuration.

### End-of-day result

Day 10 was completed with the Hybrid Assignment Portal, offline paper gradebook, private digital submission backend, learner file queue, browser photo preparation, and teacher submission-status display implemented.

The ten-mark offline grade-entry test passed manually, and the learner file queue and photo preparation were also tested in the browser. Automated tests, TypeScript, ESLint, and the production build all passed.

The implementation was committed and pushed to GitHub. Real Cloudflare R2 acceptance testing remains pending until the private bucket and credentials are configured.

---

### Week 2 Review: 3 Decisions That Shaped the Project

1. **Decision:** Used version vectors instead of relying on phone timestamps for offline edits.
**Why:** During Day 9, I implemented version-vector conflict handling for grades and progress notes. Phone clocks can be incorrect, and relying on timestamps could cause the system to overwrite a newer edit with an older one. Version vectors allow the server to understand the causal order of changes made by different devices. When two devices edit the same record independently while offline, the system preserves both complete versions and allows an authorized teacher to resolve the conflict. I manually tested this using Chrome and Edge and confirmed that both versions were preserved and that later edits worked after conflict resolution.

2. **Decision:** Kept file uploads separate from the JSON synchronization engine.
**Why:** During Days 8 and 10, I established two different synchronization workflows. Attendance records and grades are relatively small pieces of structured data, so they can be sent through the existing JSON record-sync engine. Photographs and documents are much larger and may take longer to upload or fail partway through. Sending them through the same JSON batch could delay smaller records and make retries more complicated. I therefore built a separate IndexedDB file queue and foreground upload process. The file remains on the phone until the server verifies its contents and confirms that the Submission record has been finalized.

3. **Decision:** Compressed photographs in the browser before uploading them.**
**Why:** Refugee learning centres and learners may depend on mobile data and unreliable internet connections. Uploading unnecessarily large photographs can consume expensive data and take longer on weak connections. Preparing photographs on the phone can reduce the amount of data transferred before an upload begins. I tested this with a 1.4 MB PNG, which the application reduced to 532 KB. The 500 KB target was not reached, but the application retained the prepared image under the 1 MB maximum instead of forcing further compression that could affect readability. This taught me that saving data is important, but preserving the quality of a learner's submitted work is more important than achieving a particular file size.

## Day 11 of 20 · 2026-11-11

### What I built

- Built the Performance Dashboard with individual learner views, section performance views, and a center wide performance view for the Director.
- Added grade performance calculations for paper assignments, in class exams, and digital assignments. Grades are converted into percentages so assignments with different maximum marks can be compared.
- Added section grade averages using each learner's own settled grade average, so learners with more graded assignments do not have extra weight in the section average.
- Added attendance calculations using eligible past sessions. Cancelled sessions and future sessions are excluded. The dashboard also separates confirmed attendance from recording coverage and shows unmarked sessions.
- Implemented the academic trajectory labels: Improving, Steady, Declining, and Insufficient data. The calculation uses up to the latest eight settled marks, requires at least four marks, and compares the medians of earlier and later results using the approved 10 percentage point threshold.
- Ensured missing grades, ungraded assignments, and marks with open conflicts do not incorrectly affect the grade average or academic trajectory.
- Expanded the dashboard to include file receipt trends for digital assignments and the file submission part of Both assignments. Paper assignments are not treated as file submissions.
- Added a section level file receipt table and an individual learner file receipt table. These show expected files, received files, receipt dates, and the received by now rate.
- Documented the measurement rules in `docs/DASHBOARD_METRICS.md`, including how attendance, grades, academic trajectories, and file receipts are calculated.
- Added strict server side authorization. Teachers can only access their currently assigned sections, while Directors can see performance across their own center.
- Added automated tests for dashboard calculations, missing data, cancelled sessions, and access permissions.

### What went wrong

- The original dashboard implementation did not fully cover the submission trends required by LMS-7. I investigated the database structure and discovered that submission records do not preserve a complete history of every upload attempt. Instead of presenting an unreliable attempt history, we expanded the dashboard with assignment level file receipt tables using the server recorded receipt time.
- I had to clarify the difference between files received by now and files received on time. The dashboard measures whether the server has received and stored a file, even when it arrives after the due date. It is not an on time submission rate.
- I also approved additional rules for file receipt calculations. Only learners who are active now are included, and a learner is expected to submit a file only when their enrollment started on or before the assignment due date. Future assignments and assignments without due dates are excluded from the rate.
- During the final quality checks, the production build detected a missing `receivedAt` value in a stored file test fixture. The test fixture was corrected, and the production build passed afterward.
- Before committing, a staged diff check also detected an extra blank line at the end of `lib/lms/dashboard-metrics.ts`. I removed it and repeated the check successfully.
- I manually checked the dashboard calculations instead of relying only on the automated tests.

### What I learned

- I learned how to calculate academic trajectories without inventing false precision. A learner needs enough settled grade marks before the dashboard can reasonably identify a direction of progress.
- I learned that missing grades, unresolved conflicts, and cancelled sessions must be handled carefully so they do not distort performance calculations.
- I learned the difference between attendance confirmation and attendance recording coverage. A session can be included in the eligible total without having an attendance mark yet.
- I learned that submission trends and academic trajectories are separate measurements. Receiving a homework file does not automatically mean that the learner has received a grade.
- I learned that dashboard metrics must match what the database can reliably measure. When the database does not preserve historical upload attempts, the dashboard should not pretend that it can show them.
- I also learned that a dashboard is not just about displaying percentages and tables. Its calculations must be understandable, tested, and protected by server side permissions.

### Testing and results

**Automated checks**
- Focused dashboard tests passed: 22 tests across two test files.
- TypeScript check passed using `npx tsc --noEmit`.
- ESLint passed.
- Production build passed using `npm run build`.
- `git diff --check` passed after the final correction.

**Manual browser tests**
- Hand calculated Demo Learner 01's attendance. The dashboard showed 8 Present out of 17 eligible sessions, giving 47.1% confirmed attendance. Recording coverage was 76.5%, matching the 13 recorded attendance statuses out of 17 sessions.
- Confirmed that one cancelled class was excluded from the eligible attendance total.
- Checked Demo Learner 03, who had three settled marks. The dashboard correctly displayed Insufficient data because at least four settled marks are required for an academic trajectory.
- Confirmed that the open grade conflict was excluded from the settled grade average. The learner's displayed grade average of 71.0% matched the three settled marks.
- Tested the section file receipt table for Morning Group. It showed 15 expected files and 3 received files, giving a received by now rate of 20.0%.
- Checked individual file receipt records for two learners. Demo Learner 01 showed one received file out of one expected file, while Demo Learner 04 showed zero received files out of one expected file.
- Confirmed that Paper assignments were not included in the file receipt calculations.
- Signed in as Teacher Two and attempted to access the Morning Group performance page. Access was denied.
- Signed in as Director and confirmed that the Center Performance page displayed both sections.
