// Sends pending attendance while the signed-in page is open.
// navigator.onLine is never enough. The health route must answer first.
// A mark stays pending until its own server outcome is accepted and the
// phone reads that acknowledged row back. Nothing in this file deletes a row.
// One run at a time: a second tap joins the run already in progress.

import type { FutureAttendanceEvent } from "@/lib/device/local-db";
import { collectEligibleEvents, type CollectResult } from "@/lib/sync/collect";
import { classifyHealth } from "@/lib/sync/health";
import { acknowledgeEvents, loadAttendanceSync, writeRetryMeta } from "@/lib/sync/local";
import {
  recordRetryFailure,
  type SyncAccount,
  type SyncPass,
  type SyncRetryMeta,
} from "@/lib/sync/retry";
import { selectSyncBatch, type GzipFn } from "@/lib/sync/batch";

type SyncOutcomeName = "accepted" | "already_accepted" | "rejected" | "retryable_failure";

export const SYNC_HEALTH_PATH = "/api/sync/health";
export const SYNC_UPLOAD_PATH = "/api/sync";
export const MAX_BATCHES_PER_RUN = 4;
const RESPONSE_CAP = 64 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

const OUTCOMES = new Set<SyncOutcomeName>(["accepted", "already_accepted", "rejected", "retryable_failure"]);

export type SyncReportStatus =
  | "waiting"
  | "unreachable"
  | "session_expired"
  | "access_denied"
  | "sent"
  | "problem";

export type SyncRejection = {
  clientEventId: string;
  code: string;
};

export type SyncReport = {
  status: SyncReportStatus;
  message: string;
  waiting: number;
  rejected: number;
  retrying: number;
  lastSuccessAt: string | null;
  rejections: SyncRejection[];
  nextAttemptAt: string | null;
};

export type SyncRunInput = {
  factory: IDBFactory;
  account: SyncAccount;
  mode: SyncPass;
  now?: Date;
  random?: () => number;
  fetchImpl?: typeof fetch;
  gzip?: GzipFn;
  maxBatches?: number;
};

type Loaded = Extract<Awaited<ReturnType<typeof loadAttendanceSync>>, { ok: true }>["loaded"];

let inflight: Promise<SyncReport> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function explainSyncCode(code: string): string {
  switch (code) {
    case "forbidden":
      return "This account cannot record that class.";
    case "wrong_center":
      return "That class belongs to another center.";
    case "not_enrolled":
      return "That learner is not enrolled in the class.";
    case "unknown_class":
      return "That class is not on the server.";
    case "different_mark":
      return "This mark does not match the one already saved.";
    case "invalid_correction":
      return "The correction does not match an earlier mark.";
    case "invalid_event":
      return "This mark cannot be sent as it is saved.";
    case "oversized":
      return "This mark is too large to send.";
    case "predecessor":
      return "The earlier mark has not reached the server yet.";
    case "database":
      return "The server could not finish saving. It will be tried again.";
    case "network":
    case "timeout":
      return "The server could not be reached. It will be tried again.";
    case "server":
    case "rate_limited":
      return "The server was busy. It will be tried again.";
    default:
      return "This mark was not confirmed.";
  }
}

function ownedPending(loaded: Loaded, account: SyncAccount): FutureAttendanceEvent[] {
  return loaded.events.filter(
    (event) =>
      event.syncState === "pending" &&
      event.userId === account.userId &&
      event.centerId === account.centerId &&
      event.localDeviceId === loaded.deviceId,
  );
}

