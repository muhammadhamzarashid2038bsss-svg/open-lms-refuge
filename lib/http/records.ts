import type { Actor } from "../auth/permissions";
import { resetLearnerPin, resetStaffPassword, setAccountActive } from "../auth/accounts";
import {
  listAccounts,
  readLearnerContact,
  readLearnerRecord,
  readPrivateFile,
  readResourceRecord,
  readSectionRecord,
} from "../data/records";

export type HttpResult = { status: number; body: unknown };

export function toResponse(result: HttpResult): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}

function hidden(): HttpResult {
  return { status: 404, body: { error: "Not found." } };
}

export async function learnerResponse(actor: Actor | null, learnerId: string): Promise<HttpResult> {
  if (!actor) return { status: 401, body: { error: "Sign in required." } };
  const record = await readLearnerRecord(actor, learnerId);
  if (!record) return hidden();
  return { status: 200, body: record };
}

export async function contactResponse(actor: Actor | null, learnerId: string): Promise<HttpResult> {
  if (!actor) return { status: 401, body: { error: "Sign in required." } };
  const contact = await readLearnerContact(actor, learnerId);
  if (!contact) return hidden();
  return { status: 200, body: contact };
}

export async function sectionResponse(actor: Actor | null, sectionId: string): Promise<HttpResult> {
  if (!actor) return { status: 401, body: { error: "Sign in required." } };
  const section = await readSectionRecord(actor, sectionId);
  if (!section) return hidden();
  return { status: 200, body: section };
}

export async function resourceResponse(actor: Actor | null, resourceId: string): Promise<HttpResult> {
  if (!actor) return { status: 401, body: { error: "Sign in required." } };
  const resource = await readResourceRecord(actor, resourceId);
  if (!resource) return hidden();
  return { status: 200, body: resource };
}

export async function fileResponse(actor: Actor | null, resourceId: string): Promise<HttpResult> {
  if (!actor) return { status: 401, body: { error: "Sign in required." } };
  const file = await readPrivateFile(actor, resourceId);
  if (!file) return hidden();
  return { status: 200, body: file };
}

export async function accountsResponse(actor: Actor | null): Promise<HttpResult> {
  if (!actor) return { status: 401, body: { error: "Sign in required." } };
  const accounts = await listAccounts(actor);
  if (!accounts) return hidden();
  return { status: 200, body: { accounts } };
}

async function accountChange(
  actor: Actor | null,
  run: () => Promise<{ status: "saved" } | { status: "hidden" } | { status: "invalid"; message: string }>,
  saved: string,
): Promise<HttpResult> {
  if (!actor) return { status: 401, body: { error: "Sign in required." } };
  const result = await run();
  if (result.status === "hidden") return hidden();
  if (result.status === "invalid") return { status: 400, body: { error: result.message } };
  return { status: 200, body: { message: saved } };
}

export function pinResponse(actor: Actor | null, learnerId: string, pin: string) {
  return accountChange(
    actor,
    () => resetLearnerPin(actor as Actor, learnerId, pin),
    "The new PIN is saved. Tell the learner in person. It is not kept in a readable form.",
  );
}

export function passwordResponse(actor: Actor | null, userId: string, password: string) {
  return accountChange(
    actor,
    () => resetStaffPassword(actor as Actor, userId, password),
    "The new password is saved. Their old sign-in has been signed out.",
  );
}

export function activeResponse(actor: Actor | null, userId: string, active: boolean) {
  return accountChange(
    actor,
    () => setAccountActive(actor as Actor, userId, active),
    active ? "The account is switched on." : "The account is switched off. Their records stay.",
  );
}
