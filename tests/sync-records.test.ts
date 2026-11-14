import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isCurrentAssignment } from "../lib/auth/assignments";
import type { Actor, RoleName } from "../lib/auth/permissions";
import { resolveConflict } from "../lib/data/conflicts";
import { acceptRecordBatch } from "../lib/data/sync-records";
import { prisma } from "../lib/db";
import { assertConnectedTestDatabase } from "../lib/test-db/connect";
import { incrementDeviceCounter, mergeVersionVectors, parseVersionVector } from "../lib/sync/version-vector";

// Exact fixture markers. A timed-out setup can commit a row and then keep
// running after Vitest has moved on, so cleanup cannot depend on ids that
// were never stored. These values are the whole fixture, not a name prefix.
const DEMO_CENTER_CODE = "DEMO";
const MORNING_SECTION_NAME = "Morning Group";
const DEMO_QUIZ_TITLE = "Day9 synthetic quiz";
const FOREIGN_CENTER_CODE = "SYNC-TEST-DAY9";
const STAFF_EMAILS = [
  "teacher.one@demo.invalid",
  "teacher.two@demo.invalid",
  "director@demo.invalid",
  "admin@demo.invalid",
] as const;

// Same columns loadActor() reads. Building the actor here avoids a second
// query per person. The local database serves one query at a time.
const actorSelect = {
  id: true,
  role: true,
  centerId: true,
  active: true,
  displayName: true,
  learnerProfile: {
    select: {
      id: true,
      displayName: true,
      enrollments: { where: { status: "ACTIVE" as const }, select: { sectionId: true } },
    },
  },
  sectionAssignments: { select: { sectionId: true, startsOn: true, endsOn: true } },
};

const holder = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/lib/auth/session", () => ({
  readSessionUserId: async () => holder.userId,
}));

import { POST as postAttendance } from "../app/api/sync/route";
import { POST as postRecords } from "../app/api/sync/records/route";

const earlyClock = "2001-01-01T00:00:00.000Z";
const lateClock = "2099-01-01T00:00:00.000Z";
const phoneIds = new Set<string>();
const skillTagIds = new Set<string>();

let morningId = "";
let learnerId = "";
let assignmentId = "";
let teacherOne: Actor;
let teacherTwo: Actor;
let director: Actor;
let admin: Actor;
let learner: Actor;
let foreignAssignmentId = "";
let foreignDeviceId = "";

function phone(): string {
  const id = crypto.randomUUID();
  phoneIds.add(id);
  return id;
}

function gradeMutation(
  clientMutationId: string,
  deviceId: string,
  recordId: string,
  vector: Record<string, number>,
  points: string,
  recordedAt = earlyClock,
  academicNote: string | null = null,
) {
  return {
    entityType: "GRADE_ENTRY" as const,
    clientMutationId,
    recordId,
    assignmentId,
    learnerId,
    points,
    academicNote,
    versionVector: vector,
    deviceRecordedAt: recordedAt,
    createdOffline: true,
  };
}

function noteMutation(
  clientMutationId: string,
  deviceId: string,
  recordId: string,
  vector: Record<string, number>,
  body: string,
  skillGaps: string[],
  customSkillLabel: string | null,
  customSkillTagId: string | null = null,
  recordedAt = earlyClock,
) {
  void deviceId;
  return {
    entityType: "PROGRESS_NOTE" as const,
    clientMutationId,
    recordId,
    sectionId: morningId,
    learnerId,
    body,
    skillGaps,
    customSkillLabel,
    customSkillTagId,
    versionVector: vector,
    deviceRecordedAt: recordedAt,
    createdOffline: true,
  };
}

function envelope(localDeviceId: string, mutations: unknown[]) {
  return { version: 1 as const, localDeviceId, mutations };
}

async function send(actor: Actor, localDeviceId: string, mutations: unknown[]) {
  return acceptRecordBatch(actor, envelope(localDeviceId, mutations), 200);
}

function resultsOf(body: unknown) {
  return (body as { results: { clientMutationId: string; outcome: string; code?: string; recordId?: string; conflictId?: string }[] }).results;
}

type ActorRow = {
  id: string;
  role: RoleName;
  centerId: string;
  active: boolean;
  displayName: string | null;
  learnerProfile: {
    id: string;
    displayName: string;
    enrollments: { sectionId: string }[];
  } | null;
  sectionAssignments: { sectionId: string; startsOn: Date; endsOn: Date | null }[];
};

// A Prisma code such as P2028, or a plain error name. Never the message:
// messages can contain the query and the row that failed.
function safeFailureLabel(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^P\d{4}$/.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)) return error.name;
  return "Error";
}

// Temporary. One line per step: label, milliseconds, and PASS or FAIL.
// A failure adds only the safe label above. Row values stay out of the log.
async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const value = await run();
    console.log(`[sync-records-test] ${label} ${Date.now() - started}ms PASS`);
    return value;
  } catch (error) {
    console.log(`[sync-records-test] ${label} ${Date.now() - started}ms FAIL ${safeFailureLabel(error)}`);
    throw error;
  }
}