function counts(
  loaded: Loaded,
  collected: Extract<CollectResult, { ok: true }>,
  account: SyncAccount,
): Pick<SyncReport, "waiting" | "rejected" | "retrying" | "rejections" | "nextAttemptAt" | "lastSuccessAt"> {
  const pending = ownedPending(loaded, account);
  const invalid = new Set(collected.held.filter((hold) => hold.reason === "invalid").map((hold) => hold.id));
  const rejectedRows = pending.filter((event) => loaded.meta.events[event.clientEventId]?.permanent || invalid.has(event.clientEventId));
  const rejectedIds = new Set(rejectedRows.map((event) => event.clientEventId));
  const waiting = pending.filter((event) => !rejectedIds.has(event.clientEventId)).length;
  const retrying = pending.filter((event) => {
    const entry = loaded.meta.events[event.clientEventId];
    return Boolean(entry && !entry.permanent && !invalid.has(event.clientEventId) && entry.attempts > 0);
  }).length;
  let nextAttemptAt: string | null = null;
  for (const event of pending) {
    const entry = loaded.meta.events[event.clientEventId];
    if (!entry || entry.permanent || entry.attempts >= 6 || invalid.has(event.clientEventId)) continue;
    if (!nextAttemptAt || entry.nextAttemptAt < nextAttemptAt) nextAttemptAt = entry.nextAttemptAt;
  }
  return {
    waiting,
    rejected: rejectedIds.size,
    retrying,
    rejections: rejectedRows.map((event) => ({
      clientEventId: event.clientEventId,
      code: loaded.meta.events[event.clientEventId]?.lastCode ?? "invalid_event",
    })),
    nextAttemptAt,
    lastSuccessAt: loaded.meta.lastSuccessAt,
  };
}

function reportFrom(
  loaded: Loaded,
  collected: Extract<CollectResult, { ok: true }>,
  account: SyncAccount,
  status: SyncReportStatus,
  message: string,
): SyncReport {
  return { status, message, ...counts(loaded, collected, account) };
}

function problem(message: string): SyncReport {
  return {
    status: "problem",
    message,
    waiting: 0,
    rejected: 0,
    retrying: 0,
    lastSuccessAt: null,
    rejections: [],
    nextAttemptAt: null,
  };
}

