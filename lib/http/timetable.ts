import type { Actor } from "../auth/permissions";
import {
  createTimetableSession,
  deleteTimetableSession,
  readWeeklyTimetable,
  updateTimetableSession,
  type TimetableFailure,
} from "../data/timetable";
import type { HttpResult } from "./records";

function hidden(): HttpResult {
  return { status: 404, body: { error: "Not found." } };
}

function unauthorized(): HttpResult {
  return { status: 401, body: { error: "Sign in required." } };
}

function fromFailure(result: TimetableFailure): HttpResult {
  if (result.code === "denied") return hidden();
  return { status: 400, body: { error: result.message } };
}

function readBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  return body as Record<string, unknown>;
}

function timetableInput(data: Record<string, unknown>) {
  return {
    title: String(data.title ?? ""),
    weekday: String(data.weekday ?? ""),
    startTime: String(data.startTime ?? ""),
    endTime: String(data.endTime ?? ""),
    weekOf: String(data.weekOf ?? ""),
    deliveryMode: String(data.deliveryMode ?? ""),
    meetingUrl: data.meetingUrl != null ? String(data.meetingUrl) : null,
    linkedResourceId: data.linkedResourceId != null ? String(data.linkedResourceId) : null,
  };
}

export async function timetableResponse(
  actor: Actor | null,
  sectionId: string,
  weekOf: string | null,
): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const result = await readWeeklyTimetable(actor, sectionId, weekOf);
  if (result.kind === "hidden") return hidden();
  if (result.kind === "invalid-timezone") {
    return { status: 400, body: { error: "The center clock setting needs a fix before the timetable can be shown." } };
  }
  return { status: 200, body: result.timetable };
}

export async function createTimetableResponse(
  actor: Actor | null,
  sectionId: string,
  body: unknown,
): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const data = readBody(body);
  if (!data) return { status: 400, body: { error: "Invalid body." } };
  const result = await createTimetableSession(actor, sectionId, timetableInput(data));
  if (!result.ok) return fromFailure(result);
  return { status: 201, body: { sessionId: result.sessionId } };
}

export async function updateTimetableResponse(
  actor: Actor | null,
  sectionId: string,
  sessionId: string,
  body: unknown,
): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const data = readBody(body);
  if (!data) return { status: 400, body: { error: "Invalid body." } };
  const statusRaw = data.status != null ? String(data.status) : null;
  const status = statusRaw === "SCHEDULED" || statusRaw === "CANCELLED" ? statusRaw : null;
  const result = await updateTimetableSession(actor, sectionId, sessionId, {
    ...timetableInput(data),
    status,
  });
  if (!result.ok) return fromFailure(result);
  return { status: 200, body: { message: "Saved." } };
}

export async function deleteTimetableResponse(
  actor: Actor | null,
  sectionId: string,
  sessionId: string,
): Promise<HttpResult> {
  if (!actor) return unauthorized();
  const result = await deleteTimetableSession(actor, sectionId, sessionId);
  if (!result.ok) return fromFailure(result);
  return { status: 200, body: { message: "Removed." } };
}
