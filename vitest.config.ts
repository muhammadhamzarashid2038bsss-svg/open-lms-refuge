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
    env: {
      SESSION_SECRET: "test-only-session-secret-must-be-32",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
