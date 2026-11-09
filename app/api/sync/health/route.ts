import { loadActor } from "@/lib/auth/load-actor";
import { readSessionUserId } from "@/lib/auth/session";
import { healthResponse } from "@/lib/http/sync";
import { toResponse } from "@/lib/http/records";

// A real request through the session, not the phone's online flag. A missing
// or expired session is 401. A session whose account is switched off, or gone,
// is 403. Both are JSON. This route does not redirect to the sign-in page.
export async function GET() {
  const userId = await readSessionUserId();
  if (!userId) return toResponse(healthResponse("anonymous"));
  const actor = await loadActor(userId);
  if (!actor) return toResponse(healthResponse("disabled"));
  return toResponse(healthResponse("ok"));
}
