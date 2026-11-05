import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/db";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("phase 1 demo database", () => {
  it("loads the synthetic center, people, and sections", async () => {
    const center = await prisma.center.findUnique({ where: { code: "DEMO" } });
    expect(center).not.toBeNull();
    expect(center?.timezone).toBe("UTC");

    const users = await prisma.user.groupBy({
      by: ["role"],
      where: { centerId: center?.id },
      _count: { _all: true },
    });
    const countFor = (role: string) =>
      users.find((row) => row.role === role)?._count._all ?? 0;

    expect(countFor("STUDENT")).toBe(30);
    expect(countFor("TEACHER")).toBe(3);
    expect(countFor("CENTER_DIRECTOR")).toBe(1);
    expect(countFor("ADMIN")).toBe(1);

    const studentsWithEmail = await prisma.user.count({
      where: { centerId: center?.id, role: "STUDENT", email: { not: null } },
    });
    expect(studentsWithEmail).toBe(0);

    expect(await prisma.section.count({ where: { course: { centerId: center?.id } } })).toBe(2);
    expect(await prisma.learnerProfile.count({ where: { centerId: center?.id } })).toBe(30);
    expect(await prisma.learnerOptionalContact.count()).toBe(0);

    const phonePolicy = await prisma.centerOptionalField.findFirst({
      where: { centerId: center?.id, fieldKey: "CONTACT_PHONE" },
    });
    expect(phonePolicy?.enabled).toBe(false);
  });

  it("keeps several weeks of attendance, grades, assignments, and resources", async () => {
    const center = await prisma.center.findUniqueOrThrow({ where: { code: "DEMO" } });
    expect(
      await prisma.attendanceRecord.count({ where: { learner: { centerId: center.id } } }),
    ).toBe(331);
    expect(await prisma.gradeEntry.count({ where: { learner: { centerId: center.id } } })).toBe(120);
    expect(await prisma.assignment.count({ where: { section: { course: { centerId: center.id } } } })).toBe(8);
    expect(await prisma.resource.count({ where: { course: { centerId: center.id } } })).toBe(6);
    expect(await prisma.classSession.count({ where: { section: { course: { centerId: center.id } } } })).toBe(24);
  });

  it("stores an attendance correction as a second row and trusts server receipt time", async () => {
    const rows = await prisma.attendanceRecord.findMany({
      where: { clientEventId: { in: ["demo-att-morning-2-4", "demo-att-morning-2-4-correction"] } },
      orderBy: { syncedAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.status).toBe("ABSENT");
    expect(rows[1]?.status).toBe("PRESENT");
    expect(rows[1]!.syncedAt.getTime()).toBeGreaterThan(rows[0]!.syncedAt.getTime());
    expect(rows[1]!.recordedAt.getTime()).toBeLessThan(rows[0]!.recordedAt.getTime());
  });

  it("rejects attendance edits and deletes, and rejects a repeated client event id", async () => {
    const sample = await prisma.attendanceRecord.findFirstOrThrow({
      where: { clientEventId: "demo-att-morning-2-4-correction" },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        const created = await tx.attendanceRecord.create({
          data: {
            id: "00000000-0000-4000-8000-00000000aa01",
            clientEventId: "test-rollback-attendance-update",
            learnerId: sample.learnerId,
            sessionId: sample.sessionId,
            status: "PRESENT",
            reasonCode: null,
            deviceId: sample.deviceId,
            recordedById: sample.recordedById,
            recordedAt: sample.recordedAt,
            syncedAt: sample.syncedAt,
            createdOffline: true,
          },
        });
        await tx.attendanceRecord.update({
          where: { id: created.id },
          data: { status: "LATE" },
        });
      }),
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.$transaction(async (tx) => {
        const created = await tx.attendanceRecord.create({
          data: {
            id: "00000000-0000-4000-8000-00000000aa02",
            clientEventId: "test-rollback-attendance-delete",
            learnerId: sample.learnerId,
            sessionId: sample.sessionId,
            status: "PRESENT",
            reasonCode: null,
            deviceId: sample.deviceId,
            recordedById: sample.recordedById,
            recordedAt: sample.recordedAt,
            syncedAt: sample.syncedAt,
            createdOffline: true,
          },
        });
        await tx.attendanceRecord.delete({ where: { id: created.id } });
      }),
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.attendanceRecord.create({
        data: {
          id: "00000000-0000-4000-8000-00000000aa03",
          clientEventId: sample.clientEventId,
          learnerId: sample.learnerId,
          sessionId: sample.sessionId,
          status: "LATE",
          reasonCode: null,
          deviceId: sample.deviceId,
          recordedById: sample.recordedById,
          recordedAt: sample.recordedAt,
          syncedAt: sample.syncedAt,
          createdOffline: false,
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const leftovers = await prisma.attendanceRecord.count({
      where: {
        clientEventId: {
          in: ["test-rollback-attendance-update", "test-rollback-attendance-delete"],
        },
      },
    });
    expect(leftovers).toBe(0);
  });

  it("keeps both sides of a grade conflict and shows the later-received version", async () => {
    const conflict = await prisma.syncConflict.findFirstOrThrow({
      where: { entityType: "GRADE_ENTRY", state: "OPEN" },
      include: {
        gradeEntry: true,
        gradeVersionA: true,
        gradeVersionB: true,
        shownGradeVersion: true,
      },
    });

    expect(conflict.resolution).toBeNull();
    expect(conflict.gradeVersionAId).not.toBe(conflict.gradeVersionBId);
    expect(conflict.progressNoteId).toBeNull();
    expect([conflict.gradeVersionAId, conflict.gradeVersionBId]).toContain(
      conflict.shownGradeVersionId,
    );

    const shown = conflict.shownGradeVersion;
    const hidden =
      shown?.id === conflict.gradeVersionA?.id ? conflict.gradeVersionB : conflict.gradeVersionA;
    expect(shown).not.toBeNull();
    expect(hidden).not.toBeNull();
    expect(shown!.syncedAt.getTime()).toBeGreaterThan(hidden!.syncedAt.getTime());
    expect(shown!.deviceRecordedAt.getTime()).toBeLessThan(hidden!.deviceRecordedAt.getTime());
    expect(Number(conflict.gradeEntry?.points)).toBe(Number(shown!.points));
    expect(conflict.gradeEntry?.deviceId).toBe(shown!.deviceId);
  });

  it("gives progress notes the same sync metadata as grades", async () => {
    const columns = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>
    >`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (
          'grade_entries',
          'progress_notes',
          'grade_entry_versions',
          'progress_note_versions'
        )
        AND column_name IN (
          'id',
          'deviceId',
          'versionVector',
          'deviceRecordedAt',
          'syncedAt',
          'createdOffline'
        )
    `;

    const syncColumns = [
      "id",
      "deviceId",
      "versionVector",
      "deviceRecordedAt",
      "syncedAt",
      "createdOffline",
    ];
    for (const column of syncColumns) {
      const grade = columns.find(
        (row) => row.table_name === "grade_entries" && row.column_name === column,
      );
      const note = columns.find(
        (row) => row.table_name === "progress_notes" && row.column_name === column,
      );
      expect(grade).toBeDefined();
      expect(note?.data_type).toBe(grade?.data_type);
      expect(note?.is_nullable).toBe(grade?.is_nullable);
    }

    const noteConflict = await prisma.syncConflict.findFirstOrThrow({
      where: { entityType: "PROGRESS_NOTE", state: "OPEN" },
      include: { progressNote: true, shownNoteVersion: true, noteVersionA: true, noteVersionB: true },
    });
    expect(noteConflict.noteVersionAId).not.toBe(noteConflict.noteVersionBId);
    expect(noteConflict.gradeEntryId).toBeNull();
    expect(noteConflict.shownNoteVersion?.body).toBe(noteConflict.progressNote?.body);
    expect(noteConflict.shownNoteVersion?.deviceId).toBe(noteConflict.progressNote?.deviceId);
    expect(noteConflict.progressNote?.versionVector).toEqual(noteConflict.shownNoteVersion?.versionVector);
  });

  it("stores submission metadata and keeps the file queue off the JSON sync queue", async () => {
    const submissions = await prisma.submission.findMany();
    expect(submissions.length).toBe(4);
    for (const submission of submissions) {
      expect(submission.storageKey.startsWith("private/")).toBe(true);
      expect(submission.storageKey.includes("http")).toBe(false);
      expect(submission.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(submission.byteSize).toBeGreaterThan(0);
      expect(submission.mimeType).toBe("image/jpeg");
    }
    expect(submissions.filter((row) => row.uploadState === "QUEUED")).toHaveLength(1);
    expect(await prisma.fileUploadQueueItem.count()).toBe(submissions.length);

    const queueColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'file_upload_queue'
    `;
    expect(queueColumns.map((row) => row.column_name)).not.toContain("batchId");

    const crossLinks = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT tc.table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND (
          (tc.table_name = 'file_upload_queue' AND ccu.table_name IN ('json_sync_batches', 'json_sync_items'))
          OR
          (tc.table_name IN ('json_sync_batches', 'json_sync_items') AND ccu.table_name = 'file_upload_queue')
        )
    `;
    expect(crossLinks).toEqual([]);

    const bytea = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND udt_name = 'bytea'
    `;
    expect(bytea).toEqual([]);
  });

  it("does not have columns for addresses, identity documents, or birth dates", async () => {
    const forbidden = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name ~* '(address|passport|immigration|birthdate|date_of_birth|identity_document|legal_status|(^|_)ssn($|_))'
    `;
    expect(forbidden).toEqual([]);
  });
});
