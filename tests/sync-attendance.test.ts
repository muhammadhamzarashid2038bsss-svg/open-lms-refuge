import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import { acceptSyncBatch, OFFLINE_PHONE_LABEL } from "../lib/data/sync-attendance";
import { prisma } from "../lib/db";
import { WEB_KIOSK_DEVICE_LABEL } from "../lib/lms/attendance";
import { MAX_COMPRESSED_BYTES, MAX_UNCOMPRESSED_BYTES, type SyncWireEvent } from "../lib/sync/batch";

const holder = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/lib/auth/session", () => ({
  readSessionUserId: async () => holder.userId,
}));

import { GET as getHealth } from "../app/api/sync/health/route";
import { POST } from "../app/api/sync/route";

const recordedAt = "2026-11-09T01:02:00.000Z";
const laterRecordedAt = "2026-11-09T01:05:00.000Z";
const phoneIds = new Set<string>();

let morningId = "";
let sessionId = "";
let learnerId = "";
let outsiderLearnerId = "";
let teacherOne: Actor;
let teacherTwo: Actor;
let director: Actor;
let admin: Actor;
let learner: Actor;
let foreignCenterId = "";
let foreignSectionId = "";
let foreignSessionId = "";
let foreignDeviceId = "";

function event(clientEventId: string, learner: string, overrides: Partial<SyncWireEvent> = {}): SyncWireEvent {
  return {
    clientEventId,
    sectionId: morningId,
    classSessionId: sessionId,
    learnerId: learner,
    status: "PRESENT",
    reasonCode: null,
    recordedAt,
    sequence: 1,
    correctsClientEventId: null,
    correctsServerEventId: null,
    ...overrides,
  };
}

function envelope(localDeviceId: string, events: SyncWireEvent[]) {
  return { version: 1 as const, localDeviceId, events };
}

function phone(): string {
  const id = crypto.randomUUID();
  phoneIds.add(id);
  return id;
}

async function post(body: BodyInit, headers: HeadersInit = { "content-type": "application/json" }) {
  return POST(new Request("http://local.test/api/sync", { method: "POST", headers, body }));
}

async function postJson(payload: unknown) {
  return post(JSON.stringify(payload));
}

function gzipBody(payload: unknown) {
  return gzipSync(Buffer.from(JSON.stringify(payload)));
}

async function rows(clientEventId: string) {
  return prisma.attendanceRecord.findMany({
    where: { clientEventId },
    select: {
      id: true,
      status: true,
      reasonCode: true,
      learnerId: true,
      sessionId: true,
      recordedById: true,
      recordedAt: true,
      syncedAt: true,
      createdOffline: true,
      deviceId: true,
    },
  });
}

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}

