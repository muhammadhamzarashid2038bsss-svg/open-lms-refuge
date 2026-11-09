// Grade and note upload. Attendance keeps its own route and its own envelope.
// Only an assigned teacher can send these edits. The check happens before a
// device row is created for an account that is not allowed to edit them.

import type { Actor } from "@/lib/auth/permissions";
import { acceptRecordBatch } from "@/lib/data/sync-records";
import type { HttpResult } from "@/lib/http/records";
import { readSyncBody, syncPostAllowed } from "@/lib/http/sync";

export { syncPostAllowed };

export async function recordSyncPostResponse(actor: Actor, request: Request): Promise<HttpResult> {
  if (!actor.active || actor.role !== "TEACHER") {
    return { status: 403, body: { error: "You cannot edit grades or notes." } };
  }
  const body = await readSyncBody(request);
  if (!body.ok) return { status: body.status, body: { error: body.error } };
  return acceptRecordBatch(actor, body.json, body.wireBytes);
}
