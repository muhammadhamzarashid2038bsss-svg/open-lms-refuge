import { getActor } from "@/lib/auth/actor";
import { courseResourceDownloadResponse, liveCourseFileDeps } from "@/lib/data/course-files";
import { readResourceObject } from "@/lib/data/courses";

// Demo rows still use filler bytes because their keys are not objects in the
// private bucket. A course-resources key is a real file and is opened with a
// two-minute link. The page address stays /api/resources/{id}/download.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const deps = liveCourseFileDeps();
  return courseResourceDownloadResponse(await getActor(), id, { storage: deps.storage, load: readResourceObject });
}
