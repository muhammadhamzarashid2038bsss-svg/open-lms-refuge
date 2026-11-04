import { afterAll, describe, expect, it } from "vitest";
import { hashSecret, verifySecret } from "../lib/auth/password";
import { authenticateStaff } from "../lib/auth/login";
import { findStaffByEmail } from "../lib/auth/lookup";
import { loadActor } from "../lib/auth/load-actor";
import { resetPinByCode } from "../lib/auth/accounts";
import { releaseSharedDevice } from "../lib/auth/handover";
import { prismaThrottleStore } from "../lib/auth/prisma-store";
import { ipBucketId, staffBucketId } from "../lib/auth/login";
import { fileResponse, learnerResponse, sectionResponse } from "../lib/http/records";
import { readLearnerContact, readLearnerRecord, readResourceRecord } from "../lib/data/records";
import { prisma } from "../lib/db";
import type { PrismaClient } from "../generated/prisma/client";

const now = new Date("2026-11-05T12:00:00.000Z");

afterAll(async () => {
  await prisma.$disconnect();
});

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id, now);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}

async function learnerByCode(learnerCode: string) {
  return prisma.learnerProfile.findFirstOrThrow({
    where: { learnerCode, center: { code: "DEMO" } },
    select: { id: true, userId: true, centerId: true, pinHash: true },
  });
}

async function removeUser(userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.auditLog.deleteMany({ where: { OR: [{ actorId: userId }, { entityId: userId }] } });
    await tx.authSession.deleteMany({ where: { userId } });
    await tx.deviceHandover.deleteMany({
      where: { OR: [{ fromUserId: userId }, { releasedById: userId }] },
    });
    await tx.learnerProfile.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });
}

describe("demo sign-in records", () => {
  it("checks the seeded staff password and learner PIN without storing the PIN", async () => {
    const staff = await prisma.user.findUniqueOrThrow({
      where: { email: "teacher.one@demo.invalid" },
      select: { passwordHash: true },
    });
    const learner = await learnerByCode("LNR-0001");
    expect(verifySecret("demo-password", staff.passwordHash)).toBe(true);
    expect(staff.passwordHash).not.toContain("demo-password");
    expect(verifySecret("1234", learner.pinHash)).toBe(true);
    expect(learner.pinHash).not.toContain("1234");
  });
});

