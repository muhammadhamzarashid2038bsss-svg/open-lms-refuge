import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { FutureAttendanceEvent } from "../lib/device/local-db";
import {
  MAX_COMPRESSED_BYTES,
  MAX_EVENTS_PER_BATCH,
  MAX_UNCOMPRESSED_BYTES,
  resolveBatchLimits,
  selectSyncBatch,
  validateSyncEnvelope,
  type GzipFn,
} from "../lib/sync/batch";
import { collectEligibleEvents, type CollectCandidate } from "../lib/sync/collect";
import { classifyHealth } from "../lib/sync/health";
import {
  RETRY_BASE_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_MAX_DELAY_MS,
  backoffDelayMs,
  backoffUpperMs,
  emptySyncRetryMeta,
  isAutomaticAttemptDue,
  isManualAttemptAllowed,
  parseSyncRetryMeta,
  recordRetryFailure,
  syncMetaKey,
  type SyncRetryEntry,
  type SyncRetryMeta,
} from "../lib/sync/retry";

const device = "8b6e1c2a-4f0d-4a1e-9c3b-112233445566";
const otherDevice = "99999999-9999-4999-8999-999999999999";
const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUser = "abababab-abab-4aba-8aba-abababababab";
const center = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherCenter = "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
const section = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const classSession = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const learner = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const recordedAt = "2026-11-09T01:02:00.000Z";
const now = new Date("2026-11-09T02:00:00.000Z");
const account = { userId: user, centerId: center };

