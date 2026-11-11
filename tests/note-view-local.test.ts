import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { listLocalNoteViews, queueNoteViews } from "../lib/device/note-views";
import { syncLocalNoteViews } from "../lib/sync/note-view-sync";

const owner = { centerId: "00000000-0000-4000-8000-0000000000c1", userId: "00000000-0000-4000-8000-0000000000a1" };
const other = { centerId: owner.centerId, userId: "00000000-0000-4000-8000-0000000000a2" };
const noteId = "00000000-0000-4000-8000-000000001101";
const granted = {
  persist: async () => true,
  estimate: async () => ({ quota: 5_000_000, usage: 1000 }),
};

beforeEach(() => {
  globalThis.IDBKeyRange = IDBKeyRange;
});

describe("offline note-view queue", () => {
  it("keeps a view pending until the server acknowledges it, and does not store note text", async () => {
    const indexedDB = new IDBFactory();
    const queued = await queueNoteViews(indexedDB, owner, [noteId], { storage: granted, now: new Date("2001-01-01T00:00:00.000Z") });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.events[0]?.syncState).toBe("pending");
    expect(JSON.stringify(queued.events[0])).not.toContain("body");
    expect(queued.events[0]?.deviceReportedAt).toBe("2001-01-01T00:00:00.000Z");

    const failed = await syncLocalNoteViews({
      factory: indexedDB,
      account: owner,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(failed.ok).toBe(false);
    expect(failed.pending).toBe(1);
    const still = await listLocalNoteViews(indexedDB, owner);
    expect(still.ok && still.events[0]?.syncState).toBe("pending");

    const eventId = queued.events[0]?.clientEventId ?? "";
    const sent = await syncLocalNoteViews({
      factory: indexedDB,
      account: owner,
      fetchImpl: async () => Response.json({ results: [{ clientEventId: eventId, outcome: "accepted" }] }),
    });
    expect(sent.ok).toBe(true);
    const after = await listLocalNoteViews(indexedDB, owner);
    expect(after.ok && after.events).toHaveLength(1);
    expect(after.ok && after.events[0]?.syncState).toBe("acknowledged");
  });

  it("does not show one account's view records to another account", async () => {
    const indexedDB = new IDBFactory();
    const queued = await queueNoteViews(indexedDB, owner, [noteId], { storage: granted });
    expect(queued.ok).toBe(true);
    const hidden = await listLocalNoteViews(indexedDB, other);
    expect(hidden.ok && hidden.events).toEqual([]);
    const sent = await syncLocalNoteViews({
      factory: indexedDB,
      account: other,
      fetchImpl: async () => {
        throw new Error("other account must not send");
      },
    });
    expect(sent.pending).toBe(0);
    const kept = await listLocalNoteViews(indexedDB, owner);
    expect(kept.ok && kept.events[0]?.syncState).toBe("pending");
  });

  it("keeps a retryable view pending and keeps a rejected view instead of deleting it", async () => {
    const indexedDB = new IDBFactory();
    const queued = await queueNoteViews(indexedDB, owner, [noteId], { storage: granted });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    const eventId = queued.events[0]?.clientEventId ?? "";
    const waiting = await syncLocalNoteViews({
      factory: indexedDB,
      account: owner,
      fetchImpl: async () => Response.json({ results: [{ clientEventId: eventId, outcome: "retryable_failure" }] }),
    });
    expect(waiting.ok).toBe(false);
    expect(waiting.pending).toBe(1);
    const still = await listLocalNoteViews(indexedDB, owner);
    expect(still.ok && still.events[0]?.syncState).toBe("pending");

    const refused = await syncLocalNoteViews({
      factory: indexedDB,
      account: owner,
      fetchImpl: async () => Response.json({ results: [{ clientEventId: eventId, outcome: "rejected" }] }),
    });
    expect(refused.ok).toBe(false);
    const kept = await listLocalNoteViews(indexedDB, owner);
    expect(kept.ok && kept.events).toHaveLength(1);
    expect(kept.ok && kept.events[0]?.syncState).toBe("rejected");
  });

  it("uses a new event id for a later view", async () => {
    const indexedDB = new IDBFactory();
    const first = await queueNoteViews(indexedDB, owner, [noteId], { storage: granted });
    const second = await queueNoteViews(indexedDB, owner, [noteId], { storage: granted });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.events[0]?.clientEventId).not.toBe(first.events[0]?.clientEventId);
    const listed = await listLocalNoteViews(indexedDB, owner);
    expect(listed.ok && listed.events).toHaveLength(2);
  });
});
