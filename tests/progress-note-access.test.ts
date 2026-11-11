import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import { pageGuard, type Actor } from "../lib/auth/permissions";
import { readConflict, resolveConflict } from "../lib/data/conflicts";
import { listProgressNoteSummaries, NOTE_VIEW_FAILED, readProgressNote } from "../lib/data/progress-notes";
import { loadRecordCatalog } from "../lib/data/record-catalog";
import { acceptNoteViewBatch } from "../lib/data/note-view-sync";
import { acceptRecordBatch } from "../lib/data/sync-records";
import { prisma } from "../lib/db";

const holder = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/lib/auth/session", () => ({
  readSessionUserId: async () => holder.userId,
}));

import { GET as getNote } from "../app/api/notes/[id]/route";

const started = new Date(Date.now() - 5000);
const LEGACY = "map reading";
const SHOWN_BODY = "Day12 legacy label stays on this note.";
const OTHER_BODY = "Day12 other saved copy stays too.";
const createdUserIds: string[] = [];
const deviceIds: string[] = [];
const noteIds: string[] = [];
let morningId = "";
let learnerId = "";
let learnerCode = "";
let learnerName = "";
let noteId = "";
let conflictId = "";
let foreignTagId = "";
let teacherOne: Actor;
let teacherTwo: Actor;
let director: Actor;
let otherDirector: Actor;
let admin: Actor;
let learner: Actor;
let endedTeacher: Actor;
let inactiveUserId = "";

async function actorByEmail(email: string): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(email);
  return actor;
}

function viewEnvelope(deviceId: string, clientEventId: string, targetNoteId: string, deviceReportedAt: string | null = "1990-01-01T00:00:00.000Z") {
  return {
    version: 1,
    localDeviceId: deviceId,
    events: [{ clientEventId, noteId: targetNoteId, deviceReportedAt }],
  };
}

function viewResults(body: unknown): { outcome?: string; code?: string }[] {
  if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results)) return [];
  return body.results as { outcome?: string; code?: string }[];
}

async function whileAuditWritesFail<T>(run: () => Promise<T>): Promise<T> {
  const realTransaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((callback: unknown, options?: unknown) => {
    if (typeof callback !== "function") return realTransaction(callback as never, options as never);
    return realTransaction(async (tx: { auditLog: { createMany: (...args: never[]) => Promise<{ count: number }> } }) => {
      tx.auditLog.createMany = () => Promise.reject(new Error("audit write failed"));
      return callback(tx);
    }, options as never);
  }) as typeof prisma.$transaction);
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
}

async function openNote(userId: string | null, id: string): Promise<{ status: number; text: string }> {
  holder.userId = userId;
  const response = await getNote(new Request(`http://local.test/api/notes/${id}`), { params: Promise.resolve({ id }) });
  return { status: response.status, text: await response.text() };
}

