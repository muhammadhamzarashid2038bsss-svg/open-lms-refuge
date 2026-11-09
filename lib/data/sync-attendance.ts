// Stores one offline attendance batch. The signed-in person and their center
// come from the server session. A user id or center id in the JSON is not a
// permission, and the envelope rejects those fields.
//
// Each mark is its own database transaction. Postgres cancels the whole
// transaction when a unique clientEventId collides, so one collision must not
// undo another learner's mark. The unique index is the authority: a check
// before insert is only a shortcut. Phone sequence and the phone clock are
// not the order of corrections. syncedAt is the server clock.

import { Prisma } from "../../generated/prisma/client";
import { canRecordAttendance, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import type { HttpResult } from "../http/records";
import { isUuid } from "../lms/timetable";
import { validateSyncEnvelope, type SyncWireEvent } from "../sync/batch";

/// A phone that saved marks while offline. This is not the online "Web attendance kiosk" device.
export const OFFLINE_PHONE_LABEL = "Offline phone";

export type SyncOutcomeName = "accepted" | "already_accepted" | "rejected" | "retryable_failure";

export type SyncResult = {
  clientEventId: string;
  outcome: SyncOutcomeName;
  code?: string;
};

type StoredFact = {
  attendanceId: string;
  learnerId: string;
  sessionId: string;
};

type EventResult = SyncResult & { attendanceId?: string };

export type SyncBookItem = {
  clientEventId: string;
  attendanceId: string;
  status: "APPLIED" | "DUPLICATE";
};

export type SyncBookInput = {
  deviceId: string;
  centerId: string;
  wireBytes: number;
  items: SyncBookItem[];
};

export type SyncBookWriter = (input: SyncBookInput) => Promise<void>;

type StoredRow = {
  id: string;
  clientEventId: string;
  learnerId: string;
  sessionId: string;
  status: string;
  reasonCode: string | null;
  recordedById: string;
};

const rowSelect = {
  id: true,
  clientEventId: true,
  learnerId: true,
  sessionId: true,
  status: true,
  reasonCode: true,
  recordedById: true,
} as const;

function rejected(clientEventId: string, code: string): EventResult {
  return { clientEventId, outcome: "rejected", code };
}

function retryable(clientEventId: string, code: string): EventResult {
  return { clientEventId, outcome: "retryable_failure", code };
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isRuleRejection(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return true;
  const message = error instanceof Error ? error.message : "";
  return message.includes("attendance must be") || message.includes("append-only");
}

function sameFact(row: StoredRow, event: SyncWireEvent, recordedById: string): boolean {
  return (
    row.learnerId === event.learnerId &&
    row.sessionId === event.classSessionId &&
    row.status === event.status &&
    (row.reasonCode ?? null) === event.reasonCode &&
    row.recordedById === recordedById
  );
}

function fromExisting(event: SyncWireEvent, row: StoredRow, actorId: string): EventResult {
  if (!sameFact(row, event, actorId)) return rejected(event.clientEventId, "different_mark");
  return { clientEventId: event.clientEventId, outcome: "already_accepted", attendanceId: row.id };
}

export async function registerOfflinePhone(
  actor: Actor,
  localDeviceId: string,
  now: Date,
): Promise<{ ok: true; deviceId: string } | { ok: false; status: 403 | 503; error: string }> {
  const refused = { ok: false as const, status: 403 as const, error: "This phone cannot send marks for this center." };
  const again = { ok: false as const, status: 503 as const, error: "The save did not finish. Save again to retry." };

  const claim = async (deviceId: string): Promise<{ ok: true } | { ok: false; status: 403 | 503; error: string }> => {
    const existing = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, centerId: true, label: true },
    });
    if (!existing) return { ok: true };
    if (existing.centerId !== actor.centerId) return refused;
    // Leave the label alone. The online kiosk device must not be renamed if an id ever collided.
    await prisma.device.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
    return { ok: true };
  };

  try {
    const current = await claim(localDeviceId);
    if (!current.ok) return current;
    const existing = await prisma.device.findUnique({ where: { id: localDeviceId }, select: { id: true } });
    if (existing) return { ok: true, deviceId: existing.id };
    await prisma.device.create({
      data: {
        id: localDeviceId,
        centerId: actor.centerId,
        label: OFFLINE_PHONE_LABEL,
        registeredById: actor.id,
        lastSeenAt: now,
      },
    });
    return { ok: true, deviceId: localDeviceId };
  } catch (error) {
    if (!isUniqueConflict(error)) return again;
    const raced = await claim(localDeviceId);
    if (!raced.ok) return raced;
    return { ok: true, deviceId: localDeviceId };
  }
}

