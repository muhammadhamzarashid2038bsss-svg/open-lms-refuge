import { getActor } from "@/lib/auth/actor";
import { sectionResponse, toResponse } from "@/lib/http/records";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return toResponse(await sectionResponse(await getActor(), id));
}
