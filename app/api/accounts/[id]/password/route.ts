import { getActor } from "@/lib/auth/actor";
import { passwordResponse, toResponse } from "@/lib/http/records";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  return toResponse(await passwordResponse(await getActor(), id, password));
}
