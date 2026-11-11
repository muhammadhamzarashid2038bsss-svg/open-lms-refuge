// @vitest-environment happy-dom
// Renders the real editor and fires the note dropdown's change event.
// Opening a note asks the server for that note. The list does not contain
// the note text. A lost connection can reuse text this visit already opened,
// and only after the phone has stored the view event.

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfflineRecordEditor } from "@/components/offline-record-editor";
import type { RecordCatalog } from "@/lib/data/record-catalog";
import { listLocalNoteViews } from "@/lib/device/note-views";
import { NOTE_NOT_ON_PHONE, NOTE_UNAVAILABLE, NOTE_VIEW_NOT_RECORDED, NOTE_VIEW_PENDING, NOTE_VIEW_RECORDED } from "@/lib/device/note-open";

const centerId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000004";
const sectionId = "00000000-0000-4000-8000-00000000000b";
const learnerId = "00000000-0000-4000-8000-0000000000c8";
const readingId = "21bb34d2-98ad-4792-91bc-9e46b7bcef7e";
const otherId = "00000000-0000-4000-8000-000000001771";
const readingBody = "Learner participates well in reading activities and is improving in comprehension.";
const otherBody = "Demo note: letter sounds for A to E are in progress.";
const kept = "This phone is keeping a private record that the note was opened. The note text is not in that record.";
const notKept = "This phone could not record that the note was opened. Nothing already stored was deleted.";

