import { getActor } from "@/lib/auth/actor";
import { activeResponse, toResponse } from "@/lib/http/records";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { active?: unknown } | null;
  if (typeof body?.active !== "boolean") {
    return toResponse({ status: 400, body: { error: "Say whether the account should be on or off." } });
  }
  return toResponse(await activeResponse(await getActor(), id, body.active));
}