describe("direct record access", () => {
  it("isolates learners, teachers, directors, and admins", async () => {
    const teacherOne = await actorByEmail("teacher.one@demo.invalid");
    const teacherTwo = await actorByEmail("teacher.two@demo.invalid");
    const teacherThree = await actorByEmail("teacher.three@demo.invalid");
    const director = await actorByEmail("director@demo.invalid");
    const admin = await actorByEmail("admin@demo.invalid");
    const morning = await learnerByCode("LNR-0001");
    const afternoon = await learnerByCode("LNR-0016");
    const morningStudent = await loadActor(morning.userId, now);
    const afternoonStudent = await loadActor(afternoon.userId, now);
    if (!morningStudent || !afternoonStudent) throw new Error("missing learner actor");

    expect(await readLearnerRecord(teacherOne, morning.id)).not.toBeNull();
    expect(await readLearnerRecord(teacherOne, afternoon.id)).toBeNull();
    expect(await readLearnerRecord(teacherTwo, afternoon.id)).not.toBeNull();
    expect(await readLearnerRecord(teacherTwo, morning.id)).toBeNull();
    expect(await readLearnerRecord(teacherThree, afternoon.id)).toBeNull();
    expect(await readLearnerRecord(morningStudent, morning.id)).not.toBeNull();
    expect(await readLearnerRecord(morningStudent, afternoon.id)).toBeNull();
    expect((await learnerResponse(null, morning.id)).status).toBe(401);
    expect((await learnerResponse(morningStudent, afternoon.id)).status).toBe(404);
    expect((await learnerResponse(morningStudent, morning.id)).status).toBe(200);
    expect(await readLearnerRecord(director, morning.id)).not.toBeNull();
    expect(await readLearnerRecord(director, afternoon.id)).not.toBeNull();
    expect(await readLearnerRecord(admin, morning.id)).toBeNull();

    const audio = await prisma.resource.findFirstOrThrow({
      where: { title: "Demo letter sounds" },
      select: { id: true, storageKey: true },
    });
    const web = await prisma.resource.findFirstOrThrow({
      where: { title: "Demo number practice link" },
      select: { id: true },
    });
    const morningFile = await fileResponse(morningStudent, audio.id);
    const afternoonFile = await fileResponse(afternoonStudent, audio.id);
    expect(morningFile.status).toBe(200);
    expect(JSON.stringify(morningFile.body)).not.toContain(audio.storageKey ?? "missing-key");
    expect(afternoonFile.status).toBe(404);
    expect(await readResourceRecord(morningStudent, web.id)).toBeNull();
    expect(await readResourceRecord(afternoonStudent, web.id)).not.toBeNull();
    expect(await fileResponse(admin, audio.id)).toMatchObject({ status: 404 });

    const pdf = await prisma.resource.findFirstOrThrow({
      where: { title: "Demo alphabet practice PDF" },
      select: { id: true },
    });
    expect(await readResourceRecord(morningStudent, pdf.id)).not.toBeNull();
    expect(await readResourceRecord(afternoonStudent, pdf.id)).not.toBeNull();

    const morningSection = await prisma.section.findFirstOrThrow({
      where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
      select: { id: true },
    });
    const afternoonSection = await prisma.section.findFirstOrThrow({
      where: { name: "Afternoon Group", course: { center: { code: "DEMO" } } },
      select: { id: true },
    });
    expect((await sectionResponse(teacherOne, morningSection.id)).status).toBe(200);
    expect((await sectionResponse(teacherOne, afternoonSection.id)).status).toBe(404);
    const studentSection = await sectionResponse(morningStudent, morningSection.id);
    expect(studentSection.status).toBe(200);
    expect((studentSection.body as { learners: unknown }).learners).toBeNull();
    expect(JSON.stringify(studentSection.body)).not.toContain("LNR-0002");

    expect(await readLearnerContact(director, morning.id)).toEqual({ phone: null });
    expect(await readLearnerContact(teacherOne, morning.id)).toBeNull();
    expect(await readLearnerContact(morningStudent, morning.id)).toBeNull();
  });

  it("hides a learner in another center and a phone number from a teacher", async () => {
    const director = await actorByEmail("director@demo.invalid");
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    await expect(
      prisma.$transaction(async (tx) => {
        const db = tx as unknown as PrismaClient;
        const center = await tx.center.create({
          data: { name: "Other Test Center", code: `T${Date.now().toString().slice(-8)}`, timezone: "UTC" },
        });
        const user = await tx.user.create({
          data: { centerId: center.id, role: "STUDENT", active: true },
        });
        const profile = await tx.learnerProfile.create({
          data: {
            userId: user.id,
            centerId: center.id,
            learnerCode: "LNR-9001",
            displayName: "Other Test",
            ageBand: "AGE_12_14",
            pinHash: hashSecret("1234"),
          },
        });
        expect(await readLearnerRecord(director, profile.id, db)).toBeNull();

        const demo = await tx.center.findUniqueOrThrow({ where: { code: "DEMO" } });
        await tx.centerOptionalField.update({
          where: { centerId_fieldKey: { centerId: demo.id, fieldKey: "CONTACT_PHONE" } },
          data: { enabled: true },
        });
        const morning = await tx.learnerProfile.findFirstOrThrow({
          where: { learnerCode: "LNR-0001", centerId: demo.id },
        });
        await tx.learnerOptionalContact.create({
          data: { learnerId: morning.id, phoneE164: "+10000000000" },
        });
        expect(await readLearnerContact(director, morning.id, db)).toEqual({ phone: "+10000000000" });
        expect(await readLearnerContact(teacher, morning.id, db)).toBeNull();
        throw new Error("ROLLBACK");
      }),
    ).rejects.toThrow("ROLLBACK");
  });
});