const catalog: RecordCatalog = {
  sections: [
    {
      id: sectionId,
      name: "Morning Group",
      assignments: [{ id: "00000000-0000-4000-8000-00000000044f", title: "Demo midterm paper", maxPoints: "100.00" }],
      learners: [{ id: learnerId, learnerCode: "LNR-0001", displayName: "Demo Learner 01" }],
    },
  ],
  grades: [],
  skillTags: [],
  notes: [
    {
      id: otherId,
      sectionId,
      learnerId,
      skillGaps: ["WRITING"],
      customSkillTagId: null,
      customSkillTagName: null,
      customSkillTagActive: false,
      versionVector: { "00000000-0000-4000-8000-0000000000d1": 1 },
      provisional: false,
    },
    {
      id: readingId,
      sectionId,
      learnerId,
      skillGaps: ["READING"],
      customSkillTagId: null,
      customSkillTagName: null,
      customSkillTagActive: false,
      versionVector: { "63cff376-e264-4597-89bf-b1da82096e69": 1 },
      provisional: false,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let opens = 0;
let offline = false;
let httpStatus = 200;
const seenEvents = new Set<string>();
const postedBatches: string[][] = [];
let phoneDb: IDBFactory | null = null;

function notePayload(id: string) {
  if (id === readingId) return { body: readingBody, skillGaps: ["READING"], legacyCustomLabel: null, learnerCode: "LNR-0001" };
  if (id === otherId) return { body: otherBody, skillGaps: ["WRITING"], legacyCustomLabel: "map reading", learnerCode: "LNR-0001" };
  return null;
}

beforeEach(() => {
  opens = 0;
  offline = false;
  httpStatus = 200;
  seenEvents.clear();
  postedBatches.length = 0;
  phoneDb = null;
  HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/sync/note-views")) {
      const payload = JSON.parse(String(init?.body)) as { events: { clientEventId: string; noteId: string }[] };
      const ids = payload.events.map((event) => event.clientEventId);
      postedBatches.push(ids);
      expect(JSON.stringify(payload)).not.toContain(readingBody);
      expect(JSON.stringify(payload)).not.toContain("map reading");
      const results = ids.map((id) => {
        const outcome = seenEvents.has(id) ? "already_accepted" : "accepted";
        seenEvents.add(id);
        return { clientEventId: id, outcome };
      });
      return Response.json({ results });
    }
    const id = url.split("/api/notes/")[1]?.split(/[?#]/)[0] ?? "";
    if (!id) return Response.json({ status: "ok" });
    if (offline) throw new TypeError("Failed to fetch");
    if (httpStatus !== 200) return Response.json({ error: "hidden" }, { status: httpStatus });
    const payload = notePayload(decodeURIComponent(id));
    if (!payload) return Response.json({ error: NOTE_UNAVAILABLE }, { status: 404 });
    return Response.json(payload);
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open(...args: [string, number?]) {
        opens += 1;
        if (!phoneDb) throw new Error("selecting a note must not open the phone database");
        return phoneDb.open(...args);
      },
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function noteSelect(): HTMLSelectElement {
  const select = [...container.querySelectorAll("select")].find((item) => item.options[0]?.text === "New note");
  if (!select) throw new Error("the existing-note dropdown is missing");
  return select;
}

function noteBox(): HTMLTextAreaElement {
  const box = container.querySelector("textarea");
  if (!box) throw new Error("the note box is missing");
  return box;
}

function gapBox(label: string): HTMLInputElement {
  const input = [...container.querySelectorAll("input[type='checkbox']")].find(
    (item) => item.parentElement?.textContent?.includes(label),
  );
  if (!input) throw new Error(`${label} is missing`);
  return input as HTMLInputElement;
}

async function choose(id: string) {
  const select = noteSelect();
  const before = noteBox().value;
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (id === "") {
      if (noteBox().value === "" && status() === null) return;
      continue;
    }
    if (noteBox().value !== before || container.querySelector("[role='alert']") || status()) return;
  }
}

async function clickSend() {
  const send = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send saved edits" || button.textContent === "Sending…");
  if (!send) throw new Error("send button missing");
  await act(async () => {
    send.click();
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (send.textContent === "Send saved edits" && !send.hasAttribute("disabled")) return;
  }
}

function status(): string | null {
  return container.querySelector("[data-view-status]")?.getAttribute("data-view-status") ?? null;
}

async function renderEditor() {
  await act(async () => {
    root.render(<OfflineRecordEditor centerId={centerId} userId={userId} catalog={catalog} />);
  });
}

function usePhoneDatabase() {
  globalThis.IDBKeyRange = IDBKeyRange;
  phoneDb = new IDBFactory();
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      persist: async () => true,
      estimate: async () => ({ quota: 5_000_000, usage: 1000 }),
    },
  });
}

describe("progress note form", () => {
  it("fills the note box from the server and does not open the phone database", async () => {
    await renderEditor();

    expect(noteSelect().value).toBe("");
    expect(noteBox().value).toBe("");
    expect(noteSelect().textContent).not.toContain(readingBody);
    expect(gapBox("Reading").checked).toBe(false);

    await choose(readingId);

    expect(noteSelect().value).toBe(readingId);
    expect(noteBox().value).toBe(readingBody);
    expect(gapBox("Reading").checked).toBe(true);
    expect(gapBox("Writing").checked).toBe(false);
    expect(container.textContent).toContain("short learning skill");
    expect([...container.querySelectorAll("input")].some((item) => item instanceof HTMLInputElement && item.maxLength === 80)).toBe(false);
    expect(status()).toBeNull();
    expect(opens).toBe(0);
  });

  it("loads the other note, then clears the form for a new note, without saving", async () => {
    await renderEditor();

    await choose(readingId);
    await choose(otherId);

    expect(noteSelect().value).toBe(otherId);
    expect(noteBox().value).toBe(otherBody);
    expect(container.textContent).toContain("Earlier custom label on this note: map reading");
    expect(gapBox("Reading").checked).toBe(false);
    expect(gapBox("Writing").checked).toBe(true);

    await choose("");

    expect(noteSelect().value).toBe("");
    expect(noteBox().value).toBe("");
    expect(gapBox("Reading").checked).toBe(false);
    expect(gapBox("Writing").checked).toBe(false);
    expect(opens).toBe(0);
  });

  it("does not show a previously opened note after an authorization or application error", async () => {
    await renderEditor();
    await choose(readingId);
    expect(noteBox().value).toBe(readingBody);

    for (const statusCode of [401, 403, 404, 409, 500]) {
      httpStatus = 200;
      offline = false;
      await choose("");
      await choose(readingId);
      expect(noteBox().value).toBe(readingBody);

      httpStatus = statusCode;
      await choose("");
      await choose(readingId);

      expect(noteBox().value).toBe("");
      expect(container.textContent).not.toContain(readingBody);
      expect(container.textContent).toContain(statusCode === 500 ? NOTE_VIEW_NOT_RECORDED : NOTE_UNAVAILABLE);
      expect(status()).toBeNull();
      expect(opens).toBe(0);
    }
  });

  it("does not queue a note this visit has not opened when the connection fails", async () => {
    await renderEditor();
    offline = true;
    await choose(readingId);

    expect(noteBox().value).toBe("");
    expect(container.textContent).toContain(NOTE_NOT_ON_PHONE);
    expect(container.textContent).not.toContain(readingBody);
    expect(status()).toBeNull();
    expect(opens).toBe(0);
  });

  it("does not say the opening is pending when the phone cannot store it", async () => {
    await renderEditor();
    await choose(readingId);
    expect(noteBox().value).toBe(readingBody);

    offline = true;
    await choose("");
    await choose(readingId);

    expect(noteBox().value).toBe("");
    expect(container.textContent).not.toContain(readingBody);
    expect(container.textContent).toContain(notKept);
    expect(container.textContent).not.toContain(NOTE_VIEW_PENDING);
    expect(status()).toBeNull();
  });
});

describe("offline reopening", () => {
  beforeEach(() => {
    usePhoneDatabase();
  });

  it("queues one opening, survives a re-render, and records it when sent again", async () => {
    await renderEditor();
    await choose(readingId);
    expect(noteBox().value).toBe(readingBody);
    expect(opens).toBe(0);

    offline = true;
    await choose("");
    await choose(readingId);

    expect(noteBox().value).toBe(readingBody);
    expect(status()).toBe("pending");
    expect(container.textContent).toContain(kept);
    expect(container.textContent).toContain(NOTE_VIEW_PENDING);
    const first = await listLocalNoteViews(phoneDb!, { centerId, userId });
    expect(first.ok && first.events).toHaveLength(1);
    if (!first.ok) return;
    expect(first.events[0]?.syncState).toBe("pending");
    expect(JSON.stringify(first.events)).not.toContain(readingBody);
    expect(JSON.stringify(first.events)).not.toContain("map reading");

    await act(async () => {
      root.render(<OfflineRecordEditor centerId={centerId} userId={userId} catalog={catalog} />);
    });
    const afterRender = await listLocalNoteViews(phoneDb!, { centerId, userId });
    expect(afterRender.ok && afterRender.events).toHaveLength(1);

    await choose("");
    await choose(readingId);
    const second = await listLocalNoteViews(phoneDb!, { centerId, userId });
    expect(second.ok && second.events).toHaveLength(2);
    if (!second.ok) return;
    expect(new Set(second.events.map((event) => event.clientEventId)).size).toBe(2);
    expect(status()).toBe("pending");

    await clickSend();

    expect(postedBatches).toHaveLength(1);
    expect(postedBatches[0]).toHaveLength(2);
    expect(status()).toBe("acknowledged");
    expect(container.textContent).toContain(NOTE_VIEW_RECORDED);

    await clickSend();
    expect(postedBatches).toHaveLength(1);
    const afterSend = await listLocalNoteViews(phoneDb!, { centerId, userId });
    expect(afterSend.ok && afterSend.events.map((event) => event.syncState)).toEqual(["acknowledged", "acknowledged"]);
  });
});
