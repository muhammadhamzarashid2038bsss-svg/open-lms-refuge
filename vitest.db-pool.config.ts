import { defineConfig } from "vitest/config";

// Pool-size checks must not use the database setup. That setup connects.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db-pool.test.ts"],
  },
});