async function loadSession(sessionId: string) {
  if (!isUuid(sessionId)) return null;
  return prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      sectionId: true,
      section: { select: { course: { select: { centerId: true } } } },
    },
  });
}

async function prepareEvent(actor: Actor, event: SyncWireEvent): Promise<EventResult | "ready"> {
  const session = await loadSession(event.classSessionId);
  if (!session || session.sectionId !== event.sectionId) return rejected(event.clientEventId, "unknown_class");
  const centerId = session.section.course.centerId;
  if (centerId !== actor.centerId) return rejected(event.clientEventId, "wrong_center");
  if (!canRecordAttendance(actor, { id: session.sectionId, centerId })) return rejected(event.clientEventId, "forbidden");

  const enrollment = await prisma.enrollment.findFirst({
    where: { sectionId: session.sectionId, learnerId: event.learnerId, status: "ACTIVE" },
    select: { learner: { select: { centerId: true } } },
  });
  if (!enrollment || enrollment.learner.centerId !== actor.centerId) return rejected(event.clientEventId, "not_enrolled");

  if (event.correctsServerEventId) {
    if (!isUuid(event.correctsServerEventId)) return rejected(event.clientEventId, "invalid_correction");
    const prior = await prisma.attendanceRecord.findUnique({
      where: { id: event.correctsServerEventId },
      select: { learnerId: true, sessionId: true },
    });
    if (!prior || prior.learnerId !== event.learnerId || prior.sessionId !== event.classSessionId) {
      return rejected(event.clientEventId, "invalid_correction");
    }
  }
  return "ready";
}

async function clientPredecessor(
  event: SyncWireEvent,
  stored: Map<string, StoredFact>,
  batchIds: Set<string>,
): Promise<"ok" | "defer" | "bad" | "missing"> {
  const priorId = event.correctsClientEventId;
  if (!priorId) return "ok";
  const local = stored.get(priorId);
  if (local) {
    return local.learnerId === event.learnerId && local.sessionId === event.classSessionId ? "ok" : "bad";
  }
  const row = await prisma.attendanceRecord.findUnique({
    where: { clientEventId: priorId },
    select: { learnerId: true, sessionId: true },
  });
  if (row) return row.learnerId === event.learnerId && row.sessionId === event.classSessionId ? "ok" : "bad";
  if (batchIds.has(priorId)) return "defer";
  return "missing";
}

async function insertEvent(actor: Actor, deviceId: string, event: SyncWireEvent): Promise<EventResult> {
  const write = () =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.attendanceRecord.findUnique({
        where: { clientEventId: event.clientEventId },
        select: rowSelect,
      });
      if (existing) return { kind: "existing" as const, row: existing };
      const created = await tx.attendanceRecord.create({
        data: {
          clientEventId: event.clientEventId,
          learnerId: event.learnerId,
          sessionId: event.classSessionId,
          status: event.status,
          reasonCode: event.reasonCode,
          deviceId,
          recordedById: actor.id,
          recordedAt: new Date(event.recordedAt),
          syncedAt: new Date(),
          createdOffline: true,
        },
        select: { id: true },
      });
      return { kind: "created" as const, id: created.id };
    });

  try {
    const saved = await write();
    if (saved.kind === "existing") return fromExisting(event, saved.row, actor.id);
    return { clientEventId: event.clientEventId, outcome: "accepted", attendanceId: saved.id };
  } catch (error) {
    if (!isUniqueConflict(error)) {
      if (isRuleRejection(error)) return rejected(event.clientEventId, "invalid_event");
      return retryable(event.clientEventId, "database");
    }
    const existing = await prisma.attendanceRecord.findUnique({
      where: { clientEventId: event.clientEventId },
      select: rowSelect,
    });
    if (!existing) return retryable(event.clientEventId, "database");
    return fromExisting(event, existing, actor.id);
  }
}

function remember(stored: Map<string, StoredFact>, event: SyncWireEvent, result: EventResult) {
  if ((result.outcome === "accepted" || result.outcome === "already_accepted") && result.attendanceId) {
    stored.set(event.clientEventId, {
      attendanceId: result.attendanceId,
      learnerId: event.learnerId,
      sessionId: event.classSessionId,
    });
  }
}

