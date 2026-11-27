import { getActor } from "@/lib/auth/actor";
import { beginCourseUpload, liveCourseFileDeps, type CourseFileResult } from "@/lib/data/course-files";

function json(result: CourseFileResult): Response {
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ status: 400, body: { error: "This upload request is not valid.", code: "INVALID" } });
  }
  return json(await beginCourseUpload(await getActor(), body as Record<string, unknown>, liveCourseFileDeps()));
}
