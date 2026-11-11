/* olr-kiosk-shell. No learner data is stored in this file. */
(function () {
  var modules = {};
  function define(id, factory) {
    var module = { exports: {} };
    modules[id] = module;
    factory(module.exports, function (req) {
      var loaded = modules[req];
      if (!loaded) throw new Error("Missing shell module");
      return loaded.exports;
    });
  }
  define("lib/device/storage-key.ts", function (exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_STORAGE_KEY = void 0;
// The phone queue that sign-out already uses. Stage 2 reads this value and
// copies it. It does not write it, delete it, or change the screens that save it.
exports.DEVICE_STORAGE_KEY = "olr.device.v1";

});
  define("lib/auth/constants.ts", function (exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOGIN_MESSAGES = exports.SESSION_COOKIE = exports.IP_FAILED_ATTEMPTS_BEFORE_LOCK = exports.LOCKOUT_MS = exports.FAILED_ATTEMPTS_BEFORE_LOCK = exports.SESSION_TOUCH_MS = exports.SESSION_IDLE_MS = exports.SESSION_ABSOLUTE_MS = void 0;
// Shared phones in a classroom are often left signed in. These limits are
// short on purpose. A person who walks away should not leave records on screen
// for the rest of the day, and an overnight cookie should already be dead.
exports.SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
exports.SESSION_IDLE_MS = 30 * 60 * 1000;
exports.SESSION_TOUCH_MS = 5 * 60 * 1000;
// SYS-1 lockout: 15 minutes after 5 failed attempts.
exports.FAILED_ATTEMPTS_BEFORE_LOCK = 5;
exports.LOCKOUT_MS = 15 * 60 * 1000;
// Many learners share one phone and one public network address. The per-account
// lock is the rule that matters. This network limit only stops a script from
// trying hundreds of different codes. It is high so a class mistyping PINs
// does not lock the whole room.
exports.IP_FAILED_ATTEMPTS_BEFORE_LOCK = 100;
exports.SESSION_COOKIE = "olr_session";
exports.LOGIN_MESSAGES = {
    mismatch: "Those details do not match. Try again.",
    locked: "Too many tries. Wait 15 minutes, then try again.",
    deactivated: "This account is switched off. Ask a director.",
};

});
  define("lib/auth/session-policy.ts", function (exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_IDLE_MS = exports.SESSION_ABSOLUTE_MS = void 0;
exports.sessionVerdict = sessionVerdict;
exports.shouldTouchSession = shouldTouchSession;
exports.shouldDropSessionCookie = shouldDropSessionCookie;
exports.sessionExpiry = sessionExpiry;
const constants_1 = require("lib/auth/constants.ts");
Object.defineProperty(exports, "SESSION_ABSOLUTE_MS", { enumerable: true, get: function () { return constants_1.SESSION_ABSOLUTE_MS; } });
Object.defineProperty(exports, "SESSION_IDLE_MS", { enumerable: true, get: function () { return constants_1.SESSION_IDLE_MS; } });
function sessionVerdict(row, now) {
    if (row.revokedAt)
        return "revoked";
    if (row.expiresAt.getTime() <= now.getTime())
        return "absolute";
    if (now.getTime() - row.lastSeenAt.getTime() >= constants_1.SESSION_IDLE_MS)
        return "idle";
    return "ok";
}
function shouldTouchSession(row, now) {
    return sessionVerdict(row, now) === "ok" && now.getTime() - row.lastSeenAt.getTime() >= constants_1.SESSION_TOUCH_MS;
}
// The proxy only checks that a cookie exists. A dead, missing, or unreadable
// session still looks signed in, so / and /opening send the phone to each other.
// The cookie has to be dropped. A live session must keep it.
function shouldDropSessionCookie(verdict) {
    return verdict !== "ok";
}
function sessionExpiry(now) {
    return new Date(now.getTime() + constants_1.SESSION_ABSOLUTE_MS);
}

});
  define("lib/device/shared-device.ts", function (exports, require) {
"use strict";
// Records waiting to be sent live on the phone, not on the server.
// Logout must not delete them. It locks the phone so the next person cannot
// read them. The same person can sign in again, or a staff member can write
// a handover note. Either one unlocks the phone. The records stay under the
// account that created them.
//
// The lock has an id from this phone. A handover note points at that id.
// Phone clocks are often wrong, so the note is not matched by time.
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyDeviceState = emptyDeviceState;
exports.parseDeviceState = parseDeviceState;
exports.addDeviceItem = addDeviceItem;
exports.lockDevice = lockDevice;
exports.clearLock = clearLock;
exports.addRelease = addRelease;
exports.allowSignIn = allowSignIn;
exports.visibleItems = visibleItems;
function emptyDeviceState() {
    return { lock: null, items: [], releases: [] };
}
function parseDeviceState(raw) {
    try {
        const value = JSON.parse(raw);
        if (!value || !Array.isArray(value.items) || !Array.isArray(value.releases))
            return null;
        return {
            lock: value.lock ?? null,
            items: value.items,
            releases: value.releases,
        };
    }
    catch {
        return null;
    }
}
function addDeviceItem(state, item) {
    return { ...state, items: [...state.items, item] };
}
function lockDevice(state, lock) {
    return { ...state, lock };
}
function clearLock(state) {
    return { ...state, lock: null };
}
function addRelease(state, release) {
    return { ...state, releases: [...state.releases, release] };
}
function pendingForLock(state) {
    if (!state.lock)
        return [];
    return state.items.filter((item) => item.userId === state.lock?.userId && item.centerId === state.lock?.centerId);
}
function releasedThisLock(state) {
    if (!state.lock)
        return false;
    return state.releases.some((release) => release.lockId === state.lock?.lockId &&
        release.userId === state.lock.userId &&
        release.centerId === state.lock.centerId);
}
function allowSignIn(state, next) {
    if (!state.lock)
        return { ok: true };
    if (state.lock.userId === next.userId && state.lock.centerId === next.centerId)
        return { ok: true };
    const pending = pendingForLock(state);
    if (pending.length === 0 || releasedThisLock(state))
        return { ok: true };
    return {
        ok: false,
        itemCount: pending.length,
        lockedUserId: state.lock.userId,
        centerId: state.lock.centerId,
        lockId: state.lock.lockId,
    };
}
// While the phone is locked, nobody sees the queue, including the owner.
// After they sign in again the lock is cleared and only their own rows return.
function visibleItems(state, userId) {
    if (state.lock)
        return [];
    return state.items.filter((item) => item.userId === userId);
}

});
  define("lib/device/offline-decisions.ts", function (exports, require) {
"use strict";
// Decisions for offline kiosk attendance. Nothing here reads the phone's
// storage or the network. Later stages call these functions. Stage 1 does
// not change sign-in, the attendance save, or the database.
//
// The idle and absolute limits are the same ones the server already uses.
// Comparing them with the phone clock is a convenience for a supervised
// phone with synthetic data. It is not a security check. After a restart,
// the browser only has the new phone clock. Setting that clock backward
// makes an expired snapshot look valid. Setting it forward hides the class
// early. A fixed offset measured when the class was loaded corrects a clock
// that was already wrong by the same amount. It does not detect a later change.
//
// Later stages still owe these rules:
// - The offline shell is a standalone document, not a Next.js page, so it can
//   be shown at an attendance address without Next.js hydration. Stage 5 still
//   must not cache the personalized attendance page or its server response.
// - Storage persistence and quota checks live in storage-readiness.ts. The
//   attendance save asks them before it writes. A denied request or a full
//   phone must not be reported as a saved mark. Granted persistence still
//   does not mean the browser can never delete IndexedDB.
// - Each local attendance event gets a rising sequence number and the id of
//   the event it corrects. Later sync uses that order. The phone clock does
//   not choose which correction is newest.
// - If the lock cannot be written, hide the roster and do not claim that the
//   lock or the sign-out finished. decideSignOut records that rule.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNCHECKED_RECORDS = exports.MISMATCHED_RECORDS = exports.UNREADABLE_RECORDS = void 0;
exports.sameAccount = sameAccount;
exports.assessSnapshot = assessSnapshot;
exports.decideSharedPhone = decideSharedPhone;
exports.mayShowRoster = mayShowRoster;
exports.decideQueueSource = decideQueueSource;
exports.mergeWaitingItems = mergeWaitingItems;
exports.waitingCountFromSource = waitingCountFromSource;
exports.decideMarkWrite = decideMarkWrite;
exports.decideSignOut = decideSignOut;
exports.decideRevokeResult = decideRevokeResult;
const session_policy_1 = require("lib/auth/session-policy.ts");
const shared_device_1 = require("lib/device/shared-device.ts");
exports.UNREADABLE_RECORDS = "This phone's saved records could not be read. They were not deleted. Do not hand the phone over yet.";
exports.MISMATCHED_RECORDS = "This phone's saved records do not match. They were not deleted. Do not hand the phone over yet.";
exports.UNCHECKED_RECORDS = "This phone's saved records could not be checked. They were not deleted. Do not hand the phone over yet.";
const LOCK_FAILED = "This phone could not lock the saved records. Sign-out was not completed. Do not hand the phone over yet.";
const LOCKED_WAITING = "This phone is locked. The sign-in on the server will end when the phone can reach it. Marks waiting to send are still here.";
const LOCKED_AND_SIGNED_OUT = "This phone is locked and the sign-in has ended. Marks waiting to send are still here.";
const MARK_FAILED = "This phone could not save the mark. It was not stored.";
const MARK_SAVED = "Saved on this phone, waiting to send";
function present(value) {
    return typeof value === "string" && value.trim() !== "";
}
function parseInstant(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed;
}
function sameAccount(left, right) {
    return present(left.userId) && present(left.centerId) && left.userId === right.userId && left.centerId === right.centerId;
}
function sameClass(left, right) {
    return (present(left.sectionId) &&
        present(left.classSessionId) &&
        left.sectionId === right.sectionId &&
        left.classSessionId === right.classSessionId);
}
function clocks(snapshot, phoneNow) {
    if (!present(snapshot.authSessionId))
        return null;
    const serverIssue = parseInstant(snapshot.serverNowAtIssue);
    const phoneIssue = parseInstant(snapshot.phoneNowAtIssue);
    const lastSeenAt = parseInstant(snapshot.lastSeenAt);
    const expiresAt = parseInstant(snapshot.expiresAt);
    if (!serverIssue || !phoneIssue || !lastSeenAt || !expiresAt || Number.isNaN(phoneNow.getTime()))
        return null;
    let revokedAt = null;
    if (snapshot.revokedAt !== null) {
        revokedAt = parseInstant(snapshot.revokedAt);
        if (!revokedAt)
            return null;
    }
    // Remove only the offset measured at load. A clock change after that is invisible.
    const at = new Date(phoneNow.getTime() - (phoneIssue.getTime() - serverIssue.getTime()));
    return { row: { revokedAt, lastSeenAt, expiresAt }, at };
}
function assessSnapshot(snapshot, viewer, phoneNow) {
    const timed = clocks(snapshot, phoneNow);
    if (!timed)
        return { ok: false, reason: "invalid" };
    if (!sameAccount(snapshot, viewer))
        return { ok: false, reason: "owner" };
    if (!sameClass(snapshot, viewer))
        return { ok: false, reason: "scope" };
    const verdict = (0, session_policy_1.sessionVerdict)(timed.row, timed.at);
    if (verdict !== "ok")
        return { ok: false, reason: verdict };
    return { ok: true };
}
function validItem(item) {
    return (present(item.id) &&
        present(item.userId) &&
        present(item.centerId) &&
        present(item.kind) &&
        present(item.summary) &&
        present(item.createdAt));
}
function validRelease(release) {
    return present(release.userId) && present(release.centerId) && present(release.lockId) && Number.isInteger(release.itemCount) && release.itemCount >= 0;
}
function validLock(lock) {
    return present(lock.lockId) && present(lock.userId) && present(lock.centerId);
}
/// Duplicate ids are one record. The same id claimed by two accounts is not
/// an empty queue: the whole read stops so the next person is not let in.
function checkedState(state) {
    if (!state || !Array.isArray(state.items) || !Array.isArray(state.releases))
        return null;
    if (state.lock !== null && !validLock(state.lock))
        return null;
    const seen = new Map();
    for (const item of state.items) {
        if (!validItem(item))
            return null;
        const previous = seen.get(item.id);
        if (previous && !sameAccount(previous, item))
            return null;
        if (!previous)
            seen.set(item.id, item);
    }
    for (const release of state.releases) {
        if (!validRelease(release))
            return null;
    }
    return { lock: state.lock, items: [...seen.values()], releases: state.releases };
}
function stop(message) {
    return { type: "stop", message, deletePending: false };
}
/// The existing shared-phone rules decide who may come in. A lock written
/// during sign-out also stores the server session id. The same id means the
/// server sign-in was never ended, including when that call failed offline.
/// The roster stays hidden until a different server session arrives. A lock
/// from the current app has no session id yet, and that lock still follows
/// today's rule: the same account may clear it.
function decideSharedPhone(input) {
    if (input.stored.status === "loading")
        return { type: "wait" };
    if (input.stored.status === "unavailable")
        return stop(exports.UNREADABLE_RECORDS);
    if (!present(input.nextUserId) || !present(input.nextCenterId))
        return stop(exports.UNREADABLE_RECORDS);
    if (input.nextAuthSessionId !== null && !present(input.nextAuthSessionId))
        return stop(exports.UNREADABLE_RECORDS);
    if (input.lockAuthSessionId !== null && !present(input.lockAuthSessionId))
        return stop(exports.UNREADABLE_RECORDS);
    const state = checkedState(input.stored.state);
    if (!state)
        return stop(exports.UNREADABLE_RECORDS);
    const lock = state.lock;
    const owner = lock !== null && sameAccount(lock, { userId: input.nextUserId, centerId: input.nextCenterId });
    const sameServerSession = input.lockAuthSessionId !== null &&
        (input.nextAuthSessionId === null || input.nextAuthSessionId === input.lockAuthSessionId);
    if (owner && sameServerSession)
        return { type: "stay-locked", deletePending: false };
    const admission = (0, shared_device_1.allowSignIn)(state, { userId: input.nextUserId, centerId: input.nextCenterId });
    if (!admission.ok)
        return { type: "blocked", itemCount: admission.itemCount, deletePending: false };
    if (lock)
        return { type: "clear-lock", deletePending: false };
    return { type: "open", deletePending: false };
}
function mayShowRoster(snapshot, phone) {
    return snapshot.ok && phone.type === "open";
}
/// localStorage stays the backup. IndexedDB is used only after a verified copy
/// whose fingerprint still matches that backup. A pending copy, a mismatch,
/// or an unreadable backup stops the phone. Neither store is treated as empty.
function decideQueueSource(input) {
    if (input.importStatus === "pending")
        return { type: "stop", message: exports.UNCHECKED_RECORDS };
    if (input.legacy.status === "loading")
        return { type: "wait" };
    if (input.legacy.status === "unavailable")
        return { type: "stop", message: exports.UNREADABLE_RECORDS };
    if (input.importStatus === "none")
        return { type: "legacy" };
    const emptyBackup = input.legacyPresence === "missing" &&
        input.importedPresence === "missing" &&
        input.legacyFingerprint === null &&
        input.importedFingerprint === null;
    if (emptyBackup)
        return { type: "indexed" };
    if (!present(input.legacyFingerprint) || !present(input.importedFingerprint)) {
        return { type: "stop", message: exports.UNREADABLE_RECORDS };
    }
    if (input.legacyFingerprint !== input.importedFingerprint)
        return { type: "stop", message: exports.MISMATCHED_RECORDS };
    return { type: "indexed" };
}
function validPractice(row) {
    return present(row.id) && present(row.userId) && present(row.centerId) && present(row.createdAt);
}
function validEvent(row) {
    return (present(row.clientEventId) &&
        present(row.userId) &&
        present(row.centerId) &&
        present(row.queuedAt) &&
        (row.syncState === "pending" || row.syncState === "acknowledged"));
}
/// Practice rows and pending attendance events become one waiting list.
/// An acknowledged event is not waiting. The same id is one record. A broken
/// row fails the whole list so a bad read is not reported as zero waiting.
function mergeWaitingItems(practice, events) {
    const items = new Map();
    for (const row of practice) {
        if (!validPractice(row))
            return { ok: false };
        const previous = items.get(row.id);
        if (previous && !sameAccount(previous, row))
            return { ok: false };
        if (previous)
            continue;
        items.set(row.id, {
            id: row.id,
            userId: row.userId,
            centerId: row.centerId,
            kind: "practice",
            summary: "Practice record. No personal details.",
            createdAt: row.createdAt,
        });
    }
    const seenEvents = new Map();
    for (const row of events) {
        if (!validEvent(row))
            return { ok: false };
        const previousEvent = seenEvents.get(row.clientEventId);
        if (previousEvent && !sameAccount(previousEvent, row))
            return { ok: false };
        seenEvents.set(row.clientEventId, row);
        const previous = items.get(row.clientEventId);
        if (previous && !sameAccount(previous, row))
            return { ok: false };
        // Already received by the server. It must not add a second waiting record,
        // and it must not erase a practice row that shares the id.
        if (row.syncState === "acknowledged")
            continue;
        items.set(row.clientEventId, {
            id: row.clientEventId,
            userId: row.userId,
            centerId: row.centerId,
            kind: "attendance",
            summary: "Attendance mark",
            createdAt: row.queuedAt,
        });
    }
    return { ok: true, items: [...items.values()] };
}
function countOwned(items, account) {
    return items.filter((item) => sameAccount(item, account)).length;
}
function waitingCountFromSource(input) {
    if (input.source.type === "wait")
        return { type: "wait" };
    if (input.source.type === "stop")
        return { type: "stop", message: input.source.message };
    if (!present(input.account.userId) || !present(input.account.centerId)) {
        return { type: "stop", message: exports.UNREADABLE_RECORDS };
    }
    // Before the copy is verified, indexed rows must not exist. Counting either
    // side alone could hide a record, and adding both would count a practice
    // record twice.
    if (input.source.type === "legacy" && (input.indexedPractice.length > 0 || input.indexedEvents.length > 0)) {
        return { type: "stop", message: exports.MISMATCHED_RECORDS };
    }
    const merged = input.source.type === "legacy"
        ? mergeWaitingItems(input.legacyPractice, [])
        : mergeWaitingItems(input.indexedPractice, input.indexedEvents);
    if (!merged.ok)
        return { type: "stop", message: exports.UNREADABLE_RECORDS };
    return { type: "count", count: countOwned(merged.items, input.account) };
}
function decideMarkWrite(wrote) {
    if (!wrote)
        return { confirmed: false, countChanges: false, deleteExisting: false, message: MARK_FAILED };
    return { confirmed: true, countChanges: true, deleteExisting: false, message: MARK_SAVED };
}
/// The local lock is attempted first. The server is called only after that
/// write succeeds. A failed write hides the roster and claims neither a lock
/// nor a finished sign-out. Pending marks are never deleted here.
function decideSignOut(lockWritten) {
    if (!lockWritten) {
        return {
            hideRoster: true,
            claimLocked: false,
            claimSignedOut: false,
            deletePending: false,
            mayCallServer: false,
            message: LOCK_FAILED,
        };
    }
    return {
        hideRoster: true,
        claimLocked: true,
        claimSignedOut: false,
        deletePending: false,
        mayCallServer: true,
        message: LOCKED_WAITING,
    };
}
function decideRevokeResult(input) {
    if (!input.lockWritten) {
        return {
            hideRoster: true,
            claimLocked: false,
            claimSignedOut: false,
            deletePending: false,
            message: LOCK_FAILED,
        };
    }
    if (!input.serverRevoked) {
        return {
            hideRoster: true,
            claimLocked: true,
            claimSignedOut: false,
            deletePending: false,
            message: LOCKED_WAITING,
        };
    }
    return {
        hideRoster: true,
        claimLocked: true,
        claimSignedOut: true,
        deletePending: false,
        message: LOCKED_AND_SIGNED_OUT,
    };
}

});
  define("lib/device/legacy-validate.ts", function (exports, require) {
"use strict";
// Strict reading of the existing phone queue. A missing key means this phone
// has nothing saved. A value that cannot be parsed, or a queue with a broken
// lock, practice item, or handover note, is not an empty queue.
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDeviceState = validateDeviceState;
exports.readLegacyText = readLegacyText;
exports.readLegacySource = readLegacySource;
exports.fingerprintText = fingerprintText;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function presentString(value) {
    return typeof value === "string" && value.trim() !== "";
}
function jsonCopy(value) {
    try {
        const copy = JSON.parse(JSON.stringify(value));
        if (!isRecord(copy))
            return null;
        return copy;
    }
    catch {
        return null;
    }
}
function copyItem(value) {
    if (!isRecord(value))
        return null;
    const copy = jsonCopy(value);
    // sourceIndex is the IndexedDB key added during the copy. An original
    // practice item does not have it. Rejecting it avoids hiding a field.
    if (!copy || "sourceIndex" in copy)
        return null;
    if (!presentString(copy.id) ||
        !presentString(copy.userId) ||
        !presentString(copy.centerId) ||
        !presentString(copy.kind) ||
        !presentString(copy.summary) ||
        !presentString(copy.createdAt)) {
        return null;
    }
    return copy;
}
function copyRelease(value) {
    if (!isRecord(value))
        return null;
    const copy = jsonCopy(value);
    if (!copy || "sourceIndex" in copy)
        return null;
    if (!presentString(copy.userId) || !presentString(copy.centerId) || !presentString(copy.lockId))
        return null;
    if (typeof copy.itemCount !== "number" || !Number.isInteger(copy.itemCount) || copy.itemCount < 0)
        return null;
    return copy;
}
function copyLock(value) {
    if (!isRecord(value))
        return null;
    const copy = jsonCopy(value);
    if (!copy)
        return null;
    if (!presentString(copy.lockId) || !presentString(copy.userId) || !presentString(copy.centerId))
        return null;
    // A missing session id is an older lock. A blank one is damaged.
    if ("authSessionId" in copy && !presentString(copy.authSessionId))
        return null;
    return copy;
}
/// Checks every field the current phone queue can hold: the lock, each
/// practice item, and each handover note. Extra saved fields are kept.
function validateDeviceState(value) {
    if (!isRecord(value))
        return null;
    if (!Array.isArray(value.items) || !Array.isArray(value.releases))
        return null;
    let lock = null;
    if (value.lock !== null && value.lock !== undefined) {
        lock = copyLock(value.lock);
        if (!lock)
            return null;
    }
    const items = [];
    for (const item of value.items) {
        const copied = copyItem(item);
        if (!copied)
            return null;
        items.push(copied);
    }
    const releases = [];
    for (const release of value.releases) {
        const copied = copyRelease(release);
        if (!copied)
            return null;
        releases.push(copied);
    }
    return { lock, items, releases };
}
/// null is a missing key. Any other string is parsed. Broken text is
/// unreadable. A parsed object with a missing or broken field is invalid.
function readLegacyText(raw) {
    if (raw === null)
        return { status: "missing" };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { status: "unreadable" };
    }
    const state = validateDeviceState(parsed);
    if (!state)
        return { status: "invalid" };
    return { status: "ready", raw, state };
}
function readLegacySource(readRaw) {
    try {
        return readLegacyText(readRaw());
    }
    catch {
        return { status: "unreadable" };
    }
}
/// Hash of the exact saved text, not of a rewritten object. Two texts that
/// look the same after parsing still differ when the characters differ.
async function fingerprintText(raw) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

});
  define("lib/device/local-db.ts", function (exports, require) {
"use strict";
// IndexedDB copy of the phone queue. IndexedDB is not encrypted. Anyone who
// can open this browser's storage tools can read what is stored here.
//
// localStorage and IndexedDB cannot commit together. The copy uses this
// state machine so an interrupted copy can be tried again without duplicating
// records or pretending the copy is empty:
//
//   none      The database exists and no copy has been committed.
//   pending   A copy was committed, but it has not been read back and matched.
//   verified  The read-back matched the source. Only this state is usable.
//
// A crash during the write rolls the transaction back, so the status stays
// where it was. A crash after pending and before verified is resumed by
// reading the pending rows back. The same source is not inserted again.
// If the original text changes after verified, the copy is left as it was
// and the caller must stop. This module never deletes olr.device.v1 and
// never calls deleteDatabase. Nothing here runs on startup.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_STORE_NAMES = exports.LEGACY_META_SCHEMA = exports.LOCAL_DB_VERSION = exports.LOCAL_DB_NAME = void 0;
exports.openWorkingDatabase = openWorkingDatabase;
exports.closeWorkingDatabase = closeWorkingDatabase;
exports.localRequest = localRequest;
exports.runLocalTransaction = runLocalTransaction;
exports.openLocalDatabase = openLocalDatabase;
exports.inspectLocalDatabase = inspectLocalDatabase;
exports.prepareLegacyMigration = prepareLegacyMigration;
exports.finishLegacyMigration = finishLegacyMigration;
exports.migrateLegacyDevice = migrateLegacyDevice;
exports.writeAccountLock = writeAccountLock;
exports.clearAccountLock = clearAccountLock;
exports.writeActiveAccount = writeActiveAccount;
exports.readActiveAccount = readActiveAccount;
exports.appendDeviceItem = appendDeviceItem;
exports.appendDeviceRelease = appendDeviceRelease;
const shared_device_1 = require("lib/device/shared-device.ts");
const legacy_validate_1 = require("lib/device/legacy-validate.ts");
exports.LOCAL_DB_NAME = "olr-local";
/// Version 2 adds grade and note stores. Version 3 adds the homework file
/// queue. Version 4 adds the note-view receipt queue. The upgrade only creates
/// stores that are missing. It does not delete attendance, locks, handover
/// notes, grades, files, or the old localStorage backup.
exports.LOCAL_DB_VERSION = 4;
/// The Day 7 copy row. It stays at 1 so a phone that already verified its
/// queue is not treated as damaged after the database version moves to 2.
exports.LEGACY_META_SCHEMA = 1;
exports.LOCAL_STORE_NAMES = [
    "meta",
    "deviceItems",
    "deviceReleases",
    "deviceLock",
    "snapshots",
    "rosters",
    "events",
    "recordMutations",
    "recordCounters",
    "fileQueue",
    "noteViewEvents",
];
const LEGACY_STORES = ["meta", "deviceItems", "deviceReleases", "deviceLock"];
/// meta holds bookkeeping. deviceItems, deviceReleases, and deviceLock are
/// the copied phone queue. snapshots, rosters, and events are the attendance
/// copies. Their indexes include centerId and userId so a read can stay
/// inside one account.
const STORE_PLAN = [
    { name: "meta", options: { keyPath: "key" }, indexes: [] },
    {
        name: "deviceItems",
        options: { keyPath: "sourceIndex" },
        indexes: [{ name: "byOwner", keyPath: ["centerId", "userId"] }],
    },
    { name: "deviceReleases", options: { keyPath: "sourceIndex" }, indexes: [] },
    { name: "deviceLock", options: { keyPath: "key" }, indexes: [] },
    {
        name: "snapshots",
        options: { keyPath: "id" },
        indexes: [{ name: "byOwner", keyPath: ["centerId", "userId"] }],
    },
    {
        name: "rosters",
        options: { keyPath: "id" },
        indexes: [{ name: "byOwner", keyPath: ["centerId", "userId"] }],
    },
    {
        name: "events",
        options: { keyPath: "clientEventId" },
        indexes: [
            { name: "byOwner", keyPath: ["centerId", "userId"] },
            { name: "bySequence", keyPath: ["centerId", "userId", "sequence"] },
        ],
    },
    // Grades and notes are editable records. They stay out of the attendance
    // event store and out of the homework file queue so a retry of one cannot
    // be mistaken for the other.
    {
        name: "recordMutations",
        options: { keyPath: "clientMutationId" },
        indexes: [
            { name: "byOwner", keyPath: ["centerId", "userId", "localDeviceId"] },
            { name: "byRecord", keyPath: ["centerId", "userId", "localDeviceId", "entityType", "recordId"] },
        ],
    },
    {
        name: "recordCounters",
        options: { keyPath: "id" },
        indexes: [{ name: "byOwner", keyPath: ["centerId", "userId", "localDeviceId"] }],
    },
    // Homework files stay out of the attendance event store and out of the
    // grade mutation store. A retry uses clientSubmissionId, not the filename.
    {
        name: "fileQueue",
        options: { keyPath: "clientSubmissionId" },
        indexes: [
            { name: "byOwner", keyPath: ["centerId", "userId", "localDeviceId"] },
            { name: "byAssignment", keyPath: ["centerId", "userId", "learnerId", "assignmentId"] },
        ],
    },
    // Note-view receipts stay out of the grade and note edit store. A view
    // cannot be replayed as an edit, and the row has no note text.
    {
        name: "noteViewEvents",
        options: { keyPath: "clientEventId" },
        indexes: [{ name: "byOwner", keyPath: ["centerId", "userId", "localDeviceId"] }],
    },
];
function emptyMeta() {
    return {
        key: "migration",
        schemaVersion: exports.LEGACY_META_SCHEMA,
        importStatus: "none",
        legacyPresence: null,
        legacyFingerprint: null,
        itemCount: 0,
        releaseCount: 0,
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseMeta(value) {
    if (!isRecord(value))
        return null;
    if (value.key !== "migration" || value.schemaVersion !== exports.LEGACY_META_SCHEMA)
        return null;
    if (value.importStatus !== "none" && value.importStatus !== "pending" && value.importStatus !== "verified")
        return null;
    if (value.legacyPresence !== null && value.legacyPresence !== "missing" && value.legacyPresence !== "present")
        return null;
    if (value.legacyFingerprint !== null && typeof value.legacyFingerprint !== "string")
        return null;
    if (typeof value.itemCount !== "number" || !Number.isInteger(value.itemCount) || value.itemCount < 0)
        return null;
    if (typeof value.releaseCount !== "number" || !Number.isInteger(value.releaseCount) || value.releaseCount < 0)
        return null;
    if (value.importStatus === "none") {
        if (value.legacyPresence !== null || value.legacyFingerprint !== null)
            return null;
        if (value.itemCount !== 0 || value.releaseCount !== 0)
            return null;
    }
    else if (value.legacyPresence === null) {
        return null;
    }
    if (value.legacyPresence === "missing" && value.legacyFingerprint !== null)
        return null;
    if (value.legacyPresence === "present" && (!value.legacyFingerprint || typeof value.legacyFingerprint !== "string"))
        return null;
    return {
        key: "migration",
        schemaVersion: exports.LEGACY_META_SCHEMA,
        importStatus: value.importStatus,
        legacyPresence: value.legacyPresence,
        legacyFingerprint: value.legacyFingerprint,
        itemCount: value.itemCount,
        releaseCount: value.releaseCount,
    };
}
function sameIdentity(meta, source) {
    return meta.legacyPresence === source.presence && meta.legacyFingerprint === source.fingerprint;
}
function sameState(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
}
function withTransaction(db, storeNames, mode, run) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let completed = false;
        let value;
        let hasValue = false;
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error instanceof Error ? error : new Error("IndexedDB request failed"));
        };
        const succeed = () => {
            if (settled || !hasValue)
                return;
            settled = true;
            resolve(value);
        };
        let tx;
        try {
            tx = db.transaction([...storeNames], mode);
        }
        catch (error) {
            fail(error);
            return;
        }
        tx.oncomplete = () => {
            completed = true;
            if (!hasValue)
                fail(new Error("IndexedDB transaction ended early"));
            else
                succeed();
        };
        tx.onabort = () => fail(tx.error ?? new Error("IndexedDB transaction aborted"));
        tx.onerror = () => fail(tx.error ?? new Error("IndexedDB transaction failed"));
        run(tx).then((next) => {
            hasValue = true;
            value = next;
            if (completed)
                succeed();
        }, (error) => {
            try {
                tx.abort();
            }
            catch {
                // The transaction has already finished.
            }
            fail(error);
        });
    });
}
function createSchema(db) {
    // Additive only. An existing store is left in place, including its rows.
    // deleteDatabase is never called here.
    for (const plan of STORE_PLAN) {
        if (db.objectStoreNames.contains(plan.name))
            continue;
        const store = db.createObjectStore(plan.name, plan.options);
        for (const index of plan.indexes)
            store.createIndex(index.name, index.keyPath);
    }
}
function connect(factory) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) {
                if (result.ok)
                    result.db.close();
                return;
            }
            settled = true;
            resolve(result);
        };
        let request;
        try {
            request = factory.open(exports.LOCAL_DB_NAME, exports.LOCAL_DB_VERSION);
        }
        catch {
            finish({ ok: false, reason: "unavailable" });
            return;
        }
        request.onblocked = () => finish({ ok: false, reason: "unavailable" });
        request.onerror = () => finish({ ok: false, reason: "unavailable" });
        request.onupgradeneeded = () => {
            try {
                createSchema(request.result);
            }
            catch {
                try {
                    request.transaction?.abort();
                }
                catch {
                    // The upgrade is already failing.
                }
                finish({ ok: false, reason: "unavailable" });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            finish({ ok: true, db });
        };
    });
}
function closeDatabase(db) {
    try {
        db.close();
    }
    catch {
        // Already closed.
    }
}
/// Opens the database and writes the bookkeeping row the first time this
/// browser creates it. Does not read or copy the old phone list.
async function openWorkingDatabase(factory) {
    const opened = await openReady(factory);
    if (!opened.ok || !("db" in opened)) {
        const reason = !opened.ok && opened.reason === "corrupt" ? "corrupt" : "unavailable";
        return { ok: false, reason };
    }
    return { ok: true, db: opened.db };
}
function closeWorkingDatabase(db) {
    closeDatabase(db);
}
function localRequest(request) {
    return requestToPromise(request);
}
/// One IndexedDB transaction. A thrown error cancels every change in it.
function runLocalTransaction(db, storeNames, mode, run) {
    return withTransaction(db, storeNames, mode, run);
}
async function readMeta(db) {
    const value = await withTransaction(db, ["meta"], "readonly", (tx) => requestToPromise(tx.objectStore("meta").get("migration")));
    if (value === undefined)
        return "missing";
    return parseMeta(value);
}
async function schemaInfo(db) {
    const names = [...exports.LOCAL_STORE_NAMES];
    const indexes = await withTransaction(db, names, "readonly", async (tx) => {
        const found = {};
        for (const name of names)
            found[name] = [...tx.objectStore(name).indexNames];
        return found;
    });
    return { stores: [...db.objectStoreNames], indexes };
}
function stripIndex(rows) {
    return [...rows]
        .sort((left, right) => left.sourceIndex - right.sourceIndex)
        .map((row) => {
        const copy = { ...row };
        delete copy.sourceIndex;
        return copy;
    });
}
async function readCopy(db) {
    const [itemRows, releaseRows, lockRow] = await withTransaction(db, ["deviceItems", "deviceReleases", "deviceLock"], "readonly", (tx) => Promise.all([
        requestToPromise(tx.objectStore("deviceItems").getAll()),
        requestToPromise(tx.objectStore("deviceReleases").getAll()),
        requestToPromise(tx.objectStore("deviceLock").get("current")),
    ]));
    if (!Array.isArray(itemRows) || !Array.isArray(releaseRows))
        return null;
    let lock = null;
    if (lockRow !== undefined) {
        if (!isRecord(lockRow) || !("lock" in lockRow))
            return null;
        lock = lockRow.lock === null ? null : lockRow.lock;
    }
    const state = (0, legacy_validate_1.validateDeviceState)({
        lock,
        items: stripIndex(itemRows),
        releases: stripIndex(releaseRows),
    });
    return state;
}
function putAll(store, records, done, fail) {
    let index = 0;
    const next = () => {
        if (index >= records.length) {
            done();
            return;
        }
        const request = store.put(records[index]);
        index += 1;
        request.onerror = () => fail(request.error);
        request.onsuccess = () => next();
    };
    next();
}
function writePending(db, state, meta) {
    return withTransaction(db, LEGACY_STORES, "readwrite", (tx) => {
        return new Promise((resolve, reject) => {
            const items = tx.objectStore("deviceItems");
            const releases = tx.objectStore("deviceReleases");
            const locks = tx.objectStore("deviceLock");
            const metas = tx.objectStore("meta");
            const clearItems = items.clear();
            clearItems.onerror = () => reject(clearItems.error);
            clearItems.onsuccess = () => {
                const clearReleases = releases.clear();
                clearReleases.onerror = () => reject(clearReleases.error);
                clearReleases.onsuccess = () => {
                    const clearLocks = locks.clear();
                    clearLocks.onerror = () => reject(clearLocks.error);
                    clearLocks.onsuccess = () => {
                        putAll(items, state.items.map((item, sourceIndex) => ({ ...item, sourceIndex })), () => {
                            putAll(releases, state.releases.map((release, sourceIndex) => ({ ...release, sourceIndex })), () => {
                                const lockRequest = locks.put({ key: "current", lock: state.lock });
                                lockRequest.onerror = () => reject(lockRequest.error);
                                lockRequest.onsuccess = () => {
                                    const metaRequest = metas.put(meta);
                                    metaRequest.onerror = () => reject(metaRequest.error);
                                    metaRequest.onsuccess = () => resolve();
                                };
                            }, reject);
                        }, reject);
                    };
                };
            };
        });
    });
}
function writeMeta(db, meta) {
    return withTransaction(db, ["meta"], "readwrite", (tx) => requestToPromise(tx.objectStore("meta").put(meta)).then(() => undefined));
}
async function sourceFrom(read) {
    if (read.status === "unreadable" || read.status === "invalid")
        return { ok: false, reason: read.status };
    if (read.status === "missing") {
        return { presence: "missing", fingerprint: null, state: (0, shared_device_1.emptyDeviceState)() };
    }
    return { presence: "present", fingerprint: await (0, legacy_validate_1.fingerprintText)(read.raw), state: read.state };
}
function isFailure(value) {
    return "ok" in value && value.ok === false;
}
async function openReady(factory) {
    const opened = await connect(factory);
    if (!opened.ok)
        return { ok: false, reason: "unavailable" };
    try {
        let meta = await readMeta(opened.db);
        if (meta === "missing") {
            await writeMeta(opened.db, emptyMeta());
            meta = await readMeta(opened.db);
        }
        if (meta === "missing" || meta === null) {
            closeDatabase(opened.db);
            return { ok: false, reason: "corrupt" };
        }
        return { ok: true, db: opened.db, meta };
    }
    catch {
        closeDatabase(opened.db);
        return { ok: false, reason: "unavailable" };
    }
}
async function openLocalDatabase(factory) {
    const opened = await openReady(factory);
    if (!opened.ok)
        return { ok: false, reason: opened.reason === "corrupt" ? "corrupt" : "unavailable" };
    try {
        const info = await schemaInfo(opened.db);
        return { ok: true, version: opened.db.version, ...info };
    }
    catch {
        return { ok: false, reason: "unavailable" };
    }
    finally {
        closeDatabase(opened.db);
    }
}
/// Recovery and tests use this. A pending or none result is not an empty
/// queue, and a corrupt result is not an empty queue. Only verified may be
/// treated as the copied phone queue.
async function inspectLocalDatabase(factory) {
    const opened = await connect(factory);
    if (!opened.ok) {
        return { status: "unavailable", state: null, fingerprint: null, presence: null };
    }
    try {
        const meta = await readMeta(opened.db);
        if (meta === "missing" || meta === null) {
            return { status: "corrupt", state: null, fingerprint: null, presence: null };
        }
        if (meta.importStatus === "none") {
            return { status: "none", state: null, fingerprint: null, presence: null };
        }
        const state = await readCopy(opened.db);
        if (!state || state.items.length !== meta.itemCount || state.releases.length !== meta.releaseCount) {
            return { status: "corrupt", state: null, fingerprint: meta.legacyFingerprint, presence: meta.legacyPresence };
        }
        return {
            status: meta.importStatus,
            state,
            fingerprint: meta.legacyFingerprint,
            presence: meta.legacyPresence,
        };
    }
    catch {
        return { status: "unavailable", state: null, fingerprint: null, presence: null };
    }
    finally {
        closeDatabase(opened.db);
    }
}
function pendingMeta(source) {
    return {
        key: "migration",
        schemaVersion: exports.LEGACY_META_SCHEMA,
        importStatus: "pending",
        legacyPresence: source.presence,
        legacyFingerprint: source.fingerprint,
        itemCount: source.state.items.length,
        releaseCount: source.state.releases.length,
    };
}
function done(source, outcome) {
    return { ok: true, outcome, fingerprint: source.fingerprint, presence: source.presence };
}
/// Writes the copy and marks it pending. Does not mark it verified.
/// The original localStorage value is only read. A second call with the same
/// text replaces nothing new: the pending rows are left in place.
async function prepareLegacyMigration(factory, readRaw) {
    const source = await sourceFrom((0, legacy_validate_1.readLegacySource)(readRaw));
    if (isFailure(source))
        return source;
    const opened = await openReady(factory);
    if (!opened.ok)
        return opened;
    try {
        if (opened.meta.importStatus === "verified") {
            return sameIdentity(opened.meta, source) ? done(source, "already-verified") : { ok: false, reason: "changed" };
        }
        if (opened.meta.importStatus === "pending" && sameIdentity(opened.meta, source))
            return done(source, "pending");
        await writePending(opened.db, source.state, pendingMeta(source));
        return done(source, "pending");
    }
    catch {
        return { ok: false, reason: "unavailable" };
    }
    finally {
        closeDatabase(opened.db);
    }
}
/// Reads the pending copy back. Verified is set only when it matches the
/// source. A mismatch leaves the rows in place and does not report success.
async function finishLegacyMigration(factory, readRaw) {
    const source = await sourceFrom((0, legacy_validate_1.readLegacySource)(readRaw));
    if (isFailure(source))
        return source;
    const opened = await openReady(factory);
    if (!opened.ok)
        return opened;
    try {
        if (opened.meta.importStatus === "none")
            return { ok: false, reason: "not-ready" };
        if (!sameIdentity(opened.meta, source))
            return { ok: false, reason: "changed" };
        const copied = await readCopy(opened.db);
        const matches = copied !== null &&
            copied.items.length === opened.meta.itemCount &&
            copied.releases.length === opened.meta.releaseCount &&
            sameState(copied, source.state);
        if (!matches) {
            if (opened.meta.importStatus === "verified")
                await writeMeta(opened.db, pendingMeta(source));
            return { ok: false, reason: "mismatch" };
        }
        if (opened.meta.importStatus === "verified")
            return done(source, "already-verified");
        await writeMeta(opened.db, { ...pendingMeta(source), importStatus: "verified" });
        const confirmed = await readCopy(opened.db);
        if (!confirmed || !sameState(confirmed, source.state)) {
            await writeMeta(opened.db, pendingMeta(source));
            return { ok: false, reason: "mismatch" };
        }
        return done(source, "verified");
    }
    catch {
        return { ok: false, reason: "unavailable" };
    }
    finally {
        closeDatabase(opened.db);
    }
}
/// Copies the current phone queue, reads it back, and marks it verified only
/// when the copy matches. Does not write or delete localStorage.
async function migrateLegacyDevice(factory, readRaw) {
    const prepared = await prepareLegacyMigration(factory, readRaw);
    if (!prepared.ok)
        return prepared;
    return finishLegacyMigration(factory, readRaw);
}
function presentId(value) {
    return typeof value === "string" && value.trim() !== "";
}
function parseActiveAccount(value) {
    if (!isRecord(value) || value.key !== "activeAccount")
        return null;
    if (!presentId(value.userId) || !presentId(value.centerId) || !presentId(value.authSessionId))
        return null;
    return { userId: value.userId, centerId: value.centerId, authSessionId: value.authSessionId };
}
function validQueueItem(item) {
    return (0, legacy_validate_1.validateDeviceState)({ lock: null, items: [item], releases: [] }) !== null;
}
function validRelease(release) {
    return (0, legacy_validate_1.validateDeviceState)({ lock: null, items: [], releases: [release] }) !== null;
}
/// A new sign-out lock must name the server session. The write touches only
/// the lock row, so practice records and attendance events stay where they are.
async function writeAccountLock(factory, lock) {
    if (!lock.authSessionId || (0, legacy_validate_1.validateDeviceState)({ lock, items: [], releases: [] }) === null)
        return false;
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok)
        return false;
    try {
        await runLocalTransaction(opened.db, ["deviceLock"], "readwrite", async (tx) => {
            await localRequest(tx.objectStore("deviceLock").put({ key: "current", lock }));
            const stored = await localRequest(tx.objectStore("deviceLock").get("current"));
            if (!isRecord(stored) || !isRecord(stored.lock) || stored.lock.authSessionId !== lock.authSessionId) {
                throw new Error("lock was not stored");
            }
            if (stored.lock.userId !== lock.userId || stored.lock.centerId !== lock.centerId || stored.lock.lockId !== lock.lockId) {
                throw new Error("lock was not stored");
            }
        });
        return true;
    }
    catch {
        return false;
    }
    finally {
        closeWorkingDatabase(opened.db);
    }
}
async function clearAccountLock(factory, active) {
    if (!parseActiveAccount({ key: "activeAccount", ...active }))
        return false;
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok)
        return false;
    try {
        await runLocalTransaction(opened.db, ["deviceLock", "meta"], "readwrite", async (tx) => {
            await localRequest(tx.objectStore("deviceLock").put({ key: "current", lock: null }));
            await localRequest(tx.objectStore("meta").put({ key: "activeAccount", ...active }));
            const lockRow = await localRequest(tx.objectStore("deviceLock").get("current"));
            const account = parseActiveAccount(await localRequest(tx.objectStore("meta").get("activeAccount")));
            if (!isRecord(lockRow) || lockRow.lock !== null || !account)
                throw new Error("lock was not cleared");
            if (account.userId !== active.userId || account.centerId !== active.centerId || account.authSessionId !== active.authSessionId) {
                throw new Error("lock was not cleared");
            }
        });
        return true;
    }
    catch {
        return false;
    }
    finally {
        closeWorkingDatabase(opened.db);
    }
}
async function writeActiveAccount(factory, active) {
    if (!parseActiveAccount({ key: "activeAccount", ...active }))
        return false;
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok)
        return false;
    try {
        await runLocalTransaction(opened.db, ["meta"], "readwrite", async (tx) => {
            await localRequest(tx.objectStore("meta").put({ key: "activeAccount", ...active }));
            const stored = parseActiveAccount(await localRequest(tx.objectStore("meta").get("activeAccount")));
            if (!stored || stored.userId !== active.userId || stored.centerId !== active.centerId || stored.authSessionId !== active.authSessionId) {
                throw new Error("account was not stored");
            }
        });
        return true;
    }
    catch {
        return false;
    }
    finally {
        closeWorkingDatabase(opened.db);
    }
}
/// null means no online account has been stored. "unreadable" means the row
/// is damaged, which must not be treated as permission to show another class.
async function readActiveAccount(factory) {
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok)
        return "unreadable";
    try {
        const value = await runLocalTransaction(opened.db, ["meta"], "readonly", (tx) => localRequest(tx.objectStore("meta").get("activeAccount")));
        if (value === undefined)
            return null;
        return parseActiveAccount(value) ?? "unreadable";
    }
    catch {
        return "unreadable";
    }
    finally {
        closeWorkingDatabase(opened.db);
    }
}
async function appendDeviceItem(factory, item) {
    if (!validQueueItem(item))
        return false;
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok)
        return false;
    try {
        await runLocalTransaction(opened.db, ["deviceItems", "meta"], "readwrite", async (tx) => {
            const meta = await localRequest(tx.objectStore("meta").get("migration"));
            if (!isRecord(meta) || meta.importStatus !== "verified" || typeof meta.itemCount !== "number") {
                throw new Error("copy is not verified");
            }
            const rows = await localRequest(tx.objectStore("deviceItems").getAll());
            if (!Array.isArray(rows))
                throw new Error("items could not be read");
            let max = -1;
            for (const row of rows) {
                if (!isRecord(row) || typeof row.sourceIndex !== "number")
                    throw new Error("items could not be read");
                max = Math.max(max, row.sourceIndex);
            }
            await localRequest(tx.objectStore("deviceItems").put({ ...item, sourceIndex: max + 1 }));
            await localRequest(tx.objectStore("meta").put({ ...meta, itemCount: meta.itemCount + 1 }));
        });
        return true;
    }
    catch {
        return false;
    }
    finally {
        closeWorkingDatabase(opened.db);
    }
}
async function appendDeviceRelease(factory, release) {
    if (!validRelease(release))
        return false;
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok)
        return false;
    try {
        await runLocalTransaction(opened.db, ["deviceReleases", "meta"], "readwrite", async (tx) => {
            const meta = await localRequest(tx.objectStore("meta").get("migration"));
            if (!isRecord(meta) || meta.importStatus !== "verified" || typeof meta.releaseCount !== "number") {
                throw new Error("copy is not verified");
            }
            const rows = await localRequest(tx.objectStore("deviceReleases").getAll());
            if (!Array.isArray(rows))
                throw new Error("releases could not be read");
            let max = -1;
            for (const row of rows) {
                if (!isRecord(row) || typeof row.sourceIndex !== "number")
                    throw new Error("releases could not be read");
                max = Math.max(max, row.sourceIndex);
                if (row.lockId === release.lockId && row.userId === release.userId && row.centerId === release.centerId)
                    return;
            }
            await localRequest(tx.objectStore("deviceReleases").put({ ...release, sourceIndex: max + 1 }));
            await localRequest(tx.objectStore("meta").put({ ...meta, releaseCount: meta.releaseCount + 1 }));
        });
        return true;
    }
    catch {
        return false;
    }
    finally {
        closeWorkingDatabase(opened.db);
    }
}

});
  define("lib/lms/timetable.ts", function (exports, require) {
"use strict";
// Weekly timetable rules for LMS-2 Phase 1.
// A class is stored as one ClassSession (a real start and end). The screen
// speaks in weekday and clock time because that is how teachers plan a week.
// Times are the center's clock, not the phone clock. Phone clocks in a
// classroom are often wrong, and the class happens at the center.
//
// Live links are allow-listed. A cheap phone should not open an unexpected site
// from a Join button. There is no video hosting and no offline media save here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELIVERY_MODES = exports.WEEKDAYS = void 0;
exports.weekdayLabel = weekdayLabel;
exports.deliveryLabel = deliveryLabel;
exports.materialLabel = materialLabel;
exports.clockLabel = clockLabel;
exports.formatCivilDate = formatCivilDate;
exports.formatShortDate = formatShortDate;
exports.parseIsoDate = parseIsoDate;
exports.addCalendarDays = addCalendarDays;
exports.mondayOnOrBefore = mondayOnOrBefore;
exports.isWeekdayName = isWeekdayName;
exports.isDeliveryModeName = isDeliveryModeName;
exports.isValidTimeZone = isValidTimeZone;
exports.zonedParts = zonedParts;
exports.zonedDateTimeToUtc = zonedDateTimeToUtc;
exports.weekdayOfInstant = weekdayOfInstant;
exports.clockOfInstant = clockOfInstant;
exports.localDateOfInstant = localDateOfInstant;
exports.validateMeetingUrl = validateMeetingUrl;
exports.validateTimetableInput = validateTimetableInput;
exports.sessionInstants = sessionInstants;
exports.weekBounds = weekBounds;
exports.dayBounds = dayBounds;
exports.isUuid = isUuid;
exports.WEEKDAYS = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
];
exports.DELIVERY_MODES = ["IN_PERSON", "LIVE_ONLINE", "PRE_RECORDED"];
const WEEKDAY_FROM_MONDAY = {
    MONDAY: 0,
    TUESDAY: 1,
    WEDNESDAY: 2,
    THURSDAY: 3,
    FRIDAY: 4,
    SATURDAY: 5,
    SUNDAY: 6,
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function weekdayLabel(weekday) {
    switch (weekday) {
        case "MONDAY":
            return "Monday";
        case "TUESDAY":
            return "Tuesday";
        case "WEDNESDAY":
            return "Wednesday";
        case "THURSDAY":
            return "Thursday";
        case "FRIDAY":
            return "Friday";
        case "SATURDAY":
            return "Saturday";
        case "SUNDAY":
            return "Sunday";
        default:
            return "Day";
    }
}
function deliveryLabel(mode) {
    switch (mode) {
        case "IN_PERSON":
            return "In person";
        case "LIVE_ONLINE":
            return "Live online";
        case "PRE_RECORDED":
            return "Pre-recorded";
        default:
            return "Class";
    }
}
function materialLabel(resourceType) {
    switch (resourceType) {
        case "AUDIO":
            return "Open audio";
        case "PDF":
            return "Open file";
        case "TEXT":
            return "Read lesson";
        default:
            return "Open lesson";
    }
}
function clockLabel(minutes) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function formatCivilDate(date) {
    return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
function formatShortDate(date) {
    const month = MONTHS[date.month - 1] ?? "";
    return `${date.day} ${month} ${date.year}`;
}
function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return null;
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day)
        return null;
    return { year, month, day };
}
function addCalendarDays(date, days) {
    const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
    utc.setUTCDate(utc.getUTCDate() + days);
    return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}
function mondayOnOrBefore(date) {
    const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
    const weekday = utc.getUTCDay();
    const delta = weekday === 0 ? -6 : 1 - weekday;
    return addCalendarDays(date, delta);
}
function isWeekdayName(value) {
    return exports.WEEKDAYS.includes(value);
}
function isDeliveryModeName(value) {
    return exports.DELIVERY_MODES.includes(value);
}
function parseClock(value) {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
    if (!match)
        return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23)
        return null;
    return hour * 60 + minute;
}
function isValidTimeZone(timeZone) {
    try {
        Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    }
    catch {
        return false;
    }
}
function zonedParts(date, timeZone) {
    if (!isValidTimeZone(timeZone))
        return null;
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
    const map = {};
    for (const part of formatter.formatToParts(date)) {
        if (part.type !== "literal")
            map[part.type] = part.value;
    }
    let year = Number(map.year);
    let month = Number(map.month);
    let day = Number(map.day);
    let hour = Number(map.hour);
    const minute = Number(map.minute);
    if ([year, month, day, hour, minute].some((part) => Number.isNaN(part)))
        return null;
    // Some engines report midnight as 24:00 on the previous civil date.
    if (hour === 24) {
        hour = 0;
        const next = addCalendarDays({ year, month, day }, 1);
        year = next.year;
        month = next.month;
        day = next.day;
    }
    return { year, month, day, hour, minute };
}
function zonedDateTimeToUtc(civil, timeZone) {
    if (!isValidTimeZone(timeZone))
        return null;
    const utcGuess = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, 0, 0);
    let instant = utcGuess;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const parts = zonedParts(new Date(instant), timeZone);
        if (!parts)
            return null;
        const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
        const next = utcGuess - (asUtc - instant);
        if (next === instant)
            break;
        instant = next;
    }
    const check = zonedParts(new Date(instant), timeZone);
    if (!check)
        return null;
    if (check.year !== civil.year ||
        check.month !== civil.month ||
        check.day !== civil.day ||
        check.hour !== civil.hour ||
        check.minute !== civil.minute) {
        return null;
    }
    return new Date(instant);
}
function weekdayOfInstant(date, timeZone) {
    if (!isValidTimeZone(timeZone))
        return null;
    const short = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
    switch (short) {
        case "Mon":
            return "MONDAY";
        case "Tue":
            return "TUESDAY";
        case "Wed":
            return "WEDNESDAY";
        case "Thu":
            return "THURSDAY";
        case "Fri":
            return "FRIDAY";
        case "Sat":
            return "SATURDAY";
        case "Sun":
            return "SUNDAY";
        default:
            return null;
    }
}
function clockOfInstant(date, timeZone) {
    const parts = zonedParts(date, timeZone);
    if (!parts)
        return null;
    return clockLabel(parts.hour * 60 + parts.minute);
}
function localDateOfInstant(date, timeZone) {
    const parts = zonedParts(date, timeZone);
    if (!parts)
        return null;
    return { year: parts.year, month: parts.month, day: parts.day };
}
function allowedMeetingHost(hostname) {
    const host = hostname.toLowerCase();
    if (host === "meet.google.com")
        return true;
    if (host === "meet.jit.si")
        return true;
    if (host === "8x8.vc" || host.endsWith(".8x8.vc"))
        return true;
    if (host === "zoom.us" || host.endsWith(".zoom.us"))
        return true;
    return false;
}
function validateMeetingUrl(raw) {
    const message = "Live classes need an https link from Google Meet, Zoom, or Jitsi.";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 2000 || /[\s\\]/.test(trimmed))
        return { ok: false, message };
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        return { ok: false, message };
    }
    if (url.protocol !== "https:")
        return { ok: false, message };
    if (url.username || url.password)
        return { ok: false, message };
    if (url.port)
        return { ok: false, message };
    if (!allowedMeetingHost(url.hostname))
        return { ok: false, message };
    if (!url.pathname || url.pathname === "/")
        return { ok: false, message };
    url.hash = "";
    return { ok: true, url: url.href };
}
function validateTimetableInput(input) {
    const title = input.title.trim();
    if (title.length < 2)
        return { ok: false, message: "Class name needs at least 2 characters." };
    if (title.length > 80)
        return { ok: false, message: "Class name is too long." };
    if (!isWeekdayName(input.weekday))
        return { ok: false, message: "Choose a day of the week." };
    if (!isDeliveryModeName(input.deliveryMode)) {
        return { ok: false, message: "Choose in person, live online, or pre-recorded." };
    }
    const startMinute = parseClock(input.startTime);
    const endMinute = parseClock(input.endTime);
    if (startMinute === null || endMinute === null) {
        return { ok: false, message: "Use a start and end time like 09:00." };
    }
    if (endMinute <= startMinute)
        return { ok: false, message: "End time must be after the start time." };
    const weekDate = parseIsoDate(input.weekOf);
    if (!weekDate)
        return { ok: false, message: "Choose which week this class is in." };
    const monday = mondayOnOrBefore(weekDate);
    const meetingRaw = (input.meetingUrl ?? "").trim();
    const resourceRaw = (input.linkedResourceId ?? "").trim();
    let meetingUrl = null;
    if (input.deliveryMode === "LIVE_ONLINE") {
        if (!meetingRaw)
            return { ok: false, message: "Live classes need an https link from Google Meet, Zoom, or Jitsi." };
        const checked = validateMeetingUrl(meetingRaw);
        if (!checked.ok)
            return checked;
        meetingUrl = checked.url;
    }
    else if (meetingRaw) {
        return { ok: false, message: "A meeting link is only for a live online class." };
    }
    if (input.deliveryMode === "PRE_RECORDED" && !resourceRaw) {
        return { ok: false, message: "Pre-recorded classes need a lesson or audio from this course." };
    }
    return {
        ok: true,
        value: {
            title,
            weekday: input.weekday,
            startMinute,
            endMinute,
            startTime: clockLabel(startMinute),
            endTime: clockLabel(endMinute),
            weekOf: formatCivilDate(monday),
            monday,
            deliveryMode: input.deliveryMode,
            meetingUrl,
            linkedResourceId: resourceRaw || null,
        },
    };
}
function sessionInstants(value, timeZone) {
    const day = addCalendarDays(value.monday, WEEKDAY_FROM_MONDAY[value.weekday]);
    const startsAt = zonedDateTimeToUtc({ ...day, hour: Math.floor(value.startMinute / 60), minute: value.startMinute % 60 }, timeZone);
    const endsAt = zonedDateTimeToUtc({ ...day, hour: Math.floor(value.endMinute / 60), minute: value.endMinute % 60 }, timeZone);
    if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime())
        return null;
    return { startsAt, endsAt };
}
function weekBounds(monday, timeZone) {
    const start = zonedDateTimeToUtc({ ...monday, hour: 0, minute: 0 }, timeZone);
    const end = zonedDateTimeToUtc({ ...addCalendarDays(monday, 7), hour: 0, minute: 0 }, timeZone);
    if (!start || !end || end.getTime() <= start.getTime())
        return null;
    return { start, end };
}
function dayBounds(date, timeZone) {
    const start = zonedDateTimeToUtc({ ...date, hour: 0, minute: 0 }, timeZone);
    const end = zonedDateTimeToUtc({ ...addCalendarDays(date, 1), hour: 0, minute: 0 }, timeZone);
    if (!start || !end)
        return null;
    return { start, end };
}
function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

});
  define("lib/lms/attendance.ts", function (exports, require) {
"use strict";
// Kiosk attendance rules for LMS-3 Phase 1.
// A mark is an event. A correction is another event. Nothing here rewrites an
// earlier event. The sheet shows the event the server received last for that
// learner and class. A learner with no event stays unmarked: blank is not
// absent, and it is not present.
//
// Reasons are the closed FEAT-3 list, and only for Absent or Excused. The
// reason is optional. There is no free-text family story.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEB_KIOSK_DEVICE_LABEL = exports.ABSENCE_REASONS = exports.ATTENDANCE_STATUSES = void 0;
exports.statusLabel = statusLabel;
exports.reasonLabel = reasonLabel;
exports.reasonAllowedFor = reasonAllowedFor;
exports.isAttendanceStatus = isAttendanceStatus;
exports.isAbsenceReason = isAbsenceReason;
exports.draftFromLearner = draftFromLearner;
exports.chooseStatus = chooseStatus;
exports.chooseReason = chooseReason;
exports.pendingMarks = pendingMarks;
exports.sheetCounts = sheetCounts;
exports.normalizeAttendanceBatch = normalizeAttendanceBatch;
exports.latestEventByLearner = latestEventByLearner;
exports.buildSessionHistory = buildSessionHistory;
const timetable_1 = require("lib/lms/timetable.ts");
exports.ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
exports.ABSENCE_REASONS = [
    "ILLNESS",
    "FAMILY_CARE",
    "TRANSPORT_OR_COST",
    "FAMILY_CIRCUMSTANCES_NOT_RECORDED",
    "UNKNOWN",
];
/// Label on the existing Device row used when a teacher saves from this page.
/// Day 6 is online. The attendance table still requires a device, and this
/// label is that row. It is not the Day 7 offline queue.
exports.WEB_KIOSK_DEVICE_LABEL = "Web attendance kiosk";
const STATUS_LABELS = {
    PRESENT: "Present",
    ABSENT: "Absent",
    LATE: "Late",
    EXCUSED: "Excused",
};
const REASON_LABELS = {
    ILLNESS: "Illness",
    FAMILY_CARE: "Family care",
    TRANSPORT_OR_COST: "Transport or cost",
    FAMILY_CIRCUMSTANCES_NOT_RECORDED: "Family circumstances (details not recorded)",
    UNKNOWN: "Unknown",
};
const CLIENT_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;
const MAX_MARKS = 80;
function statusLabel(status) {
    return STATUS_LABELS[status];
}
function reasonLabel(reason) {
    return REASON_LABELS[reason];
}
function reasonAllowedFor(status) {
    return status === "ABSENT" || status === "EXCUSED";
}
function isAttendanceStatus(value) {
    return exports.ATTENDANCE_STATUSES.includes(value);
}
function isAbsenceReason(value) {
    return exports.ABSENCE_REASONS.includes(value);
}
function draftFromLearner(learner) {
    return {
        learnerId: learner.id,
        displayName: learner.displayName,
        learnerCode: learner.learnerCode,
        saved: learner.saved,
        status: learner.saved?.status ?? null,
        reasonCode: learner.saved?.reasonCode ?? null,
        clientEventId: null,
        recordedAt: null,
    };
}
function matchesSaved(saved, status, reasonCode) {
    return (saved?.status ?? null) === status && (saved?.reasonCode ?? null) === reasonCode;
}
function withChoice(draft, status, reasonCode, factory) {
    const reason = status && reasonAllowedFor(status) ? reasonCode : null;
    if (matchesSaved(draft.saved, status, reason)) {
        return { ...draft, status, reasonCode: reason, clientEventId: null, recordedAt: null };
    }
    if (draft.clientEventId && draft.recordedAt) {
        return { ...draft, status, reasonCode: reason };
    }
    const fresh = factory();
    return {
        ...draft,
        status,
        reasonCode: reason,
        clientEventId: fresh.clientEventId,
        recordedAt: fresh.recordedAt,
    };
}
function chooseStatus(draft, status, factory) {
    const keepReason = reasonAllowedFor(status) ? draft.reasonCode : null;
    return withChoice(draft, status, keepReason, factory);
}
/// Tap the selected reason again to clear it. Clearing stores no reason,
/// which the requirements allow. It does not add a sixth reason.
function chooseReason(draft, reason, factory) {
    if (!draft.status || !reasonAllowedFor(draft.status))
        return draft;
    const next = draft.reasonCode === reason ? null : reason;
    return withChoice(draft, draft.status, next, factory);
}
function pendingMarks(drafts) {
    const marks = [];
    for (const draft of drafts) {
        if (!draft.status || !draft.clientEventId || !draft.recordedAt)
            continue;
        if (matchesSaved(draft.saved, draft.status, draft.reasonCode))
            continue;
        marks.push({
            learnerId: draft.learnerId,
            status: draft.status,
            reasonCode: draft.reasonCode,
            clientEventId: draft.clientEventId,
            recordedAt: draft.recordedAt,
        });
    }
    return marks;
}
function sheetCounts(drafts) {
    const unmarkedNames = drafts.filter((draft) => draft.status === null).map((draft) => draft.displayName);
    return {
        marked: drafts.length - unmarkedNames.length,
        unmarked: unmarkedNames.length,
        pending: pendingMarks(drafts).length,
        unmarkedNames,
    };
}
function reasonMessage() {
    return "That reason is not allowed. Use Illness, Family care, Transport or cost, Family circumstances (details not recorded), or Unknown. Leave it blank if you do not know.";
}
function normalizeAttendanceBatch(marks) {
    if (marks.length === 0) {
        return {
            ok: false,
            message: "Choose a status for at least one learner. Learners left unmarked are not saved.",
        };
    }
    if (marks.length > MAX_MARKS) {
        return { ok: false, message: "Too many marks in one save." };
    }
    const seenLearners = new Set();
    const seenIds = new Set();
    const normalized = [];
    for (const mark of marks) {
        if (!mark.learnerId || seenLearners.has(mark.learnerId)) {
            return { ok: false, message: "Each learner can have only one mark in a save." };
        }
        seenLearners.add(mark.learnerId);
        const clientEventId = mark.clientEventId.trim();
        if (!CLIENT_EVENT_ID.test(clientEventId) || seenIds.has(clientEventId)) {
            return {
                ok: false,
                message: seenIds.has(clientEventId)
                    ? "Each mark needs its own save id."
                    : "A mark is missing its save id.",
            };
        }
        seenIds.add(clientEventId);
        if (!isAttendanceStatus(mark.status)) {
            return { ok: false, message: "Choose Present, Absent, Late, or Excused." };
        }
        let reasonCode = null;
        if (mark.reasonCode !== null && mark.reasonCode.trim() !== "") {
            if (!isAbsenceReason(mark.reasonCode)) {
                return { ok: false, message: reasonMessage() };
            }
            reasonCode = mark.reasonCode;
        }
        if (reasonCode && !reasonAllowedFor(mark.status)) {
            const who = mark.status === "PRESENT" ? "Present" : "Late";
            return { ok: false, message: `${who} does not take a reason.` };
        }
        normalized.push({
            learnerId: mark.learnerId,
            status: mark.status,
            reasonCode,
            clientEventId,
            recordedAt: mark.recordedAt,
        });
    }
    return { ok: true, marks: normalized };
}
function sortEvents(events) {
    return [...events].sort((a, b) => {
        const synced = a.syncedAt.getTime() - b.syncedAt.getTime();
        if (synced !== 0)
            return synced;
        const created = a.createdAt.getTime() - b.createdAt.getTime();
        if (created !== 0)
            return created;
        if (a.id < b.id)
            return -1;
        if (a.id > b.id)
            return 1;
        return 0;
    });
}
/// Latest server receipt wins. The phone clock is ignored on purpose:
/// classroom phones are often set wrong.
function latestEventByLearner(events) {
    const latest = new Map();
    for (const event of sortEvents(events))
        latest.set(event.learnerId, event);
    return latest;
}
function receivedLabel(syncedAt, timeZone) {
    const local = (0, timetable_1.localDateOfInstant)(syncedAt, timeZone);
    const clock = (0, timetable_1.clockOfInstant)(syncedAt, timeZone);
    if (!local || !clock)
        return syncedAt.toISOString();
    return `${(0, timetable_1.formatShortDate)(local)}, ${clock}`;
}
function buildSessionHistory(events, timeZone) {
    const ordered = sortEvents(events);
    const previous = new Map();
    const currentIds = new Set();
    for (const event of latestEventByLearner(ordered).values())
        currentIds.add(event.id);
    return ordered.map((event) => {
        const earlier = previous.get(event.learnerId) ?? null;
        previous.set(event.learnerId, event);
        const statusText = statusLabel(event.status);
        const reasonText = event.reasonCode ? reasonLabel(event.reasonCode) : null;
        const reasonSentence = reasonText ? ` Reason: ${reasonText}.` : "";
        const summary = earlier
            ? `Corrects the earlier ${statusLabel(earlier.status)} mark. The sheet now shows ${statusText}. The earlier mark is kept.${reasonSentence}`
            : `First mark: ${statusText}.${reasonSentence}`;
        return {
            id: event.id,
            learnerId: event.learnerId,
            learnerName: event.learnerName,
            learnerCode: event.learnerCode,
            statusLabel: statusText,
            reasonLabel: reasonText,
            recordedByName: event.recordedByName,
            receivedLabel: receivedLabel(event.syncedAt, timeZone),
            kind: earlier ? "correction" : "first",
            summary,
            supersedesEventId: earlier?.id ?? null,
            isCurrent: currentIds.has(event.id),
        };
    });
}

});
  define("lib/device/storage-readiness.ts", function (exports, require) {
"use strict";
// Asks the browser whether this site may keep local data, and whether the
// reported free space covers one proposed write. IndexedDB is not encrypted.
// persist() returning true only asks the browser to avoid automatic eviction.
// The person can still clear the site, and this is not a promise that a
// saved mark can never disappear.
//
// Free space is quota minus usage, both in bytes, from estimate(). The
// numbers are a snapshot. They do not reserve space, so a later write can
// still fail. A denied persistence request, a failed or missing estimate, or
// too little free space must not be treated as a safely saved mark.
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserStorageProbe = browserStorageProbe;
exports.checkStorageReadiness = checkStorageReadiness;
exports.claimForStorage = claimForStorage;
const offline_decisions_1 = require("lib/device/offline-decisions.ts");
function finiteByte(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function browserStorageProbe() {
    const storage = globalThis.navigator?.storage;
    if (!storage || (typeof storage.persist !== "function" && typeof storage.estimate !== "function"))
        return null;
    return {
        persist: typeof storage.persist === "function" ? () => storage.persist() : undefined,
        estimate: typeof storage.estimate === "function" ? () => storage.estimate() : undefined,
    };
}
async function checkStorageReadiness(bytesNeeded, storage = browserStorageProbe()) {
    const bytesOk = Number.isInteger(bytesNeeded) && bytesNeeded >= 0;
    const result = {
        persistence: "unsupported",
        estimate: "unavailable",
        quotaBytes: null,
        usageBytes: null,
        availableBytes: null,
        bytesNeeded,
        enoughRoom: false,
        readyForWrite: false,
        mayClaimSaved: false,
        evictionStillPossible: true,
    };
    if (!storage)
        return result;
    if (typeof storage.persist === "function") {
        try {
            result.persistence = (await storage.persist()) ? "granted" : "denied";
        }
        catch {
            result.persistence = "failed";
        }
    }
    if (typeof storage.estimate !== "function")
        return result;
    let estimate;
    try {
        estimate = await storage.estimate();
    }
    catch {
        result.estimate = "failed";
        return result;
    }
    if (!estimate || !finiteByte(estimate.quota) || !finiteByte(estimate.usage)) {
        result.estimate = "unavailable";
        return result;
    }
    const available = Math.max(0, estimate.quota - estimate.usage);
    result.estimate = "ready";
    result.quotaBytes = estimate.quota;
    result.usageBytes = estimate.usage;
    result.availableBytes = available;
    result.enoughRoom = bytesOk && available >= bytesNeeded;
    result.readyForWrite = result.enoughRoom;
    result.mayClaimSaved = result.readyForWrite && result.persistence === "granted";
    return result;
}
/// A mark may be described as saved only when this check allows it. The
/// attendance save asks before it writes.
function claimForStorage(readiness) {
    return (0, offline_decisions_1.decideMarkWrite)(readiness.mayClaimSaved);
}

});
  define("lib/device/local-attendance.ts", function (exports, require) {
"use strict";
// Attendance marks kept on the phone before a later stage can send them.
// IndexedDB is not encrypted. This file stores the class list, the class name,
// the mark already on the server, and the marks for one signed-in center account.
// It does not store a meeting link or a course title.
//
// A correction is a new row. The phone clock is stored as a note on the row
// and is never used to decide which correction is newest. The rising sequence
// number does that. A failed write is not sent to the server instead: a later
// stage sends only rows this phone has read back.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SNAPSHOT_FORMAT = exports.OUTDATED_SNAPSHOT = void 0;
exports.attendanceRecordId = attendanceRecordId;
exports.newLocalEventId = newLocalEventId;
exports.rosterReady = rosterReady;
exports.storeAuthorizedClass = storeAuthorizedClass;
exports.effectiveLocalEvent = effectiveLocalEvent;
exports.eventsInSequence = eventsInSequence;
exports.applyLocalEvents = applyLocalEvents;
exports.readLocalAttendance = readLocalAttendance;
exports.saveLocalAttendance = saveLocalAttendance;
exports.readLocalCatalog = readLocalCatalog;
const offline_decisions_1 = require("lib/device/offline-decisions.ts");
const local_db_1 = require("lib/device/local-db.ts");
const attendance_1 = require("lib/lms/attendance.ts");
const storage_readiness_1 = require("lib/device/storage-readiness.ts");
const SAVED_MESSAGE = (0, offline_decisions_1.decideMarkWrite)(true).message;
const NOT_STORED = (0, offline_decisions_1.decideMarkWrite)(false).message;
const UNAVAILABLE = "Local attendance saving is unavailable on this phone. The marks were not stored.";
const NO_ROOM = "This phone does not have enough free space. Local attendance saving is unavailable. The marks were not stored.";
const DENIED = "This phone did not allow saved data to stay. Local attendance saving is unavailable. The marks were not stored.";
const UNREADABLE = "This phone's saved attendance could not be read. It was not deleted, and these marks were not stored.";
const EXPIRED = "This sign-in is no longer valid for saving on this phone. The marks were not stored.";
const OTHER_ACCOUNT = "These marks belong to a different sign-in. They were not stored.";
const NO_SNAPSHOT = "Open this class while connected before saving on this phone. The marks were not stored.";
exports.OUTDATED_SNAPSHOT = "Open this class again while connected before correcting attendance. The marks already on this phone were kept.";
/// Rows written by this version. The IndexedDB database stays at version 1.
exports.SNAPSHOT_FORMAT = 1;
const NOT_ON_ROSTER = "That learner is not on the saved class list. The marks were not stored.";
const DUPLICATE = "This save id was already used for a different mark. It was not stored.";
const BAD_LINK = "The earlier attendance record could not be linked. The mark was not stored.";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTENDANCE_STORES = ["meta", "snapshots", "rosters", "events"];
class LocalStop extends Error {
    constructor(message) {
        super(message);
        this.name = "LocalStop";
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function present(value) {
    return typeof value === "string" && value.trim() !== "";
}
function owned(owner) {
    return present(owner.userId) && present(owner.centerId);
}
function attendanceRecordId(owner, sectionId, classSessionId) {
    return `${owner.centerId}:${owner.userId}:${sectionId}:${classSessionId}`;
}
function sequenceKey(owner) {
    return `sequence:${owner.centerId}:${owner.userId}`;
}
/// A new id for one attendance change. The time is kept on the row as a note.
/// The sequence number, not this clock, decides which correction is newest.
function newLocalEventId(now = new Date()) {
    return { clientEventId: crypto.randomUUID(), recordedAt: now.toISOString() };
}
function readinessMessage(readiness) {
    if (readiness.mayClaimSaved)
        return null;
    if (readiness.estimate === "ready" && !readiness.enoughRoom)
        return NO_ROOM;
    if (readiness.persistence === "denied")
        return DENIED;
    return UNAVAILABLE;
}
function bytesFor(value) {
    // estimate() does not reserve space. The extra bytes cover the index keys
    // stored beside the row. A later write can still fail, and that failure
    // must not be described as saved.
    return new TextEncoder().encode(JSON.stringify(value)).length + 1024;
}
function ownerRange(owner) {
    if (typeof IDBKeyRange === "undefined")
        throw new LocalStop(UNREADABLE);
    return IDBKeyRange.only([owner.centerId, owner.userId]);
}
function deviceIdOf(value) {
    if (value === undefined)
        return null;
    if (!isRecord(value) || value.key !== "device" || typeof value.localDeviceId !== "string")
        return "bad";
    if (!DEVICE_ID.test(value.localDeviceId))
        return "bad";
    return value.localDeviceId;
}
function sequenceOf(value, owner) {
    if (value === undefined)
        return null;
    if (!isRecord(value) || value.key !== sequenceKey(owner))
        return "bad";
    if (!Number.isInteger(value.next) || value.next < 1)
        return "bad";
    return value.next;
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function labelText(value) {
    if (!present(value))
        return null;
    const text = value.trim();
    if (text.length < 1 || text.length > 200)
        return null;
    return text;
}
function parseSnapshot(value) {
    if (!isRecord(value))
        return null;
    const snapshot = {
        centerId: value.centerId,
        userId: value.userId,
        localDeviceId: value.localDeviceId,
        sectionId: value.sectionId,
        classSessionId: value.classSessionId,
        authSessionId: value.authSessionId,
        serverNowAtIssue: value.serverNowAtIssue,
        phoneNowAtIssue: value.phoneNowAtIssue,
        lastSeenAt: value.lastSeenAt,
        expiresAt: value.expiresAt,
        revokedAt: value.revokedAt === null ? null : value.revokedAt,
    };
    if (!present(snapshot.localDeviceId) || !DEVICE_ID.test(snapshot.localDeviceId))
        return null;
    if (snapshot.revokedAt !== null && !present(snapshot.revokedAt))
        return null;
    const text = Object.values(snapshot).every((item) => item === null || typeof item === "string");
    if (!text)
        return null;
    const sectionName = labelText(value.sectionName);
    const classTitle = labelText(value.classTitle);
    const whenLabel = labelText(value.whenLabel);
    const current = value.formatVersion === exports.SNAPSHOT_FORMAT && sectionName !== null && classTitle !== null && whenLabel !== null;
    return {
        ...snapshot,
        formatVersion: current ? exports.SNAPSHOT_FORMAT : null,
        sectionName: current ? sectionName : null,
        classTitle: current ? classTitle : null,
        whenLabel: current ? whenLabel : null,
    };
}
function parseServerMark(value) {
    const keys = ["serverAttendanceRecordId", "serverStatus", "serverReasonCode"];
    if (!keys.every((key) => hasOwn(value, key))) {
        return { serverKnown: false, serverAttendanceRecordId: null, serverStatus: null, serverReasonCode: null };
    }
    const serverAttendanceRecordId = value.serverAttendanceRecordId;
    const serverStatus = value.serverStatus;
    const serverReasonCode = value.serverReasonCode;
    if (serverAttendanceRecordId === null && serverStatus === null && serverReasonCode === null) {
        return { serverKnown: true, serverAttendanceRecordId: null, serverStatus: null, serverReasonCode: null };
    }
    if (typeof serverAttendanceRecordId !== "string" || !SAFE_ID.test(serverAttendanceRecordId))
        return null;
    if (typeof serverStatus !== "string" || !(0, attendance_1.isAttendanceStatus)(serverStatus))
        return null;
    if (serverReasonCode !== null && (typeof serverReasonCode !== "string" || !(0, attendance_1.isAbsenceReason)(serverReasonCode)))
        return null;
    if (serverReasonCode !== null && !(0, attendance_1.reasonAllowedFor)(serverStatus))
        return null;
    return { serverKnown: true, serverAttendanceRecordId, serverStatus, serverReasonCode };
}
function parseLearner(value) {
    if (!isRecord(value))
        return null;
    if (!present(value.learnerId) || !present(value.displayName) || !present(value.learnerCode))
        return null;
    const server = parseServerMark(value);
    if (!server)
        return null;
    return {
        learnerId: value.learnerId,
        displayName: value.displayName,
        learnerCode: value.learnerCode,
        ...server,
    };
}
function parseRoster(value) {
    if (!isRecord(value) || !Array.isArray(value.learners))
        return null;
    const learners = [];
    for (const learner of value.learners) {
        const parsed = parseLearner(learner);
        if (!parsed)
            return null;
        learners.push(parsed);
    }
    const id = value.id;
    const centerId = value.centerId;
    const userId = value.userId;
    const localDeviceId = value.localDeviceId;
    const sectionId = value.sectionId;
    const classSessionId = value.classSessionId;
    if (!present(id) || !present(centerId) || !present(userId))
        return null;
    if (!present(localDeviceId) || !DEVICE_ID.test(localDeviceId))
        return null;
    if (!present(sectionId) || !present(classSessionId))
        return null;
    const known = learners.length === 0 || learners.every((learner) => learner.serverKnown);
    const legacy = learners.every((learner) => !learner.serverKnown);
    if (!known && !legacy)
        return null;
    const formatVersion = value.formatVersion === exports.SNAPSHOT_FORMAT && known ? exports.SNAPSHOT_FORMAT : null;
    return { id, centerId, userId, localDeviceId, sectionId, classSessionId, learners, formatVersion };
}
function parseEvent(value) {
    if (!isRecord(value))
        return null;
    if (!present(value.clientEventId) || !SAFE_ID.test(value.clientEventId))
        return null;
    if (!present(value.centerId) || !present(value.userId) || !present(value.sectionId))
        return null;
    if (!present(value.classSessionId) || !present(value.learnerId) || !present(value.recordedAt))
        return null;
    if (!present(value.localDeviceId) || !DEVICE_ID.test(value.localDeviceId))
        return null;
    const status = String(value.status);
    if (!(0, attendance_1.isAttendanceStatus)(status))
        return null;
    const reasonCode = value.reasonCode === null ? null : String(value.reasonCode);
    if (reasonCode !== null && !(0, attendance_1.isAbsenceReason)(reasonCode))
        return null;
    if (!Number.isInteger(value.sequence) || value.sequence < 1)
        return null;
    if (value.correctsClientEventId !== null && !present(value.correctsClientEventId))
        return null;
    if (value.correctsServerEventId !== null && !present(value.correctsServerEventId))
        return null;
    if (value.correctsClientEventId !== null && value.correctsServerEventId !== null)
        return null;
    if (value.syncState !== "pending" && value.syncState !== "acknowledged")
        return null;
    return {
        clientEventId: value.clientEventId,
        centerId: value.centerId,
        userId: value.userId,
        localDeviceId: value.localDeviceId,
        sectionId: value.sectionId,
        classSessionId: value.classSessionId,
        learnerId: value.learnerId,
        status,
        reasonCode,
        recordedAt: value.recordedAt,
        sequence: value.sequence,
        correctsClientEventId: value.correctsClientEventId,
        correctsServerEventId: value.correctsServerEventId,
        syncState: value.syncState,
    };
}
function sameEvent(left, right) {
    return (left.clientEventId === right.clientEventId &&
        left.centerId === right.centerId &&
        left.userId === right.userId &&
        left.localDeviceId === right.localDeviceId &&
        left.sectionId === right.sectionId &&
        left.classSessionId === right.classSessionId &&
        left.learnerId === right.learnerId &&
        left.status === right.status &&
        left.reasonCode === right.reasonCode &&
        left.recordedAt === right.recordedAt &&
        left.sequence === right.sequence &&
        left.correctsClientEventId === right.correctsClientEventId &&
        left.correctsServerEventId === right.correctsServerEventId &&
        left.syncState === right.syncState);
}
async function ownedValues(store, owner) {
    const rows = await (0, local_db_1.localRequest)(store.index("byOwner").getAll(ownerRange(owner)));
    if (!Array.isArray(rows))
        throw new LocalStop(UNREADABLE);
    for (const row of rows) {
        if (!isRecord(row) || row.centerId !== owner.centerId || row.userId !== owner.userId)
            throw new LocalStop(UNREADABLE);
    }
    return rows;
}
function eventsFrom(rows) {
    const events = [];
    const sequences = new Set();
    for (const row of rows) {
        const event = parseEvent(row);
        // A row that cannot be checked is not the same as an empty list.
        if (!event || sequences.has(event.sequence))
            throw new LocalStop(UNREADABLE);
        sequences.add(event.sequence);
        events.push(event);
    }
    return events;
}
function viewFrom(events, roster, scope) {
    const sessionEvents = events.filter((event) => event.sectionId === scope.sectionId && event.classSessionId === scope.classSessionId);
    return {
        sessionEvents,
        pendingCount: events.filter((event) => event.syncState === "pending").length,
        roster,
    };
}
async function readView(tx, owner, scope) {
    const events = eventsFrom(await ownedValues(tx.objectStore("events"), owner));
    const rosterRow = await (0, local_db_1.localRequest)(tx.objectStore("rosters").get(attendanceRecordId(owner, scope.sectionId, scope.classSessionId)));
    if (rosterRow === undefined)
        return viewFrom(events, null, scope);
    const roster = parseRoster(rosterRow);
    if (!roster || roster.centerId !== owner.centerId || roster.userId !== owner.userId)
        throw new LocalStop(UNREADABLE);
    if (roster.sectionId !== scope.sectionId || roster.classSessionId !== scope.classSessionId)
        throw new LocalStop(UNREADABLE);
    return viewFrom(events, roster, scope);
}
function refusal(error, fallback) {
    if (error instanceof LocalStop) {
        return { message: error.message, unreadable: error.message === UNREADABLE };
    }
    return { message: fallback, unreadable: true };
}
async function withDatabase(factory, run) {
    const opened = await (0, local_db_1.openWorkingDatabase)(factory);
    if (!opened.ok)
        throw new LocalStop(UNREADABLE);
    try {
        return await run(opened.db);
    }
    finally {
        (0, local_db_1.closeWorkingDatabase)(opened.db);
    }
}
function cleanLearners(input) {
    const learners = [];
    const seen = new Set();
    for (const learner of input) {
        if (!learner || typeof learner.learnerId !== "string" || seen.has(learner.learnerId))
            return null;
        const row = parseLearner(learner);
        if (!row?.serverKnown)
            return null;
        seen.add(row.learnerId);
        learners.push(row);
    }
    return learners;
}
function cleanLabels(input) {
    const sectionName = labelText(input.sectionName);
    const classTitle = labelText(input.classTitle);
    const whenLabel = labelText(input.whenLabel);
    if (!sectionName || !classTitle || !whenLabel)
        return null;
    return { formatVersion: exports.SNAPSHOT_FORMAT, sectionName, classTitle, whenLabel };
}
function storedLearner(learner) {
    return {
        learnerId: learner.learnerId,
        displayName: learner.displayName,
        learnerCode: learner.learnerCode,
        serverAttendanceRecordId: learner.serverAttendanceRecordId,
        serverStatus: learner.serverStatus,
        serverReasonCode: learner.serverReasonCode,
    };
}
function sameSnapshot(stored, expected) {
    return (stored.centerId === expected.centerId &&
        stored.userId === expected.userId &&
        stored.localDeviceId === expected.localDeviceId &&
        stored.sectionId === expected.sectionId &&
        stored.classSessionId === expected.classSessionId &&
        stored.authSessionId === expected.authSessionId &&
        stored.serverNowAtIssue === expected.serverNowAtIssue &&
        stored.phoneNowAtIssue === expected.phoneNowAtIssue &&
        stored.lastSeenAt === expected.lastSeenAt &&
        stored.expiresAt === expected.expiresAt &&
        stored.revokedAt === expected.revokedAt &&
        stored.formatVersion === expected.formatVersion &&
        stored.sectionName === expected.sectionName &&
        stored.classTitle === expected.classTitle &&
        stored.whenLabel === expected.whenLabel);
}
function sameRoster(stored, expected) {
    return (stored.id === expected.id &&
        stored.centerId === expected.centerId &&
        stored.userId === expected.userId &&
        stored.localDeviceId === expected.localDeviceId &&
        stored.sectionId === expected.sectionId &&
        stored.classSessionId === expected.classSessionId &&
        stored.formatVersion === expected.formatVersion &&
        JSON.stringify(stored.learners) === JSON.stringify(expected.learners));
}
function rosterReady(snapshot, roster) {
    return snapshot.formatVersion === exports.SNAPSHOT_FORMAT && roster.formatVersion === exports.SNAPSHOT_FORMAT && roster.learners.every((learner) => learner.serverKnown);
}
function snapshotDecisionMessage(reason) {
    if (reason === "owner")
        return OTHER_ACCOUNT;
    if (reason === "scope")
        return NO_SNAPSHOT;
    return EXPIRED;
}
async function storeAuthorizedClass(input) {
    if (!owned(input.owner) || !present(input.sectionId) || !present(input.classSessionId)) {
        return { ok: false, message: NO_SNAPSHOT, unreadable: false };
    }
    const learners = cleanLearners(input.learners);
    const labels = cleanLabels(input);
    if (!learners || !labels || !present(input.clock.authSessionId))
        return { ok: false, message: NO_SNAPSHOT, unreadable: false };
    const id = attendanceRecordId(input.owner, input.sectionId, input.classSessionId);
    const draftSnapshot = {
        centerId: input.owner.centerId,
        userId: input.owner.userId,
        sectionId: input.sectionId,
        classSessionId: input.classSessionId,
        authSessionId: input.clock.authSessionId,
        serverNowAtIssue: input.clock.serverNow,
        phoneNowAtIssue: input.phoneNow.toISOString(),
        lastSeenAt: input.clock.lastSeenAt,
        expiresAt: input.clock.expiresAt,
        revokedAt: null,
    };
    const decision = (0, offline_decisions_1.assessSnapshot)(draftSnapshot, { ...input.owner, sectionId: input.sectionId, classSessionId: input.classSessionId }, input.phoneNow);
    if (!decision.ok)
        return { ok: false, message: snapshotDecisionMessage(decision.reason), unreadable: false };
    const storage = input.storage === undefined ? (0, storage_readiness_1.browserStorageProbe)() : input.storage;
    const readiness = await (0, storage_readiness_1.checkStorageReadiness)(bytesFor({ id, learners }), storage);
    const blocked = readinessMessage(readiness);
    if (blocked)
        return { ok: false, message: blocked, unreadable: false };
    try {
        const localDeviceId = await withDatabase(input.factory, async (db) => {
            const written = await (0, local_db_1.runLocalTransaction)(db, ["meta", "snapshots", "rosters"], "readwrite", async (tx) => {
                const current = deviceIdOf(await (0, local_db_1.localRequest)(tx.objectStore("meta").get("device")));
                if (current === "bad")
                    throw new LocalStop(UNREADABLE);
                const deviceId = current ?? crypto.randomUUID();
                const snapshot = { ...draftSnapshot, localDeviceId: deviceId, ...labels };
                const roster = {
                    id,
                    centerId: input.owner.centerId,
                    userId: input.owner.userId,
                    localDeviceId: deviceId,
                    sectionId: input.sectionId,
                    classSessionId: input.classSessionId,
                    formatVersion: exports.SNAPSHOT_FORMAT,
                    learners: learners.map(storedLearner),
                };
                if (current === null) {
                    await (0, local_db_1.localRequest)(tx.objectStore("meta").put({ key: "device", localDeviceId: deviceId }));
                }
                // The shell may list classes only for the account that opened one online.
                await (0, local_db_1.localRequest)(tx.objectStore("meta").put({
                    key: "activeAccount",
                    userId: input.owner.userId,
                    centerId: input.owner.centerId,
                    authSessionId: input.clock.authSessionId,
                }));
                await (0, local_db_1.localRequest)(tx.objectStore("snapshots").put({ ...snapshot, id }));
                await (0, local_db_1.localRequest)(tx.objectStore("rosters").put(roster));
                const storedSnapshot = parseSnapshot(await (0, local_db_1.localRequest)(tx.objectStore("snapshots").get(id)));
                const storedRoster = parseRoster(await (0, local_db_1.localRequest)(tx.objectStore("rosters").get(id)));
                const storedDevice = deviceIdOf(await (0, local_db_1.localRequest)(tx.objectStore("meta").get("device")));
                const expectedRoster = parseRoster(roster);
                if (!storedSnapshot || !storedRoster || !expectedRoster || storedDevice !== deviceId)
                    throw new LocalStop(NOT_STORED);
                if (!sameSnapshot(storedSnapshot, snapshot) || !sameRoster(storedRoster, expectedRoster))
                    throw new LocalStop(NOT_STORED);
                return deviceId;
            });
            const confirmed = await (0, local_db_1.runLocalTransaction)(db, ["snapshots", "rosters", "meta"], "readonly", async (tx) => {
                const storedSnapshot = parseSnapshot(await (0, local_db_1.localRequest)(tx.objectStore("snapshots").get(id)));
                const storedRoster = parseRoster(await (0, local_db_1.localRequest)(tx.objectStore("rosters").get(id)));
                return storedSnapshot?.localDeviceId === written && storedRoster?.localDeviceId === written;
            });
            if (!confirmed)
                throw new LocalStop(NOT_STORED);
            return written;
        });
        return { ok: true, localDeviceId };
    }
    catch (error) {
        const failed = refusal(error, NOT_STORED);
        return { ok: false, message: failed.message, unreadable: failed.unreadable };
    }
}
function sameBody(existing, mark, owner, scope) {
    return (existing.learnerId === mark.learnerId &&
        existing.status === mark.status &&
        existing.reasonCode === mark.reasonCode &&
        existing.centerId === owner.centerId &&
        existing.userId === owner.userId &&
        existing.sectionId === scope.sectionId &&
        existing.classSessionId === scope.classSessionId);
}
function latestFor(events, learnerId, scope) {
    let best = null;
    for (const event of events) {
        if (event.learnerId !== learnerId || event.sectionId !== scope.sectionId || event.classSessionId !== scope.classSessionId)
            continue;
        if (!best || event.sequence > best.sequence)
            best = event;
    }
    return best;
}
function effectiveLocalEvent(events, learnerId) {
    return events
        .filter((event) => event.learnerId === learnerId)
        .reduce((best, event) => (!best || event.sequence > best.sequence ? event : best), null);
}
function eventsInSequence(events) {
    return [...events].sort((left, right) => left.sequence - right.sequence);
}
/// The sheet shows the newest sequence for each learner. Older rows stay in
/// the history list the caller already has.
function applyLocalEvents(learners, events) {
    return learners.map((learner) => {
        const draft = (0, attendance_1.draftFromLearner)(learner);
        const latest = events
            .filter((event) => event.learnerId === learner.id)
            .reduce((best, event) => (!best || event.sequence > best.sequence ? event : best), null);
        if (!latest)
            return draft;
        return {
            ...draft,
            status: latest.status,
            reasonCode: latest.reasonCode,
            saved: { eventId: latest.clientEventId, status: latest.status, reasonCode: latest.reasonCode },
            clientEventId: null,
            recordedAt: null,
        };
    });
}
async function readLocalAttendance(factory, owner, scope) {
    if (!owned(owner))
        return { ok: false, message: UNREADABLE, count: null, unreadable: true };
    try {
        const view = await withDatabase(factory, (db) => (0, local_db_1.runLocalTransaction)(db, ["events", "rosters"], "readonly", (tx) => readView(tx, owner, scope)));
        return { ok: true, ...view };
    }
    catch (error) {
        const failed = refusal(error, UNREADABLE);
        return { ok: false, message: failed.message, count: null, unreadable: true };
    }
}
async function saveLocalAttendance(input) {
    const scope = { sectionId: input.sectionId, classSessionId: input.classSessionId };
    if (!owned(input.owner) || !present(scope.sectionId) || !present(scope.classSessionId)) {
        return { ok: false, message: NO_SNAPSHOT, count: null, unreadable: false };
    }
    const normalized = (0, attendance_1.normalizeAttendanceBatch)(input.marks);
    if (!normalized.ok)
        return { ok: false, message: normalized.message, count: null, unreadable: false };
    const serverIds = new Map(input.marks.map((mark) => [mark.learnerId, mark.serverEventId]));
    const storage = input.storage === undefined ? (0, storage_readiness_1.browserStorageProbe)() : input.storage;
    const readiness = await (0, storage_readiness_1.checkStorageReadiness)(bytesFor(normalized.marks), storage);
    const blocked = readinessMessage(readiness);
    if (blocked)
        return { ok: false, message: blocked, count: null, unreadable: false };
    try {
        const view = await withDatabase(input.factory, async (db) => {
            const expected = await (0, local_db_1.runLocalTransaction)(db, [...ATTENDANCE_STORES, "deviceLock"], "readwrite", async (tx) => {
                const lockRow = await (0, local_db_1.localRequest)(tx.objectStore("deviceLock").get("current"));
                if (lockRow !== undefined) {
                    if (!isRecord(lockRow) || !("lock" in lockRow))
                        throw new LocalStop(UNREADABLE);
                    // A lock hides the class. Saving another mark would keep private data on screen.
                    if (lockRow.lock !== null)
                        throw new LocalStop("This phone is locked. The class list stays hidden.");
                }
                const id = attendanceRecordId(input.owner, scope.sectionId, scope.classSessionId);
                const snapshot = parseSnapshot(await (0, local_db_1.localRequest)(tx.objectStore("snapshots").get(id)));
                if (!snapshot)
                    throw new LocalStop(NO_SNAPSHOT);
                const decision = (0, offline_decisions_1.assessSnapshot)(snapshot, { ...input.owner, ...scope }, input.phoneNow);
                if (!decision.ok)
                    throw new LocalStop(snapshotDecisionMessage(decision.reason));
                const deviceId = deviceIdOf(await (0, local_db_1.localRequest)(tx.objectStore("meta").get("device")));
                if (deviceId === "bad" || deviceId === null || deviceId !== snapshot.localDeviceId)
                    throw new LocalStop(UNREADABLE);
                const roster = parseRoster(await (0, local_db_1.localRequest)(tx.objectStore("rosters").get(id)));
                if (!roster || roster.centerId !== input.owner.centerId || roster.userId !== input.owner.userId)
                    throw new LocalStop(UNREADABLE);
                if (roster.localDeviceId !== deviceId)
                    throw new LocalStop(UNREADABLE);
                if (!rosterReady(snapshot, roster))
                    throw new LocalStop(exports.OUTDATED_SNAPSHOT);
                const allowed = new Set(roster.learners.map((learner) => learner.learnerId));
                if (normalized.marks.some((mark) => !allowed.has(mark.learnerId)))
                    throw new LocalStop(NOT_ON_ROSTER);
                const existing = eventsFrom(await ownedValues(tx.objectStore("events"), input.owner));
                const byId = new Map(existing.map((event) => [event.clientEventId, event]));
                const planned = [];
                const created = [];
                const storedNext = sequenceOf(await (0, local_db_1.localRequest)(tx.objectStore("meta").get(sequenceKey(input.owner))), input.owner);
                if (storedNext === "bad")
                    throw new LocalStop(UNREADABLE);
                const highest = existing.reduce((max, event) => Math.max(max, event.sequence), 0);
                let sequence = Math.max(storedNext ?? 1, highest + 1);
                for (const mark of normalized.marks) {
                    const current = byId.get(mark.clientEventId);
                    if (current) {
                        if (!sameBody(current, mark, input.owner, scope))
                            throw new LocalStop(DUPLICATE);
                        planned.push(current);
                        continue;
                    }
                    const baseline = roster.learners.find((learner) => learner.learnerId === mark.learnerId);
                    if (!baseline?.serverKnown)
                        throw new LocalStop(exports.OUTDATED_SNAPSHOT);
                    const serverEventId = serverIds.get(mark.learnerId) ?? null;
                    // The saved class, not the button, names the original server row.
                    if (serverEventId !== baseline.serverAttendanceRecordId)
                        throw new LocalStop(BAD_LINK);
                    const previous = latestFor(existing, mark.learnerId, scope);
                    let correctsClientEventId = null;
                    let correctsServerEventId = null;
                    if (previous)
                        correctsClientEventId = previous.clientEventId;
                    else if (serverEventId !== null)
                        correctsServerEventId = serverEventId;
                    const event = {
                        clientEventId: mark.clientEventId,
                        centerId: input.owner.centerId,
                        userId: input.owner.userId,
                        localDeviceId: deviceId,
                        sectionId: scope.sectionId,
                        classSessionId: scope.classSessionId,
                        learnerId: mark.learnerId,
                        status: mark.status,
                        reasonCode: mark.reasonCode,
                        recordedAt: mark.recordedAt && !Number.isNaN(new Date(mark.recordedAt).getTime()) ? mark.recordedAt : input.phoneNow.toISOString(),
                        sequence,
                        correctsClientEventId,
                        correctsServerEventId,
                        syncState: "pending",
                    };
                    sequence += 1;
                    planned.push(event);
                    created.push(event);
                    existing.push(event);
                }
                for (const event of created) {
                    // add refuses an id that is already stored, so a retry cannot replace it.
                    await (0, local_db_1.localRequest)(tx.objectStore("events").add(event));
                }
                if (created.length > 0) {
                    await (0, local_db_1.localRequest)(tx.objectStore("meta").put({ key: sequenceKey(input.owner), next: sequence }));
                }
                for (const event of planned) {
                    const stored = parseEvent(await (0, local_db_1.localRequest)(tx.objectStore("events").get(event.clientEventId)));
                    if (!stored || !sameEvent(stored, event))
                        throw new LocalStop(NOT_STORED);
                }
                const confirmedNext = sequenceOf(await (0, local_db_1.localRequest)(tx.objectStore("meta").get(sequenceKey(input.owner))), input.owner);
                if (created.length > 0 && confirmedNext !== sequence)
                    throw new LocalStop(NOT_STORED);
                return planned.map((event) => event.clientEventId);
            });
            const confirmed = await (0, local_db_1.runLocalTransaction)(db, ["events", "rosters"], "readonly", async (tx) => {
                const view = await readView(tx, input.owner, scope);
                const found = new Map(view.sessionEvents.map((event) => [event.clientEventId, event]));
                if (expected.some((clientEventId) => !found.has(clientEventId)))
                    throw new LocalStop(NOT_STORED);
                return view;
            });
            return confirmed;
        });
        return { ok: true, message: SAVED_MESSAGE, count: view.pendingCount, events: view.sessionEvents };
    }
    catch (error) {
        const failed = refusal(error, NOT_STORED);
        return { ok: false, message: failed.message, count: null, unreadable: failed.unreadable };
    }
}
/// Reads every local attendance row. A row that cannot be checked fails the
/// whole read. It does not come back as an empty class list.
async function readLocalCatalog(factory) {
    try {
        return await withDatabase(factory, (db) => (0, local_db_1.runLocalTransaction)(db, ["meta", "snapshots", "rosters", "events"], "readonly", async (tx) => {
            const device = deviceIdOf(await (0, local_db_1.localRequest)(tx.objectStore("meta").get("device")));
            if (device === "bad")
                throw new LocalStop(UNREADABLE);
            const snapshotRows = await (0, local_db_1.localRequest)(tx.objectStore("snapshots").getAll());
            const rosterRows = await (0, local_db_1.localRequest)(tx.objectStore("rosters").getAll());
            const eventRows = await (0, local_db_1.localRequest)(tx.objectStore("events").getAll());
            if (!Array.isArray(snapshotRows) || !Array.isArray(rosterRows) || !Array.isArray(eventRows)) {
                throw new LocalStop(UNREADABLE);
            }
            const snapshots = [];
            for (const row of snapshotRows) {
                const parsed = parseSnapshot(row);
                if (!parsed || !isRecord(row) || !present(row.id))
                    throw new LocalStop(UNREADABLE);
                snapshots.push({ ...parsed, id: String(row.id) });
            }
            const rosters = [];
            for (const row of rosterRows) {
                const parsed = parseRoster(row);
                if (!parsed)
                    throw new LocalStop(UNREADABLE);
                rosters.push(parsed);
            }
            const grouped = new Map();
            for (const row of eventRows) {
                if (!isRecord(row) || !present(row.centerId) || !present(row.userId))
                    throw new LocalStop(UNREADABLE);
                const key = `${row.centerId}:${row.userId}`;
                const list = grouped.get(key) ?? [];
                list.push(row);
                grouped.set(key, list);
            }
            const events = [];
            for (const rows of grouped.values())
                events.push(...eventsFrom(rows));
            return { ok: true, deviceId: device, snapshots, rosters, events };
        }));
    }
    catch (error) {
        return { ok: false, message: refusal(error, UNREADABLE).message };
    }
}

});
  define("lib/device/phone-access.ts", function (exports, require) {
"use strict";
// The verified IndexedDB queue is the only place new phone records are written.
// olr.device.v1 stays as the backup from the moment the copy was checked.
// An older tab can still change that backup. This module cannot stop that
// write, so any change makes the phone stop. Neither store is deleted.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHONE_PRIVACY_EVENT = void 0;
exports.openVerifiedQueue = openVerifiedQueue;
exports.withWaiting = withWaiting;
exports.performPhoneSignOut = performPhoneSignOut;
exports.addVerifiedPractice = addVerifiedPractice;
exports.addVerifiedRelease = addVerifiedRelease;
exports.waitingForAccount = waitingForAccount;
const local_attendance_1 = require("lib/device/local-attendance.ts");
const local_db_1 = require("lib/device/local-db.ts");
const legacy_validate_1 = require("lib/device/legacy-validate.ts");
const offline_decisions_1 = require("lib/device/offline-decisions.ts");
const shared_device_1 = require("lib/device/shared-device.ts");
exports.PHONE_PRIVACY_EVENT = "olr-phone-privacy";
function failure(reason) {
    if (reason === "mismatch" || reason === "changed")
        return { ok: false, message: offline_decisions_1.MISMATCHED_RECORDS };
    if (reason === "pending" || reason === "not-ready" || reason === "none")
        return { ok: false, message: offline_decisions_1.UNCHECKED_RECORDS };
    return { ok: false, message: offline_decisions_1.UNREADABLE_RECORDS };
}
/// Runs the existing copy, then checks the backup again. A pending copy, a
/// damaged database, or a backup that no longer matches the checked hash
/// stops the phone. The backup text is not rewritten.
async function acceptVerifiedCopy(factory, backup, state, importedFingerprint, importedPresence) {
    const legacy = (0, legacy_validate_1.readLegacySource)(() => backup);
    if (legacy.status === "unreadable" || legacy.status === "invalid")
        return failure(legacy.status);
    const legacyFingerprint = legacy.status === "ready" ? await (0, legacy_validate_1.fingerprintText)(legacy.raw) : null;
    const source = (0, offline_decisions_1.decideQueueSource)({
        legacy: legacy.status === "missing" ? { status: "ready", state: (0, shared_device_1.emptyDeviceState)() } : { status: "ready", state: legacy.state },
        importStatus: "verified",
        legacyFingerprint,
        importedFingerprint,
        legacyPresence: legacy.status === "missing" ? "missing" : "present",
        importedPresence,
    });
    if (source.type === "stop")
        return { ok: false, message: source.message };
    if (source.type !== "indexed")
        return failure("not-ready");
    const active = await (0, local_db_1.readActiveAccount)(factory);
    if (active === "unreadable")
        return failure("unreadable");
    return { ok: true, state, active, backup };
}
async function openVerifiedQueue(factory, readRaw) {
    let first;
    try {
        first = readRaw();
    }
    catch {
        return failure("unreadable");
    }
    // A verified copy is not compared to the backup row by row. New practice
    // records live only in IndexedDB. Calling the copy again would treat those
    // new rows as damage and hide them. Only the saved hash is checked.
    const existing = await (0, local_db_1.inspectLocalDatabase)(factory);
    if (existing.status === "verified" && existing.state) {
        let latest;
        try {
            latest = readRaw();
        }
        catch {
            return failure("unreadable");
        }
        if (latest !== first)
            return { ok: false, message: offline_decisions_1.MISMATCHED_RECORDS };
        return acceptVerifiedCopy(factory, latest, existing.state, existing.fingerprint, existing.presence);
    }
    const migrated = await (0, local_db_1.migrateLegacyDevice)(factory, () => first);
    if (!migrated.ok)
        return failure(migrated.reason);
    let latest;
    try {
        latest = readRaw();
    }
    catch {
        return failure("unreadable");
    }
    if (latest !== first)
        return { ok: false, message: offline_decisions_1.MISMATCHED_RECORDS };
    const inspected = await (0, local_db_1.inspectLocalDatabase)(factory);
    if (inspected.status !== "verified" || !inspected.state)
        return failure(inspected.status);
    return acceptVerifiedCopy(factory, latest, inspected.state, inspected.fingerprint, inspected.presence);
}
async function withWaiting(factory, state) {
    let catalog;
    try {
        catalog = await (0, local_attendance_1.readLocalCatalog)(factory);
    }
    catch {
        return failure("unreadable");
    }
    if (!catalog.ok)
        return { ok: false, message: catalog.message };
    const merged = (0, offline_decisions_1.mergeWaitingItems)(state.items.map((item) => ({
        id: item.id,
        userId: item.userId,
        centerId: item.centerId,
        createdAt: item.createdAt,
    })), catalog.events.map((event) => ({
        clientEventId: event.clientEventId,
        userId: event.userId,
        centerId: event.centerId,
        syncState: event.syncState,
        queuedAt: event.recordedAt,
    })));
    if (!merged.ok)
        return failure("unreadable");
    return { ok: true, state: { lock: state.lock, items: merged.items, releases: state.releases } };
}
/// Lock first. Hide next. Ask the server last. A failed lock does not call revoke.
async function performPhoneSignOut(input) {
    const queue = await openVerifiedQueue(input.factory, input.readRaw);
    if (!queue.ok) {
        input.onPrivacy(queue.message, false);
        return;
    }
    if (input.authSessionId.trim() === "" || input.account.userId.trim() === "" || input.account.centerId.trim() === "") {
        input.onPrivacy((0, offline_decisions_1.decideSignOut)(false).message, false);
        return;
    }
    const lock = {
        lockId: crypto.randomUUID(),
        userId: input.account.userId,
        centerId: input.account.centerId,
        authSessionId: input.authSessionId,
    };
    const written = await (input.writeLock ?? local_db_1.writeAccountLock)(input.factory, lock);
    const decision = (0, offline_decisions_1.decideSignOut)(written);
    input.onPrivacy(decision.message, decision.claimLocked);
    if (!decision.mayCallServer)
        return;
    let revoked = false;
    try {
        revoked = await input.revoke();
    }
    catch {
        revoked = false;
    }
    input.onPrivacy((0, offline_decisions_1.decideRevokeResult)({ lockWritten: true, serverRevoked: revoked }).message, true);
}
async function addVerifiedPractice(input) {
    const queue = await openVerifiedQueue(input.factory, input.readRaw);
    if (!queue.ok)
        return queue;
    const item = {
        id: crypto.randomUUID(),
        userId: input.account.userId,
        centerId: input.account.centerId,
        kind: "practice",
        summary: "Practice record. No personal details.",
        createdAt: new Date().toISOString(),
    };
    const saved = await (0, local_db_1.appendDeviceItem)(input.factory, item);
    if (!saved)
        return failure("unavailable");
    const checked = await openVerifiedQueue(input.factory, input.readRaw);
    if (!checked.ok)
        return checked;
    return { ok: true };
}
async function addVerifiedRelease(input) {
    const queue = await openVerifiedQueue(input.factory, input.readRaw);
    if (!queue.ok)
        return queue;
    if (!queue.state.lock || queue.state.lock.lockId !== input.release.lockId)
        return failure("invalid");
    if (queue.state.lock.userId !== input.release.userId || queue.state.lock.centerId !== input.release.centerId)
        return failure("invalid");
    const saved = await (0, local_db_1.appendDeviceRelease)(input.factory, input.release);
    if (!saved)
        return failure("unavailable");
    return { ok: true };
}
async function waitingForAccount(input) {
    const queue = await openVerifiedQueue(input.factory, input.readRaw);
    if (!queue.ok)
        return queue;
    const waiting = await withWaiting(input.factory, queue.state);
    if (!waiting.ok)
        return waiting;
    const count = waiting.state.items.filter((item) => item.userId === input.account.userId && item.centerId === input.account.centerId).length;
    return { ok: true, count, state: waiting.state };
}

});
  define("lib/device/revoke-session.ts", function (exports, require) {
"use strict";
// The page asks the server to end the sign-in. The cookie stays in the browser's
// own request. This function does not read the cookie, and the service worker
// is not given the session id.
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeServerSession = revokeServerSession;
async function revokeServerSession() {
    try {
        const response = await fetch("/session/revoke", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
        });
        return response.ok;
    }
    catch {
        return false;
    }
}

});
  define("lib/device/persistence-status.ts", function (exports, require) {
"use strict";
// One look at whether this phone will keep saved marks. persist() is asked
// at most once, and it is not asked again when the browser already agreed.
// A refusal leaves local attendance saving unavailable. There is no server fallback.
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPersistenceOnce = readPersistenceOnce;
exports.persistenceLines = persistenceLines;
function finiteByte(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
async function readPersistenceOnce(storage) {
    const snapshot = {
        persisted: null,
        request: "unsupported",
        usageBytes: null,
        quotaBytes: null,
    };
    if (!storage)
        return snapshot;
    if (typeof storage.persisted === "function") {
        try {
            snapshot.persisted = await storage.persisted();
        }
        catch {
            snapshot.persisted = null;
        }
    }
    if (snapshot.persisted === true) {
        snapshot.request = "already-kept";
    }
    else if (typeof storage.persist === "function") {
        try {
            const granted = await storage.persist();
            snapshot.request = granted ? "granted" : "denied";
            if (granted)
                snapshot.persisted = true;
        }
        catch {
            snapshot.request = "failed";
        }
    }
    if (typeof storage.estimate === "function") {
        try {
            const estimate = await storage.estimate();
            if (finiteByte(estimate?.usage))
                snapshot.usageBytes = estimate.usage;
            if (finiteByte(estimate?.quota))
                snapshot.quotaBytes = estimate.quota;
        }
        catch {
            snapshot.usageBytes = null;
            snapshot.quotaBytes = null;
        }
    }
    return snapshot;
}
function persistenceLines(snapshot) {
    const kept = snapshot.persisted === true ? "yes" : snapshot.persisted === false ? "no" : "unknown";
    const request = snapshot.request === "granted"
        ? "The browser agreed to keep saved data."
        : snapshot.request === "already-kept"
            ? "Saved data is already allowed to stay."
            : snapshot.request === "denied"
                ? "This phone did not allow saved data to stay. Local attendance saving is unavailable."
                : snapshot.request === "failed"
                    ? "This phone could not say whether saved data may stay. Local attendance saving is unavailable."
                    : "This phone cannot keep saved data. Local attendance saving is unavailable.";
    const space = snapshot.usageBytes !== null && snapshot.quotaBytes !== null
        ? `Storage used: ${snapshot.usageBytes} bytes. Storage available to this site: ${snapshot.quotaBytes} bytes.`
        : "Storage space could not be read.";
    return [`Kept on this phone: ${kept}.`, request, space];
}

});
  define("lib/device/kiosk-shell.ts", function (exports, require) {
"use strict";
// Offline attendance shell. This file is plain logic plus a small page painter.
// It is not a Next.js page. A Next.js page is tied to the address it was built
// for, and the phone will later show this same document at a class address.
// Personal data stays in IndexedDB. The document itself has no learner names.
//
// The phone lock hides the class list. That lock is not encryption. IndexedDB
// is still readable by anyone who can open this browser's storage tools.
// Pending marks are never deleted here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MORE_THAN_ONE_SIGN_IN = exports.PHONE_LOCKED = exports.OPEN_WHILE_CONNECTED = void 0;
exports.parseAttendancePath = parseAttendancePath;
exports.attendanceHref = attendanceHref;
exports.planKioskShell = planKioskShell;
exports.mountKioskShell = mountKioskShell;
const storage_key_1 = require("lib/device/storage-key.ts");
const offline_decisions_1 = require("lib/device/offline-decisions.ts");
const phone_access_1 = require("lib/device/phone-access.ts");
const revoke_session_1 = require("lib/device/revoke-session.ts");
const local_attendance_1 = require("lib/device/local-attendance.ts");
const persistence_status_1 = require("lib/device/persistence-status.ts");
const storage_readiness_1 = require("lib/device/storage-readiness.ts");
const attendance_1 = require("lib/lms/attendance.ts");
exports.OPEN_WHILE_CONNECTED = "Open this class once while connected.";
exports.PHONE_LOCKED = "This phone is locked. The class list stays hidden.";
exports.MORE_THAN_ONE_SIGN_IN = "This phone has more than one saved sign-in. Open a class while connected.";
const ATTENDANCE_PATH = /\/sections\/([^/]+)\/sessions\/([^/]+)\/attendance\/?$/;
function parseAttendancePath(pathname) {
    const match = ATTENDANCE_PATH.exec(pathname);
    if (!match)
        return null;
    try {
        return { sectionId: decodeURIComponent(match[1]), classSessionId: decodeURIComponent(match[2]) };
    }
    catch {
        return null;
    }
}
function attendanceHref(sectionId, classSessionId) {
    return `/sections/${encodeURIComponent(sectionId)}/sessions/${encodeURIComponent(classSessionId)}/attendance`;
}
function accountKey(account) {
    return `${account.centerId}\n${account.userId}`;
}
function rosterFor(snapshot, rosters) {
    return (rosters.find((roster) => roster.id === snapshot.id &&
        roster.centerId === snapshot.centerId &&
        roster.userId === snapshot.userId &&
        roster.localDeviceId === snapshot.localDeviceId &&
        roster.sectionId === snapshot.sectionId &&
        roster.classSessionId === snapshot.classSessionId) ?? null);
}
function lockBlocks(snapshot, stored) {
    // A lock that the sign-in screen would clear still hides the class here.
    // This shell must not unlock the phone or delete the marks waiting on it.
    const decision = (0, offline_decisions_1.decideSharedPhone)({
        stored,
        nextUserId: snapshot.userId,
        nextCenterId: snapshot.centerId,
        nextAuthSessionId: snapshot.authSessionId,
        lockAuthSessionId: null,
    });
    return decision.type !== "open";
}
function usable(snapshot, now) {
    return (0, offline_decisions_1.assessSnapshot)(snapshot, {
        userId: snapshot.userId,
        centerId: snapshot.centerId,
        sectionId: snapshot.sectionId,
        classSessionId: snapshot.classSessionId,
    }, now).ok;
}
function planKioskShell(input) {
    // A failed read uses the shared-phone warning. It must not look like an empty class.
    if (!input.catalog.ok || input.stored.status === "unavailable") {
        return { kind: "unreadable", message: offline_decisions_1.UNREADABLE_RECORDS };
    }
    if (input.stored.status !== "ready")
        return { kind: "unreadable", message: offline_decisions_1.UNREADABLE_RECORDS };
    const { deviceId, snapshots, rosters, events } = input.catalog;
    if (snapshots.length > 0 && deviceId === null)
        return { kind: "unreadable", message: offline_decisions_1.UNREADABLE_RECORDS };
    const owned = snapshots.filter((snapshot) => snapshot.localDeviceId === deviceId);
    const path = parseAttendancePath(input.pathname);
    const inScope = path
        ? owned.filter((snapshot) => snapshot.sectionId === path.sectionId && snapshot.classSessionId === path.classSessionId)
        : owned;
    const accounts = new Set(owned.map((snapshot) => accountKey(snapshot)));
    if (accounts.size > 1)
        return { kind: "notice", message: exports.MORE_THAN_ONE_SIGN_IN };
    const sample = inScope[0];
    if (!sample)
        return { kind: "notice", message: exports.OPEN_WHILE_CONNECTED };
    if (lockBlocks(sample, input.stored))
        return { kind: "notice", message: exports.PHONE_LOCKED };
    const current = inScope.filter((snapshot) => usable(snapshot, input.now));
    if (!path) {
        if (current.length === 0)
            return { kind: "notice", message: exports.OPEN_WHILE_CONNECTED };
        const sessions = [...current]
            .sort((left, right) => attendanceHref(left.sectionId, left.classSessionId).localeCompare(attendanceHref(right.sectionId, right.classSessionId)))
            .map((snapshot) => {
            const href = attendanceHref(snapshot.sectionId, snapshot.classSessionId);
            const roster = rosterFor(snapshot, rosters);
            if (snapshot.formatVersion !== 1 || roster?.formatVersion !== 1 || !snapshot.sectionName || !snapshot.classTitle || !snapshot.whenLabel) {
                return { kind: "refresh", href };
            }
            return { kind: "named", href, sectionName: snapshot.sectionName, classTitle: snapshot.classTitle, whenLabel: snapshot.whenLabel };
        });
        return { kind: "list", sessions };
    }
    const snapshot = current[0];
    if (!snapshot)
        return { kind: "notice", message: exports.OPEN_WHILE_CONNECTED };
    const roster = rosterFor(snapshot, rosters);
    if (!roster)
        return { kind: "notice", message: exports.OPEN_WHILE_CONNECTED };
    if (snapshot.formatVersion !== 1 || roster.formatVersion !== 1 || roster.learners.some((learner) => !learner.serverKnown)) {
        return { kind: "notice", message: local_attendance_1.OUTDATED_SNAPSHOT };
    }
    const sessionEvents = (0, local_attendance_1.eventsInSequence)(events.filter((event) => event.centerId === snapshot.centerId &&
        event.userId === snapshot.userId &&
        event.sectionId === snapshot.sectionId &&
        event.classSessionId === snapshot.classSessionId));
    // The server mark is the baseline. A newer mark on this phone replaces it on
    // screen and points back at that server row. The older row is not deleted.
    const learners = (0, local_attendance_1.applyLocalEvents)(roster.learners.map((learner) => ({
        id: learner.learnerId,
        displayName: learner.displayName,
        learnerCode: learner.learnerCode,
        saved: learner.serverAttendanceRecordId && learner.serverStatus
            ? { eventId: learner.serverAttendanceRecordId, status: learner.serverStatus, reasonCode: learner.serverReasonCode }
            : null,
    })), sessionEvents);
    const names = new Map(roster.learners.map((learner) => [learner.learnerId, learner.displayName]));
    return {
        kind: "class",
        pendingCount: events.filter((event) => event.centerId === snapshot.centerId && event.userId === snapshot.userId && event.syncState === "pending").length,
        owner: { userId: snapshot.userId, centerId: snapshot.centerId },
        sectionId: snapshot.sectionId,
        classSessionId: snapshot.classSessionId,
        learners,
        localLearnerIds: [...new Set(sessionEvents.map((event) => event.learnerId))],
        serverRecordIds: roster.learners.map((learner) => ({
            learnerId: learner.learnerId,
            serverAttendanceRecordId: learner.serverAttendanceRecordId,
        })),
        history: sessionEvents.map((event) => ({
            clientEventId: event.clientEventId,
            displayName: names.get(event.learnerId) ?? "Learner",
            summary: event.reasonCode ? `${(0, attendance_1.statusLabel)(event.status)} · ${(0, attendance_1.reasonLabel)(event.reasonCode)}` : (0, attendance_1.statusLabel)(event.status),
            correction: Boolean(event.correctsClientEventId || event.correctsServerEventId),
        })),
    };
}
function el(doc, tag, text, className) {
    const node = doc.createElement(tag);
    if (className)
        node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function paintClass(doc, root, plan, drafts, message, saving, actions) {
    const pending = (0, attendance_1.pendingMarks)(drafts).length;
    const back = el(doc, "a", "All saved classes");
    back.setAttribute("href", "/kiosk-shell");
    const blocks = [
        back,
        el(doc, "h1", "Attendance"),
        el(doc, "p", "Unmarked learners stay unmarked. They are not saved as absent or present."),
        el(doc, "p", `Waiting to send: ${plan.pendingCount}`, "count"),
    ];
    for (const draft of drafts) {
        const card = el(doc, "article");
        card.setAttribute("data-learner", draft.learnerId);
        card.append(el(doc, "h2", draft.displayName), el(doc, "p", draft.learnerCode));
        const onPhone = plan.localLearnerIds.includes(draft.learnerId);
        const statusText = !draft.status
            ? "Not marked yet"
            : draft.clientEventId
                ? `${(0, attendance_1.statusLabel)(draft.status)} — not saved yet`
                : onPhone
                    ? `Saved: ${(0, attendance_1.statusLabel)(draft.status)}`
                    : `On the server: ${(0, attendance_1.statusLabel)(draft.status)}`;
        card.append(el(doc, "p", statusText));
        if (draft.reasonCode)
            card.append(el(doc, "p", `Reason: ${(0, attendance_1.reasonLabel)(draft.reasonCode)}`));
        const statuses = el(doc, "div");
        for (const status of attendance_1.ATTENDANCE_STATUSES) {
            const button = el(doc, "button", (0, attendance_1.statusLabel)(status));
            button.type = "button";
            button.setAttribute("aria-pressed", draft.status === status ? "true" : "false");
            button.addEventListener("click", () => actions.onStatus(draft.learnerId, status));
            statuses.append(button);
        }
        card.append(statuses);
        if (draft.status === "ABSENT" || draft.status === "EXCUSED") {
            const reasons = el(doc, "div");
            reasons.append(el(doc, "p", "Reason, optional. Tap again to clear it."));
            for (const reason of attendance_1.ABSENCE_REASONS) {
                const button = el(doc, "button", (0, attendance_1.reasonLabel)(reason));
                button.type = "button";
                button.setAttribute("aria-pressed", draft.reasonCode === reason ? "true" : "false");
                button.addEventListener("click", () => actions.onReason(draft.learnerId, reason));
                reasons.append(button);
            }
            card.append(reasons);
        }
        blocks.push(card);
    }
    const save = el(doc, "button", saving ? "Saving…" : "Save attendance");
    save.type = "button";
    save.disabled = saving || pending === 0;
    save.addEventListener("click", actions.onSave);
    blocks.push(save);
    const signOut = el(doc, "button", "Sign out");
    signOut.type = "button";
    signOut.setAttribute("data-action", "sign-out");
    signOut.addEventListener("click", actions.onSignOut);
    blocks.push(signOut);
    if (message)
        blocks.push(el(doc, "p", message, "message"));
    const history = el(doc, "section");
    history.append(el(doc, "h2", "On this phone"));
    if (plan.history.length === 0)
        history.append(el(doc, "p", "No attendance is waiting on this phone for this class."));
    for (const line of plan.history) {
        const item = el(doc, "p");
        item.append(`${line.displayName}: ${line.summary}`);
        if (line.correction)
            item.append(" Corrects an earlier mark. The earlier mark is kept.");
        history.append(item);
    }
    blocks.push(history);
    root.replaceChildren(...blocks);
}
async function mountKioskShell(doc, env = {}) {
    const status = doc.getElementById("kiosk-status");
    const root = doc.getElementById("kiosk-root");
    if (!status || !root)
        return;
    const factory = env.indexedDB ?? globalThis.indexedDB;
    const storage = env.localStorage ?? globalThis.localStorage;
    const pathname = env.pathname ?? globalThis.location?.pathname ?? "";
    const now = () => env.now ?? new Date();
    const probe = () => (env.storage === undefined ? (0, storage_readiness_1.browserStorageProbe)() : env.storage);
    // One storage question for the person installing the app. It does not decide
    // whether a mark may be saved: the save path still asks for itself.
    async function showStorage() {
        const slot = doc.getElementById("kiosk-storage");
        if (!slot)
            return;
        const browser = typeof navigator === "undefined" ? null : (navigator.storage ?? null);
        try {
            slot.textContent = (0, persistence_status_1.persistenceLines)(await (0, persistence_status_1.readPersistenceOnce)(browser)).join(" ");
        }
        catch {
            slot.textContent = "This phone could not say whether saved data may stay. Local attendance saving is unavailable.";
        }
    }
    void showStorage();
    // Once the roster is hidden, a later paint must not put the names back.
    let sealed = false;
    function seal(message) {
        sealed = true;
        if (!status || !root)
            return;
        status.textContent = message;
        root.replaceChildren();
    }
    function readRaw() {
        if (!storage)
            throw new Error("backup unreadable");
        return storage.getItem(storage_key_1.DEVICE_STORAGE_KEY);
    }
    let signingOut = null;
    function signOut() {
        if (!factory || sealed)
            return;
        void (0, phone_access_1.performPhoneSignOut)({
            factory,
            readRaw,
            account: { userId: signingOut?.userId ?? "", centerId: signingOut?.centerId ?? "" },
            authSessionId: signingOut?.authSessionId ?? "",
            revoke: env.revoke ?? revoke_session_1.revokeServerSession,
            onPrivacy: (message) => seal(message),
        });
    }
    if (typeof window !== "undefined") {
        window.addEventListener("storage", (event) => {
            if (event.key === storage_key_1.DEVICE_STORAGE_KEY)
                seal(offline_decisions_1.MISMATCHED_RECORDS);
        });
    }
    async function draw(message, drafts, saving) {
        if (!status || !root || sealed)
            return;
        if (!factory || !storage) {
            seal(offline_decisions_1.UNREADABLE_RECORDS);
            return;
        }
        const queue = await (0, phone_access_1.openVerifiedQueue)(factory, readRaw);
        if (!queue.ok) {
            seal(queue.message);
            return;
        }
        if (queue.state.lock) {
            seal(exports.PHONE_LOCKED);
            if (queue.state.lock.authSessionId) {
                let revoked = false;
                try {
                    revoked = await (env.revoke ?? revoke_session_1.revokeServerSession)();
                }
                catch {
                    revoked = false;
                }
                seal((0, offline_decisions_1.decideRevokeResult)({ lockWritten: true, serverRevoked: revoked }).message);
            }
            return;
        }
        if (queue.active)
            signingOut = queue.active;
        let catalog;
        try {
            catalog = await (0, local_attendance_1.readLocalCatalog)(factory);
        }
        catch {
            seal(offline_decisions_1.UNREADABLE_RECORDS);
            return;
        }
        if (!catalog.ok) {
            // The class list uses the same stop sentence as a broken phone queue.
            seal(offline_decisions_1.UNREADABLE_RECORDS);
            return;
        }
        if (!queue.active) {
            status.textContent = exports.OPEN_WHILE_CONNECTED;
            root.replaceChildren();
            return;
        }
        const accounts = new Set(catalog.snapshots.map((snapshot) => accountKey(snapshot)));
        if (accounts.size > 1) {
            status.textContent = exports.MORE_THAN_ONE_SIGN_IN;
            root.replaceChildren();
            return;
        }
        const ownedSnapshots = catalog.snapshots.filter((snapshot) => snapshot.userId === queue.active?.userId && snapshot.centerId === queue.active.centerId);
        if (catalog.snapshots.length > 0 && ownedSnapshots.length === 0) {
            status.textContent = exports.OPEN_WHILE_CONNECTED;
            root.replaceChildren();
            return;
        }
        const ownedCatalog = {
            ...catalog,
            snapshots: ownedSnapshots,
            rosters: catalog.rosters.filter((roster) => roster.userId === queue.active?.userId && roster.centerId === queue.active.centerId),
            events: catalog.events.filter((event) => event.userId === queue.active?.userId && event.centerId === queue.active.centerId),
        };
        const plan = planKioskShell({
            catalog: ownedCatalog,
            stored: { status: "ready", state: { ...queue.state, lock: null } },
            pathname,
            now: now(),
        });
        if (plan.kind === "unreadable") {
            seal(plan.message);
            return;
        }
        if (plan.kind === "notice") {
            status.textContent = plan.message;
            root.replaceChildren();
            return;
        }
        if (plan.kind === "list") {
            status.textContent = "Classes saved on this phone";
            const list = el(doc, "ul");
            for (const session of plan.sessions) {
                const item = el(doc, "li");
                const link = el(doc, "a", session.kind === "named" ? session.sectionName : "Open this class again while connected");
                link.setAttribute("href", session.href);
                item.append(link);
                if (session.kind === "named")
                    item.append(el(doc, "p", session.classTitle), el(doc, "p", session.whenLabel));
                list.append(item);
            }
            const signOutButton = el(doc, "button", "Sign out");
            signOutButton.type = "button";
            signOutButton.setAttribute("data-action", "sign-out");
            signOutButton.addEventListener("click", signOut);
            root.replaceChildren(list, signOutButton);
            return;
        }
        status.textContent = "Saved on this phone. It has not been sent.";
        const current = drafts ?? plan.learners.map((learner) => ({ ...learner }));
        paintClass(doc, root, plan, current, message, saving, {
            onStatus: (learnerId, attendanceStatus) => {
                if (sealed)
                    return;
                const next = current.map((draft) => (draft.learnerId === learnerId ? (0, attendance_1.chooseStatus)(draft, attendanceStatus, local_attendance_1.newLocalEventId) : draft));
                void draw(null, next, false);
            },
            onReason: (learnerId, reason) => {
                if (sealed)
                    return;
                const next = current.map((draft) => (draft.learnerId === learnerId ? (0, attendance_1.chooseReason)(draft, reason, local_attendance_1.newLocalEventId) : draft));
                void draw(null, next, false);
            },
            onSave: () => {
                if (sealed)
                    return;
                void (async () => {
                    const serverIds = new Map(plan.serverRecordIds.map((learner) => [learner.learnerId, learner.serverAttendanceRecordId]));
                    const marks = (0, attendance_1.pendingMarks)(current).map((mark) => ({ ...mark, serverEventId: serverIds.get(mark.learnerId) ?? null }));
                    if (marks.length === 0 || !factory || sealed)
                        return;
                    await draw(null, current, true);
                    if (sealed)
                        return;
                    const result = await (0, local_attendance_1.saveLocalAttendance)({
                        factory,
                        storage: probe(),
                        owner: plan.owner,
                        sectionId: plan.sectionId,
                        classSessionId: plan.classSessionId,
                        marks,
                        phoneNow: now(),
                    });
                    await draw(result.message, null, false);
                })();
            },
            onSignOut: signOut,
        });
    }
    try {
        await draw(null, null, false);
    }
    catch {
        status.textContent = offline_decisions_1.UNREADABLE_RECORDS;
        root.replaceChildren();
    }
}

});
  modules["lib/device/kiosk-shell.ts"].exports.mountKioskShell(document);
})();
