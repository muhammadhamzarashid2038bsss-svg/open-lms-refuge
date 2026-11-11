// Decides what one note-opening action may show.
// The note list on the records page does not include the note text.
// Text from a successful open stays in the page's memory for this visit.
// It is not written into the phone's view queue.
// A lost connection is the only reason to reuse that memory, and only for a
// note this visit already opened. An HTTP reply, including 401, 403, 404,
// 409, and 500, is the server answering. It is not a lost connection.
// A full reload still cannot show this page: the phone does not keep a copy of it.

export type RememberedNote = {
  body: string;
  skillGaps: string[];
  customSkillTagId: string;
  legacyCustomLabel: string;
};

export const NOTE_NOT_ON_PHONE = "This note's text is not on this phone. Open it once while the connection works.";
export const NOTE_UNAVAILABLE = "That note is not available.";
export const NOTE_VIEW_NOT_RECORDED = "The note view could not be recorded.";
export const NOTE_VIEW_PENDING = "Pending. This opening is saved on this phone and has not been recorded by the server yet.";
export const NOTE_VIEW_RECORDED = "Recorded. The server has this opening.";
export const NOTE_VIEW_REFUSED = "Not recorded. The server refused this opening. It is still on this phone.";

export type NoteOpenDecision =
  | { kind: "online"; note: RememberedNote }
  | { kind: "offline"; note: RememberedNote }
  | { kind: "unavailable"; message: string; forget: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The reply may also contain a learner code or name. Those are not kept.
// The tag id comes from the note list, which does not include the note text.
export function openedNoteFromResponse(value: unknown, customSkillTagId: string): RememberedNote | null {
  if (!isRecord(value) || typeof value.body !== "string" || value.body.length > 2000) return null;
  if (!Array.isArray(value.skillGaps) || value.skillGaps.some((item) => typeof item !== "string")) return null;
  const legacy = value.legacyCustomLabel;
  if (legacy !== null && typeof legacy !== "string") return null;
  return {
    body: value.body,
    skillGaps: [...value.skillGaps],
    customSkillTagId,
    legacyCustomLabel: typeof legacy === "string" ? legacy : "",
  };
}

export function decideNoteOpen(input: {
  reachedServer: boolean;
  httpStatus: number | null;
  opened: RememberedNote | null;
  remembered: RememberedNote | null;
}): NoteOpenDecision {
  // No HTTP response at all: the connection failed before the server answered.
  if (!input.reachedServer) {
    if (input.remembered) return { kind: "offline", note: input.remembered };
    return { kind: "unavailable", message: NOTE_NOT_ON_PHONE, forget: false };
  }
  if (input.httpStatus === 200 && input.opened) return { kind: "online", note: input.opened };
  // Any other HTTP status is an answer from the server. Do not reuse memory.
  return {
    kind: "unavailable",
    message: input.httpStatus === 500 ? NOTE_VIEW_NOT_RECORDED : NOTE_UNAVAILABLE,
    forget: true,
  };
}

export function viewStatusText(state: "pending" | "acknowledged" | "rejected"): string {
  if (state === "pending") return NOTE_VIEW_PENDING;
  if (state === "acknowledged") return NOTE_VIEW_RECORDED;
  return NOTE_VIEW_REFUSED;
}
