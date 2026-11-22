import { defineConfig } from "vitest/config";

// These checks must not use the database setup. That setup connects.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/demo-throttle.test.ts"],
  },
});
