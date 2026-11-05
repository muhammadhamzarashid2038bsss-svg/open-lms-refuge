import { getActor } from "@/lib/auth/actor";
import { createSectionResponse } from "@/lib/http/lms";
import { toResponse } from "@/lib/http/records";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  return toResponse(await createSectionResponse(await getActor(), id, body));
}