async function persistSyncBook(input: SyncBookInput): Promise<void> {
  if (input.items.length === 0) return;
  const existing = await prisma.jsonSyncItem.findMany({
    where: { deviceId: input.deviceId, clientMutationId: { in: input.items.map((item) => item.clientEventId) } },
    select: { clientMutationId: true },
  });
  const seen = new Set(existing.map((item) => item.clientMutationId));
  const fresh = input.items.filter((item) => !seen.has(item.clientEventId));
  if (fresh.length === 0) return;
  await prisma.$transaction(async (tx) => {
    const batch = await tx.jsonSyncBatch.create({
      data: {
        deviceId: input.deviceId,
        centerId: input.centerId,
        receivedAt: new Date(),
        itemCount: fresh.length,
        compressedByteSize: input.wireBytes,
      },
      select: { id: true },
    });
    await tx.jsonSyncItem.createMany({
      data: fresh.map((item) => ({
        batchId: batch.id,
        deviceId: input.deviceId,
        entityType: "ATTENDANCE" as const,
        entityId: item.attendanceId,
        clientMutationId: item.clientEventId,
        status: item.status,
      })),
    });
  });
}

function publicResult(result: SyncResult): SyncResult {
  if (result.outcome === "accepted" || result.outcome === "already_accepted") {
    return { clientEventId: result.clientEventId, outcome: result.outcome };
  }
  return { clientEventId: result.clientEventId, outcome: result.outcome, code: result.code ?? "invalid_event" };
}

export async function acceptSyncBatch(
  actor: Actor,
  body: unknown,
  wireBytes: number,
  writeBook: SyncBookWriter = persistSyncBook,
): Promise<HttpResult> {
  const envelope = validateSyncEnvelope(body);
  if (!envelope.ok) return { status: 400, body: { error: "Invalid body." } };

  const device = await registerOfflinePhone(actor, envelope.envelope.localDeviceId, new Date());
  if (!device.ok) return { status: device.status, body: { error: device.error } };

  const events = envelope.envelope.events;
  const batchIds = new Set(events.map((event) => event.clientEventId));
  const stored = new Map<string, StoredFact>();
  const outcomes: Array<EventResult | undefined> = events.map(() => undefined);

  const take = async (index: number): Promise<void> => {
    const event = events[index];
    if (!event || outcomes[index]) return;
    const ready = await prepareEvent(actor, event);
    if (ready !== "ready") {
      outcomes[index] = ready;
      return;
    }
    const prior = await clientPredecessor(event, stored, batchIds);
    if (prior === "defer") return;
    if (prior === "bad") {
      outcomes[index] = rejected(event.clientEventId, "invalid_correction");
      return;
    }
    if (prior === "missing") {
      outcomes[index] = retryable(event.clientEventId, "predecessor");
      return;
    }
    const saved = await insertEvent(actor, device.deviceId, event);
    outcomes[index] = saved;
    remember(stored, event, saved);
  };

  for (let index = 0; index < events.length; index += 1) await take(index);
  for (let index = 0; index < events.length; index += 1) await take(index);

  for (let index = 0; index < events.length; index += 1) {
    if (outcomes[index]) continue;
    const event = events[index];
    if (!event) continue;
    const priorId = event.correctsClientEventId;
    const priorIndex = priorId ? events.findIndex((item) => item.clientEventId === priorId) : -1;
    const priorOutcome = priorIndex >= 0 ? outcomes[priorIndex] : undefined;
    outcomes[index] =
      priorOutcome?.outcome === "rejected"
        ? rejected(event.clientEventId, "invalid_correction")
        : retryable(event.clientEventId, "predecessor");
  }

  const results: EventResult[] = outcomes.map((result, index) => result ?? retryable(events[index]?.clientEventId ?? "", "database"));
  const items: SyncBookItem[] = [];
  for (const result of results) {
    if ((result.outcome !== "accepted" && result.outcome !== "already_accepted") || !result.attendanceId) continue;
    items.push({
      clientEventId: result.clientEventId,
      attendanceId: result.attendanceId,
      status: result.outcome === "accepted" ? "APPLIED" : "DUPLICATE",
    });
  }
  if (items.length > 0) {
    try {
      await writeBook({ deviceId: device.deviceId, centerId: actor.centerId, wireBytes, items });
    } catch {
      // The attendance rows are already stored. A failed bookkeeping note must
      // not make the phone send them as new marks. The next upload sees the
      // same clientEventId and returns already_accepted.
    }
  }

  return { status: 200, body: { results: results.map(publicResult) } };
}
