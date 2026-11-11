import { loadActor } from "@/lib/auth/load-actor";
import { readSessionUserId } from "@/lib/auth/session";
import { readProgressNote, NOTE_VIEW_FAILED } from "@/lib/data/progress-notes";
import { toResponse } from "@/lib/http/records";

const HIDDEN = { error: "That note is not available." };

// One note, after the server has recorded the view. A guess and a forbidden
// id use the same response and do not include note text.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await readSessionUserId();
  if (!userId) return toResponse({ status: 401, body: { error: "Sign in required." } });
  const actor = await loadActor(userId);
  if (!actor) return toResponse({ status: 403, body: HIDDEN });
  const { id } = await context.params;
  try {
    const note = await readProgressNote(actor, id);
    if (!note) return toResponse({ status: 404, body: HIDDEN });
    return toResponse({ status: 200, body: note });
  } catch (error) {
    if (error instanceof Error && error.message === NOTE_VIEW_FAILED) {
      return toResponse({ status: 500, body: { error: NOTE_VIEW_FAILED } });
    }
    return toResponse({ status: 500, body: { error: NOTE_VIEW_FAILED } });
  }
}
