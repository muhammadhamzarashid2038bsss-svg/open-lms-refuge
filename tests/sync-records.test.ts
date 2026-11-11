import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import { resolveConflict } from "../lib/data/conflicts";
import { acceptRecordBatch } from "../lib/data/sync-records";
import { prisma } from "../lib/db";
import { incrementDeviceCounter, mergeVersionVectors, parseVersionVector } from "../lib/sync/version-vector";

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
let foreignCenterId = "";
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

async function clearRecords() {
  const grades = assignmentId
    ? await prisma.gradeEntry.findMany({ where: { assignmentId }, select: { id: true } })
    : [];
  const notes = morningId
    ? await prisma.progressNote.findMany({ where: { sectionId: morningId, body: { startsWith: "Day9 " } }, select: { id: true } })
    : [];
  const gradeIds = grades.map((row) => row.id);
  const noteIds = notes.map((row) => row.id);
  const filters = [
    ...(gradeIds.length ? [{ gradeEntryId: { in: gradeIds } }] : []),
    ...(noteIds.length ? [{ progressNoteId: { in: noteIds } }] : []),
  ];
  if (filters.length) await prisma.syncConflict.deleteMany({ where: { OR: filters } });
  await prisma.jsonSyncItem.deleteMany({ where: { clientMutationId: { startsWith: "day9-" } } });
  const ids = [...phoneIds];
  if (ids.length > 0) {
    await prisma.jsonSyncItem.deleteMany({ where: { deviceId: { in: ids } } });
    await prisma.jsonSyncBatch.deleteMany({ where: { deviceId: { in: ids } } });
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    const entityIds = [...gradeIds, ...noteIds];
    if (entityIds.length) await tx.auditLog.deleteMany({ where: { entityId: { in: entityIds } } });
    if (gradeIds.length) await tx.gradeEntryVersion.deleteMany({ where: { gradeEntryId: { in: gradeIds } } });
    if (noteIds.length) await tx.progressNoteVersion.deleteMany({ where: { progressNoteId: { in: noteIds } } });
    if (gradeIds.length) await tx.gradeEntry.deleteMany({ where: { id: { in: gradeIds } } });
    if (noteIds.length) await tx.progressNote.deleteMany({ where: { id: { in: noteIds } } });
  });
}

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}

describe("grade and note conflict sync", () => {
  beforeAll(async () => {
    morningId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    learnerId = (
      await prisma.enrollment.findFirstOrThrow({
        where: { sectionId: morningId, status: "ACTIVE" },
        select: { learnerId: true },
      })
    ).learnerId;
    teacherOne = await actorByEmail("teacher.one@demo.invalid");
    teacherTwo = await actorByEmail("teacher.two@demo.invalid");
    director = await actorByEmail("director@demo.invalid");
    admin = await actorByEmail("admin@demo.invalid");
    const learnerUser = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { userId: true },
    });
    const loadedLearner = await loadActor(learnerUser.userId);
    if (!loadedLearner) throw new Error("missing learner");
    learner = loadedLearner;
    const assignment = await prisma.assignment.create({
      data: {
        sectionId: morningId,
        title: "Day9 synthetic quiz",
        kind: "PAPER",
        maxPoints: "20.00",
        createdById: teacherOne.id,
      },
      select: { id: true },
    });
    assignmentId = assignment.id;

    const center = await prisma.center.create({
      data: { name: "Day9 sync center", code: "SYNC-TEST-DAY9", timezone: "UTC" },
      select: { id: true },
    });
    foreignCenterId = center.id;
    const foreignTeacher = await prisma.user.create({
      data: {
        centerId: center.id,
        role: "TEACHER",
        email: "day9-foreign@demo.invalid",
        passwordHash: "day9-not-a-password",
        displayName: "Day9 Foreign",
      },
      select: { id: true },
    });
    const course = await prisma.course.create({
      data: { centerId: center.id, title: "Day9 course", code: "DAY9", academicYear: 2099, semester: "SEMESTER_1" },
      select: { id: true },
    });
    const section = await prisma.section.create({
      data: { courseId: course.id, name: "Day9 group" },
      select: { id: true },
    });
    const foreignAssignment = await prisma.assignment.create({
      data: {
        sectionId: section.id,
        title: "Day9 foreign quiz",
        kind: "PAPER",
        maxPoints: "10.00",
        createdById: foreignTeacher.id,
      },
      select: { id: true },
    });
    foreignAssignmentId = foreignAssignment.id;
    foreignDeviceId = crypto.randomUUID();
    await prisma.device.create({ data: { id: foreignDeviceId, centerId: center.id, label: "Offline phone" } });
  });

  beforeEach(async () => {
    await clearRecords();
  });

  afterAll(async () => {
    await clearRecords();
    const leftovers = await prisma.centerSkillTag.findMany({
      where: {
        OR: [
          { name: { startsWith: "Map reading " } },
          { name: { startsWith: "Retry tag " } },
          { name: { startsWith: "Shape sense " } },
        ],
      },
      select: { id: true, name: true },
    });
    const testTagName = /^(?:Map reading|Retry tag|Shape sense) [0-9a-f]{8}$/i;
    for (const row of leftovers) {
      if (testTagName.test(row.name)) skillTagIds.add(row.id);
    }
    const tagIds = [...skillTagIds];
    if (tagIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
        await tx.auditLog.deleteMany({ where: { entityId: { in: tagIds } } });
      });
      await prisma.centerSkillTag.deleteMany({ where: { id: { in: tagIds } } });
    }
    if (assignmentId) await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    const ids = [...phoneIds];
    if (ids.length > 0) {
      await prisma.jsonSyncItem.deleteMany({ where: { deviceId: { in: ids } } });
      await prisma.jsonSyncBatch.deleteMany({ where: { deviceId: { in: ids } } });
      await prisma.device.deleteMany({ where: { id: { in: ids } } });
    }
    if (foreignCenterId) {
      await prisma.assignment.deleteMany({ where: { id: foreignAssignmentId } });
      const sections = await prisma.section.findMany({ where: { course: { centerId: foreignCenterId } }, select: { id: true } });
      if (sections.length) await prisma.section.deleteMany({ where: { id: { in: sections.map((row) => row.id) } } });
      await prisma.course.deleteMany({ where: { centerId: foreignCenterId } });
      await prisma.device.deleteMany({ where: { centerId: foreignCenterId } });
      await prisma.user.deleteMany({ where: { centerId: foreignCenterId } });
      await prisma.center.delete({ where: { id: foreignCenterId } });
    }
    await prisma.$disconnect();
  });

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
