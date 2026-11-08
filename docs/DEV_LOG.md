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

**Final result:** Day 7 was completed with one documented browser limitation. The offline kiosk shell, caching boundaries, IndexedDB migration, and shared-device protection were verified. However, actual offline attendance saving could not be demonstrated because Chrome refused persistent storage. The application correctly blocked the save rather than risking an inaccurate confirmation. Uploading unsynchronized attendance records remains part of Day 8.
