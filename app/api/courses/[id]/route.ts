import { getActor } from "@/lib/auth/actor";
import { courseDetailResponse } from "@/lib/http/lms";
import { toResponse } from "@/lib/http/records";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return toResponse(await courseDetailResponse(await getActor(), id));
}