async function removeDay12Fixtures(): Promise<void> {
  const leftoverNotes = await prisma.progressNote.findMany({
    where: { body: { startsWith: "Day12 " } },
    select: { id: true },
  });
  const ids = [...new Set([...noteIds, ...leftoverNotes.map((row) => row.id)])];
  const marked = ids.length === 0
    ? []
    : await prisma.jsonSyncItem.findMany({
      where: { OR: [{ clientMutationId: { startsWith: "day12-" } }, { entityId: { in: ids } }] },
      select: { deviceId: true },
    });
  const labeled = await prisma.device.findMany({
    where: { label: "Day12 note phone" },
    select: { id: true },
  });
  const phones = [...new Set([...deviceIds, ...marked.map((row) => row.deviceId), ...labeled.map((row) => row.id)])];
  if (phones.length > 0) {
    await prisma.jsonSyncItem.deleteMany({ where: { deviceId: { in: phones } } });
    await prisma.jsonSyncBatch.deleteMany({ where: { deviceId: { in: phones } } });
  }
  if (ids.length > 0) await prisma.syncConflict.deleteMany({ where: { progressNoteId: { in: ids } } });
  const fixtureUsers = await prisma.user.findMany({
    where: { email: { in: ["inactive-day12@demo.invalid", "ended-day12@demo.invalid", "director@day12-tags.invalid"] } },
    select: { id: true },
  });
  const userIds = [...new Set([...createdUserIds, ...fixtureUsers.map((row) => row.id)])];
  if (userIds.length > 0) await prisma.sectionTeacher.deleteMany({ where: { teacherId: { in: userIds } } });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    if (ids.length > 0) {
      await tx.progressNoteVersion.deleteMany({ where: { progressNoteId: { in: ids } } });
      await tx.progressNote.deleteMany({ where: { id: { in: ids } } });
      await tx.auditLog.deleteMany({ where: { action: "VIEW", entityType: "PROGRESS_NOTE", entityId: { in: ids } } });
    }
    // A director read of the seeded legacy note during this run writes one view.
    // Only that new row is removed. Older view records stay.
    const director = await tx.user.findUnique({ where: { email: "director@demo.invalid" }, select: { id: true } });
    const legacyNotes = await tx.progressNote.findMany({
      where: { customSkillLabel: LEGACY, customSkillTagId: null },
      select: { id: true },
    });
    const legacyIds = legacyNotes.map((row) => row.id);
    if (director && legacyIds.length > 0) {
      await tx.auditLog.deleteMany({
        where: {
          action: "VIEW",
          entityType: "PROGRESS_NOTE",
          actorId: director.id,
          entityId: { in: legacyIds },
          at: { gte: started },
        },
      });
    }
    if (userIds.length > 0) await tx.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  });
  if (phones.length > 0) await prisma.device.deleteMany({ where: { id: { in: phones } } });
  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: userIds }, email: { in: ["inactive-day12@demo.invalid", "ended-day12@demo.invalid"] } },
    });
  }
  const foreign = await prisma.center.findUnique({ where: { code: "DAY12-TAGS" }, select: { id: true } });
  if (foreign) await removeForeignCenter(foreign.id);
}

async function deleteAudits(where: { actorId?: { in: string[] }; centerId?: string; entityId?: { in: string[] } }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.auditLog.deleteMany({ where });
  });
}

async function removeForeignCenter(centerId: string): Promise<void> {
  const tags = await prisma.centerSkillTag.findMany({ where: { centerId }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { centerId }, select: { id: true } });
  const devices = await prisma.device.findMany({ where: { centerId }, select: { id: true } });
  const ownedDevices = devices.map((row) => row.id);
  if (ownedDevices.length > 0) {
    await prisma.jsonSyncItem.deleteMany({ where: { deviceId: { in: ownedDevices } } });
    await prisma.jsonSyncBatch.deleteMany({ where: { deviceId: { in: ownedDevices } } });
  }
  await deleteAudits({ centerId });
  if (tags.length > 0) await prisma.centerSkillTag.deleteMany({ where: { centerId } });
  if (ownedDevices.length > 0) await prisma.device.deleteMany({ where: { id: { in: ownedDevices } } });
  if (users.length > 0) await prisma.user.deleteMany({ where: { id: { in: users.map((row) => row.id) } } });
  await prisma.center.delete({ where: { id: centerId } });
}

