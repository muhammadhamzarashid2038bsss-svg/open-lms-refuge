# Isolated test database

Automated tests use a native PostgreSQL database on this computer. They do not use the Prisma Dev database and they do not read `DATABASE_URL` from `.env`.

The app, `npm run dev`, `npm run db:migrate`, and `npm run db:seed` still use `.env` and `prisma7.config.ts`.

## One-time setup

1. Install PostgreSQL 18 locally and keep it listening on port `5433`.
2. Create the database `open_lms_refuge_test` owned by the login role `open_lms_refuge_test`.
3. Set the database parameter `app.is_test_database` to `yes`.
4. Copy `.env.test.example` to `.env.test`.
5. Replace `<URL_ENCODED_PASSWORD>` with the test role password. Encode characters such as `@`, `:`, and `/` so the URL stays valid. Do not commit `.env.test`.

## Commands

Run these from the project folder in PowerShell:

- `npm run test:url` checks the URL rules only. It does not connect to PostgreSQL.
- `npm run db:test:verify` checks the URL, then checks that the connected database, role, and `app.is_test_database` marker match.
- `npm run db:test:migrate` applies the existing Prisma migrations to the test database.
- `npm run db:test:seed` loads the same synthetic DEMO seed used in development, after the marker check.
- `npm run test:db` runs the Vitest suite against that database.

`npm test` uses the same Vitest configuration. It also refuses to start unless `.env.test` points at this database.

`prisma7.test.config.ts` repeats the live check before it hands Prisma a URL. `npx prisma migrate deploy --config prisma7.test.config.ts` stops when that check fails.

The suite checks the live server before each test file. Destructive cleanup in the grade-sync tests and the Day 16 export tests runs that check again before deleting rows.
