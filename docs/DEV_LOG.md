# Development Log

## Day 1 - October 23, 2026 

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

## Day 2 - November 3, 2026

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