describe("progress note read access and view audit", () => {
  beforeAll(async () => {
    await removeDay12Fixtures();

    morningId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { sectionId: morningId, status: "ACTIVE" },
      select: {
        learnerId: true,
        learner: { select: { learnerCode: true, displayName: true, userId: true } },
      },
    });
    learnerId = enrollment.learnerId;
    learnerCode = enrollment.learner.learnerCode;
    learnerName = enrollment.learner.displayName;
    teacherOne = await actorByEmail("teacher.one@demo.invalid");
    teacherTwo = await actorByEmail("teacher.two@demo.invalid");
    director = await actorByEmail("director@demo.invalid");
    admin = await actorByEmail("admin@demo.invalid");
    const learnerActor = await loadActor(enrollment.learner.userId);
    if (!learnerActor) throw new Error("learner");
    learner = learnerActor;

    const foreign = await prisma.center.create({
      data: { name: "Day12 other center", code: "DAY12-TAGS", timezone: "UTC" },
      select: { id: true },
    });
    const foreignDirectorUser = await prisma.user.create({
      data: {
        centerId: foreign.id,
        role: "CENTER_DIRECTOR",
        email: "director@day12-tags.invalid",
        passwordHash: "day12-not-a-password",
        displayName: "Day12 Other Director",
        active: true,
      },
      select: { id: true },
    });
    createdUserIds.push(foreignDirectorUser.id);
    const loadedForeign = await loadActor(foreignDirectorUser.id);
    if (!loadedForeign) throw new Error("foreign director");
    otherDirector = loadedForeign;
    const foreignTag = await prisma.centerSkillTag.create({
      data: { centerId: foreign.id, name: "Shape sense", active: true },
      select: { id: true },
    });
    foreignTagId = foreignTag.id;

    const inactive = await prisma.user.create({
      data: {
        centerId: director.centerId,
        role: "TEACHER",
        email: "inactive-day12@demo.invalid",
        passwordHash: "day12-not-a-password",
        displayName: "Day12 Inactive",
        active: false,
        deactivatedAt: new Date("2020-01-03T00:00:00.000Z"),
      },
      select: { id: true },
    });
    inactiveUserId = inactive.id;
    createdUserIds.push(inactive.id);

    const ended = await prisma.user.create({
      data: {
        centerId: director.centerId,
        role: "TEACHER",
        email: "ended-day12@demo.invalid",
        passwordHash: "day12-not-a-password",
        displayName: "Day12 Ended",
        active: true,
      },
      select: { id: true },
    });
    createdUserIds.push(ended.id);
    await prisma.sectionTeacher.create({
      data: {
        sectionId: morningId,
        teacherId: ended.id,
        startsOn: new Date("2020-01-01T00:00:00.000Z"),
        endsOn: new Date("2020-01-02T00:00:00.000Z"),
      },
    });
    const loadedEnded = await loadActor(ended.id);
    if (!loadedEnded) throw new Error("ended teacher");
    endedTeacher = loadedEnded;

    const deviceId = crypto.randomUUID();
    deviceIds.push(deviceId);
    await prisma.device.create({
      data: { id: deviceId, centerId: director.centerId, label: "Day12 note phone" },
    });
    noteId = crypto.randomUUID();
    noteIds.push(noteId);
    const shownVersionId = crypto.randomUUID();
    const otherVersionId = crypto.randomUUID();
    const recordedAt = new Date("2026-11-01T00:00:00.000Z");
    await prisma.progressNote.create({
      data: {
        id: noteId,
        learnerId,
        sectionId: morningId,
        authorId: teacherOne.id,
        body: SHOWN_BODY,
        skillGaps: ["CUSTOM"],
        customSkillLabel: LEGACY,
        customSkillTagId: null,
        deviceId,
        versionVector: { [deviceId]: 1 },
        deviceRecordedAt: recordedAt,
        syncedAt: recordedAt,
        createdOffline: true,
      },
    });
    await prisma.progressNoteVersion.createMany({
      data: [
        {
          id: otherVersionId,
          progressNoteId: noteId,
          authorId: teacherOne.id,
          body: OTHER_BODY,
          skillGaps: ["READING"],
          customSkillLabel: null,
          deviceId,
          versionVector: { [deviceId]: 2 },
          deviceRecordedAt: recordedAt,
          syncedAt: recordedAt,
          createdOffline: true,
          preservedFromConflict: true,
        },
        {
          id: shownVersionId,
          progressNoteId: noteId,
          authorId: teacherOne.id,
          body: SHOWN_BODY,
          skillGaps: ["CUSTOM"],
          customSkillLabel: LEGACY,
          deviceId,
          versionVector: { [deviceId]: 1 },
          deviceRecordedAt: recordedAt,
          syncedAt: new Date("2026-11-01T00:05:00.000Z"),
          createdOffline: true,
          preservedFromConflict: true,
        },
      ],
    });
    const conflict = await prisma.syncConflict.create({
      data: {
        entityType: "PROGRESS_NOTE",
        state: "OPEN",
        progressNoteId: noteId,
        noteVersionAId: otherVersionId,
        noteVersionBId: shownVersionId,
        shownNoteVersionId: shownVersionId,
      },
      select: { id: true },
    });
    conflictId = conflict.id;
  });

  afterAll(async () => {
    holder.userId = null;
    await removeDay12Fixtures();
    await prisma.$disconnect();
  });

  it("lets the assigned teacher and the same-center director read the note, and records the view", async () => {
    expect(teacherTwo.assignedSectionIds).not.toContain(morningId);
    expect(endedTeacher.assignedSectionIds).not.toContain(morningId);
    const teacherView = await readProgressNote(teacherOne, noteId);
    expect(teacherView?.body).toBe(SHOWN_BODY);
    expect(teacherView?.legacyCustomLabel).toBe(LEGACY);
    const directorView = await readProgressNote(director, noteId);
    expect(directorView?.body).toBe(SHOWN_BODY);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: noteId, action: "VIEW", actorId: teacherOne.id, at: { gte: started } },
      orderBy: { at: "desc" },
    });
    expect(audit.actorId).toBe(teacherOne.id);
    expect(audit.action).toBe("VIEW");
    expect(audit.entityId).toBe(noteId);
    expect(audit.at.getTime()).toBeGreaterThanOrEqual(started.getTime());
    expect(audit.metadata).toEqual({ source: "online" });
    const meta = JSON.stringify(audit.metadata);
    expect(meta).not.toContain(SHOWN_BODY);
    expect(meta).not.toContain(LEGACY);
    expect(meta).not.toContain(learnerCode);
    expect(meta).not.toContain(learnerName);
  });

  it("hides the note from another center, another section, learners, admins, and inactive or ended staff", async () => {
    for (const actor of [otherDirector, teacherTwo, learner, admin, endedTeacher]) {
      expect(await readProgressNote(actor, noteId)).toBeNull();
    }
    expect(await loadActor(inactiveUserId)).toBeNull();
    const summaries = await listProgressNoteSummaries(director);
    const summary = summaries?.find((item) => item.id === noteId);
    expect(summary?.hasLegacyLabel).toBe(true);
    expect(JSON.stringify(summary)).not.toContain(SHOWN_BODY);
    expect(JSON.stringify(summary)).not.toContain(LEGACY);
    expect(await listProgressNoteSummaries(otherDirector)).toEqual([]);
    expect(pageGuard(teacherOne, "CENTER_DIRECTOR").ok).toBe(false);
    expect(pageGuard(director, "CENTER_DIRECTOR").ok).toBe(true);
  });

  it("enforces the same hide on the note API, including a guessed id", async () => {
    const allowed = await openNote(director.id, noteId);
    expect(allowed.status).toBe(200);
    expect(allowed.text).toContain(SHOWN_BODY);
    const teacher = await openNote(teacherOne.id, noteId);
    expect(teacher.status).toBe(200);
    for (const userId of [otherDirector.id, teacherTwo.id, learner.id, admin.id, endedTeacher.id]) {
      const hidden = await openNote(userId, noteId);
      expect(hidden.status).toBe(404);
      expect(hidden.text).not.toContain(SHOWN_BODY);
      expect(hidden.text).not.toContain(LEGACY);
    }
    const inactive = await openNote(inactiveUserId, noteId);
    expect(inactive.status).toBe(403);
    expect(inactive.text).not.toContain(SHOWN_BODY);
    const guessed = await openNote(director.id, crypto.randomUUID());
    expect(guessed.status).toBe(404);
    expect(guessed.text).not.toContain(SHOWN_BODY);
    expect(guessed.text).not.toContain(LEGACY);
    holder.userId = null;
  });

  it("does not let a director create or resolve a note, and keeps both legacy conflict copies readable", async () => {
    const created = await acceptRecordBatch(director, {}, 10);
    expect(created.status).toBe(403);
    const review = await readConflict(teacherOne, conflictId);
    expect(review?.shown.body).toBe(SHOWN_BODY);
    expect(review?.shown.customSkillLabel).toBe(LEGACY);
    expect(review?.other.body).toBe(OTHER_BODY);
    expect(await readConflict(director, conflictId)).toBeNull();
    const denied = await resolveConflict(director, { conflictId, localDeviceId: crypto.randomUUID(), choice: "shown" });
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied)).not.toContain(SHOWN_BODY);
    const still = await prisma.syncConflict.findUniqueOrThrow({ where: { id: conflictId } });
    expect(still.state).toBe("OPEN");
    const seedConflict = await prisma.syncConflict.findFirstOrThrow({
      where: {
        entityType: "PROGRESS_NOTE",
        state: "OPEN",
        id: { not: conflictId },
        progressNote: { sectionId: morningId },
      },
      select: { id: true },
    });
    const existing = await readConflict(teacherOne, seedConflict.id);
    expect(existing?.shown.body?.length).toBeGreaterThan(0);
    expect(existing?.other.body?.length).toBeGreaterThan(0);
  });

  it("keeps the seeded map-reading label readable without treating the catalog as a view", async () => {
    const seeded = await prisma.progressNote.findFirstOrThrow({
      where: { customSkillLabel: LEGACY, customSkillTagId: null, id: { not: noteId } },
      select: { id: true, body: true },
    });
    const viewed = await readProgressNote(director, seeded.id);
    expect(viewed?.legacyCustomLabel).toBe(LEGACY);
    expect(viewed?.body).toBe(seeded.body);
    const before = await prisma.auditLog.count({
      where: { entityId: noteId, action: "VIEW", actorId: teacherOne.id },
    });
    const catalog = await loadRecordCatalog(teacherOne);
    const listed = catalog?.notes.find((note) => note.id === noteId);
    expect(listed?.skillGaps).toContain("CUSTOM");
    expect(JSON.stringify(listed)).not.toContain(SHOWN_BODY);
    expect(JSON.stringify(listed)).not.toContain(LEGACY);
    expect(JSON.stringify(catalog?.notes)).not.toContain(seeded.body);
    const after = await prisma.auditLog.count({
      where: { entityId: noteId, action: "VIEW", actorId: teacherOne.id },
    });
    expect(after).toBe(before);
    const otherCatalog = await loadRecordCatalog(teacherTwo);
    expect(otherCatalog?.notes.some((note) => note.id === noteId)).toBe(false);
    const directorView = await prisma.auditLog.findFirst({
      where: { entityId: seeded.id, action: "VIEW", actorId: director.id, metadata: { equals: { source: "online" } } },
    });
    expect(directorView?.at).toBeInstanceOf(Date);
  });

  it("records one offline view per event id, rejects a changed replay, and does not move the event to another account", async () => {
    const deviceId = crypto.randomUUID();
    deviceIds.push(deviceId);
    const phoneTime = "1990-01-01T00:00:00.000Z";
    const first = await acceptNoteViewBatch(teacherOne, viewEnvelope(deviceId, "day12-view-1", noteId, phoneTime));
    const repeat = await acceptNoteViewBatch(teacherOne, viewEnvelope(deviceId, "day12-view-1", noteId, phoneTime));
    expect(viewResults(first.body)[0]?.outcome).toBe("accepted");
    expect(viewResults(repeat.body)[0]?.outcome).toBe("already_accepted");
    const offline = await prisma.auditLog.findMany({
      where: { entityId: noteId, action: "VIEW", metadata: { path: ["clientEventId"], equals: "day12-view-1" } },
    });
    expect(offline).toHaveLength(1);
    expect(offline[0]?.actorId).toBe(teacherOne.id);
    expect(offline[0]?.metadata).toEqual({ source: "offline", clientEventId: "day12-view-1" });
    expect(JSON.stringify(offline[0]?.metadata)).not.toContain(phoneTime);
    expect(JSON.stringify(offline[0]?.metadata)).not.toContain(SHOWN_BODY);
    expect(JSON.stringify(offline[0]?.metadata)).not.toContain(LEGACY);
    expect(JSON.stringify(offline[0]?.metadata)).not.toContain(learnerName);
    expect(JSON.stringify(offline[0]?.metadata)).not.toContain(learnerCode);
    expect(offline[0]?.at.getUTCFullYear()).toBeGreaterThan(1990);
    expect(offline[0]?.at.getTime()).toBeGreaterThanOrEqual(started.getTime());

    const changed = await acceptNoteViewBatch(teacherOne, viewEnvelope(deviceId, "day12-view-1", crypto.randomUUID(), phoneTime));
    expect(viewResults(changed.body)[0]).toMatchObject({ outcome: "rejected", code: "event_mismatch" });
    expect(await prisma.auditLog.count({
      where: { action: "VIEW", metadata: { path: ["clientEventId"], equals: "day12-view-1" } },
    })).toBe(1);

    const later = await acceptNoteViewBatch(teacherOne, viewEnvelope(deviceId, "day12-view-2", noteId, phoneTime));
    expect(viewResults(later.body)[0]?.outcome).toBe("accepted");
    expect(await prisma.auditLog.count({
      where: { entityId: noteId, action: "VIEW", metadata: { path: ["source"], equals: "offline" } },
    })).toBe(2);

    const transferred = await acceptNoteViewBatch(teacherTwo, viewEnvelope(deviceId, "day12-view-1", noteId, phoneTime));
    expect(viewResults(transferred.body)[0]?.outcome).toBe("already_accepted");
    const still = await prisma.auditLog.findMany({
      where: { metadata: { path: ["clientEventId"], equals: "day12-view-1" } },
    });
    expect(still).toHaveLength(1);
    expect(still[0]?.actorId).toBe(teacherOne.id);

    const otherAccount = await acceptNoteViewBatch(teacherTwo, viewEnvelope(deviceId, "day12-view-3", noteId, phoneTime));
    expect(viewResults(otherAccount.body)[0]).toMatchObject({ outcome: "rejected", code: "forbidden" });
    expect(await prisma.auditLog.count({
      where: { metadata: { path: ["clientEventId"], equals: "day12-view-3" } },
    })).toBe(0);

    const otherCenter = await acceptNoteViewBatch(otherDirector, viewEnvelope(crypto.randomUUID(), "day12-view-4", noteId, phoneTime));
    expect(viewResults(otherCenter.body)[0]?.outcome).toBe("rejected");
    expect(await prisma.auditLog.count({
      where: { actorId: otherDirector.id, entityId: noteId, action: "VIEW" },
    })).toBe(0);

    const withActor = await acceptNoteViewBatch(teacherOne, {
      version: 1,
      localDeviceId: deviceId,
      events: [{ clientEventId: "day12-view-5", noteId, deviceReportedAt: phoneTime, actorId: teacherTwo.id }],
    });
    expect(viewResults(withActor.body)[0]).toMatchObject({ outcome: "rejected", code: "invalid_event" });
    expect(await prisma.auditLog.count({
      where: { metadata: { path: ["clientEventId"], equals: "day12-view-5" } },
    })).toBe(0);
  });

  it("does not let another teacher consume a pending view event id", async () => {
    const deviceId = crypto.randomUUID();
    deviceIds.push(deviceId);
    const eventId = "day12-view-owner";
    const phoneTime = "1990-01-01T00:00:00.000Z";
    const stolen = await acceptNoteViewBatch(teacherTwo, viewEnvelope(deviceId, eventId, noteId, phoneTime));
    expect(viewResults(stolen.body)[0]).toMatchObject({ outcome: "rejected", code: "forbidden" });
    expect(await prisma.auditLog.count({
      where: { action: "VIEW", metadata: { path: ["clientEventId"], equals: eventId } },
    })).toBe(0);
    expect(await prisma.jsonSyncItem.count({
      where: { deviceId, clientMutationId: eventId },
    })).toBe(0);

    const owned = await acceptNoteViewBatch(teacherOne, viewEnvelope(deviceId, eventId, noteId, phoneTime));
    expect(viewResults(owned.body)[0]?.outcome).toBe("accepted");
    const audits = await prisma.auditLog.findMany({
      where: { action: "VIEW", metadata: { path: ["clientEventId"], equals: eventId } },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(teacherOne.id);
    expect(audits[0]?.entityId).toBe(noteId);

    const again = await acceptNoteViewBatch(teacherOne, viewEnvelope(deviceId, eventId, noteId, phoneTime));
    expect(viewResults(again.body)[0]?.outcome).toBe("already_accepted");
    expect(await prisma.auditLog.count({
      where: { action: "VIEW", metadata: { path: ["clientEventId"], equals: eventId } },
    })).toBe(1);
  });

  it("does not return note text when the view audit cannot be written", async () => {
    const before = await prisma.auditLog.count({
      where: { entityId: noteId, action: "VIEW" },
    });
    await expect(whileAuditWritesFail(() => readProgressNote(director, noteId))).rejects.toThrow();
    expect(await prisma.auditLog.count({
      where: { entityId: noteId, action: "VIEW" },
    })).toBe(before);

    const hidden = await whileAuditWritesFail(() => openNote(director.id, noteId));
    expect(hidden.status).toBe(500);
    expect(hidden.text).toContain(NOTE_VIEW_FAILED);
    expect(hidden.text).not.toContain(SHOWN_BODY);
    expect(hidden.text).not.toContain(LEGACY);
    expect(hidden.text).not.toContain(learnerName);
    expect(hidden.text).not.toContain(learnerCode);
    expect(await prisma.auditLog.count({
      where: { entityId: noteId, action: "VIEW" },
    })).toBe(before);

    const opened = await readProgressNote(director, noteId);
    expect(opened?.body).toBe(SHOWN_BODY);
    expect(await prisma.auditLog.count({
      where: { entityId: noteId, action: "VIEW" },
    })).toBe(before + 1);
  });

  it("refuses a custom tag from another center", async () => {
    const deviceId = crypto.randomUUID();
    deviceIds.push(deviceId);
    const recordId = crypto.randomUUID();
    const result = await acceptRecordBatch(teacherOne, {
      version: 1,
      localDeviceId: deviceId,
      mutations: [{
        entityType: "PROGRESS_NOTE",
        clientMutationId: "day12-foreign-tag",
        recordId,
        sectionId: morningId,
        learnerId,
        body: "Day12 foreign tag must not save",
        skillGaps: ["CUSTOM"],
        customSkillLabel: null,
        customSkillTagId: foreignTagId,
        versionVector: { [deviceId]: 1 },
        deviceRecordedAt: "2026-11-11T00:00:00.000Z",
        createdOffline: true,
      }],
    }, 200);
    expect(viewResults(result.body)[0]?.code).toBe("invalid_note");
    expect(await prisma.progressNote.findUnique({ where: { id: recordId } })).toBeNull();
  });
});
