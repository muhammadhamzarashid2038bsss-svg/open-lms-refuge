// Applies queued progress-note view receipts.
// The actor comes from the signed-in session. A repeated event id with the
// same note id is recorded once. The same id with a different note is refused.
// Nothing here edits the note or opens a conflict.
// The audit clock is the server time on the audit row. The phone time is not copied there.

import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { canViewProgressNote, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import { writeNoteViewAudits } from "./progress-notes";
import { registerOfflinePhone } from "./sync-attendance";
import type { HttpResult } from "../http/records";
import { validateNoteViewEnvelope, type NoteViewEvent } from "../sync/note-view-batch";

export type NoteViewOutcome = "accepted" | "already_accepted" | "rejected" | "retryable_failure";

export type NoteViewResult = {
  clientEventId: string;
  outcome: NoteViewOutcome;
  code?: string;
};

type Tx = Prisma.TransactionClient;

function rejected(clientEventId: string, code: string): NoteViewResult {
  return { clientEventId, outcome: "rejected", code };
}

function retryable(clientEventId: string, code: string): NoteViewResult {
  return { clientEventId, outcome: "retryable_failure", code };
}

function fingerprintOf(event: NoteViewEvent): string {
  return createHash("sha256")
    .update(JSON.stringify({
      clientEventId: event.clientEventId,
      deviceReportedAt: event.deviceReportedAt,
      noteId: event.noteId,
    }))
    .digest("hex");
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function writeItem(
  tx: Tx,
  input: {
    deviceId: string;
    centerId: string;
    noteId: string;
    clientEventId: string;
    status: "APPLIED" | "REJECTED";
    fingerprint: string;
  },
): Promise<void> {
  const batch = await tx.jsonSyncBatch.create({
    data: {
      deviceId: input.deviceId,
      centerId: input.centerId,
      receivedAt: new Date(),
      itemCount: 1,
      compressedByteSize: 0,
    },
    select: { id: true },
  });
  await tx.jsonSyncItem.create({
    data: {
      batchId: batch.id,
      deviceId: input.deviceId,
      entityType: "NOTE_VIEW",
      entityId: input.noteId,
      clientMutationId: input.clientEventId,
      status: input.status,
      contentFingerprint: input.fingerprint,
    },
  });
}

async function applyEvent(tx: Tx, actor: Actor, deviceId: string, event: NoteViewEvent, fingerprint: string): Promise<NoteViewResult> {
  const prior = await tx.jsonSyncItem.findUnique({
    where: { deviceId_clientMutationId: { deviceId, clientMutationId: event.clientEventId } },
    select: { entityType: true, entityId: true, status: true, contentFingerprint: true },
  });
  if (prior) {
    if (prior.entityType !== "NOTE_VIEW" || prior.contentFingerprint !== fingerprint) {
      return rejected(event.clientEventId, "event_mismatch");
    }
    if (prior.status === "APPLIED" || prior.status === "DUPLICATE") {
      return { clientEventId: event.clientEventId, outcome: "already_accepted" };
    }
    if (prior.status === "REJECTED") return rejected(event.clientEventId, "forbidden");
    return retryable(event.clientEventId, "database");
  }

  const note = await tx.progressNote.findUnique({
    where: { id: event.noteId },
    select: { id: true, sectionId: true, section: { select: { course: { select: { centerId: true } } } } },
  });
  // The note edit may still be waiting on this phone. Keep the view pending
  // instead of closing it, so a later retry can be audited.
  if (!note) return retryable(event.clientEventId, "not_ready");
  const allowed = canViewProgressNote(actor, {
    centerId: note.section.course.centerId,
    sectionId: note.sectionId,
  });
  // A shared center phone uses one device id for every teacher who signs in.
  // Saving this refusal would occupy the event id, and the assigned teacher
  // could never record the view.
  if (!allowed) return rejected(event.clientEventId, "forbidden");

  await writeNoteViewAudits(tx, actor, [note.id], { source: "offline", clientEventId: event.clientEventId });
  await writeItem(tx, {
    deviceId,
    centerId: actor.centerId,
    noteId: note.id,
    clientEventId: event.clientEventId,
    status: "APPLIED",
    fingerprint,
  });
  return { clientEventId: event.clientEventId, outcome: "accepted" };
}

async function applyWithRetry(actor: Actor, deviceId: string, event: NoteViewEvent): Promise<NoteViewResult> {
  const fingerprint = fingerprintOf(event);
  const run = () => prisma.$transaction((tx) => applyEvent(tx, actor, deviceId, event, fingerprint), { timeout: 20000 });
  try {
    return await run();
  } catch (error) {
    if (isUniqueConflict(error)) {
      try {
        return await run();
      } catch {
        return retryable(event.clientEventId, "database");
      }
    }
    return retryable(event.clientEventId, "database");
  }
}

export async function acceptNoteViewBatch(actor: Actor, body: unknown): Promise<HttpResult> {
  if (!actor.active || (actor.role !== "TEACHER" && actor.role !== "CENTER_DIRECTOR")) {
    return { status: 403, body: { error: "You cannot record note views." } };
  }
  const envelope = validateNoteViewEnvelope(body);
  if (!envelope.ok) return { status: 400, body: { error: "Invalid body." } };
  const device = await registerOfflinePhone(actor, envelope.localDeviceId, new Date());
  if (!device.ok) return { status: device.status, body: { error: device.error } };

  const results: NoteViewResult[] = [];
  for (const item of envelope.items) {
    if (!item.ok) {
      results.push(rejected(item.clientEventId, item.code));
      continue;
    }
    results.push(await applyWithRetry(actor, device.deviceId, item.event));
  }
  return { status: 200, body: { results } };
}
