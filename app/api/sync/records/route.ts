import { loadActor } from "@/lib/auth/load-actor";
import { readSessionUserId } from "@/lib/auth/session";
import { healthResponse } from "@/lib/http/sync";
import { recordSyncPostResponse, syncPostAllowed } from "@/lib/http/sync-records";
import { toResponse } from "@/lib/http/records";

// Offline grades and progress notes. This is not the attendance upload.
// Attendance still uses POST /api/sync and is unchanged.
export async function POST(request: Request) {
  if (!syncPostAllowed(request)) {
    return toResponse({ status: 403, body: { error: "This page cannot send edits." } });
  }
  const userId = await readSessionUserId();
  if (!userId) return toResponse(healthResponse("anonymous"));
  const actor = await loadActor(userId);
  if (!actor) return toResponse(healthResponse("disabled"));
  return toResponse(await recordSyncPostResponse(actor, request));
}
