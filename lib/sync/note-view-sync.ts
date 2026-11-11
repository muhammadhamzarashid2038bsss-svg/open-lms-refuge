// Sends pending note-view receipts. A failed send leaves them pending.
// An acknowledged or rejected row stays on the phone. This file does not
// send note text, and it does not send another account's rows.

import { listLocalNoteViews, markLocalNoteViews, type LocalNoteView, type NoteViewSyncState } from "@/lib/device/note-views";
import { NOTE_VIEW_SYNC_VERSION, type NoteViewEvent } from "@/lib/sync/note-view-batch";

export const NOTE_VIEW_SYNC_PATH = "/api/sync/note-views";

type Account = { centerId: string; userId: string };

type WireResult = { clientEventId?: string; outcome?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toWire(event: LocalNoteView): NoteViewEvent {
  return {
    clientEventId: event.clientEventId,
    noteId: event.noteId,
    deviceReportedAt: event.deviceReportedAt,
  };
}

function nextState(outcome: string): NoteViewSyncState | null {
  if (outcome === "accepted" || outcome === "already_accepted") return "acknowledged";
  if (outcome === "rejected") return "rejected";
  return null;
}

export async function syncLocalNoteViews(input: {
  factory: IDBFactory;
  account: Account;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; message: string; pending: number }> {
  const loaded = await listLocalNoteViews(input.factory, input.account);
  if (!loaded.ok) return { ok: false, message: loaded.message, pending: 0 };
  if (!loaded.deviceId) return { ok: true, message: "There is no note-view record waiting on this phone.", pending: 0 };
  const pending = loaded.events.filter((event) => event.syncState === "pending");
  if (pending.length === 0) return { ok: true, message: "There is no note-view record waiting on this phone.", pending: 0 };

  const batch = pending.slice(0, 10);
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(NOTE_VIEW_SYNC_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: NOTE_VIEW_SYNC_VERSION, localDeviceId: loaded.deviceId, events: batch.map(toWire) }),
    });
  } catch {
    return { ok: false, message: "The note-view records are still on this phone. The server could not be reached.", pending: pending.length };
  }
  if (!response.ok) {
    return { ok: false, message: "The note-view records are still on this phone. They were not confirmed.", pending: pending.length };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: "The note-view records are still on this phone. The reply could not be read.", pending: pending.length };
  }
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return { ok: false, message: "The note-view records are still on this phone. The reply could not be read.", pending: pending.length };
  }
  const updates: { clientEventId: string; syncState: NoteViewSyncState }[] = [];
  for (const result of body.results as WireResult[]) {
    if (!result || typeof result.clientEventId !== "string" || typeof result.outcome !== "string") continue;
    const state = nextState(result.outcome);
    if (!state) continue;
    if (!batch.some((event) => event.clientEventId === result.clientEventId)) continue;
    updates.push({ clientEventId: result.clientEventId, syncState: state });
  }
  if (updates.length > 0) {
    const marked = await markLocalNoteViews(input.factory, input.account, updates);
    if (!marked) {
      return { ok: false, message: "The server replied, but this phone could not record that. The note-view records are still here.", pending: pending.length };
    }
  }
  const after = await listLocalNoteViews(input.factory, input.account);
  const still = after.ok ? after.events.filter((event) => event.syncState === "pending").length : pending.length;
  if (!after.ok) return { ok: false, message: after.message, pending: still };
  if (still > 0) return { ok: false, message: "Some note-view records are still on this phone, waiting to send.", pending: still };
  const rejected = after.events.filter((event) => event.syncState === "rejected").length;
  if (rejected > 0) {
    return { ok: false, message: "Some note-view records were refused. They are still on this phone and were not recorded as audited.", pending: 0 };
  }
  return { ok: true, message: "The note-view records were recorded.", pending: 0 };
}
