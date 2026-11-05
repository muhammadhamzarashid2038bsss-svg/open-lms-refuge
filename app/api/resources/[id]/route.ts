import { getActor } from "@/lib/auth/actor";
import { deleteResourceResponse } from "@/lib/http/lms";
import { resourceResponse, toResponse } from "@/lib/http/records";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return toResponse(await resourceResponse(await getActor(), id));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return toResponse(await deleteResourceResponse(await getActor(), id));
}