async function removeOurs() {
  await prisma.user.deleteMany({ where: { email: "sync-test-off@demo.invalid" } });
  await prisma.jsonSyncItem.deleteMany({ where: { clientMutationId: { startsWith: "sync-test-" } } });
  const ids = [...phoneIds];
  if (ids.length > 0) {
    await prisma.jsonSyncItem.deleteMany({ where: { deviceId: { in: ids } } });
    await prisma.jsonSyncBatch.deleteMany({ where: { deviceId: { in: ids } } });
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.attendanceRecord.deleteMany({ where: { clientEventId: { startsWith: "sync-test-" } } });
    if (ids.length > 0) await tx.attendanceRecord.deleteMany({ where: { deviceId: { in: ids } } });
  });
  if (ids.length > 0) {
    const devices = await prisma.device.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        _count: { select: { attendanceRecords: true, jsonSyncBatches: true, jsonSyncItems: true } },
      },
    });
    const free = devices
      .filter((device) => device._count.attendanceRecords === 0 && device._count.jsonSyncBatches === 0 && device._count.jsonSyncItems === 0)
      .map((device) => device.id);
    if (free.length > 0) await prisma.device.deleteMany({ where: { id: { in: free } } });
  }

  const center = await prisma.center.findUnique({ where: { code: "SYNC-TEST-DAY8" }, select: { id: true } });
  if (!center) return;
  const courses = await prisma.course.findMany({ where: { centerId: center.id }, select: { id: true } });
  const courseIds = courses.map((course) => course.id);
  const sections = await prisma.section.findMany({ where: { courseId: { in: courseIds } }, select: { id: true } });
  const sectionIds = sections.map((section) => section.id);
  if (sectionIds.length > 0) await prisma.classSession.deleteMany({ where: { sectionId: { in: sectionIds } } });
  if (sectionIds.length > 0) await prisma.section.deleteMany({ where: { id: { in: sectionIds } } });
  if (courseIds.length > 0) await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  const foreignDevices = await prisma.device.findMany({ where: { centerId: center.id }, select: { id: true } });
  const foreignIds = foreignDevices.map((device) => device.id);
  if (foreignIds.length > 0) {
    await prisma.jsonSyncItem.deleteMany({ where: { deviceId: { in: foreignIds } } });
    await prisma.jsonSyncBatch.deleteMany({ where: { deviceId: { in: foreignIds } } });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
      await tx.attendanceRecord.deleteMany({ where: { deviceId: { in: foreignIds } } });
    });
    await prisma.device.deleteMany({ where: { id: { in: foreignIds } } });
  }
  await prisma.user.deleteMany({ where: { centerId: center.id } });
  await prisma.center.delete({ where: { id: center.id } });
}

