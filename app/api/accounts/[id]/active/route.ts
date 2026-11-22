import { getActor } from "@/lib/auth/actor";
import { activeResponse, toResponse } from "@/lib/http/records";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { active?: unknown; incomingTeacherId?: unknown } | null;
  if (typeof body?.active !== "boolean") {
    return toResponse({ status: 400, body: { error: "Say whether the account should be on or off." } });
  }
  let incomingTeacherId: string | null = null;
  if (body.incomingTeacherId !== undefined && body.incomingTeacherId !== null) {
    if (typeof body.incomingTeacherId !== "string") {
      return toResponse({ status: 400, body: { error: "Choose a teacher from this centre, or leave the incoming teacher blank." } });
    }
    const trimmed = body.incomingTeacherId.trim();
    incomingTeacherId = trimmed.length > 0 ? trimmed : null;
  }
  return toResponse(await activeResponse(await getActor(), id, body.active, incomingTeacherId));
}
