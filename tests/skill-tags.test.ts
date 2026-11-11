import { afterAll, describe, expect, it } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import { createCenterSkillTag, setCenterSkillTagActive } from "../lib/data/skill-tags";
import { acceptRecordBatch } from "../lib/data/sync-records";
import { prisma } from "../lib/db";

const createdTagIds: string[] = [];

async function actorByEmail(email: string): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(email);
  return actor;
}

describe("center skill tags", () => {
  afterAll(async () => {
    if (createdTagIds.length === 0) return;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
      await tx.auditLog.deleteMany({ where: { entityId: { in: createdTagIds } } });
    });
    await prisma.centerSkillTag.deleteMany({ where: { id: { in: createdTagIds } } });
  });

  it("lets the center director add a short skill tag and keeps the name out of the audit row", async () => {
    const director = await actorByEmail("director@demo.invalid");
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    const name = `Map reading ${crypto.randomUUID().slice(0, 8)}`;
    const created = await createCenterSkillTag(director, name);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdTagIds.push(created.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: created.id, action: "CREATE" } });
    expect(audit.actorId).toBe(director.id);
    expect(audit.entityType).toBe("SKILL_TAG");
    expect(audit.metadata).toEqual({ source: "skill-tag", active: true });
    expect(JSON.stringify(audit.metadata)).not.toContain(name);

    expect((await createCenterSkillTag(teacher, `Other ${crypto.randomUUID().slice(0, 8)}`)).ok).toBe(false);
    expect((await createCenterSkillTag(director, "legal status")).ok).toBe(false);
  });

  it("keeps a turned-off tag off new notes and readable by id", async () => {
    const director = await actorByEmail("director@demo.invalid");
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    const name = `Shape sense ${crypto.randomUUID().slice(0, 8)}`;
    const created = await createCenterSkillTag(director, name);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdTagIds.push(created.id);
    expect((await setCenterSkillTagActive(director, created.id, false)).ok).toBe(true);
    const stored = await prisma.centerSkillTag.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.active).toBe(false);
    expect(stored.name).toBe(name);

    const morning = await prisma.section.findFirstOrThrow({
      where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
      select: { id: true },
    });
    const learner = await prisma.enrollment.findFirstOrThrow({
      where: { sectionId: morning.id, status: "ACTIVE" },
      select: { learnerId: true },
    });
    const deviceId = crypto.randomUUID();
    const recordId = crypto.randomUUID();
    const result = await acceptRecordBatch(teacher, {
      version: 1,
      localDeviceId: deviceId,
      mutations: [{
        entityType: "PROGRESS_NOTE",
        clientMutationId: `tag-off-${recordId.slice(0, 8)}`,
        recordId,
        sectionId: morning.id,
        learnerId: learner.learnerId,
        body: "Day12 inactive tag must not save",
        skillGaps: ["CUSTOM"],
        customSkillLabel: null,
        customSkillTagId: created.id,
        versionVector: { [deviceId]: 1 },
        deviceRecordedAt: "2026-11-11T00:00:00.000Z",
        createdOffline: true,
      }],
    }, 200);
    expect((result.body as { results: { code?: string }[] }).results[0]?.code).toBe("invalid_note");
    expect(await prisma.progressNote.findUnique({ where: { id: recordId } })).toBeNull();
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
      await tx.auditLog.deleteMany({ where: { entityId: created.id } });
    });
  });
});
