// Sends pending grade and note edits while a person asks for it.
// Nothing here deletes a local row. A failed send leaves the edit pending.
// Attendance is not included. Homework file bytes are not included.

import { listLocalRecords, markLocalRecords, type LocalRecordMutation, type LocalSyncState } from "@/lib/device/local-records";
import { RECORD_SYNC_VERSION, type GradeMutation, type NoteMutation } from "@/lib/sync/record-batch";

export const RECORD_SYNC_PATH = "/api/sync/records";

type Account = { centerId: string; userId: string };

type WireResult = {
  clientMutationId?: string;
  outcome?: string;
  code?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toWire(mutation: LocalRecordMutation): GradeMutation | NoteMutation | null {
  const shared = {
    clientMutationId: mutation.clientMutationId,
    recordId: mutation.recordId,
    versionVector: mutation.versionVector,
    deviceRecordedAt: mutation.deviceRecordedAt,
    createdOffline: mutation.createdOffline,
  };
  if (mutation.entityType === "GRADE_ENTRY") {
    if (!("points" in mutation.content)) return null;
    return {
      entityType: "GRADE_ENTRY",
      ...shared,
      assignmentId: mutation.content.assignmentId,
      learnerId: mutation.content.learnerId,
      points: mutation.content.points,
      academicNote: mutation.content.academicNote,
    };
  }
  if (!("body" in mutation.content)) return null;
  return {
    entityType: "PROGRESS_NOTE",
    ...shared,
    sectionId: mutation.content.sectionId,
    learnerId: mutation.content.learnerId,
    body: mutation.content.body,
    skillGaps: mutation.content.skillGaps,
    customSkillLabel: mutation.content.customSkillLabel ?? null,
    customSkillTagId: "customSkillTagId" in mutation.content ? mutation.content.customSkillTagId : null,
  };
}

function nextState(outcome: string): LocalSyncState | null {
  if (outcome === "accepted" || outcome === "already_accepted") return "acknowledged";
  if (outcome === "conflict") return "conflict";
  if (outcome === "stale") return "stale";
  if (outcome === "rejected") return "rejected";
  return null;
}

export async function syncLocalRecords(input: {
  factory: IDBFactory;
  account: Account;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; message: string; pending: number }> {
  const loaded = await listLocalRecords(input.factory, input.account);
  if (!loaded.ok) return { ok: false, message: loaded.message, pending: 0 };
  if (!loaded.deviceId) return { ok: true, message: "There is no edit waiting on this phone.", pending: 0 };
  const pending = loaded.mutations
    .filter((mutation) => mutation.syncState === "pending")
    .sort((left, right) => (left.versionVector[loaded.deviceId!] ?? 0) - (right.versionVector[loaded.deviceId!] ?? 0));
  if (pending.length === 0) return { ok: true, message: "There is no edit waiting on this phone.", pending: 0 };

  const batch = pending.slice(0, 10);
  const mutations = batch.map(toWire).filter((mutation) => mutation !== null);
  if (mutations.length !== batch.length) {
    return { ok: false, message: "A saved edit could not be read. It was not deleted.", pending: pending.length };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(RECORD_SYNC_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: RECORD_SYNC_VERSION, localDeviceId: loaded.deviceId, mutations }),
    });
  } catch {
    return { ok: false, message: "The edits are still on this phone. The server could not be reached.", pending: pending.length };
  }
  if (!response.ok) {
    return { ok: false, message: "The edits are still on this phone. They were not confirmed.", pending: pending.length };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: "The edits are still on this phone. The reply could not be read.", pending: pending.length };
  }
  if (!isRecord(body) || !Array.isArray(body.results)) {
    return { ok: false, message: "The edits are still on this phone. The reply could not be read.", pending: pending.length };
  }
  const updates: { clientMutationId: string; syncState: LocalSyncState }[] = [];
  for (const result of body.results as WireResult[]) {
    if (!result || typeof result.clientMutationId !== "string" || typeof result.outcome !== "string") continue;
    const state = nextState(result.outcome);
    if (!state) continue;
    if (!batch.some((mutation) => mutation.clientMutationId === result.clientMutationId)) continue;
    updates.push({ clientMutationId: result.clientMutationId, syncState: state });
  }
  if (updates.length > 0) {
    const marked = await markLocalRecords(input.factory, input.account, updates);
    if (!marked) {
      return { ok: false, message: "The server replied, but this phone could not record that. The edits are still here.", pending: pending.length };
    }
  }
  const after = await listLocalRecords(input.factory, input.account);
  const still = after.ok ? after.mutations.filter((mutation) => mutation.syncState === "pending").length : pending.length;
  if (!after.ok) return { ok: false, message: after.message, pending: still };
  if (still > 0) return { ok: false, message: "Some edits are still on this phone, waiting to send.", pending: still };
  return { ok: true, message: "The saved edits were sent. They are still kept on this phone.", pending: 0 };
}
