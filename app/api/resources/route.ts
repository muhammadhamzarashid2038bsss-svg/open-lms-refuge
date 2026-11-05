import { getActor } from "@/lib/auth/actor";
import { createResourceResponse } from "@/lib/http/lms";
import { toResponse } from "@/lib/http/records";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  return toResponse(await createResourceResponse(await getActor(), body));
}
