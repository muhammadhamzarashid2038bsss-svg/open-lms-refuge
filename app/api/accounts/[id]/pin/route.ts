import { getActor } from "@/lib/auth/actor";
import { pinResponse, toResponse } from "@/lib/http/records";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin : "";
  return toResponse(await pinResponse(await getActor(), id, pin));
}