describe("account changes on throwaway users", () => {
  it("rejects a deactivated account and locks a real database counter after 5 failures", async () => {
    const center = await prisma.center.findUniqueOrThrow({ where: { code: "DEMO" } });
    const email = `lock-${crypto.randomUUID()}@demo.invalid`;
    const created = await prisma.user.create({
      data: {
        centerId: center.id,
        role: "TEACHER",
        email,
        displayName: "Lock Test",
        passwordHash: hashSecret("correct-horse"),
        active: false,
        deactivatedAt: now,
      },
    });
    const store = prismaThrottleStore();
    try {
      const wrong = await authenticateStaff({
        email,
        password: "wrong-password",
        now,
        ip: "198.51.100.20",
        store,
        findStaff: findStaffByEmail,
      });
      const right = await authenticateStaff({
        email,
        password: "correct-horse",
        now,
        ip: "198.51.100.20",
        store,
        findStaff: findStaffByEmail,
      });
      expect(wrong).toEqual({ ok: false, error: "mismatch" });
      expect(right).toEqual({ ok: false, error: "deactivated" });

      await prisma.user.update({ where: { id: created.id }, data: { active: true, deactivatedAt: null } });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await authenticateStaff({
          email,
          password: "wrong-password",
          now,
          ip: "198.51.100.21",
          store,
          findStaff: findStaffByEmail,
        });
      }
      const row = await prisma.loginThrottle.findUniqueOrThrow({ where: { bucketKey: staffBucketId(email) } });
      expect(row.failedCount).toBeGreaterThanOrEqual(5);
      expect(row.lockedUntil).not.toBeNull();
      const locked = await authenticateStaff({
        email,
        password: "correct-horse",
        now,
        ip: "198.51.100.21",
        store,
        findStaff: findStaffByEmail,
      });
      expect(locked).toEqual({ ok: false, error: "locked" });
    } finally {
      await prisma.loginThrottle.deleteMany({
        where: {
          bucketKey: {
            in: [staffBucketId(email), ipBucketId("198.51.100.20"), ipBucketId("198.51.100.21")],
          },
        },
      });
      await removeUser(created.id);
    }
  });

  it("lets an admin set a PIN and stops a teacher from another section", async () => {
    const center = await prisma.center.findUniqueOrThrow({ where: { code: "DEMO" } });
    const admin = await actorByEmail("admin@demo.invalid");
    const teacherTwo = await actorByEmail("teacher.two@demo.invalid");
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { centerId: center.id, role: "STUDENT", active: true },
      });
      const profile = await tx.learnerProfile.create({
        data: {
          userId: user.id,
          centerId: center.id,
          learnerCode: `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          displayName: "Pin Test",
          ageBand: "AGE_12_14",
          pinHash: hashSecret("1111"),
        },
      });
      return profile;
    });
    try {
      const denied = await resetPinByCode(teacherTwo, "DEMO", created.learnerCode, "4321");
      expect(denied.status).toBe("hidden");
      const saved = await resetPinByCode(admin, "DEMO", created.learnerCode, "4321");
      expect(saved.status).toBe("saved");
      const updated = await prisma.learnerProfile.findUniqueOrThrow({
        where: { id: created.id },
        select: { pinHash: true },
      });
      expect(updated.pinHash).not.toContain("4321");
      expect(verifySecret("4321", updated.pinHash)).toBe(true);
      expect(verifySecret("1111", updated.pinHash)).toBe(false);
    } finally {
      await removeUser(created.userId);
    }
  });

  it("records a handover for an authorized teacher and refuses another section", async () => {
    const morning = await learnerByCode("LNR-0001");
    const allowed = await releaseSharedDevice({
      email: "teacher.one@demo.invalid",
      password: "demo-password",
      fromUserId: morning.userId,
      centerId: morning.centerId,
      reason: "The learner left this shared classroom phone.",
      deviceLabel: "test phone",
      itemCount: 1,
      ip: "198.51.100.30",
      now,
    });
    const denied = await releaseSharedDevice({
      email: "teacher.two@demo.invalid",
      password: "demo-password",
      fromUserId: morning.userId,
      centerId: morning.centerId,
      reason: "The learner left this shared classroom phone.",
      deviceLabel: "test phone",
      itemCount: 1,
      ip: "198.51.100.31",
      now,
    });
    expect(allowed.ok).toBe(true);
    expect(denied.ok).toBe(false);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
      await tx.deviceHandover.deleteMany({ where: { fromUserId: morning.userId, deviceLabel: "test phone" } });
      const notes = await tx.auditLog.findMany({ where: { entityId: morning.userId } });
      const handoverNotes = notes.filter((note) => {
        const metadata = note.metadata;
        return Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && "handoverId" in metadata);
      });
      if (handoverNotes.length) {
        await tx.auditLog.deleteMany({ where: { id: { in: handoverNotes.map((note) => note.id) } } });
      }
    });
  });
});