function toActor(user: ActorRow, label: string): Actor {
  if (!user.active) throw new Error(`missing actor ${label}`);
  const now = new Date();
  const assignedSectionIds =
    user.role === "TEACHER"
      ? user.sectionAssignments
          .filter((row) => isCurrentAssignment(row.startsOn, row.endsOn, now))
          .map((row) => row.sectionId)
      : [];
  return {
    id: user.id,
    role: user.role,
    centerId: user.centerId,
    active: user.active,
    displayName: user.learnerProfile?.displayName ?? user.displayName ?? "Account",
    learnerId: user.learnerProfile?.id ?? null,
    assignedSectionIds,
    enrolledSectionIds: user.learnerProfile?.enrollments.map((row) => row.sectionId) ?? [],
  };
}

async function morningSectionId(): Promise<string | null> {
  if (morningId) return morningId;
  const section = await prisma.section.findFirst({
    where: {
      name: MORNING_SECTION_NAME,
      course: { center: { code: DEMO_CENTER_CODE } },
    },
    select: { id: true },
  });
  if (!section) return null;
  morningId = section.id;
  return section.id;
}

async function findDemoQuizIds(): Promise<string[]> {
  const sectionId = await morningSectionId();
  if (!sectionId) return [];
  const rows = await prisma.assignment.findMany({
    where: { sectionId, title: DEMO_QUIZ_TITLE },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

// Conflicts point at versions, and versions point at the grade or note.
// Audit rows and versions are append-only unless this same transaction
// allows a demo reset. Skip the transaction when there is nothing to delete:
// turning the switch on still costs a round trip on the one local connection.
async function deleteProtectedRows(gradeIds: string[], noteIds: string[]) {
  if (gradeIds.length === 0 && noteIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    const filters = [
      ...(gradeIds.length > 0 ? [{ gradeEntryId: { in: gradeIds } }] : []),
      ...(noteIds.length > 0 ? [{ progressNoteId: { in: noteIds } }] : []),
    ];
    await tx.syncConflict.deleteMany({ where: { OR: filters } });
    const entityIds = [...gradeIds, ...noteIds];
    await tx.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
    if (gradeIds.length > 0) {
      await tx.gradeEntryVersion.deleteMany({ where: { gradeEntryId: { in: gradeIds } } });
    }
    if (noteIds.length > 0) {
      await tx.progressNoteVersion.deleteMany({ where: { progressNoteId: { in: noteIds } } });
    }
    if (gradeIds.length > 0) await tx.gradeEntry.deleteMany({ where: { id: { in: gradeIds } } });
    if (noteIds.length > 0) await tx.progressNote.deleteMany({ where: { id: { in: noteIds } } });
  });
}

async function clearRecords(knownQuizIds?: string[]) {
  await timed("cleanup.records", () => clearRecordRows(knownQuizIds));
}

async function clearRecordRows(knownQuizIds?: string[]) {
  await assertConnectedTestDatabase();
  const quizIds = knownQuizIds ?? (assignmentId ? [assignmentId] : await findDemoQuizIds());
  const sectionId = await morningSectionId();
  const grades =
    quizIds.length > 0
      ? await prisma.gradeEntry.findMany({
          where: { assignmentId: { in: quizIds } },
          select: { id: true },
        })
      : [];
  // "Day9 " is the body this file writes. Limited to Morning Group so a note
  // with the same opening words in another section is left alone.
  const notes = sectionId
    ? await prisma.progressNote.findMany({
        where: { sectionId, body: { startsWith: "Day9 " } },
        select: { id: true },
      })
    : [];
  const deviceIds = [...phoneIds];
  // The day9- prefix is cleared even when no fixture id was stored.
  // Phone ids are only devices this file created.
  await prisma.jsonSyncItem.deleteMany({
    where: {
      OR: [
        { clientMutationId: { startsWith: "day9-" } },
        ...(deviceIds.length > 0 ? [{ deviceId: { in: deviceIds } }] : []),
      ],
    },
  });
  if (deviceIds.length > 0) {
    await prisma.jsonSyncBatch.deleteMany({ where: { deviceId: { in: deviceIds } } });
  }
  await deleteProtectedRows(
    grades.map((row) => row.id),
    notes.map((row) => row.id),
  );
}

// Child rows block the center delete. Order follows the foreign keys.
// The center is found by its code, so this still works when setup timed out
// before foreignCenterId was stored.
async function removeForeignCenter() {
  await assertConnectedTestDatabase();
  const center = await prisma.center.findUnique({
    where: { code: FOREIGN_CENTER_CODE },
    select: { id: true },
  });
  if (!center) return;
  const centerId = center.id;
  const grades = await prisma.gradeEntry.findMany({
    where: { assignment: { section: { course: { centerId } } } },
    select: { id: true },
  });
  await deleteProtectedRows(
    grades.map((row) => row.id),
    [],
  );
  await prisma.jsonSyncItem.deleteMany({ where: { device: { centerId } } });
  await prisma.jsonSyncBatch.deleteMany({ where: { centerId } });
  await prisma.assignment.deleteMany({ where: { section: { course: { centerId } } } });
  await prisma.section.deleteMany({ where: { course: { centerId } } });
  await prisma.course.deleteMany({ where: { centerId } });
  await prisma.device.deleteMany({ where: { centerId } });
  await prisma.user.deleteMany({ where: { centerId } });
  await prisma.center.delete({ where: { id: centerId } });
}

describe("grade and note conflict sync", () => {
  // The foreign-center removal measured 12 seconds. These two hooks alone
  // get 30 seconds. The default 10 seconds starts cleanup while setup still
  // holds the only database connection. Test timeouts stay at 30 seconds.
  beforeAll(async () => {
    // Separate indexed reads. One join through the section, its learners, and
    // the learner's account held the only local connection until the worker quit.
    const section = await timed("setup.morning-section", () =>
      prisma.section.findFirstOrThrow({
        where: { name: MORNING_SECTION_NAME, course: { center: { code: DEMO_CENTER_CODE } } },
        select: { id: true },
      }),
    );
    morningId = section.id;

    // First active enrollment, with no extra filter. This person can differ
    // from the signed-in learner loaded below.
    const enrollment = await timed("setup.enrollment", async () => {
      const row = await prisma.enrollment.findFirst({
        where: { sectionId: morningId, status: "ACTIVE" },
        select: { learnerId: true },
      });
      if (!row) throw new Error("missing learner");
      return row;
    });
    learnerId = enrollment.learnerId;

    await timed("setup.actors", async () => {
      const people = await prisma.user.findMany({
        where: {
          center: { code: DEMO_CENTER_CODE },
          OR: [
            { email: { in: [...STAFF_EMAILS] } },
            { learnerProfile: { is: { learnerCode: "LNR-0001" } } },
          ],
        },
        select: {
          email: true,
          ...actorSelect,
          learnerProfile: {
            select: {
              id: true,
              learnerCode: true,
              displayName: true,
              enrollments: { where: { status: "ACTIVE" as const }, select: { sectionId: true } },
            },
          },
        },
      });
      const learnerRow = people.find((row) => row.learnerProfile?.learnerCode === "LNR-0001");
      if (!learnerRow) throw new Error("missing learner");
      learner = toActor(learnerRow, "learner");
      const byEmail = new Map(people.flatMap((row) => (row.email ? [[row.email, row] as const] : [])));
      const requireStaff = (email: (typeof STAFF_EMAILS)[number]) => {
        const user = byEmail.get(email);
        if (!user) throw new Error(`missing actor ${email}`);
        return toActor(user, email);
      };
      teacherOne = requireStaff("teacher.one@demo.invalid");
      teacherTwo = requireStaff("teacher.two@demo.invalid");
      director = requireStaff("director@demo.invalid");
      admin = requireStaff("admin@demo.invalid");
    });

    const existingQuizIds = await timed("setup.demo-quiz-lookup", () => findDemoQuizIds());
    if (existingQuizIds.length > 0) {
      assignmentId = existingQuizIds[0] ?? "";
    } else {
      const assignment = await timed("setup.demo-quiz-create", () =>
        prisma.assignment.create({
          data: {
            sectionId: morningId,
            title: DEMO_QUIZ_TITLE,
            kind: "PAPER",
            maxPoints: "20.00",
            createdById: teacherOne.id,
          },
          select: { id: true },
        }),
      );
      assignmentId = assignment.id;
    }

    // Remove a center left behind by a setup that timed out after committing.
    await timed("setup.foreign-center-remove", () => removeForeignCenter());
    const centerId = crypto.randomUUID();
    const teacherId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    // One nested create is one transaction, so a timeout cannot leave half of
    // this center committed. Prisma still inserts each row inside that
    // transaction (center, teacher, course, section, assignment, device).
    // That is six statements and one commit, not one SQL statement.
    await timed("setup.foreign-center-create", async () => {
    const created = await prisma.center.create({
      data: {
        id: centerId,
        name: "Day9 sync center",
        code: FOREIGN_CENTER_CODE,
        timezone: "UTC",
        devices: { create: { id: deviceId, label: "Offline phone" } },
        courses: {
          create: {
            title: "Day9 course",
            code: "DAY9",
            academicYear: 2099,
            semester: "SEMESTER_1",
            sections: {
              create: {
                name: "Day9 group",
                assignments: {
                  create: {
                    title: "Day9 foreign quiz",
                    kind: "PAPER",
                    maxPoints: "10.00",
                    createdBy: {
                      create: {
                        id: teacherId,
                        role: "TEACHER",
                        email: "day9-foreign@demo.invalid",
                        passwordHash: "day9-not-a-password",
                        displayName: "Day9 Foreign",
                        center: { connect: { id: centerId } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: {
        devices: { select: { id: true } },
        courses: { select: { sections: { select: { assignments: { select: { id: true } } } } } },
      },
    });
    foreignDeviceId = created.devices[0]?.id ?? "";
    foreignAssignmentId = created.courses[0]?.sections[0]?.assignments[0]?.id ?? "";
    if (!foreignDeviceId || !foreignAssignmentId) throw new Error("missing foreign fixture");
    });
  }, 30_000);

  beforeEach(async () => {
    await clearRecords();
  });

  // A failed cleanup used to skip the disconnect and leave the only connection
  // open. The local database does not close idle connections on its own.
  afterAll(async () => {
    try {
      await assertConnectedTestDatabase();
      const quizIds = await timed("cleanup.demo-quiz-lookup", () => findDemoQuizIds());
      await clearRecords(quizIds);
      // This run's tags are deleted by the ids stored above. An earlier
      // interrupted run can only be found by name. "Retry tag" plus eight hex
      // characters is unique to this file. "Map reading" and "Shape sense"
      // are also used by the skill-tag tests, so those names are not scanned.
      await timed("cleanup.skill-tags", async () => {
        const leftovers = await prisma.centerSkillTag.findMany({
          where: {
            center: { code: DEMO_CENTER_CODE },
            name: { startsWith: "Retry tag " },
          },
          select: { id: true, name: true },
        });
        const retryTagName = /^Retry tag [0-9a-f]{8}$/i;
        for (const row of leftovers) {
          if (retryTagName.test(row.name)) skillTagIds.add(row.id);
        }
        const tagIds = [...skillTagIds];
        if (tagIds.length === 0) return;
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
          await tx.auditLog.deleteMany({ where: { entityId: { in: tagIds } } });
        });
        await prisma.centerSkillTag.deleteMany({ where: { id: { in: tagIds } } });
      });
      await timed("cleanup.demo-quiz", async () => {
        if (!morningId || quizIds.length === 0) return;
        await prisma.assignment.deleteMany({
          where: { id: { in: quizIds }, title: DEMO_QUIZ_TITLE, sectionId: morningId },
        });
      });
      // Sync rows for these phones were removed in clearRecords. Grades that
      // pointed at them were removed there too, so the phones can go next.
      await timed("cleanup.phones", async () => {
        const ids = [...phoneIds];
        if (ids.length === 0) return;
        await prisma.device.deleteMany({ where: { id: { in: ids } } });
      });
      await timed("cleanup.foreign-center", () => removeForeignCenter());
    } finally {
      await timed("cleanup.disconnect", () => prisma.$disconnect());
    }
  }, 30_000);

  it("accepts a later edit and keeps the earlier grade", async () => {
    const deviceA = phone();
    const recordId = crypto.randomUUID();
    const first = await send(teacherOne, deviceA, [gradeMutation("day9-normal-1", deviceA, recordId, { [deviceA]: 1 }, "10.00")]);
    const second = await send(teacherOne, deviceA, [gradeMutation("day9-normal-2", deviceA, recordId, { [deviceA]: 2 }, "12.00", earlyClock, "checked")]);
    expect(resultsOf(first.body)).toMatchObject([{ outcome: "accepted" }]);
    expect(resultsOf(second.body)).toMatchObject([{ outcome: "accepted" }]);
    const grade = await prisma.gradeEntry.findUniqueOrThrow({ where: { id: recordId } });
    const versions = await prisma.gradeEntryVersion.findMany({ where: { gradeEntryId: recordId }, orderBy: { syncedAt: "asc" } });
    expect(Number(grade.points)).toBe(12);
    expect(grade.academicNote).toBe("checked");
    expect(versions.map((version) => Number(version.points))).toEqual([10, 12]);
    expect(grade.recordedById).toBe(teacherOne.id);
  });

  it("keeps both grade versions when two phones edit together", async () => {
    const deviceA = phone();
    const deviceB = phone();
    const recordId = crypto.randomUUID();
    const first = await send(teacherOne, deviceA, [gradeMutation("day9-grade-a", deviceA, recordId, { [deviceA]: 1 }, "16.00", lateClock)]);
    const second = await send(teacherOne, deviceB, [gradeMutation("day9-grade-b", deviceB, recordId, { [deviceB]: 1 }, "14.00", earlyClock)]);
    expect(resultsOf(first.body)[0]?.outcome).toBe("accepted");
    expect(resultsOf(second.body)[0]).toMatchObject({ outcome: "conflict", code: "concurrent" });
    const grade = await prisma.gradeEntry.findUniqueOrThrow({ where: { id: recordId } });
    const versions = await prisma.gradeEntryVersion.findMany({ where: { gradeEntryId: recordId } });
    const conflict = await prisma.syncConflict.findFirstOrThrow({
      where: { gradeEntryId: recordId, state: "OPEN" },
      include: { shownGradeVersion: true, gradeVersionA: true, gradeVersionB: true },
    });
    expect(versions).toHaveLength(2);
    expect(versions.map((version) => Number(version.points)).sort((a, b) => a - b)).toEqual([14, 16]);
    expect(Number(grade.points)).toBe(14);
    expect(Number(conflict.shownGradeVersion?.points)).toBe(14);
    expect(conflict.shownGradeVersion?.deviceRecordedAt.toISOString()).toBe(earlyClock);
    expect(conflict.gradeVersionAId).not.toBe(conflict.gradeVersionBId);
    expect(conflict.shownGradeVersion && conflict.shownGradeVersion.syncedAt.getTime()).toBeGreaterThan(
      Math.min(conflict.gradeVersionA!.syncedAt.getTime(), conflict.gradeVersionB!.syncedAt.getTime()),
    );
  });

  it("keeps both progress-note versions, including body and skill gaps", async () => {
    const deviceA = phone();
    const deviceB = phone();
    const recordId = crypto.randomUUID();
    const tag = await prisma.centerSkillTag.create({
      data: { centerId: teacherOne.centerId, name: `Map reading ${recordId.slice(0, 8)}`, active: true },
      select: { id: true, name: true },
    });
    skillTagIds.add(tag.id);
    const first = await send(teacherOne, deviceA, [
      noteMutation("day9-note-a", deviceA, recordId, { [deviceA]: 1 }, "Day9 reading is uneven", ["READING"], null, null, lateClock),
    ]);
    const second = await send(teacherOne, deviceB, [
      noteMutation("day9-note-b", deviceB, recordId, { [deviceB]: 1 }, "Day9 needs number sense", ["NUMBER_SENSE", "CUSTOM"], null, tag.id, earlyClock),
    ]);
    expect(resultsOf(first.body)[0]?.outcome).toBe("accepted");
    expect(resultsOf(second.body)[0]?.outcome).toBe("conflict");
    const note = await prisma.progressNote.findUniqueOrThrow({ where: { id: recordId } });
    const versions = await prisma.progressNoteVersion.findMany({ where: { progressNoteId: recordId } });
    const conflict = await prisma.syncConflict.findFirstOrThrow({
      where: { progressNoteId: recordId, state: "OPEN" },
      include: { shownNoteVersion: true },
    });
    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.body).sort()).toEqual(["Day9 needs number sense", "Day9 reading is uneven"]);
    expect(note.body).toBe("Day9 needs number sense");
    expect(note.skillGaps).toEqual(expect.arrayContaining(["NUMBER_SENSE", "CUSTOM"]));
    expect(note.customSkillLabel).toBeNull();
    expect(note.customSkillTagId).toBe(tag.id);
    expect(conflict.shownNoteVersion?.body).toBe("Day9 needs number sense");
    expect(conflict.shownNoteVersion?.deviceRecordedAt.toISOString()).toBe(earlyClock);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: recordId, action: "UPDATE" } });
    expect(JSON.stringify(audit.metadata)).not.toContain(tag.name);
    expect(JSON.stringify(audit.metadata)).not.toContain("Day9");
  });

  it("does not create another version when the same mutation is sent twice", async () => {
    const deviceA = phone();
    const recordId = crypto.randomUUID();
    const mutation = gradeMutation("day9-repeat", deviceA, recordId, { [deviceA]: 1 }, "10.00");
    const first = await send(teacherOne, deviceA, [mutation]);
    const second = await send(teacherOne, deviceA, [mutation]);
    expect(resultsOf(first.body)[0]?.outcome).toBe("accepted");
    expect(resultsOf(second.body)[0]?.outcome).toBe("already_accepted");
    expect(await prisma.gradeEntryVersion.count({ where: { gradeEntryId: recordId } })).toBe(1);
    expect(await prisma.syncConflict.count({ where: { gradeEntryId: recordId } })).toBe(0);
    const changed = await send(teacherOne, deviceA, [gradeMutation("day9-repeat", deviceA, recordId, { [deviceA]: 1 }, "18.00")]);
    expect(resultsOf(changed.body)[0]).toMatchObject({ outcome: "rejected", code: "mutation_mismatch" });
    expect(Number((await prisma.gradeEntry.findUniqueOrThrow({ where: { id: recordId } })).points)).toBe(10);
    expect(await prisma.gradeEntryVersion.count({ where: { gradeEntryId: recordId } })).toBe(1);
  });

  it("treats equal vectors as already known, and refuses different content", async () => {
    const deviceA = phone();
    const recordId = crypto.randomUUID();
    await send(teacherOne, deviceA, [gradeMutation("day9-equal-1", deviceA, recordId, { [deviceA]: 1 }, "10.00")]);
    const same = await send(teacherOne, deviceA, [gradeMutation("day9-equal-2", deviceA, recordId, { [deviceA]: 1 }, "10")]);
    const different = await send(teacherOne, deviceA, [gradeMutation("day9-equal-3", deviceA, recordId, { [deviceA]: 1 }, "11.00")]);
    expect(resultsOf(same.body)[0]?.outcome).toBe("already_accepted");
    expect(resultsOf(different.body)[0]).toMatchObject({ outcome: "rejected", code: "invalid_counter" });
    expect(Number((await prisma.gradeEntry.findUniqueOrThrow({ where: { id: recordId } })).points)).toBe(10);
    expect(await prisma.gradeEntryVersion.count({ where: { gradeEntryId: recordId } })).toBe(1);
  });

  it("resolves a conflict and then accepts a later edit", async () => {
    const deviceA = phone();
    const deviceB = phone();
    const resolver = phone();
    const recordId = crypto.randomUUID();
    await send(teacherOne, deviceA, [gradeMutation("day9-resolve-a", deviceA, recordId, { [deviceA]: 1 }, "16.00", lateClock)]);
    const conflicted = await send(teacherOne, deviceB, [gradeMutation("day9-resolve-b", deviceB, recordId, { [deviceB]: 1 }, "14.00", earlyClock)]);
    const conflictId = resultsOf(conflicted.body)[0]?.conflictId ?? "";
    const resolved = await resolveConflict(teacherOne, { conflictId, localDeviceId: resolver, choice: "shown" });
    expect(resolved.ok).toBe(true);
    const conflict = await prisma.syncConflict.findUniqueOrThrow({ where: { id: conflictId }, include: { resolvedGradeVersion: true } });
    expect(conflict.state).toBe("RESOLVED");
    expect(conflict.resolution).toBe("KEPT_LATER_RECEIVED");
    expect(conflict.resolvedById).toBe(teacherOne.id);
    expect(conflict.resolvedAt).toBeTruthy();
    expect(conflict.resolvedGradeVersionId).toBeTruthy();
    expect(conflict.resolvedGradeVersionId).not.toBe(conflict.gradeVersionAId);
    expect(conflict.resolvedGradeVersionId).not.toBe(conflict.gradeVersionBId);
    const storedVector = parseVersionVector(conflict.resolvedGradeVersion?.versionVector);
    const expected = incrementDeviceCounter(mergeVersionVectors(parseVersionVector({ [deviceA]: 1 })!, parseVersionVector({ [deviceB]: 1 })!), resolver);
    expect(storedVector).toEqual(expected);
    const originals = await prisma.gradeEntryVersion.findMany({ where: { id: { in: [conflict.gradeVersionAId!, conflict.gradeVersionBId!] } } });
    expect(originals.map((version) => Number(version.points)).sort((a, b) => a - b)).toEqual([14, 16]);

    const laterVector = incrementDeviceCounter(expected!, deviceA);
    const later = await send(teacherOne, deviceA, [gradeMutation("day9-resolve-later", deviceA, recordId, laterVector!, "15.00")]);
    expect(resultsOf(later.body)[0]?.outcome).toBe("accepted");
    expect(await prisma.syncConflict.count({ where: { gradeEntryId: recordId, state: "OPEN" } })).toBe(0);
    expect(Number((await prisma.gradeEntry.findUniqueOrThrow({ where: { id: recordId } })).points)).toBe(15);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: recordId, action: "RESOLVE_CONFLICT" } });
    expect(audit.actorId).toBe(teacherOne.id);
    expect(audit.metadata).toEqual({
      conflictId,
      resolution: "KEPT_LATER_RECEIVED",
      resolvedVersionId: conflict.resolvedGradeVersionId,
    });
  });

  it("keeps a valid edit when another edit in the same upload is invalid", async () => {
    const deviceA = phone();
    const recordId = crypto.randomUUID();
    const response = await send(teacherOne, deviceA, [
      gradeMutation("day9-partial-ok", deviceA, recordId, { [deviceA]: 1 }, "9.00"),
      { ...gradeMutation("day9-partial-bad", deviceA, crypto.randomUUID(), { "not-a-device": 1 }, "8.00") },
    ]);
    expect(response.status).toBe(200);
    expect(resultsOf(response.body).map((result) => result.outcome)).toEqual(["accepted", "rejected"]);
    expect(await prisma.gradeEntry.count({ where: { assignmentId } })).toBe(1);
    const again = await send(teacherOne, deviceA, [
      gradeMutation("day9-partial-ok", deviceA, recordId, { [deviceA]: 1 }, "9.00"),
      { ...gradeMutation("day9-partial-bad", deviceA, crypto.randomUUID(), { "not-a-device": 1 }, "8.00") },
    ]);
    expect(resultsOf(again.body)[0]?.outcome).toBe("already_accepted");
    expect(await prisma.gradeEntryVersion.count({ where: { gradeEntry: { assignmentId } } })).toBe(1);
  });

  it("applies one copy of a mutation when two requests arrive together", async () => {
    const deviceA = phone();
    const recordId = crypto.randomUUID();
    const mutation = gradeMutation("day9-race", deviceA, recordId, { [deviceA]: 1 }, "7.00");
    const [first, second] = await Promise.all([send(teacherOne, deviceA, [mutation]), send(teacherOne, deviceA, [mutation])]);
    const outcomes = [resultsOf(first.body)[0]?.outcome, resultsOf(second.body)[0]?.outcome].sort();
    expect(outcomes).toEqual(["accepted", "already_accepted"]);
    expect(await prisma.gradeEntryVersion.count({ where: { gradeEntryId: recordId } })).toBe(1);
  });

  it("refuses learners, directors, admins, unassigned teachers, and other centers", async () => {
    const deviceA = phone();
    const recordId = crypto.randomUUID();
    const mutation = gradeMutation("day9-forbid", deviceA, recordId, { [deviceA]: 1 }, "6.00");
    expect((await send(learner, deviceA, [mutation])).status).toBe(403);
    expect((await send(director, deviceA, [mutation])).status).toBe(403);
    expect((await send(admin, deviceA, [mutation])).status).toBe(403);
    const unassigned = await send(teacherTwo, phone(), [mutation]);
    expect(resultsOf(unassigned.body)[0]?.code).toBe("forbidden");
    const otherCenter = await send(teacherOne, phone(), [
      { ...mutation, clientMutationId: "day9-other-center", assignmentId: foreignAssignmentId },
    ]);
    expect(resultsOf(otherCenter.body)[0]?.code).toBe("wrong_center");
    const wrongDevice = await send(teacherOne, foreignDeviceId, [gradeMutation("day9-wrong-device", foreignDeviceId, recordId, { [foreignDeviceId]: 1 }, "6.00")]);
    expect(wrongDevice.status).toBe(403);
    expect(await prisma.gradeEntry.count({ where: { assignmentId } })).toBe(0);

    const owned = phone();
    const otherPhone = phone();
    const ownedRecord = crypto.randomUUID();
    await send(teacherOne, owned, [gradeMutation("day9-auth-a", owned, ownedRecord, { [owned]: 1 }, "5.00")]);
    const opened = await send(teacherOne, otherPhone, [gradeMutation("day9-auth-b", otherPhone, ownedRecord, { [otherPhone]: 1 }, "4.00")]);
    expect(resultsOf(opened.body)[0]?.outcome).toBe("conflict");
    const conflictId = resultsOf(opened.body)[0]?.conflictId ?? "";
    for (const actor of [learner, director, admin, teacherTwo]) {
      const result = await resolveConflict(actor, { conflictId, localDeviceId: phone(), choice: "shown" });
      expect(result.ok).toBe(false);
    }
    const still = await prisma.syncConflict.findUniqueOrThrow({ where: { id: conflictId } });
    expect(still.state).toBe("OPEN");
  });

  it("refuses a typed custom label and records one audit when a tag note is retried", async () => {
    const deviceA = phone();
    const typed = await send(teacherOne, deviceA, [
      noteMutation("day9-typed", deviceA, crypto.randomUUID(), { [deviceA]: 1 }, "Day9 typed label", ["CUSTOM"], "family story", null),
    ]);
    expect(resultsOf(typed.body)[0]).toMatchObject({ outcome: "rejected", code: "invalid_note" });
    expect(await prisma.progressNote.count({ where: { body: "Day9 typed label" } })).toBe(0);

    const tag = await prisma.centerSkillTag.create({
      data: { centerId: teacherOne.centerId, name: `Retry tag ${crypto.randomUUID().slice(0, 8)}`, active: true },
      select: { id: true },
    });
    skillTagIds.add(tag.id);
    const recordId = crypto.randomUUID();
    const mutation = noteMutation("day9-note-retry", deviceA, recordId, { [deviceA]: 1 }, "Day9 retry note", ["CUSTOM"], null, tag.id);
    const first = await send(teacherOne, deviceA, [mutation]);
    const second = await send(teacherOne, deviceA, [mutation]);
    expect(resultsOf(first.body)[0]?.outcome).toBe("accepted");
    expect(resultsOf(second.body)[0]?.outcome).toBe("already_accepted");
    expect(await prisma.progressNoteVersion.count({ where: { progressNoteId: recordId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: recordId, action: "CREATE" } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: recordId, action: "CREATE" } });
    expect(JSON.stringify(audit.metadata)).not.toContain("Day9");
    expect(audit.actorId).toBe(teacherOne.id);
  });

  it("records one server-timed update audit for a normal progress-note edit", async () => {
    const deviceA = phone();
    const recordId = crypto.randomUUID();
    const tag = await prisma.centerSkillTag.create({
      data: { centerId: teacherOne.centerId, name: `Map reading ${recordId.slice(0, 8)}`, active: true },
      select: { id: true, name: true },
    });
    skillTagIds.add(tag.id);
    const profile = await prisma.learnerProfile.findUniqueOrThrow({
      where: { id: learnerId },
      select: { learnerCode: true, displayName: true },
    });
    const created = await send(teacherOne, deviceA, [
      noteMutation("day9-note-edit-create", deviceA, recordId, { [deviceA]: 1 }, "Day9 first wording", ["READING"], null, null),
    ]);
    expect(resultsOf(created.body)[0]?.outcome).toBe("accepted");

    const before = new Date();
    const edited = await send(teacherOne, deviceA, [
      noteMutation(
        "day9-note-edit-update",
        deviceA,
        recordId,
        { [deviceA]: 2 },
        "Day9 revised wording",
        ["READING", "CUSTOM"],
        null,
        tag.id,
      ),
    ]);
    expect(resultsOf(edited.body)[0]?.outcome).toBe("accepted");
    expect(await prisma.syncConflict.count({ where: { progressNoteId: recordId } })).toBe(0);

    const updates = await prisma.auditLog.findMany({
      where: { entityId: recordId, entityType: "PROGRESS_NOTE", action: "UPDATE" },
    });
    expect(updates).toHaveLength(1);
    const audit = updates[0];
    expect(audit?.actorId).toBe(teacherOne.id);
    expect(audit?.at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
    expect(audit!.at.getTime()).toBeLessThanOrEqual(Date.now() + 5000);
    expect(audit?.at.toISOString()).not.toBe(earlyClock);
    expect(audit?.metadata).toEqual({ source: "record-sync", clientMutationId: "day9-note-edit-update" });
    const meta = JSON.stringify(audit?.metadata);
    expect(meta).not.toContain("Day9 revised wording");
    expect(meta).not.toContain("Day9 first wording");
    expect(meta).not.toContain(tag.name);
    expect(meta).not.toContain(profile.learnerCode);
    expect(meta).not.toContain(profile.displayName);
  });

  it("records one resolution audit for a progress-note conflict and skips an unauthorized attempt", async () => {
    const deviceA = phone();
    const deviceB = phone();
    const recordId = crypto.randomUUID();
    const tag = await prisma.centerSkillTag.create({
      data: { centerId: teacherOne.centerId, name: `Map reading ${recordId.slice(0, 8)}`, active: true },
      select: { id: true, name: true },
    });
    skillTagIds.add(tag.id);
    const profile = await prisma.learnerProfile.findUniqueOrThrow({
      where: { id: learnerId },
      select: { learnerCode: true, displayName: true },
    });
    const first = await send(teacherOne, deviceA, [
      noteMutation("day9-note-resolve-a", deviceA, recordId, { [deviceA]: 1 }, "Day9 reading is uneven", ["READING"], null, null, lateClock),
    ]);
    const second = await send(teacherOne, deviceB, [
      noteMutation(
        "day9-note-resolve-b",
        deviceB,
        recordId,
        { [deviceB]: 1 },
        "Day9 needs number sense",
        ["NUMBER_SENSE", "CUSTOM"],
        null,
        tag.id,
        earlyClock,
      ),
    ]);
    expect(resultsOf(first.body)[0]?.outcome).toBe("accepted");
    expect(resultsOf(second.body)[0]?.outcome).toBe("conflict");
    const conflictId = resultsOf(second.body)[0]?.conflictId ?? "";

    for (const actor of [learner, director, admin, teacherTwo]) {
      const denied = await resolveConflict(actor, { conflictId, localDeviceId: phone(), choice: "shown" });
      expect(denied.ok).toBe(false);
      const deniedText = JSON.stringify(denied);
      expect(deniedText).not.toContain("Day9 reading is uneven");
      expect(deniedText).not.toContain("Day9 needs number sense");
      expect(deniedText).not.toContain(tag.name);
      expect(deniedText).not.toContain(profile.learnerCode);
      expect(deniedText).not.toContain(profile.displayName);
    }
    expect(await prisma.auditLog.count({ where: { entityId: recordId, action: "RESOLVE_CONFLICT" } })).toBe(0);
    expect((await prisma.syncConflict.findUniqueOrThrow({ where: { id: conflictId } })).state).toBe("OPEN");

    const before = new Date();
    const resolved = await resolveConflict(teacherOne, { conflictId, localDeviceId: phone(), choice: "shown" });
    expect(resolved.ok).toBe(true);
    const conflict = await prisma.syncConflict.findUniqueOrThrow({ where: { id: conflictId } });
    expect(conflict.state).toBe("RESOLVED");
    expect(conflict.resolution).toBe("KEPT_LATER_RECEIVED");
    const audits = await prisma.auditLog.findMany({
      where: { entityId: recordId, entityType: "PROGRESS_NOTE", action: "RESOLVE_CONFLICT" },
    });
    expect(audits).toHaveLength(1);
    const audit = audits[0];
    expect(audit?.actorId).toBe(teacherOne.id);
    expect(audit?.at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
    expect(audit!.at.getTime()).toBeLessThanOrEqual(Date.now() + 5000);
    expect(audit?.at.toISOString()).not.toBe(earlyClock);
    expect(audit?.at.toISOString()).not.toBe(lateClock);
    expect(audit?.metadata).toEqual({
      conflictId,
      resolution: "KEPT_LATER_RECEIVED",
      resolvedVersionId: conflict.resolvedNoteVersionId,
    });
    const meta = JSON.stringify(audit?.metadata);
    expect(meta).not.toContain("Day9 reading is uneven");
    expect(meta).not.toContain("Day9 needs number sense");
    expect(meta).not.toContain(tag.name);
    expect(meta).not.toContain(profile.learnerCode);
    expect(meta).not.toContain(profile.displayName);
  });

  it("does not let a record upload through the attendance route", async () => {
    holder.userId = teacherOne.id;
    const deviceA = phone();
    const response = await postAttendance(
      new Request("http://local.test/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope(deviceA, [gradeMutation("day9-attendance-route", deviceA, crypto.randomUUID(), { [deviceA]: 1 }, "3.00")])),
      }),
    );
    expect(response.status).toBe(400);
    expect(await prisma.device.findUnique({ where: { id: deviceA } })).toBeNull();
    holder.userId = null;
    const denied = await postRecords(
      new Request("http://local.test/api/sync/records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope(phone(), [])),
      }),
    );
    expect(denied.status).toBe(401);
  });
});
