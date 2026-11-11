import { loadActor } from "@/lib/auth/load-actor";
import { readSessionUserId } from "@/lib/auth/session";
import { healthResponse } from "@/lib/http/sync";
import { noteViewSyncPostResponse } from "@/lib/http/note-views";
import { toResponse } from "@/lib/http/records";
import { syncPostAllowed } from "@/lib/http/sync";

// Offline progress-note view receipts. This route does not accept note text.
export async function POST(request: Request) {
  if (!syncPostAllowed(request)) {
    return toResponse({ status: 403, body: { error: "This page cannot send view records." } });
  }
  const userId = await readSessionUserId();
  if (!userId) return toResponse(healthResponse("anonymous"));
  const actor = await loadActor(userId);
  if (!actor) return toResponse(healthResponse("disabled"));
  return toResponse(await noteViewSyncPostResponse(actor, request));
}
