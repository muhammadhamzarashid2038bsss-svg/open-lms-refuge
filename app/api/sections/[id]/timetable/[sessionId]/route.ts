import { getActor } from "@/lib/auth/actor";
import { deleteTimetableResponse, updateTimetableResponse } from "@/lib/http/timetable";
import { toResponse } from "@/lib/http/records";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id, sessionId } = await context.params;
  const body = await request.json().catch(() => null);
  return toResponse(await updateTimetableResponse(await getActor(), id, sessionId, body));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id, sessionId } = await context.params;
  return toResponse(await deleteTimetableResponse(await getActor(), id, sessionId));
}
