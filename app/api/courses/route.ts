import { getActor } from "@/lib/auth/actor";
import { createCourseResponse, coursesListResponse } from "@/lib/http/lms";
import { toResponse } from "@/lib/http/records";

export async function GET() {
  return toResponse(await coursesListResponse(await getActor()));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  return toResponse(await createCourseResponse(await getActor(), body));
}
