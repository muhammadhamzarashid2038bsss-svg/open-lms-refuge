import { getActor } from "@/lib/auth/actor";
import { createTimetableResponse, timetableResponse } from "@/lib/http/timetable";
import { toResponse } from "@/lib/http/records";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const week = new URL(request.url).searchParams.get("week");
  return toResponse(await timetableResponse(await getActor(), id, week));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  return toResponse(await createTimetableResponse(await getActor(), id, body));
}
