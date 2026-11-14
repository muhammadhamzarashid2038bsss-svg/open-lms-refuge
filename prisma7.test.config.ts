// Prisma commands for the native test database. The URL comes from .env.test
// in the project folder. This file does not load .env and does not read
// DATABASE_URL, so a development URL cannot be selected by mistake.
//
// The loader used by Prisma 7 awaits a function export before migrate or seed
// sees the URL. The live check therefore finishes, and its own connection is
// closed, before a direct `prisma --config prisma7.test.config.ts` command
// can continue.
import { defineConfig } from "prisma/config";
import { assertConnectedTestDatabase } from "./lib/test-db/connect";
import { loadTestDatabaseEnv } from "./lib/test-db/load";

export default async function testDatabaseConfig() {
  const testDatabase = loadTestDatabaseEnv();
  await assertConnectedTestDatabase(testDatabase.url);
  return defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
      path: "prisma/migrations",
      seed: "tsx scripts/test-database-command.ts seed",
    },
    datasource: {
      url: testDatabase.url,
    },
  });
}
