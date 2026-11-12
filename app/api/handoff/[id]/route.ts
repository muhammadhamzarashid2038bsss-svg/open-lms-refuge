import { loadActor } from "@/lib/auth/load-actor";
import { readSessionUserId } from "@/lib/auth/session";
import { readHandoffReport } from "@/lib/data/handoff";
import { toResponse } from "@/lib/http/records";

const HIDDEN = { error: "That report is not available." };
const FAILED = "The handoff view could not be recorded.";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await readSessionUserId();
  if (!userId) return toResponse({ status: 401, body: { error: "Sign in required." } });
  const actor = await loadActor(userId);
  if (!actor) return toResponse({ status: 403, body: HIDDEN });
  const { id } = await context.params;
  try {
    const report = await readHandoffReport(actor, id, "view");
    if (!report) return toResponse({ status: 404, body: HIDDEN });
    return toResponse({ status: 200, body: report });
  } catch {
    return toResponse({ status: 500, body: { error: FAILED } });
  }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await readSessionUserId();
  if (!userId) return toResponse({ status: 401, body: { error: "Sign in required." } });
  const actor = await loadActor(userId);
  if (!actor) return toResponse({ status: 403, body: HIDDEN });
  const { id } = await context.params;
  try {
    const report = await readHandoffReport(actor, id, "print");
    if (!report) return toResponse({ status: 404, body: HIDDEN });
    return toResponse({ status: 200, body: { recorded: "print-request", reportId: report.id } });
  } catch {
    return toResponse({ status: 500, body: { error: "The print request could not be recorded." } });
  }
}
