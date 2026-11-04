import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import { prisma } from "../lib/db";
import type { Actor } from "../lib/auth/permissions";

const holder = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/lib/auth/actor", () => ({
  getActor: async () => holder.actor,
}));

import { GET as getLearner } from "../app/api/learners/[id]/route";
import { GET as getFile } from "../app/api/resources/[id]/file/route";

const now = new Date("2026-11-05T12:00:00.000Z");

describe("direct API routes", () => {
  let morningId = "";
  let afternoonId = "";
  let audioId = "";
  let storageKey = "";

  beforeAll(async () => {
    const morning = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { id: true, userId: true },
    });
    const afternoon = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0016", center: { code: "DEMO" } },
      select: { id: true },
    });
    const audio = await prisma.resource.findFirstOrThrow({
      where: { title: "Demo letter sounds" },
      select: { id: true, storageKey: true },
    });
    morningId = morning.id;
    afternoonId = afternoon.id;
    audioId = audio.id;
    storageKey = audio.storageKey ?? "";
    holder.actor = await loadActor(morning.userId, now);
  });

  it("returns 401 when nobody is signed in", async () => {
    holder.actor = null;
    const response = await getLearner(new Request("http://localhost/api/learners/x"), {
      params: Promise.resolve({ id: morningId }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Sign in required.");
  });

  it("returns 404 for another learner and does not expose a private file key", async () => {
    const morning = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { userId: true },
    });
    holder.actor = await loadActor(morning.userId, now);
    const denied = await getLearner(new Request("http://localhost/api/learners/other"), {
      params: Promise.resolve({ id: afternoonId }),
    });
    expect(denied.status).toBe(404);

    const file = await getFile(new Request("http://localhost/api/resources/file"), {
      params: Promise.resolve({ id: audioId }),
    });
    expect(file.status).toBe(200);
    const text = await file.text();
    expect(text).not.toContain(storageKey);
    expect(text).not.toContain("private/demo");
  });
});