function mark(sequence: number, overrides: Partial<FutureAttendanceEvent> = {}): FutureAttendanceEvent {
  return {
    clientEventId: `event-${String(sequence).padStart(4, "0")}`,
    centerId: center,
    userId: user,
    localDeviceId: device,
    sectionId: section,
    classSessionId: classSession,
    learnerId: learner,
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

function meta(events: SyncRetryMeta["events"] = {}): SyncRetryMeta {
  return { key: `sync:${center}:${user}`, lastSuccessAt: null, events };
}

function entry(overrides: Partial<SyncRetryEntry> = {}): SyncRetryEntry {
  return {
    attempts: 1,
    nextAttemptAt: "2026-11-09T02:00:00.000Z",
    lastCode: "network",
    permanent: false,
    ...overrides,
  };
}

function collect(records: CollectCandidate[], overrides: Partial<Parameters<typeof collectEligibleEvents>[0]> = {}) {
  return collectEligibleEvents({
    account,
    localDeviceId: device,
    records,
    retry: meta(),
    now,
    mode: "automatic",
    ...overrides,
  });
}

function ids(result: ReturnType<typeof collect>): string[] {
  return result.ok ? result.events.map((event) => event.clientEventId) : [];
}

describe("attendance collection", () => {
  it("keeps only this account and this browser, in sequence order", () => {
    const result = collect([
      mark(3),
      mark(8, { clientEventId: "event-other-user", userId: otherUser }),
      mark(4, { clientEventId: "event-other-center", centerId: otherCenter }),
      mark(5, { clientEventId: "event-other-phone", localDeviceId: otherDevice }),
      mark(2),
      mark(1),
      { kind: "practice", id: "practice-row", userId: user, centerId: center },
      mark(6, { clientEventId: "event-sent", syncState: "acknowledged" }),
    ]);

    expect(result.ok).toBe(true);
    expect(ids(result)).toEqual(["event-0001", "event-0002", "event-0003"]);
    if (!result.ok) return;
    expect(result.held).toHaveLength(5);
    expect(result.held).toEqual(
      expect.arrayContaining([
        { id: "event-other-user", reason: "other_account" },
        { id: "event-other-center", reason: "other_center" },
        { id: "event-other-phone", reason: "other_device" },
        { id: "practice-row", reason: "practice" },
        { id: "event-sent", reason: "acknowledged" },
      ]),
    );
  });

  it("sends a correction after its earlier local mark, including in the same batch", () => {
    const original = mark(1);
    const correction = mark(2, { clientEventId: "event-correct", correctsClientEventId: original.clientEventId });
    const together = collect([correction, original]);
    expect(ids(together)).toEqual([original.clientEventId, correction.clientEventId]);

    const afterConfirm = collect([
      mark(1, { syncState: "acknowledged" }),
      correction,
    ]);
    expect(ids(afterConfirm)).toEqual([correction.clientEventId]);
  });

  it("holds a correction until its local predecessor is confirmed or included", () => {
    const waiting = collect(
      [mark(1), mark(2, { clientEventId: "event-correct", correctsClientEventId: "event-0001" })],
      { retry: meta({ "event-0001": entry({ nextAttemptAt: "2026-11-09T02:00:02.000Z" }) }) },
    );
    expect(waiting.ok).toBe(true);
    if (!waiting.ok) return;
    expect(ids(waiting)).toEqual([]);
    expect(waiting.held).toContainEqual({ id: "event-0001", reason: "retry_wait" });
    expect(waiting.held).toContainEqual({ id: "event-correct", reason: "predecessor" });

    const missing = collect([mark(2, { clientEventId: "event-correct", correctsClientEventId: "event-0001" })]);
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.held).toEqual([{ id: "event-correct", reason: "predecessor" }]);
  });

  it("allows a correction that points at a server row", () => {
    const result = collect([mark(4, { correctsServerEventId: "11111111-1111-4111-8111-111111111111" })]);
    expect(ids(result)).toEqual(["event-0004"]);
  });

  it("does not send a permanently rejected mark on a manual pass", () => {
    const records = [
      mark(1, { clientEventId: "event-capped" }),
      mark(2, { clientEventId: "event-rejected" }),
    ];
    const retry = meta({
      "event-capped": entry({ attempts: RETRY_MAX_ATTEMPTS, nextAttemptAt: "2026-11-09T03:00:00.000Z" }),
      "event-rejected": entry({ permanent: true }),
    });
    expect(ids(collect(records, { retry, mode: "automatic" }))).toEqual([]);
    const manual = collect(records, { retry, mode: "manual" });
    expect(ids(manual)).toEqual(["event-capped"]);
    expect(manual.ok && manual.held).toContainEqual({ id: "event-rejected", reason: "permanent" });
  });

  it("keeps an illegal mark pending without hiding a valid one", () => {
    const result = collect([
      mark(1, { clientEventId: "event-bad-reason", status: "PRESENT", reasonCode: "ILLNESS" }),
      mark(2),
    ]);
    expect(ids(result)).toEqual(["event-0002"]);
    expect(result.ok && result.held).toContainEqual({ id: "event-bad-reason", reason: "invalid" });
  });

  it("does not treat a corrupt row as an empty queue", () => {
    const result = collect([mark(1), mark(2, { clientEventId: "event-bad", status: "AWAY" })]);
    expect(result).toEqual({ ok: false, reason: "unreadable" });
    expect(collect([mark(1), mark(1, { clientEventId: "event-same-seq" })])).toEqual({ ok: false, reason: "duplicate_sequence" });
  });
});

describe("sync batches", () => {
  const plain: GzipFn = async () => null;

  it("refuses a limit above the prepaid caps", () => {
    expect(MAX_EVENTS_PER_BATCH).toBe(25);
    expect(MAX_UNCOMPRESSED_BYTES).toBe(64 * 1024);
    expect(MAX_COMPRESSED_BYTES).toBe(32 * 1024);
    expect(resolveBatchLimits({ maxEvents: 80, maxUncompressedBytes: 1024 * 1024, maxCompressedBytes: 1024 * 1024 })).toEqual({
      maxEvents: 25,
      maxUncompressedBytes: 64 * 1024,
      maxCompressedBytes: 32 * 1024,
    });
  });

  it("splits after 25 events and keeps the rest pending", async () => {
    const events = Array.from({ length: 26 }, (_, index) => mark(index + 1));
    const first = await selectSyncBatch({ localDeviceId: device, events, gzip: plain });
    expect(first.ok).toBe(true);
    if (!first.ok || !first.encoded) return;
    expect(first.encoded.envelope.events).toHaveLength(25);
    expect(first.encoded.envelope.events[0]?.sequence).toBe(1);
    expect(first.encoded.envelope.events[24]?.sequence).toBe(25);
    expect(first.remaining.map((event) => event.sequence)).toEqual([26]);
    expect(first.blockedBy).toBeNull();

    const second = await selectSyncBatch({ localDeviceId: device, events: first.remaining, gzip: plain });
    expect(second.ok && second.encoded?.envelope.events.map((event) => event.clientEventId)).toEqual(["event-0026"]);
    expect(second.ok && second.remaining).toEqual([]);
  });

  it("leaves an oversized record pending and does not skip past it", async () => {
    const events = [mark(1), mark(2), mark(3)];
    const sample = await selectSyncBatch({ localDeviceId: device, events: [events[0]!], gzip: plain });
    expect(sample.ok && sample.encoded).toBeTruthy();
    if (!sample.ok || !sample.encoded) return;

    const packed = await selectSyncBatch({
      localDeviceId: device,
      events,
      gzip: plain,
      limits: { maxUncompressedBytes: sample.encoded.uncompressedBytes },
    });
    expect(packed.ok).toBe(true);
    if (!packed.ok || !packed.encoded) return;
    expect(packed.encoded.envelope.events.map((event) => event.sequence)).toEqual([1]);
    expect(packed.remaining.map((event) => event.sequence)).toEqual([2, 3]);
    expect(packed.blockedBy).toBeNull();

    const blocked = await selectSyncBatch({
      localDeviceId: device,
      events,
      gzip: plain,
      limits: { maxUncompressedBytes: sample.encoded.uncompressedBytes - 1 },
    });
    expect(blocked.ok && blocked.encoded).toBeNull();
    expect(blocked.ok && blocked.remaining.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(blocked.ok && blocked.blockedBy).toEqual({ clientEventId: "event-0001", reason: "oversized" });
  });

  it("does not jump over an event the envelope cannot carry", async () => {
    const packed = await selectSyncBatch({
      localDeviceId: device,
      events: [mark(1, { status: "LATE", reasonCode: "UNKNOWN" }), mark(2)],
      gzip: plain,
    });
    expect(packed.ok && packed.encoded).toBeNull();
    expect(packed.ok && packed.remaining).toHaveLength(2);
    expect(packed.ok && packed.blockedBy).toEqual({ clientEventId: "event-0001", reason: "invalid" });
  });

  it("round trips gzip and omits ownership fields", async () => {
    const packed = await selectSyncBatch({ localDeviceId: device, events: [mark(1, { status: "ABSENT", reasonCode: "ILLNESS" })] });
    expect(packed.ok).toBe(true);
    if (!packed.ok || !packed.encoded) return;
    expect(packed.encoded.encoding).toBe("gzip");
    expect(packed.encoded.body.byteLength).toBeLessThanOrEqual(MAX_COMPRESSED_BYTES);
    expect(packed.encoded.uncompressedBytes).toBeLessThanOrEqual(MAX_UNCOMPRESSED_BYTES);
    const json = gunzipSync(Buffer.from(packed.encoded.body)).toString("utf8");
    expect(JSON.parse(json)).toEqual(packed.encoded.envelope);
    expect(json).not.toContain(user);
    expect(json).not.toContain(center);
    expect(json).not.toContain("syncState");
    expect(validateSyncEnvelope(JSON.parse(json)).ok).toBe(true);
  });

  it("sends plain JSON when compression is unavailable", async () => {
    const packed = await selectSyncBatch({ localDeviceId: device, events: [mark(2), mark(1)], gzip: plain });
    expect(packed.ok).toBe(true);
    if (!packed.ok || !packed.encoded) return;
    expect(packed.encoded.encoding).toBe("identity");
    expect(Buffer.from(packed.encoded.body).toString("utf8")).toBe(JSON.stringify(packed.encoded.envelope));
    expect(packed.encoded.envelope.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("sends plain JSON when gzip is available but larger than the compressed cap", async () => {
    const huge: GzipFn = async () => new Uint8Array(MAX_COMPRESSED_BYTES + 1);
    const packed = await selectSyncBatch({ localDeviceId: device, events: [mark(1)], gzip: huge });
    expect(packed.ok).toBe(true);
    if (!packed.ok || !packed.encoded) return;
    expect(packed.encoded.encoding).toBe("identity");
    expect(packed.encoded.uncompressedBytes).toBeLessThanOrEqual(MAX_UNCOMPRESSED_BYTES);
    expect(Buffer.from(packed.encoded.body).toString("utf8")).toBe(JSON.stringify(packed.encoded.envelope));
    expect(packed.remaining).toEqual([]);
  });

  it("rejects an envelope that is not attendance-only", () => {
    const packed = {
      version: 1,
      localDeviceId: device,
      userId: user,
      events: [mark(1)],
    };
    expect(validateSyncEnvelope(packed).ok).toBe(false);
    expect(validateSyncEnvelope({ version: 2, localDeviceId: device, events: [] }).ok).toBe(false);
  });
});

describe("server health classification", () => {
  const ok = {
    status: 200,
    contentType: "application/json; charset=utf-8",
    bodyText: '{"status":"ok"}',
  };

  it("accepts only the exact authenticated JSON response", () => {
    expect(classifyHealth({ navigatorOnline: false, response: ok })).toEqual({ state: "authenticated" });
    expect(classifyHealth({ navigatorOnline: true, response: { ...ok, bodyText: '{"status":"ok","name":"Ada"}' } })).toEqual({
      state: "unavailable",
      reason: "unexpected",
    });
    expect(classifyHealth({ response: { ...ok, contentType: "text/plain" } })).toEqual({ state: "unavailable", reason: "unexpected" });
  });

  it("does not treat the phone's online flag as a server response", () => {
    expect(classifyHealth({ navigatorOnline: true })).toEqual({ state: "unavailable", reason: "network" });
    expect(classifyHealth({ navigatorOnline: true, error: "network" })).toEqual(classifyHealth({ navigatorOnline: false, error: "network" }));
    expect(classifyHealth({ navigatorOnline: true, error: "timeout", response: ok })).toEqual({ state: "unavailable", reason: "timeout" });
  });

  it("does not treat HTML or a redirect as success", () => {
    const signIn = "<!doctype html><title>Sign in</title>";
    expect(classifyHealth({ navigatorOnline: true, response: { status: 200, contentType: "text/html", bodyText: signIn } })).toEqual({
      state: "unavailable",
      reason: "html",
    });
    expect(classifyHealth({ response: { status: 302, contentType: "text/html", bodyText: signIn } })).toEqual({
      state: "unavailable",
      reason: "redirect",
    });
    expect(classifyHealth({ response: { status: 0, type: "opaqueredirect", bodyText: "" } })).toEqual({
      state: "unavailable",
      reason: "redirect",
    });
    expect(classifyHealth({ response: { status: 401, contentType: "application/json", bodyText: '{"status":"unauthorized"}' } })).toEqual({
      state: "unauthorized",
    });
    expect(classifyHealth({ response: { status: 403, contentType: "application/json", bodyText: "{}" } })).toEqual({ state: "unauthorized" });
    expect(classifyHealth({ response: { status: 503, contentType: "application/json", bodyText: '{"status":"ok"}' } })).toEqual({
      state: "unavailable",
      reason: "server_error",
    });
  });
});

describe("retry backoff", () => {
  it("uses full jitter inside the capped exponential delay", () => {
    expect(backoffUpperMs(1)).toBe(RETRY_BASE_MS);
    expect(backoffUpperMs(2)).toBe(RETRY_BASE_MS * 2);
    expect(backoffUpperMs(3)).toBe(RETRY_BASE_MS * 4);
    expect(backoffUpperMs(0)).toBeNull();
    for (let failures = 1; failures <= 12; failures += 1) {
      const upper = backoffUpperMs(failures);
      expect(upper).toBeLessThanOrEqual(RETRY_MAX_DELAY_MS);
      expect(backoffDelayMs(failures, 0)).toBe(0);
      expect(backoffDelayMs(failures, 1)).toBe(upper);
      expect(backoffDelayMs(failures, 0.5)).toBeGreaterThanOrEqual(0);
      expect(backoffDelayMs(failures, 0.5)).toBeLessThanOrEqual(upper ?? -1);
    }
    expect(backoffDelayMs(1, 1.1)).toBeNull();
    expect(backoffUpperMs(20)).toBe(RETRY_MAX_DELAY_MS);
  });

  it("stops automatic retries after six attempts and still allows Sync now", () => {
    const capped = entry({ attempts: RETRY_MAX_ATTEMPTS, nextAttemptAt: "2026-11-09T01:00:00.000Z" });
    expect(RETRY_MAX_ATTEMPTS).toBe(6);
    expect(isAutomaticAttemptDue(capped, now)).toBe(false);
    expect(isManualAttemptAllowed(capped)).toBe(true);
    expect(isAutomaticAttemptDue(entry({ attempts: 5, nextAttemptAt: now.toISOString() }), now)).toBe(true);
    expect(isAutomaticAttemptDue(entry({ nextAttemptAt: "2026-11-09T02:00:01.000Z" }), now)).toBe(false);
    const jumped = new Date(now.getTime() + RETRY_MAX_DELAY_MS + 1).toISOString();
    expect(isAutomaticAttemptDue(entry({ nextAttemptAt: jumped }), now)).toBe(true);
    expect(isManualAttemptAllowed(entry({ permanent: true }))).toBe(false);
  });

  it("stores the wait on the account meta key without changing the input", () => {
    expect(syncMetaKey(account)).toBe(`sync:${center}:${user}`);
    const original = emptySyncRetryMeta(account);
    expect(original).not.toBeNull();
    if (!original) return;
    const stored = recordRetryFailure(original, "event-0001", { now, code: "network", randomUnit: 1 });
    expect(original.events).toEqual({});
    expect(stored?.events["event-0001"]).toEqual({
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + RETRY_BASE_MS).toISOString(),
      lastCode: "network",
      permanent: false,
    });
    const permanent = recordRetryFailure(original, "event-0001", { now, code: "different_mark", randomUnit: 0, permanent: true });
    const again = permanent ? recordRetryFailure(permanent, "event-0001", { now, code: "network", randomUnit: 1 }) : null;
    expect(again?.events["event-0001"]?.permanent).toBe(true);
    expect(again?.events["event-0001"]?.attempts).toBe(1);
  });

  it("rejects invalid retry metadata", () => {
    const valid = meta({ "event-0001": entry() });
    expect(parseSyncRetryMeta(valid, account)).toEqual({ ok: true, meta: valid });
    expect(parseSyncRetryMeta({ ...valid, key: `sync:${otherCenter}:${user}` }, account)).toEqual({ ok: false });
    expect(parseSyncRetryMeta({ ...valid, note: "family" }, account)).toEqual({ ok: false });
    expect(parseSyncRetryMeta({ ...valid, events: [] }, account)).toEqual({ ok: false });
    expect(parseSyncRetryMeta({ ...valid, lastSuccessAt: "tomorrow" }, account)).toEqual({ ok: false });
    expect(parseSyncRetryMeta({ ...valid, events: { x: entry() } }, account)).toEqual({ ok: false });
    expect(parseSyncRetryMeta({ ...valid, events: { "event-0001": { ...entry(), attempts: 1.5 } } }, account)).toEqual({ ok: false });
    expect(parseSyncRetryMeta({ ...valid, events: { "event-0001": { ...entry(), permanent: "yes" } } }, account)).toEqual({ ok: false });
    expect(parseSyncRetryMeta({ ...valid, events: { "event-0001": { ...entry(), lastCode: "Not a code" } } }, account)).toEqual({ ok: false });
    expect(parseSyncRetryMeta({ ...valid, events: { "event-0001": { ...entry(), nextAttemptAt: "2026-11-09T02:00:00Z" } } }, account)).toEqual({
      ok: false,
    });
    expect(parseSyncRetryMeta(null, account)).toEqual({ ok: false });
  });
});
