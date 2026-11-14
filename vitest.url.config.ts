// Runs only the URL checks. It does not load .env.test and does not open a
// database connection, so the rules can be reviewed before the test database
// is migrated.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/test-database-url.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
