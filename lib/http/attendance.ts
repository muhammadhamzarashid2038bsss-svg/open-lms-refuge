import type { Actor } from "../auth/permissions";
import { readAttendanceSheet, recordAttendance, type AttendanceFailure } from "../data/attendance";
import type { MarkDraftInput } from "../lms/attendance";
import type { HttpResult } from "./records";

function hidden(): HttpResult {
  return { status: 404, body: { error: "Not found." } };
}

function unauthorized(): HttpResult {
  return { status: 401, body: { error: "Sign in required." } };
}

function fromFailure(result: AttendanceFailure): HttpResult {
  if (result.code === "denied") return hidden();
  if (result.code === "conflict") return { status: 409, body: { error: result.message } };
  return { status: 400, body: { error: result.message } };
}

function readMark(value: unknown): MarkDraftInput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.learnerId !== "string" || typeof row.status !== "string" || typeof row.clientEventId !== "string") {
    return null;
  }
  if (row.reasonCode !== null && row.reasonCode !== undefined && typeof row.reasonCode !== "string") return null;
  if (row.recordedAt !== null && row.recordedAt !== undefined && typeof row.recordedAt !== "string") return null;
  // Family notes are not a field. Anything else on the object is ignored.
  return {
    learnerId: row.learnerId,
    status: row.status,
    reasonCode: typeof row.reasonCode === "string" ? row.reasonCode : null,
    clientEventId: row.clientEventId,
    recordedAt: typeof row.recordedAt === "string" ? row.recordedAt : null,
  };
}

export function readMarks(body: unknown): MarkDraftInput[] | null {
  if (!body || typeof body !== "object") return null;
  const marks = (body as { marks?: unknown }).marks;
  if (!Array.isArray(marks)) return null;
  const parsed: MarkDraftInput[] = [];
  for (const item of marks) {
    const mark = readMark(item);
    if (!mark) return null;
    parsed.push(mark);
  }
  return parsed;
}

export async function attendanceSheetResponse(
  actor: Actor | null,
  sectionId: string,
  sessionId: string,
): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const result = await readAttendanceSheet(actor, sectionId, sessionId);
  if (result.kind === "hidden") return hidden();
  return { status: 200, body: result.sheet };
}

export async function recordAttendanceResponse(
  actor: Actor | null,
  sectionId: string,
  sessionId: string,
  body: unknown,
): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const marks = readMarks(body);
  if (!marks) return { status: 400, body: { error: "Invalid body." } };
  const result = await recordAttendance(actor, sectionId, sessionId, marks);
  if (!result.ok) return fromFailure(result);
  return { status: 200, body: { created: result.created, alreadyStored: result.alreadyStored } };
}
