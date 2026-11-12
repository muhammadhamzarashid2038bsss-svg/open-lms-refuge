import { loadActor } from "@/lib/auth/load-actor";
import { readSessionUserId } from "@/lib/auth/session";
import { listAuditLog } from "@/lib/data/handoff";
import { toResponse } from "@/lib/http/records";

const HIDDEN = { error: "That log is not available." };

export async function GET(request: Request) {
  const userId = await readSessionUserId();
  if (!userId) return toResponse({ status: 401, body: { error: "Sign in required." } });
  const actor = await loadActor(userId);
  if (!actor) return toResponse({ status: 403, body: HIDDEN });
  const url = new URL(request.url);
  const page = await listAuditLog(actor, {
    action: url.searchParams.get("action") ?? undefined,
    entityType: url.searchParams.get("entityType") ?? undefined,
    actorId: url.searchParams.get("actorId") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!page) return toResponse({ status: 404, body: HIDDEN });
  return toResponse({ status: 200, body: page });
}
