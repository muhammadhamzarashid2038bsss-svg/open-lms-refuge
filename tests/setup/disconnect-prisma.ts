import { afterAll } from "vitest";
import { prisma } from "../../lib/db";

// The local learning-center database allows 10 connections and never closes an
// idle one. Each test file is its own process with this shared client. This
// hook is registered before the test file, and Vitest runs afterAll in reverse
// order, so the file's own cleanup finishes first. A cleanup hook that throws
// skips this fallback, so those files also disconnect in their own finally.
// A failed close is reported here. It does not replace an assertion failure
// that was already recorded.
afterAll(async () => {
  await prisma.$disconnect();
});
