# Architecture decisions

Short record of choices that affect how the app runs locally and in production.

## DATABASE_POOL_MAX for local Prisma Postgres

**Decision:** Read `DATABASE_POOL_MAX` when constructing `PrismaPg` in `lib/db.ts`. When unset, the driver keeps its default pool size.

**Why:** `npx prisma dev` serves a local Postgres proxy that effectively allows **one client connection at a time**. A larger pool (or parallel test workers) opens a second connection and fails with `P1017` / “Server has closed the connection”, especially during long `prisma db seed` transactions.

**Local setup:** Set `DATABASE_POOL_MAX=1` in `.env` while using `prisma dev`. Vitest is configured to run test **files** one at a time for the same reason.

**Rejected:** Relying only on `connection_limit` in the URL string — the pg adapter pool uses `max`, not that query parameter.
