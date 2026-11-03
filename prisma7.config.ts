// Prisma 7 reads the database URL here, not in schema.prisma.
// DATABASE_URL stays in .env, which is never committed.
import "dotenv/config";
import { defineConfig } from "prisma/config";

const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