describe("sync server", () => {
  beforeAll(async () => {
    await removeOurs();
    morningId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    const afternoonId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Afternoon Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    sessionId = (
      await prisma.classSession.findFirstOrThrow({
        where: { sectionId: morningId },
        select: { id: true },
      })
    ).id;
    const morningLearners = await prisma.enrollment.findMany({
      where: { sectionId: morningId, status: "ACTIVE" },
      select: { learnerId: true },
    });
    const morningLearnerIds = new Set(morningLearners.map((row) => row.learnerId));
    learnerId = morningLearners[0]?.learnerId ?? "";
    const afternoon = await prisma.enrollment.findMany({
      where: { sectionId: afternoonId, status: "ACTIVE" },
      select: { learnerId: true },
    });
    outsiderLearnerId = afternoon.find((row) => !morningLearnerIds.has(row.learnerId))?.learnerId ?? "";
    if (!learnerId || !outsiderLearnerId) throw new Error("missing learners for sync tests");
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

    const center = await prisma.center.create({
      data: { name: "Sync test center", code: "SYNC-TEST-DAY8", timezone: "UTC" },
      select: { id: true },
    });
    foreignCenterId = center.id;
    const course = await prisma.course.create({
      data: { centerId: center.id, title: "Sync test course", code: "SYNC-TEST", academicYear: 2099, semester: "SEMESTER_1" },
      select: { id: true },
    });
    const section = await prisma.section.create({
      data: { courseId: course.id, name: "Sync test group" },
      select: { id: true },
    });
    foreignSectionId = section.id;
    const session = await prisma.classSession.create({
      data: {
        sectionId: section.id,
        title: "Sync test session",
        startsAt: new Date("2099-01-04T09:00:00.000Z"),
        endsAt: new Date("2099-01-04T10:00:00.000Z"),
        deliveryMode: "IN_PERSON",
        status: "SCHEDULED",
      },
      select: { id: true },
    });
    foreignSessionId = session.id;
    foreignDeviceId = crypto.randomUUID();
    phoneIds.add(foreignDeviceId);
    await prisma.device.create({ data: { id: foreignDeviceId, centerId: center.id, label: OFFLINE_PHONE_LABEL } });
  });

  afterAll(async () => {
    await removeOurs();
    await prisma.$disconnect();
  });

  it("returns 401 JSON for a health check with no session", async () => {
    holder.userId = null;
    const response = await getHealth();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "unauthorized" });
  });

  it("returns 200 JSON for a health check with a real session account", async () => {
    holder.userId = teacherOne.id;
    const response = await getHealth();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
    expect(JSON.stringify(body)).not.toContain("teacher.one");
    expect(JSON.stringify(body)).not.toContain(teacherOne.centerId);
  });

  it("returns 403 when the signed-in account is switched off", async () => {
    // A switched-off staff account must record when it was switched off, and the
    // staff sign-in columns cannot be empty. This hash is not a password.
    const disabled = await prisma.user.create({
      data: {
        centerId: foreignCenterId,
        role: "TEACHER",
        email: "sync-test-off@demo.invalid",
        passwordHash: "sync-test-not-a-password",
        active: false,
        deactivatedAt: new Date("2026-11-09T00:00:00.000Z"),
      },
      select: { id: true },
    });
    try {
      holder.userId = disabled.id;
      const response = await getHealth();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ status: "unauthorized" });
    } finally {
      await prisma.user.deleteMany({ where: { id: disabled.id } });
    }
  });

  it("returns 401 for a sync upload with no session and writes nothing", async () => {
    holder.userId = null;
    const id = phone();
    const before = await prisma.attendanceRecord.count({ where: { clientEventId: { startsWith: "sync-test-" } } });
    const response = await postJson(envelope(id, [event("sync-test-anon", learnerId)]));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: "unauthorized" });
    expect(await prisma.device.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.attendanceRecord.count({ where: { clientEventId: { startsWith: "sync-test-" } } })).toBe(before);
  });

  it("refuses a sync upload from another site and accepts this site", async () => {
    holder.userId = teacherOne.id;
    const foreign = phone();
    const before = await prisma.attendanceRecord.count({ where: { clientEventId: { startsWith: "sync-test-" } } });
    const refused = await post(JSON.stringify(envelope(foreign, [event("sync-test-origin", learnerId)])), {
      "content-type": "application/json",
      origin: "https://evil.example",
    });
    expect(refused.status).toBe(403);
    expect(await prisma.device.findUnique({ where: { id: foreign } })).toBeNull();
    expect(await prisma.attendanceRecord.count({ where: { clientEventId: { startsWith: "sync-test-" } } })).toBe(before);

    const id = phone();
    const allowed = await post(JSON.stringify(envelope(id, [event("sync-test-same-origin", learnerId)])), {
      "content-type": "application/json",
      origin: "http://local.test",
    });
    expect(allowed.status).toBe(200);
    expect(await rows("sync-test-same-origin")).toHaveLength(1);
  });

  it("stores a gzip upload for the signed-in teacher and registers that phone", async () => {
    holder.userId = teacherOne.id;
    const id = phone();
    const kioskBefore = await prisma.device.findMany({
      where: { label: WEB_KIOSK_DEVICE_LABEL },
      select: { id: true, label: true, lastSeenAt: true },
      orderBy: { id: "asc" },
    });
    const response = await post(gzipBody(envelope(id, [event("sync-test-valid", learnerId, { status: "ABSENT", reasonCode: "ILLNESS" })])), {
      "content-type": "application/json",
      "content-encoding": "gzip",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { results: { clientEventId: string; outcome: string }[] };
    expect(body.results).toEqual([{ clientEventId: "sync-test-valid", outcome: "accepted" }]);
    expect(JSON.stringify(body)).not.toContain(teacherOne.id);
    const stored = await rows("sync-test-valid");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      status: "ABSENT",
      reasonCode: "ILLNESS",
      recordedById: teacherOne.id,
      createdOffline: true,
      deviceId: id,
    });
    const device = await prisma.device.findUniqueOrThrow({
      where: { id },
      select: { centerId: true, label: true, registeredById: true },
    });
    expect(device).toEqual({ centerId: teacherOne.centerId, label: OFFLINE_PHONE_LABEL, registeredById: teacherOne.id });
    const item = await prisma.jsonSyncItem.findFirstOrThrow({
      where: { clientMutationId: "sync-test-valid", deviceId: id },
      select: { status: true, entityId: true, entityType: true },
    });
    expect(item).toEqual({ status: "APPLIED", entityId: stored[0]?.id, entityType: "ATTENDANCE" });
    const kioskAfter = await prisma.device.findMany({
      where: { label: WEB_KIOSK_DEVICE_LABEL },
      select: { id: true, label: true, lastSeenAt: true },
      orderBy: { id: "asc" },
    });
    expect(kioskAfter).toEqual(kioskBefore);
  });

  it("returns already_accepted for the same mark and keeps the original timestamps", async () => {
    holder.userId = teacherOne.id;
    const original = await rows("sync-test-valid");
    const response = await postJson(
      envelope(original[0]?.deviceId ?? phone(), [
        event("sync-test-valid", learnerId, { status: "ABSENT", reasonCode: "ILLNESS", recordedAt: laterRecordedAt, sequence: 9 }),
      ]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ clientEventId: "sync-test-valid", outcome: "already_accepted" }] });
    const again = await rows("sync-test-valid");
    expect(again).toHaveLength(1);
    expect(again[0]?.recordedAt.toISOString()).toBe(original[0]?.recordedAt.toISOString());
    expect(again[0]?.syncedAt.toISOString()).toBe(original[0]?.syncedAt.toISOString());
    expect(again[0]?.status).toBe("ABSENT");
  });

  it("keeps one row when two identical uploads arrive together", async () => {
    holder.userId = teacherOne.id;
    const id = phone();
    const payload = envelope(id, [event("sync-test-race", learnerId)]);
    const [first, second] = await Promise.all([postJson(payload), postJson(payload)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const outcomes = [
      ((await first.json()) as { results: { outcome: string }[] }).results[0]?.outcome,
      ((await second.json()) as { results: { outcome: string }[] }).results[0]?.outcome,
    ].sort();
    expect(outcomes).toEqual(["accepted", "already_accepted"]);
    expect(await rows("sync-test-race")).toHaveLength(1);
  });

  it("rejects the same client event id when the mark conflicts and leaves the original row", async () => {
    holder.userId = teacherOne.id;
    const deviceId = (await rows("sync-test-valid"))[0]?.deviceId ?? phone();
    const response = await postJson(envelope(deviceId, [event("sync-test-valid", learnerId, { status: "PRESENT" })]));
    expect(await response.json()).toEqual({
      results: [{ clientEventId: "sync-test-valid", outcome: "rejected", code: "different_mark" }],
    });
    const stored = await rows("sync-test-valid");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe("ABSENT");
  });

  it("accepts a valid mark in a batch that also contains an invalid mark", async () => {
    holder.userId = teacherOne.id;
    const id = phone();
    const response = await postJson(
      envelope(id, [
        event("sync-test-partial-bad", "ffffffff-ffff-4fff-8fff-ffffffffffff"),
        event("sync-test-partial-good", learnerId, { sequence: 2 }),
      ]),
    );
    const body = (await response.json()) as { results: { clientEventId: string; outcome: string; code?: string }[] };
    expect(body.results).toEqual([
      { clientEventId: "sync-test-partial-bad", outcome: "rejected", code: "not_enrolled" },
      { clientEventId: "sync-test-partial-good", outcome: "accepted" },
    ]);
    expect(await rows("sync-test-partial-bad")).toHaveLength(0);
    expect(await rows("sync-test-partial-good")).toHaveLength(1);
  });

  it("rejects a class from another center", async () => {
    holder.userId = teacherOne.id;
    const id = phone();
    const response = await postJson(
      envelope(id, [
        event("sync-test-other-center", learnerId, { sectionId: foreignSectionId, classSessionId: foreignSessionId }),
      ]),
    );
    expect(await response.json()).toEqual({
      results: [{ clientEventId: "sync-test-other-center", outcome: "rejected", code: "wrong_center" }],
    });
    expect(await rows("sync-test-other-center")).toHaveLength(0);
  });

  it("rejects a learner who is not actively enrolled in the class", async () => {
    holder.userId = teacherOne.id;
    const response = await postJson(envelope(phone(), [event("sync-test-outsider", outsiderLearnerId)]));
    expect(await response.json()).toEqual({
      results: [{ clientEventId: "sync-test-outsider", outcome: "rejected", code: "not_enrolled" }],
    });
    expect(await rows("sync-test-outsider")).toHaveLength(0);
  });

  it("rejects an unassigned teacher and allows the director", async () => {
    holder.userId = teacherTwo.id;
    const denied = await postJson(envelope(phone(), [event("sync-test-unassigned", learnerId)]));
    expect(await denied.json()).toEqual({
      results: [{ clientEventId: "sync-test-unassigned", outcome: "rejected", code: "forbidden" }],
    });
    expect(await rows("sync-test-unassigned")).toHaveLength(0);

    holder.userId = director.id;
    const id = phone();
    const allowed = await postJson(envelope(id, [event("sync-test-director", learnerId, { sequence: 2 })]));
    expect(await allowed.json()).toEqual({ results: [{ clientEventId: "sync-test-director", outcome: "accepted" }] });
    expect((await rows("sync-test-director"))[0]).toMatchObject({ recordedById: director.id, deviceId: id });
  });

  it("does not let a learner or an admin upload attendance", async () => {
    const id = phone();
    holder.userId = learner.id;
    const learnerResponse = await postJson(envelope(id, [event("sync-test-learner", learnerId)]));
    expect(learnerResponse.status).toBe(403);
    holder.userId = admin.id;
    const adminResponse = await postJson(envelope(phone(), [event("sync-test-admin", learnerId)]));
    expect(adminResponse.status).toBe(403);
    expect(await prisma.device.findUnique({ where: { id } })).toBeNull();
    expect(await rows("sync-test-learner")).toHaveLength(0);
    expect(await rows("sync-test-admin")).toHaveLength(0);
  });

  it("does not let a client user id or center id replace the session", async () => {
    holder.userId = teacherOne.id;
    const id = phone();
    const response = await postJson({
      ...envelope(id, [event("sync-test-override", learnerId)]),
      userId: director.id,
      centerId: foreignCenterId,
    });
    expect(response.status).toBe(400);
    expect(await prisma.device.findUnique({ where: { id } })).toBeNull();
    expect(await rows("sync-test-override")).toHaveLength(0);
    expect((await rows("sync-test-valid"))[0]?.recordedById).toBe(teacherOne.id);
  });

  it("refuses a device id that already belongs to another center", async () => {
    holder.userId = teacherOne.id;
    const before = await prisma.device.findUniqueOrThrow({
      where: { id: foreignDeviceId },
      select: { centerId: true, lastSeenAt: true, label: true },
    });
    const response = await postJson(envelope(foreignDeviceId, [event("sync-test-foreign-phone", learnerId)]));
    expect(response.status).toBe(403);
    expect(await rows("sync-test-foreign-phone")).toHaveLength(0);
    const after = await prisma.device.findUniqueOrThrow({
      where: { id: foreignDeviceId },
      select: { centerId: true, lastSeenAt: true, label: true },
    });
    expect(after).toEqual(before);
  });

  it("rejects malformed JSON and malformed gzip without writing", async () => {
    holder.userId = teacherOne.id;
    const beforeDevices = await prisma.device.count({ where: { label: OFFLINE_PHONE_LABEL } });
    const beforeRows = await prisma.attendanceRecord.count({ where: { clientEventId: { startsWith: "sync-test-" } } });
    const json = await post("{");
    expect(json.status).toBe(400);
    const gzip = await post(Buffer.from("this is not gzip"), { "content-type": "application/json", "content-encoding": "gzip" });
    expect(gzip.status).toBe(400);
    const coded = await post(JSON.stringify(envelope(phone(), [event("sync-test-deflate", learnerId)])), {
      "content-type": "application/json",
      "content-encoding": "deflate",
    });
    expect(coded.status).toBe(415);
    expect(await prisma.device.count({ where: { label: OFFLINE_PHONE_LABEL } })).toBe(beforeDevices);
    expect(await prisma.attendanceRecord.count({ where: { clientEventId: { startsWith: "sync-test-" } } })).toBe(beforeRows);
    expect(await rows("sync-test-deflate")).toHaveLength(0);
  });

  it("rejects an oversized body and a gzip bomb without writing", async () => {
    holder.userId = teacherOne.id;
    const beforeDevices = await prisma.device.count({ where: { label: OFFLINE_PHONE_LABEL } });
    const beforeRows = await prisma.attendanceRecord.count({ where: { clientEventId: { startsWith: "sync-test-" } } });
    const oversized = await post(`{"pad":"${"a".repeat(MAX_UNCOMPRESSED_BYTES)}"}`);
    expect(oversized.status).toBe(413);
    const bomb = gzipSync(Buffer.alloc(MAX_UNCOMPRESSED_BYTES + 1024, 97));
    expect(bomb.byteLength).toBeLessThanOrEqual(MAX_COMPRESSED_BYTES);
    const expanded = await post(bomb, { "content-type": "application/json", "content-encoding": "gzip" });
    expect(expanded.status).toBe(413);
    const fatGzip = Buffer.alloc(MAX_COMPRESSED_BYTES + 1, 1);
    const tooFat = await post(fatGzip, { "content-type": "application/json", "content-encoding": "gzip" });
    expect(tooFat.status).toBe(413);
    expect(await prisma.device.count({ where: { label: OFFLINE_PHONE_LABEL } })).toBe(beforeDevices);
    expect(await prisma.attendanceRecord.count({ where: { clientEventId: { startsWith: "sync-test-" } } })).toBe(beforeRows);
  });

  it("keeps the stored mark when the sync bookkeeping note fails", async () => {
    const id = phone();
    const payload = envelope(id, [event("sync-test-book", learnerId)]);
    const failed = await acceptSyncBatch(teacherOne, payload, 80, async () => {
      throw new Error("bookkeeping failed");
    });
    expect(failed).toEqual({ status: 200, body: { results: [{ clientEventId: "sync-test-book", outcome: "accepted" }] } });
    const stored = await rows("sync-test-book");
    expect(stored).toHaveLength(1);
    expect(await prisma.jsonSyncItem.count({ where: { clientMutationId: "sync-test-book" } })).toBe(0);

    const again = await acceptSyncBatch(teacherOne, payload, 80);
    expect(again).toEqual({ status: 200, body: { results: [{ clientEventId: "sync-test-book", outcome: "already_accepted" }] } });
    const after = await rows("sync-test-book");
    expect(after).toHaveLength(1);
    expect(after[0]?.syncedAt.toISOString()).toBe(stored[0]?.syncedAt.toISOString());
    const item = await prisma.jsonSyncItem.findFirstOrThrow({
      where: { clientMutationId: "sync-test-book" },
      select: { status: true, entityId: true },
    });
    expect(item).toEqual({ status: "DUPLICATE", entityId: stored[0]?.id });
  });

  it("stores a correction after the earlier mark in the same batch and does not change that mark", async () => {
    holder.userId = teacherOne.id;
    const id = phone();
    const response = await postJson(
      envelope(id, [
        event("sync-test-correction", learnerId, { status: "LATE", sequence: 2, correctsClientEventId: "sync-test-original" }),
        event("sync-test-original", learnerId, { status: "ABSENT", reasonCode: "UNKNOWN", sequence: 1 }),
      ]),
    );
    const body = (await response.json()) as { results: { clientEventId: string; outcome: string }[] };
    expect(body.results.map((result) => result.outcome)).toEqual(["accepted", "accepted"]);
    const original = await rows("sync-test-original");
    const correction = await rows("sync-test-correction");
    expect(original).toHaveLength(1);
    expect(correction).toHaveLength(1);
    expect(original[0]?.status).toBe("ABSENT");
    expect(correction[0]?.status).toBe("LATE");
  });
});
