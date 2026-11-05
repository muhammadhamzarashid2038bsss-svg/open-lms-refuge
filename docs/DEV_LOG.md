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
