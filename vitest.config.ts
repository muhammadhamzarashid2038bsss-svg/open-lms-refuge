import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    // One file at a time. The local Prisma database proxy mixes up prepared
    // statements when several test files query it at once.
    fileParallelism: false,
    maxWorkers: 1,
    // The first file sets the test database URL before the Prisma client can
    // load .env. The second file checks the live server. The disconnect still
    // runs last, after that file's own cleanup hooks.
    globalSetup: ["./tests/setup/global-test-database.ts"],
    setupFiles: [
      "./tests/setup/load-test-env.ts",
      "./tests/setup/assert-test-database.ts",
      "./tests/setup/disconnect-prisma.ts",
    ],
    env: {
      SESSION_SECRET: "test-only-session-secret-must-be-32",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/support/server-only-stub.ts"),
    },
  },
});
