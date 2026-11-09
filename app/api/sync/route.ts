import { loadActor } from "@/lib/auth/load-actor";
import { readSessionUserId } from "@/lib/auth/session";
import { healthResponse, syncPostAllowed, syncPostResponse } from "@/lib/http/sync";
import { toResponse } from "@/lib/http/records";

// Attendance upload for marks saved on the phone. The cookie session is the
// same one the other API routes use. The response lists one outcome per mark.
export async function POST(request: Request) {
  if (!syncPostAllowed(request)) {
    return toResponse({ status: 403, body: { error: "This page cannot send marks." } });
  }
  const userId = await readSessionUserId();
  if (!userId) return toResponse(healthResponse("anonymous"));
  const actor = await loadActor(userId);
  if (!actor) return toResponse(healthResponse("disabled"));
  return toResponse(await syncPostResponse(actor, request));
}
