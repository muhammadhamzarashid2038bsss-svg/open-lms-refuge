import { getActor } from "@/lib/auth/actor";
import { attendanceSheetResponse, recordAttendanceResponse } from "@/lib/http/attendance";
import { toResponse } from "@/lib/http/records";

export async function GET(_request: Request, context: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id, sessionId } = await context.params;
  return toResponse(await attendanceSheetResponse(await getActor(), id, sessionId));
}

export async function POST(request: Request, context: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id, sessionId } = await context.params;
  const body = await request.json().catch(() => null);
  return toResponse(await recordAttendanceResponse(await getActor(), id, sessionId, body));
}
