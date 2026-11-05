import type { Semester } from "../../generated/prisma/client";
import type { Actor } from "../auth/permissions";
import {
  createCourse,
  createResource,
  createSection,
  deleteResource,
  listCourses,
  readCourse,
  type CreateResourceInput,
} from "../data/courses";

export type HttpResult = { status: number; body: unknown };

function hidden(): HttpResult {
  return { status: 404, body: { error: "Not found." } };
}

function unauthorized(): HttpResult {
  return { status: 401, body: { error: "Sign in required." } };
}

export async function coursesListResponse(actor: Actor | null): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const courses = await listCourses(actor);
  if (!courses) return hidden();
  return { status: 200, body: { courses } };
}

export async function courseDetailResponse(actor: Actor | null, courseId: string): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const course = await readCourse(actor, courseId);
  if (!course) return hidden();
  return { status: 200, body: course };
}

export async function createCourseResponse(actor: Actor | null, body: unknown): Promise<HttpResult> {
  if (!actor) return unauthorized();
  if (!body || typeof body !== "object") return { status: 400, body: { error: "Invalid body." } };
  const data = body as Record<string, unknown>;
  const result = await createCourse(actor, {
    title: String(data.title ?? ""),
    code: String(data.code ?? ""),
    academicYear: Number(data.academicYear),
    semester: String(data.semester ?? "SEMESTER_1") as Semester,
    summary: data.summary != null ? String(data.summary) : null,
    firstSectionName: data.firstSectionName != null ? String(data.firstSectionName) : null,
  });
  if (!result.ok) return { status: 400, body: { error: result.message } };
  return { status: 201, body: { courseId: result.courseId } };
}

export async function createSectionResponse(
  actor: Actor | null,
  courseId: string,
  body: unknown,
): Promise<HttpResult> {
  if (!actor) return unauthorized();
  if (!body || typeof body !== "object") return { status: 400, body: { error: "Invalid body." } };
  const name = String((body as Record<string, unknown>).name ?? "");
  const result = await createSection(actor, courseId, name);
  if (!result.ok) return { status: 400, body: { error: result.message } };
  return { status: 201, body: { sectionId: result.sectionId } };
}

export async function createResourceResponse(actor: Actor | null, body: unknown): Promise<HttpResult> {
  if (!actor) return unauthorized();
  if (!body || typeof body !== "object") return { status: 400, body: { error: "Invalid body." } };
  const data = body as Record<string, unknown>;
  const input: CreateResourceInput = {
    courseId: String(data.courseId ?? ""),
    sectionId: data.sectionId != null && String(data.sectionId).trim() ? String(data.sectionId) : null,
    title: String(data.title ?? ""),
    resourceType: String(data.resourceType ?? "") as CreateResourceInput["resourceType"],
    externalUrl: data.externalUrl != null ? String(data.externalUrl) : null,
    bodyText: data.bodyText != null ? String(data.bodyText) : null,
    storageKey: data.storageKey != null ? String(data.storageKey) : null,
    mimeType: data.mimeType != null ? String(data.mimeType) : null,
    byteSize: data.byteSize != null ? Number(data.byteSize) : null,
    checksumSha256: data.checksumSha256 != null ? String(data.checksumSha256) : null,
  };
  const result = await createResource(actor, input);
  if (!result.ok) return { status: 400, body: { error: result.message } };
  return { status: 201, body: { resourceId: result.resourceId } };
}

export async function deleteResourceResponse(actor: Actor | null, resourceId: string): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const result = await deleteResource(actor, resourceId);
  if (!result.ok) return hidden();
  return { status: 200, body: { message: "Removed." } };
}
