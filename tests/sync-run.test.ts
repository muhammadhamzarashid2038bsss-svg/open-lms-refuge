import { gunzipSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { AttendanceSyncPanel } from "../components/attendance-sync";
import { closeWorkingDatabase, localRequest, openWorkingDatabase, runLocalTransaction, type FutureAttendanceEvent } from "../lib/device/local-db";
import { readLocalCatalog } from "../lib/device/local-attendance";
import { acknowledgeEvents } from "../lib/sync/local";
import { MAX_COMPRESSED_BYTES, type GzipFn } from "../lib/sync/batch";
import { runAttendanceSync, type SyncReport } from "../lib/sync/run";
import { bindAttendanceSync, nextAutomaticDelayMs } from "../lib/sync/trigger";

const account = { userId: "user-a", centerId: "center-a" };
const deviceId = "44444444-4444-4444-8444-444444444444";
const otherDevice = "55555555-5555-4555-8555-555555555555";
const sectionId = "11111111-1111-4111-8111-111111111111";
const classSessionId = "22222222-2222-4222-8222-222222222222";
const learnerId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-11-09T01:00:00.000Z");
const recordedAt = "2026-11-09T01:02:00.000Z";

beforeEach(() => {
  globalThis.IDBKeyRange = IDBKeyRange;
});

function event(sequence: number, overrides: Partial<FutureAttendanceEvent> = {}): FutureAttendanceEvent {
  const number = String(sequence).padStart(4, "0");
  return {
    clientEventId: `event-${number}`,
    centerId: account.centerId,
    userId: account.userId,
    localDeviceId: deviceId,
    sectionId,
    classSessionId,
    learnerId,
    status: "PRESENT",
    reasonCode: null,
    recordedAt,
    sequence,
    correctsClientEventId: null,
    correctsServerEventId: null,
    syncState: "pending",
    ...overrides,
  };
}

async function seed(
  factory: IDBFactory,
  events: FutureAttendanceEvent[],
  extras?: { practice?: boolean; meta?: unknown },
) {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) throw new Error("database did not open");
  try {
    await runLocalTransaction(opened.db, ["meta", "events", "deviceItems"], "readwrite", async (tx) => {
      await localRequest(tx.objectStore("meta").put({ key: "device", localDeviceId: deviceId }));
      if (extras?.meta !== undefined) await localRequest(tx.objectStore("meta").put(extras.meta));
      if (extras?.practice) {
        await localRequest(tx.objectStore("deviceItems").put({
          sourceIndex: 0,
          id: "practice-row",
          userId: account.userId,
          centerId: account.centerId,
          kind: "practice",
          summary: "Practice record. No personal details.",
          createdAt: recordedAt,
        }));
      }
      for (const row of events) await localRequest(tx.objectStore("events").put(row));
    });
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

async function saved(factory: IDBFactory) {
  const catalog = await readLocalCatalog(factory);
  if (!catalog.ok) throw new Error(catalog.message);
  return catalog.events;
}

async function meta(factory: IDBFactory) {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) throw new Error("database did not open");
  try {
    return await runLocalTransaction(opened.db, ["meta"], "readonly", (tx) =>
      localRequest(tx.objectStore("meta").get(`sync:${account.centerId}:${account.userId}`)),
    );
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

async function uploadText(init: RequestInit | undefined) {
  const encoding = new Headers(init?.headers).get("content-encoding");
  const body = init?.body;
  const bytes =
    body instanceof Uint8Array
      ? body
      : new Uint8Array(await new Response(body ?? "").arrayBuffer());
  const text = encoding === "gzip" ? gunzipSync(Buffer.from(bytes)).toString("utf8") : new TextDecoder().decode(bytes);
  return { encoding, text, json: JSON.parse(text) as { events: { clientEventId: string }[] } };
}

function harness(factory: IDBFactory, respond: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return respond(url, init);
  };
  const run = (mode: "automatic" | "manual" = "automatic", gzip?: GzipFn) =>
    runAttendanceSync({ factory, account, mode, now, random: () => 1, fetchImpl, gzip });
  return { calls, run };
}

function acceptBody(payload: { events: { clientEventId: string }[] }, outcome: "accepted" | "already_accepted" = "accepted") {
  return json(200, { results: payload.events.map((row) => ({ clientEventId: row.clientEventId, outcome })) });
}

describe("attendance sync runner", () => {
  it("acknowledges a mark only after the server confirms it and the phone reads it back", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1)]);
    const { calls, run } = harness(factory, async (url, init) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      const uploaded = await uploadText(init);
      expect(uploaded.text).not.toContain(account.userId);
      expect(uploaded.text).not.toContain(account.centerId);
      return acceptBody(uploaded.json);
    });
    const report = await run();
    expect(calls.map((call) => call.url)).toEqual(["/api/sync/health", "/api/sync"]);
    expect(report.status).toBe("sent");
    expect(report.lastSuccessAt).toBe(now.toISOString());
    const rows = await saved(factory);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.syncState).toBe("acknowledged");
  });

  it("acknowledges a duplicate the server already stored", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1)]);
    const { run } = harness(factory, async (url, init) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      return acceptBody((await uploadText(init)).json, "already_accepted");
    });
    expect((await run()).status).toBe("sent");
    expect((await saved(factory))[0]?.syncState).toBe("acknowledged");
  });

  it("keeps the mark pending when the upload response is lost", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1)]);
    const { run } = harness(factory, async (url) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      throw new Error("connection dropped");
    });
    const report = await run();
    expect(report.status).toBe("unreachable");
    expect((await saved(factory))[0]?.syncState).toBe("pending");
    expect((await saved(factory))).toHaveLength(1);
  });

  it("does not acknowledge marks when the response is malformed, unknown, or repeated", async () => {
    const malformed = new IDBFactory();
    await seed(malformed, [event(1), event(2)]);
    const bad = harness(malformed, async (url) => (url.endsWith("/health") ? json(200, { status: "ok" }) : json(200, { status: "ok" })));
    expect((await bad.run()).waiting).toBe(2);
    expect((await saved(malformed)).every((row) => row.syncState === "pending")).toBe(true);

    const unknown = new IDBFactory();
    await seed(unknown, [event(1)]);
    const missed = harness(unknown, async (url) =>
      url.endsWith("/health") ? json(200, { status: "ok" }) : json(200, { results: [{ clientEventId: "event-9999", outcome: "accepted" }] }),
    );
    await missed.run();
    expect((await saved(unknown))[0]?.syncState).toBe("pending");

    const duplicated = new IDBFactory();
    await seed(duplicated, [event(1), event(2)]);
    const twice = harness(duplicated, async (url) =>
      url.endsWith("/health")
        ? json(200, { status: "ok" })
        : json(200, {
            results: [
              { clientEventId: "event-0001", outcome: "accepted" },
              { clientEventId: "event-0001", outcome: "accepted" },
            ],
          }),
    );
    await twice.run();
    expect((await saved(duplicated)).every((row) => row.syncState === "pending")).toBe(true);
  });

  it("handles a mixed batch one mark at a time", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1), event(2)]);
    const { run } = harness(factory, async (url) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      return json(200, {
        results: [
          { clientEventId: "event-0001", outcome: "accepted" },
          { clientEventId: "event-0002", outcome: "rejected", code: "not_enrolled" },
        ],
      });
    });
    const report = await run();
    const rows = await saved(factory);
    expect(rows.find((row) => row.clientEventId === "event-0001")?.syncState).toBe("acknowledged");
    expect(rows.find((row) => row.clientEventId === "event-0002")?.syncState).toBe("pending");
    expect(report.rejections).toEqual([{ clientEventId: "event-0002", code: "not_enrolled" }]);
    expect(report.rejected).toBe(1);
  });

  it("does not retry a permanent refusal automatically or from Sync now", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1)]);
    const { calls, run } = harness(factory, async (url) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      return json(200, { results: [{ clientEventId: "event-0001", outcome: "rejected", code: "forbidden" }] });
    });
    await run();
    const after = calls.length;
    await run("automatic");
    await run("manual");
    expect(calls).toHaveLength(after);
    expect((await saved(factory))[0]?.syncState).toBe("pending");
    expect((await saved(factory))).toHaveLength(1);
  });

  it("keeps a retryable mark pending and waits with the capped backoff", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1)]);
    const { run } = harness(factory, async (url) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      return json(200, { results: [{ clientEventId: "event-0001", outcome: "retryable_failure", code: "database" }] });
    });
    const report = await run();
    expect((await saved(factory))[0]?.syncState).toBe("pending");
    expect(report.retrying).toBe(1);
    expect(report.nextAttemptAt).toBe("2026-11-09T01:00:02.000Z");
    const note = (await meta(factory)) as { events: { "event-0001": { attempts: number; permanent: boolean } } };
    expect(note.events["event-0001"]).toMatchObject({ attempts: 1, permanent: false, lastCode: "database" });
  });

  it("stops automatic retries after six attempts and lets Sync now try again", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1)], {
      meta: {
        key: `sync:${account.centerId}:${account.userId}`,
        lastSuccessAt: null,
        events: {
          "event-0001": { attempts: 6, nextAttemptAt: "2026-11-09T01:05:00.000Z", lastCode: "network", permanent: false },
        },
      },
    });
    const { calls, run } = harness(factory, async (url, init) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      return acceptBody((await uploadText(init)).json);
    });
    const skipped = await run("automatic");
    expect(calls).toHaveLength(0);
    expect(skipped.waiting).toBe(1);
    const manual = await run("manual");
    expect(calls.map((call) => call.url)).toEqual(["/api/sync/health", "/api/sync"]);
    expect(manual.status).toBe("sent");
    expect((await saved(factory))[0]?.syncState).toBe("acknowledged");
  });

  it("does not upload or erase an unreadable sync note", async () => {
    const factory = new IDBFactory();
    const broken = { key: `sync:${account.centerId}:${account.userId}`, lastSuccessAt: null };
    await seed(factory, [event(1)], { meta: broken });
    const { calls, run } = harness(factory, () => json(200, { status: "ok" }));
    const report = await run();
    expect(report.status).toBe("problem");
    expect(calls).toHaveLength(0);
    expect(await meta(factory)).toEqual(broken);
    expect((await saved(factory))[0]?.syncState).toBe("pending");
  });

  it("requires a successful health check and ignores navigator.onLine", async () => {
    const previous = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    try {
      const factory = new IDBFactory();
      await seed(factory, [event(1)]);
      const { calls, run } = harness(factory, async (url) => (url.endsWith("/health") ? json(503, { status: "ok" }) : json(200, { results: [] })));
      const report = await run();
      expect(calls.map((call) => call.url)).toEqual(["/api/sync/health"]);
      expect(report.status).toBe("unreachable");
      expect((await saved(factory))[0]?.syncState).toBe("pending");
    } finally {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: previous });
    }
  });

  it("starts a health check and upload when the browser comes online", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1)]);
    const calls: string[] = [];
    let current = Promise.resolve<SyncReport>({
      status: "waiting",
      message: "",
      waiting: 0,
      rejected: 0,
      retrying: 0,
      lastSuccessAt: null,
      rejections: [],
      nextAttemptAt: null,
    });
    // A plain `let` written inside this callback is narrowed to `never`, so the
    // saved function could not be called. The object keeps the real callback type.
    const onlineListener: { notify: (() => void) | null } = { notify: null };
    const controls = bindAttendanceSync({
      subscribeOnline: (next) => {
        onlineListener.notify = next;
        return () => {
          onlineListener.notify = null;
        };
      },
      schedule: () => () => undefined,
      run: () => {
        current = runAttendanceSync({
          factory,
          account,
          mode: "automatic",
          now,
          random: () => 1,
          fetchImpl: async (input, init) => {
            const url = String(input);
            calls.push(url);
            if (url.endsWith("/health")) return json(200, { status: "ok" });
            return acceptBody((await uploadText(init)).json);
          },
        });
        return current;
      },
    });
    onlineListener.notify?.();
    await current;
    controls.stop();
    expect(calls).toEqual(["/api/sync/health", "/api/sync"]);
    expect((await saved(factory))[0]?.syncState).toBe("acknowledged");
  });

  it("stops on 401 and 403 without scheduling another attempt", async () => {
    for (const status of [401, 403] as const) {
      const factory = new IDBFactory();
      await seed(factory, [event(1)]);
      const scheduled: number[] = [];
      let current = Promise.resolve<SyncReport>({
        status: "waiting",
        message: "",
        waiting: 1,
        rejected: 0,
        retrying: 0,
        lastSuccessAt: null,
        rejections: [],
        nextAttemptAt: "2026-11-09T01:00:02.000Z",
      });
      const controls = bindAttendanceSync({
        subscribeOnline: () => () => undefined,
        schedule: (delay) => {
          scheduled.push(delay);
          return () => undefined;
        },
        run: () => {
          current = runAttendanceSync({
            factory,
            account,
            mode: "automatic",
            now,
            random: () => 1,
            fetchImpl: async () => json(status, { status: "unauthorized" }),
          });
          return current;
        },
      });
      controls.load();
      const report = await current;
      expect(report.status).toBe(status === 401 ? "session_expired" : "access_denied");
      expect(nextAutomaticDelayMs(report, now)).toBeNull();
      expect(scheduled).toEqual([]);
      expect((await saved(factory))[0]?.syncState).toBe("pending");
      controls.stop();
    }
  });

  it("does not upload another account, another device, or a practice record", async () => {
    const factory = new IDBFactory();
    await seed(
      factory,
      [
        event(1),
        event(2, { clientEventId: "event-other-user", userId: "user-b", sequence: 2 }),
        event(3, { clientEventId: "event-other-device", localDeviceId: otherDevice, sequence: 3 }),
      ],
      { practice: true },
    );
    const { run } = harness(factory, async (url, init) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      const uploaded = await uploadText(init);
      expect(uploaded.json.events.map((row) => row.clientEventId)).toEqual(["event-0001"]);
      return acceptBody(uploaded.json);
    });
    await run();
    const rows = await saved(factory);
    expect(rows.find((row) => row.clientEventId === "event-0001")?.syncState).toBe("acknowledged");
    expect(rows.find((row) => row.clientEventId === "event-other-user")?.syncState).toBe("pending");
    expect(rows.find((row) => row.clientEventId === "event-other-device")?.syncState).toBe("pending");
  });

  it("sends a correction only after the earlier mark in sequence order", async () => {
    const factory = new IDBFactory();
    const original = event(1);
    const correction = event(2, { clientEventId: "event-correct", status: "LATE", correctsClientEventId: original.clientEventId });
    await seed(factory, [correction, original]);
    const { run } = harness(factory, async (url, init) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      const uploaded = await uploadText(init);
      expect(uploaded.json.events.map((row) => row.clientEventId)).toEqual(["event-0001", "event-correct"]);
      return acceptBody(uploaded.json);
    });
    await run();
    expect((await saved(factory)).every((row) => row.syncState === "acknowledged")).toBe(true);

    const held = new IDBFactory();
    await seed(held, [event(2, { clientEventId: "event-correct", correctsClientEventId: "event-0001" })]);
    const waiting = harness(held, () => json(200, { status: "ok" }));
    const report = await waiting.run();
    expect(report.waiting).toBe(1);
    expect((await saved(held))[0]?.syncState).toBe("pending");
    expect(waiting.calls).toHaveLength(0);
  });

  it("sends more than 25 marks as separate batches", async () => {
    const factory = new IDBFactory();
    await seed(factory, Array.from({ length: 26 }, (_, index) => event(index + 1)));
    const sizes: number[] = [];
    const { run } = harness(factory, async (url, init) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      const uploaded = await uploadText(init);
      sizes.push(uploaded.json.events.length);
      return acceptBody(uploaded.json);
    });
    await run();
    expect(sizes).toEqual([25, 1]);
    expect((await saved(factory)).every((row) => row.syncState === "acknowledged")).toBe(true);
  });

  it("sends plain JSON when gzip is over the compressed cap", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1), event(2)]);
    const huge: GzipFn = async () => new Uint8Array(MAX_COMPRESSED_BYTES + 1);
    const { run } = harness(factory, async (url, init) => {
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      const uploaded = await uploadText(init);
      expect(uploaded.encoding).toBeNull();
      expect(uploaded.json.events).toHaveLength(2);
      return acceptBody(uploaded.json);
    });
    await run("automatic", huge);
    expect((await saved(factory)).every((row) => row.syncState === "acknowledged")).toBe(true);
  });

  it("does not delete or acknowledge a mark when the local update is interrupted", async () => {
    const factory = new IDBFactory();
    const row = event(1);
    await seed(factory, [row]);
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok) throw new Error("database did not open");
    const store = opened.db.transaction("events", "readonly").objectStore("events");
    const proto = Object.getPrototypeOf(store) as { put: IDBObjectStore["put"] };
    closeWorkingDatabase(opened.db);
    const original = proto.put;
    proto.put = () => {
      throw new Error("interrupted");
    };
    try {
      expect(await acknowledgeEvents(factory, [row])).toBe(false);
    } finally {
      proto.put = original;
    }
    const rows = await saved(factory);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.syncState).toBe("pending");
  });

  it("runs only one upload when two starts overlap", async () => {
    const factory = new IDBFactory();
    await seed(factory, [event(1)]);
    let posts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) return json(200, { status: "ok" });
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return acceptBody((await uploadText(init)).json);
    };
    const input = { factory, account, mode: "automatic" as const, now, random: () => 1, fetchImpl };
    const [first, second] = await Promise.all([runAttendanceSync(input), runAttendanceSync(input)]);
    expect(posts).toBe(1);
    expect(first).toBe(second);
    expect((await saved(factory))[0]?.syncState).toBe("acknowledged");
  });
});

describe("attendance sync panel", () => {
  it("shows waiting marks, a refusal, and Sync now without claiming the queue is clear", () => {
    const report: SyncReport = {
      status: "waiting",
      message: "Some attendance marks were refused and are still on this phone.",
      waiting: 2,
      rejected: 1,
      retrying: 1,
      lastSuccessAt: "2026-11-09T01:00:00.000Z",
      nextAttemptAt: null,
      rejections: [{ clientEventId: "event-0002", code: "not_enrolled" }],
    };
    const html = renderToStaticMarkup(createElement(AttendanceSyncPanel, { report, syncing: false, onSync: () => undefined }));
    expect(html).toContain("Attendance waiting to send: 2");
    expect(html).toContain("Attendance refused by the server: 1");
    expect(html).toContain("not_enrolled");
    expect(html).toContain("Sync now");
    expect(html).toContain("type=\"button\"");
    expect(html).not.toContain("All attendance");
    const more: SyncReport = { ...report, status: "sent", waiting: 30, retrying: 0, rejected: 0, rejections: [] };
    expect(nextAutomaticDelayMs(more, new Date("2026-11-09T01:00:00.000Z"))).toBe(2000);
  });
});
