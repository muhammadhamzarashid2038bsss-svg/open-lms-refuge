import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/db";

// The first migration already attaches sync_conflicts_same_record. The Day 9
// migration replaces the function body. PostgreSQL keeps the trigger, so a
// second trigger is not created. These tests lock that in and prove the
// database, not only the application, refuses a version from another record.

const when = new Date("2026-03-01T00:00:00.000Z");

let centerId = "";
let teacherId = "";
let sectionId = "";
let deviceId = "";
let assignmentId = "";
let ownGradeId = "";
let otherGradeId = "";
let ownNoteId = "";
let otherNoteId = "";
let ownGradeA = "";
let ownGradeB = "";
let ownGradeResolved = "";
let otherGradeVersion = "";
let ownNoteA = "";
let ownNoteB = "";
let ownNoteResolved = "";
let otherNoteVersion = "";

async function removeFixtures() {
  const gradeIds = [ownGradeId, otherGradeId].filter(Boolean);
  const noteIds = [ownNoteId, otherNoteId].filter(Boolean);
  if (gradeIds.length || noteIds.length) {
    await prisma.syncConflict.deleteMany({
      where: {
        OR: [
          ...(gradeIds.length ? [{ gradeEntryId: { in: gradeIds } }] : []),
          ...(noteIds.length ? [{ progressNoteId: { in: noteIds } }] : []),
        ],
      },
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    if (gradeIds.length) await tx.gradeEntryVersion.deleteMany({ where: { gradeEntryId: { in: gradeIds } } });
    if (noteIds.length) await tx.progressNoteVersion.deleteMany({ where: { progressNoteId: { in: noteIds } } });
    if (gradeIds.length) await tx.gradeEntry.deleteMany({ where: { id: { in: gradeIds } } });
    if (noteIds.length) await tx.progressNote.deleteMany({ where: { id: { in: noteIds } } });
  });
  if (assignmentId) await prisma.assignment.deleteMany({ where: { id: assignmentId } });
  if (deviceId) await prisma.device.deleteMany({ where: { id: deviceId } });
}

describe("sync conflict version trigger", () => {
  beforeAll(async () => {
    const teacher = await prisma.user.findUniqueOrThrow({
      where: { email: "teacher.one@demo.invalid" },
      select: { id: true, centerId: true },
    });
    teacherId = teacher.id;
    centerId = teacher.centerId;
    sectionId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    const enrolled = await prisma.enrollment.findMany({
      where: { sectionId, status: "ACTIVE" },
      select: { learnerId: true },
      take: 2,
    });
    if (enrolled.length < 2) throw new Error("the demo section needs two active learners");
    deviceId = crypto.randomUUID();
    await prisma.device.create({ data: { id: deviceId, centerId, label: "Day9 trigger phone" } });
    assignmentId = (
      await prisma.assignment.create({
        data: {
          sectionId,
          title: "Day9 trigger quiz",
          kind: "PAPER",
          maxPoints: "20.00",
          createdById: teacherId,
        },
        select: { id: true },
      })
    ).id;

    ownGradeId = crypto.randomUUID();
    otherGradeId = crypto.randomUUID();
    await prisma.gradeEntry.createMany({
      data: [ownGradeId, otherGradeId].map((id, index) => ({
        id,
        assignmentId,
        learnerId: enrolled[index]!.learnerId,
        points: "10.00",
        recordedById: teacherId,
        deviceId,
        versionVector: { [deviceId]: 1 },
        deviceRecordedAt: when,
        syncedAt: when,
        createdOffline: true,
      })),
    });
    ownGradeA = crypto.randomUUID();
    ownGradeB = crypto.randomUUID();
    ownGradeResolved = crypto.randomUUID();
    otherGradeVersion = crypto.randomUUID();
    await prisma.gradeEntryVersion.createMany({
      data: [
        [ownGradeA, ownGradeId],
        [ownGradeB, ownGradeId],
        [ownGradeResolved, ownGradeId],
        [otherGradeVersion, otherGradeId],
      ].map(([id, gradeEntryId]) => ({
        id,
        gradeEntryId,
        points: "10.00",
        recordedById: teacherId,
        deviceId,
        versionVector: { [deviceId]: 1 },
        deviceRecordedAt: when,
        syncedAt: when,
        createdOffline: true,
        preservedFromConflict: false,
      })),
    });

    ownNoteId = crypto.randomUUID();
    otherNoteId = crypto.randomUUID();
    await prisma.progressNote.createMany({
      data: [ownNoteId, otherNoteId].map((id, index) => ({
        id,
        learnerId: enrolled[index]!.learnerId,
        sectionId,
        authorId: teacherId,
        body: `Day9 trigger note ${index + 1}`,
        skillGaps: ["READING" as const],
        deviceId,
        versionVector: { [deviceId]: 1 },
        deviceRecordedAt: when,
        syncedAt: when,
        createdOffline: true,
      })),
    });
    ownNoteA = crypto.randomUUID();
    ownNoteB = crypto.randomUUID();
    ownNoteResolved = crypto.randomUUID();
    otherNoteVersion = crypto.randomUUID();
    await prisma.progressNoteVersion.createMany({
      data: [
        [ownNoteA, ownNoteId],
        [ownNoteB, ownNoteId],
        [ownNoteResolved, ownNoteId],
        [otherNoteVersion, otherNoteId],
      ].map(([id, progressNoteId]) => ({
        id,
        progressNoteId,
        authorId: teacherId,
        body: "Day9 trigger copy",
        skillGaps: ["READING" as const],
        deviceId,
        versionVector: { [deviceId]: 1 },
        deviceRecordedAt: when,
        syncedAt: when,
        createdOffline: true,
        preservedFromConflict: false,
      })),
    });
  });

  afterAll(async () => {
    await removeFixtures();
    await prisma.$disconnect();
  });

  it("keeps the existing before-insert-or-update trigger on the replaced function", async () => {
    const rows = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'sync_conflicts'
        AND t.tgname = 'sync_conflicts_same_record'
        AND NOT t.tgisinternal
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.definition).toContain("BEFORE INSERT OR UPDATE");
    expect(rows[0]?.definition).toContain("EXECUTE FUNCTION sync_conflict_versions_match_parent()");
    const source = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      WHERE p.proname = 'sync_conflict_versions_match_parent'
    `;
    expect(source[0]?.definition).toContain("grade conflict versions must belong to the same grade");
    expect(source[0]?.definition).toContain("grade resolution version must be a new copy of the same grade");
    expect(source[0]?.definition).toContain("note conflict versions must belong to the same note");
    expect(source[0]?.definition).toContain("note resolution version must be a new copy of the same note");
  });

  it("accepts a grade conflict on one record and rejects a version from another grade", async () => {
    const conflictId = crypto.randomUUID();
    await expect(
      prisma.syncConflict.create({
        data: {
          id: conflictId,
          entityType: "GRADE_ENTRY",
          state: "OPEN",
          gradeEntryId: ownGradeId,
          gradeVersionAId: ownGradeA,
          gradeVersionBId: otherGradeVersion,
          shownGradeVersionId: ownGradeA,
        },
      }),
    ).rejects.toThrow(/grade conflict versions must belong to the same grade/);

    await prisma.syncConflict.create({
      data: {
        id: conflictId,
        entityType: "GRADE_ENTRY",
        state: "OPEN",
        gradeEntryId: ownGradeId,
        gradeVersionAId: ownGradeA,
        gradeVersionBId: ownGradeB,
        shownGradeVersionId: ownGradeB,
      },
    });

    await expect(
      prisma.syncConflict.update({
        where: { id: conflictId },
        data: { gradeVersionBId: otherGradeVersion },
      }),
    ).rejects.toThrow(/grade conflict versions must belong to the same grade/);

    const stillOpen = await prisma.syncConflict.findUniqueOrThrow({ where: { id: conflictId } });
    expect(stillOpen.gradeVersionBId).toBe(ownGradeB);

    const resolvedFields = {
      state: "RESOLVED" as const,
      resolution: "MERGED" as const,
      resolvedAt: when,
      resolvedById: teacherId,
    };
    await expect(
      prisma.syncConflict.update({
        where: { id: conflictId },
        data: { ...resolvedFields, resolvedGradeVersionId: otherGradeVersion },
      }),
    ).rejects.toThrow(/grade resolution version must be a new copy of the same grade/);
    await expect(
      prisma.syncConflict.update({
        where: { id: conflictId },
        data: { ...resolvedFields, resolvedGradeVersionId: ownGradeA },
      }),
    ).rejects.toThrow(/grade resolution version must be a new copy of the same grade/);

    await prisma.syncConflict.update({
      where: { id: conflictId },
      data: { ...resolvedFields, resolvedGradeVersionId: ownGradeResolved },
    });
    const resolved = await prisma.syncConflict.findUniqueOrThrow({ where: { id: conflictId } });
    expect(resolved.state).toBe("RESOLVED");
    expect(resolved.resolvedGradeVersionId).toBe(ownGradeResolved);
    expect(resolved.gradeVersionAId).toBe(ownGradeA);
    expect(resolved.gradeVersionBId).toBe(ownGradeB);
  });

  it("accepts a note conflict on one record and rejects a version from another note", async () => {
    const conflictId = crypto.randomUUID();
    await expect(
      prisma.syncConflict.create({
        data: {
          id: conflictId,
          entityType: "PROGRESS_NOTE",
          state: "OPEN",
          progressNoteId: ownNoteId,
          noteVersionAId: ownNoteA,
          noteVersionBId: otherNoteVersion,
          shownNoteVersionId: ownNoteA,
        },
      }),
    ).rejects.toThrow(/note conflict versions must belong to the same note/);

    await prisma.syncConflict.create({
      data: {
        id: conflictId,
        entityType: "PROGRESS_NOTE",
        state: "OPEN",
        progressNoteId: ownNoteId,
        noteVersionAId: ownNoteA,
        noteVersionBId: ownNoteB,
        shownNoteVersionId: ownNoteA,
      },
    });

    const resolvedFields = {
      state: "RESOLVED" as const,
      resolution: "KEPT_LATER_RECEIVED" as const,
      resolvedAt: when,
      resolvedById: teacherId,
    };
    await expect(
      prisma.syncConflict.update({
        where: { id: conflictId },
        data: { ...resolvedFields, resolvedNoteVersionId: otherNoteVersion },
      }),
    ).rejects.toThrow(/note resolution version must be a new copy of the same note/);
    await expect(
      prisma.syncConflict.update({
        where: { id: conflictId },
        data: { ...resolvedFields, resolvedNoteVersionId: ownNoteB },
      }),
    ).rejects.toThrow(/note resolution version must be a new copy of the same note/);

    await prisma.syncConflict.update({
      where: { id: conflictId },
      data: { ...resolvedFields, resolvedNoteVersionId: ownNoteResolved },
    });
    const resolved = await prisma.syncConflict.findUniqueOrThrow({ where: { id: conflictId } });
    expect(resolved.state).toBe("RESOLVED");
    expect(resolved.resolvedNoteVersionId).toBe(ownNoteResolved);
    expect(resolved.noteVersionAId).toBe(ownNoteA);
    expect(resolved.noteVersionBId).toBe(ownNoteB);
  });
});