async function readLimited(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.length > RESPONSE_CAP ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > RESPONSE_CAP) {
        await reader.cancel();
        return null;
      }
      chunks.push(step.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

type ParsedResult = { clientEventId: string; outcome: SyncOutcomeName; code?: string };

/// The response must name each submitted mark once. Anything else confirms nothing.
export function matchSyncResults(submittedIds: string[], body: unknown): { ok: true; results: ParsedResult[] } | { ok: false } {
  if (!isRecord(body) || !exactKeys(body, ["results"]) || !Array.isArray(body.results)) return { ok: false };
  if (body.results.length !== submittedIds.length) return { ok: false };
  const expected = new Set(submittedIds);
  if (expected.size !== submittedIds.length) return { ok: false };
  const results: ParsedResult[] = [];
  const seen = new Set<string>();
  for (const item of body.results) {
    if (!isRecord(item) || typeof item.clientEventId !== "string" || typeof item.outcome !== "string") return { ok: false };
    if (!OUTCOMES.has(item.outcome as SyncOutcomeName) || !expected.has(item.clientEventId) || seen.has(item.clientEventId)) {
      return { ok: false };
    }
    seen.add(item.clientEventId);
    const outcome = item.outcome as SyncOutcomeName;
    if (outcome === "accepted" || outcome === "already_accepted") {
      if (!exactKeys(item, ["clientEventId", "outcome"])) return { ok: false };
      results.push({ clientEventId: item.clientEventId, outcome });
      continue;
    }
    if (!exactKeys(item, ["clientEventId", "outcome", "code"]) || typeof item.code !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(item.code)) {
      return { ok: false };
    }
    results.push({ clientEventId: item.clientEventId, outcome, code: item.code });
  }
  if (seen.size !== expected.size) return { ok: false };
  return { ok: true, results };
}

async function fetchHealth(fetchImpl: typeof fetch, nowOnline: boolean | undefined): Promise<
  | { state: "authenticated" }
  | { state: "session_expired" }
  | { state: "access_denied" }
  | { state: "unreachable"; code: "network" | "timeout" | "server" }
> {
  try {
    const response = await fetchImpl(SYNC_HEALTH_PATH, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const bodyText = (await readLimited(response)) ?? "";
    const health = classifyHealth({
      navigatorOnline: nowOnline,
      response: {
        status: response.status,
        redirected: response.redirected,
        type: response.type,
        contentType: response.headers.get("content-type"),
        bodyText,
      },
    });
    if (health.state === "authenticated") return { state: "authenticated" };
    if (health.state === "unauthorized") return response.status === 403 ? { state: "access_denied" } : { state: "session_expired" };
    return { state: "unreachable", code: health.reason === "timeout" ? "timeout" : health.reason === "server_error" ? "server" : "network" };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError" || error instanceof Error && error.name === "TimeoutError";
    return { state: "unreachable", code: timeout ? "timeout" : "network" };
  }
}

function remember(meta: SyncRetryMeta, ids: string[], now: Date, code: string, randomUnit: number, permanent = false): SyncRetryMeta | null {
  let next = meta;
  for (const id of ids) {
    const updated = recordRetryFailure(next, id, { now, code, randomUnit, permanent });
    if (!updated) return null;
    next = updated;
  }
  return next;
}

function without(meta: SyncRetryMeta, ids: string[], successAt: string | null): SyncRetryMeta {
  const events = { ...meta.events };
  for (const id of ids) delete events[id];
  return { key: meta.key, lastSuccessAt: successAt ?? meta.lastSuccessAt, events };
}

async function executeSync(input: SyncRunInput): Promise<SyncReport> {
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxBatches = input.maxBatches ?? MAX_BATCHES_PER_RUN;
  const account = input.account;

  const initial = await loadAttendanceSync(input.factory, account);
  if (!initial.ok) {
    if (initial.reason === "no_device") return problem("This phone has no saved device id yet. Nothing was sent.");
    return problem("Saved attendance on this phone could not be read. Nothing was sent, and nothing was deleted.");
  }

  const firstCollect = collectEligibleEvents({
    account,
    localDeviceId: initial.loaded.deviceId,
    records: [...initial.loaded.practice, ...initial.loaded.events],
    retry: initial.loaded.meta,
    now,
    mode: input.mode,
  });
  if (!firstCollect.ok) return problem("Saved attendance on this phone could not be read. Nothing was sent, and nothing was deleted.");
  if (firstCollect.events.length === 0) {
    return reportFrom(initial.loaded, firstCollect, account, "waiting", waitingMessage(counts(initial.loaded, firstCollect, account)));
  }

  const online = typeof navigator === "undefined" ? undefined : navigator.onLine;
  const health = await fetchHealth(fetchImpl, online);
  if (health.state === "session_expired") {
    return reportFrom(initial.loaded, firstCollect, account, "session_expired", "Sign in again before these marks can be sent.");
  }
  if (health.state === "access_denied") {
    return reportFrom(initial.loaded, firstCollect, account, "access_denied", "This account cannot send attendance.");
  }
  if (health.state === "unreachable") {
    const failed = await failEvents(input.factory, account, initial.loaded.meta, firstCollect.events, now, random(), health.code);
    const reloaded = failed ?? initial.loaded.meta;
    const view = { ...initial.loaded, meta: reloaded };
    return reportFrom(view, firstCollect, account, "unreachable", "The server cannot be reached. The phone being online is not enough.");
  }

  let acknowledgedAny = false;
  let lostContact = false;
  const parked = new Set<string>();
  let uploads = 0;
  let guard = 0;
  while (uploads < maxBatches && guard < maxBatches + 8) {
    guard += 1;
    const loadedResult = await loadAttendanceSync(input.factory, account);
    if (!loadedResult.ok) return problem("Saved attendance on this phone could not be read. Nothing was deleted.");
    const loaded = loadedResult.loaded;
    const collected = collectEligibleEvents({
      account,
      localDeviceId: loaded.deviceId,
      records: [...loaded.practice, ...loaded.events],
      retry: loaded.meta,
      now,
      mode: input.mode,
    });
    if (!collected.ok) return problem("Saved attendance on this phone could not be read. Nothing was deleted.");
    if (collected.events.length === 0) break;

    const selected = await selectSyncBatch({
      localDeviceId: loaded.deviceId,
      events: collected.events,
      gzip: input.gzip,
    });
    if (!selected.ok) return problem("Saved attendance on this phone could not be packed. Nothing was deleted.");
    if (!selected.encoded) {
      const blocked = selected.blockedBy;
      if (!blocked || parked.has(blocked.clientEventId)) break;
      parked.add(blocked.clientEventId);
      const code = blocked.reason === "oversized" ? "oversized" : "invalid_event";
      const noted = remember(loaded.meta, [blocked.clientEventId], now, code, random(), true);
      if (!noted || !(await writeRetryMeta(input.factory, account, noted))) {
        return problem("A mark could not be recorded as too large to send. It was not deleted.");
      }
      continue;
    }

    const ids = selected.encoded.envelope.events.map((event) => event.clientEventId);
    uploads += 1;
    let response: Response;
    try {
      response = await fetchImpl(SYNC_UPLOAD_PATH, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          ...(selected.encoded.encoding === "gzip" ? { "content-encoding": "gzip" } : {}),
        },
        body: selected.encoded.body as BodyInit,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      await failEvents(input.factory, account, loaded.meta, eventsFor(loaded, ids), now, random(), timeout ? "timeout" : "network");
      lostContact = true;
      break;
    }

    if (response.status === 401) {
      const again = await loadAttendanceSync(input.factory, account);
      const view = again.ok ? again.loaded : loaded;
      const viewCollect = again.ok
        ? collectEligibleEvents({
            account,
            localDeviceId: view.deviceId,
            records: [...view.practice, ...view.events],
            retry: view.meta,
            now,
            mode: input.mode,
          })
        : collected;
      if (!viewCollect.ok) return problem("Sign in again before these marks can be sent.");
      return reportFrom(view, viewCollect, account, "session_expired", "Sign in again before these marks can be sent.");
    }
    if (response.status === 403) {
      return reportFrom(loaded, collected, account, "access_denied", "This account cannot send attendance.");
    }
    if (response.status === 429 || response.status >= 500) {
      await failEvents(input.factory, account, loaded.meta, eventsFor(loaded, ids), now, random(), response.status === 429 ? "rate_limited" : "server");
      break;
    }
    if (response.status !== 200) {
      await failEvents(input.factory, account, loaded.meta, eventsFor(loaded, ids), now, random(), "upload_refused");
      break;
    }

    const bodyText = await readLimited(response);
    let parsedBody: unknown = null;
    if (bodyText !== null) {
      try {
        parsedBody = JSON.parse(bodyText) as unknown;
      } catch {
        parsedBody = null;
      }
    }
    const matched = bodyText === null || parsedBody === null ? { ok: false as const } : matchSyncResults(ids, parsedBody);
    if (!matched.ok) {
      await failEvents(input.factory, account, loaded.meta, eventsFor(loaded, ids), now, random(), "response");
      break;
    }

    const byId = new Map(eventsFor(loaded, ids).map((event) => [event.clientEventId, event]));
    const confirmed: FutureAttendanceEvent[] = [];
    const rejected: ParsedResult[] = [];
    const retryable: ParsedResult[] = [];
    for (const result of matched.results) {
      const event = byId.get(result.clientEventId);
      if (!event) {
        confirmed.length = 0;
        break;
      }
      if (result.outcome === "accepted" || result.outcome === "already_accepted") confirmed.push(event);
      else if (result.outcome === "rejected") rejected.push(result);
      else retryable.push(result);
    }
    if (confirmed.length + rejected.length + retryable.length !== matched.results.length) {
      await failEvents(input.factory, account, loaded.meta, eventsFor(loaded, ids), now, random(), "response");
      break;
    }

    const acked = await acknowledgeEvents(input.factory, confirmed);
    let meta = loaded.meta;
    if (acked && confirmed.length > 0) {
      acknowledgedAny = true;
      meta = without(meta, confirmed.map((event) => event.clientEventId), now.toISOString());
    } else if (confirmed.length > 0) {
      const noted = remember(meta, confirmed.map((event) => event.clientEventId), now, "local_confirm", random());
      if (!noted) return problem("The phone could not confirm the saved marks. They were not deleted.");
      meta = noted;
    }
    for (const result of rejected) {
      const noted = remember(meta, [result.clientEventId], now, result.code ?? "invalid_event", random(), true);
      if (!noted) return problem("A refused mark could not be recorded. It was not deleted.");
      meta = noted;
    }
    for (const result of retryable) {
      const noted = remember(meta, [result.clientEventId], now, result.code ?? "database", random());
      if (!noted) return problem("A mark that needs another try could not be recorded. It was not deleted.");
      meta = noted;
    }
    if (!(await writeRetryMeta(input.factory, account, meta))) {
      return problem("The phone could not store the sync note. Attendance rows were not deleted.");
    }
  }

  const done = await loadAttendanceSync(input.factory, account);
  if (!done.ok) return problem("Saved attendance on this phone could not be read after sending. Nothing was deleted.");
  const doneCollect = collectEligibleEvents({
    account,
    localDeviceId: done.loaded.deviceId,
    records: [...done.loaded.practice, ...done.loaded.events],
    retry: done.loaded.meta,
    now,
    mode: input.mode,
  });
  if (!doneCollect.ok) return problem("Saved attendance on this phone could not be read after sending. Nothing was deleted.");
  const summary = counts(done.loaded, doneCollect, account);
  if (lostContact) {
    return {
      status: "unreachable",
      message: "The server cannot be reached. The phone being online is not enough.",
      ...summary,
    };
  }
  if (summary.rejected > 0 && summary.waiting === 0 && !acknowledgedAny) {
    return { status: "waiting", message: "Some attendance marks were refused and are still on this phone.", ...summary };
  }
  if (summary.waiting > 0) {
    return {
      status: acknowledgedAny ? "sent" : "waiting",
      message: acknowledgedAny
        ? "Some attendance was sent. More is still waiting on this phone."
        : waitingMessage(summary),
      ...summary,
    };
  }
  if (summary.rejected > 0) {
    return { status: "sent", message: "Sent attendance is confirmed. Some marks were refused and are still on this phone.", ...summary };
  }
  if (acknowledgedAny) {
    return { status: "sent", message: "Attendance saved on this phone was confirmed by the server.", ...summary };
  }
  return { status: "waiting", message: waitingMessage(summary), ...summary };
}

function waitingMessage(summary: Pick<SyncReport, "waiting" | "rejected">): string {
  if (summary.rejected > 0 && summary.waiting === 0) return "Some attendance marks were refused and are still on this phone.";
  if (summary.waiting === 0 && summary.rejected === 0) return "No attendance is waiting to send.";
  return "Attendance is saved on this phone and waiting to send.";
}

function eventsFor(loaded: Loaded, ids: string[]): FutureAttendanceEvent[] {
  const wanted = new Set(ids);
  return loaded.events.filter((event) => wanted.has(event.clientEventId));
}

async function failEvents(
  factory: IDBFactory,
  account: SyncAccount,
  meta: SyncRetryMeta,
  events: FutureAttendanceEvent[],
  now: Date,
  randomUnit: number,
  code: string,
): Promise<SyncRetryMeta | null> {
  const noted = remember(meta, events.map((event) => event.clientEventId), now, code, randomUnit);
  if (!noted) return null;
  await writeRetryMeta(factory, account, noted);
  return noted;
}

export function runAttendanceSync(input: SyncRunInput): Promise<SyncReport> {
  if (inflight) return inflight;
  const run = executeSync(input).finally(() => {
    if (inflight === run) inflight = null;
  });
  inflight = run;
  return run;
}
