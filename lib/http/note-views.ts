// View receipts stay on their own route so a note edit cannot be mistaken
// for a view, and a view cannot change a note.

import type { Actor } from "@/lib/auth/permissions";
import { acceptNoteViewBatch } from "@/lib/data/note-view-sync";
import type { HttpResult } from "@/lib/http/records";
import { readSyncBody } from "@/lib/http/sync";

export async function noteViewSyncPostResponse(actor: Actor, request: Request): Promise<HttpResult> {
  if (!actor.active || (actor.role !== "TEACHER" && actor.role !== "CENTER_DIRECTOR")) {
    return { status: 403, body: { error: "You cannot record note views." } };
  }
  const body = await readSyncBody(request);
  if (!body.ok) return { status: body.status, body: { error: body.error } };
  return acceptNoteViewBatch(actor, body.json);
}
