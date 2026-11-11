import { describe, expect, it } from "vitest";
import {
  NOTE_NOT_ON_PHONE,
  NOTE_UNAVAILABLE,
  NOTE_VIEW_NOT_RECORDED,
  decideNoteOpen,
  openedNoteFromResponse,
  type RememberedNote,
} from "../lib/device/note-open";

const opened: RememberedNote = {
  body: "Learner participates well in reading activities.",
  skillGaps: ["READING"],
  customSkillTagId: "",
  legacyCustomLabel: "",
};

const remembered: RememberedNote = {
  body: "Needs more time with number sense.",
  skillGaps: ["NUMBER_SENSE"],
  customSkillTagId: "00000000-0000-4000-8000-000000001199",
  legacyCustomLabel: "map reading",
};

describe("one note opening", () => {
  it("shows the note returned by the server while online", () => {
    expect(decideNoteOpen({ reachedServer: true, httpStatus: 200, opened, remembered })).toEqual({ kind: "online", note: opened });
  });

  it("reuses a note this visit already opened when the connection fails", () => {
    expect(decideNoteOpen({ reachedServer: false, httpStatus: null, opened: null, remembered })).toEqual({ kind: "offline", note: remembered });
  });

  it("does not invent a note that this visit has not opened", () => {
    expect(decideNoteOpen({ reachedServer: false, httpStatus: null, opened: null, remembered: null })).toEqual({
      kind: "unavailable",
      message: NOTE_NOT_ON_PHONE,
      forget: false,
    });
  });

  it.each([401, 403, 404, 409, 500])("does not reuse an opened note after HTTP %s", (httpStatus) => {
    const decision = decideNoteOpen({ reachedServer: true, httpStatus, opened: null, remembered });
    expect(decision.kind).toBe("unavailable");
    if (decision.kind !== "unavailable") return;
    expect(decision.forget).toBe(true);
    expect(decision.message).toBe(httpStatus === 500 ? NOTE_VIEW_NOT_RECORDED : NOTE_UNAVAILABLE);
    expect(JSON.stringify(decision)).not.toContain(remembered.body);
    expect(JSON.stringify(decision)).not.toContain("map reading");
  });

  it("keeps the note text and drops the learner code from a successful reply", () => {
    const parsed = openedNoteFromResponse(
      { body: opened.body, skillGaps: ["READING"], legacyCustomLabel: "map reading", learnerCode: "LNR-0001", learnerName: "Demo Learner 01" },
      "",
    );
    expect(parsed).toEqual({ ...opened, legacyCustomLabel: "map reading" });
    expect(parsed && "learnerCode" in parsed).toBe(false);
  });
});
