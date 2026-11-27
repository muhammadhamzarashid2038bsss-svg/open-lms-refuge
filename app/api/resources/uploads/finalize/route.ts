import { getActor } from "@/lib/auth/actor";
import { finalizeCourseUpload, liveCourseFileDeps, type CourseFileResult } from "@/lib/data/course-files";

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
  const token =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { uploadToken?: unknown }).uploadToken === "string"
      ? (body as { uploadToken: string }).uploadToken
      : "";
  if (!token) return json({ status: 400, body: { error: "This upload request is not valid.", code: "INVALID" } });
  return json(await finalizeCourseUpload(await getActor(), token, liveCourseFileDeps()));
}
