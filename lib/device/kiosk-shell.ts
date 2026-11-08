// Offline attendance shell. This file is plain logic plus a small page painter.
// It is not a Next.js page. A Next.js page is tied to the address it was built
// for, and the phone will later show this same document at a class address.
// Personal data stays in IndexedDB. The document itself has no learner names.
//
// The phone lock hides the class list. That lock is not encryption. IndexedDB
// is still readable by anyone who can open this browser's storage tools.
// Pending marks are never deleted here.

import { DEVICE_STORAGE_KEY } from "./storage-key";
import { emptyDeviceState, parseDeviceState } from "./shared-device";
import {
  UNREADABLE_RECORDS,
  assessSnapshot,
  decideSharedPhone,
  type AccountRef,
} from "./offline-decisions";
import type { StoredDevice } from "./phone-check";
import {
  applyLocalEvents,
  eventsInSequence,
  newLocalEventId,
  OUTDATED_SNAPSHOT,
  readLocalCatalog,
  saveLocalAttendance,
  type LocalCatalog,
  type LocalRoster,
} from "./local-attendance";
import { browserStorageProbe, type StorageProbe } from "./storage-readiness";
import {
  ABSENCE_REASONS,
  ATTENDANCE_STATUSES,
  chooseReason,
  chooseStatus,
  pendingMarks,
  reasonLabel,
  statusLabel,
  type AbsenceReasonName,
  type AttendanceStatusName,
  type LearnerDraft,
} from "@/lib/lms/attendance";

export const OPEN_WHILE_CONNECTED = "Open this class once while connected.";
export const PHONE_LOCKED = "This phone is locked. The class list stays hidden.";
export const MORE_THAN_ONE_SIGN_IN = "This phone has more than one saved sign-in. Open a class while connected.";

const ATTENDANCE_PATH = /\/sections\/([^/]+)\/sessions\/([^/]+)\/attendance\/?$/;

export function parseAttendancePath(pathname: string): { sectionId: string; classSessionId: string } | null {
  const match = ATTENDANCE_PATH.exec(pathname);
  if (!match) return null;
  try {
    return { sectionId: decodeURIComponent(match[1]), classSessionId: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

export function attendanceHref(sectionId: string, classSessionId: string): string {
  return `/sections/${encodeURIComponent(sectionId)}/sessions/${encodeURIComponent(classSessionId)}/attendance`;
}

type OwnedSnapshot = Extract<LocalCatalog, { ok: true }>["snapshots"][number];

export type ShellSession =
  | { kind: "named"; href: string; sectionName: string; classTitle: string; whenLabel: string }
  | { kind: "refresh"; href: string };

export type ShellPlan =
  | { kind: "unreadable"; message: string }
  | { kind: "notice"; message: string }
  | { kind: "list"; sessions: ShellSession[] }
  | {
      kind: "class";
      pendingCount: number;
      owner: AccountRef;
      sectionId: string;
      classSessionId: string;
      learners: LearnerDraft[];
      localLearnerIds: string[];
      serverRecordIds: { learnerId: string; serverAttendanceRecordId: string | null }[];
      history: { clientEventId: string; displayName: string; summary: string; correction: boolean }[];
    };

function readPhone(storage: { getItem(key: string): string | null } | null): StoredDevice {
  if (!storage) return { status: "unavailable" };
  try {
    const raw = storage.getItem(DEVICE_STORAGE_KEY);
    if (raw === null) return { status: "ready", state: emptyDeviceState() };
    const parsed = parseDeviceState(raw);
    if (!parsed) return { status: "unavailable" };
    return { status: "ready", state: parsed };
  } catch {
    return { status: "unavailable" };
  }
}

function accountKey(account: AccountRef): string {
  return `${account.centerId}\n${account.userId}`;
}

function rosterFor(snapshot: OwnedSnapshot, rosters: LocalRoster[]): LocalRoster | null {
  return (
    rosters.find(
      (roster) =>
        roster.id === snapshot.id &&
        roster.centerId === snapshot.centerId &&
        roster.userId === snapshot.userId &&
        roster.localDeviceId === snapshot.localDeviceId &&
        roster.sectionId === snapshot.sectionId &&
        roster.classSessionId === snapshot.classSessionId,
    ) ?? null
  );
}

function lockBlocks(snapshot: OwnedSnapshot, stored: StoredDevice): boolean {
  // A lock that the sign-in screen would clear still hides the class here.
  // This shell must not unlock the phone or delete the marks waiting on it.
  const decision = decideSharedPhone({
    stored,
    nextUserId: snapshot.userId,
    nextCenterId: snapshot.centerId,
    nextAuthSessionId: snapshot.authSessionId,
    lockAuthSessionId: null,
  });
  return decision.type !== "open";
}

function usable(snapshot: OwnedSnapshot, now: Date): boolean {
  return assessSnapshot(
    snapshot,
    {
      userId: snapshot.userId,
      centerId: snapshot.centerId,
      sectionId: snapshot.sectionId,
      classSessionId: snapshot.classSessionId,
    },
    now,
  ).ok;
}

export function planKioskShell(input: {
  catalog: LocalCatalog;
  stored: StoredDevice;
  pathname: string;
  now: Date;
}): ShellPlan {
  // A failed read uses the shared-phone warning. It must not look like an empty class.
  if (!input.catalog.ok || input.stored.status === "unavailable") {
    return { kind: "unreadable", message: UNREADABLE_RECORDS };
  }
  if (input.stored.status !== "ready") return { kind: "unreadable", message: UNREADABLE_RECORDS };
  const { deviceId, snapshots, rosters, events } = input.catalog;
  if (snapshots.length > 0 && deviceId === null) return { kind: "unreadable", message: UNREADABLE_RECORDS };
  const owned = snapshots.filter((snapshot) => snapshot.localDeviceId === deviceId);
  const path = parseAttendancePath(input.pathname);
  const inScope = path
    ? owned.filter((snapshot) => snapshot.sectionId === path.sectionId && snapshot.classSessionId === path.classSessionId)
    : owned;
  const accounts = new Set(owned.map((snapshot) => accountKey(snapshot)));
  if (accounts.size > 1) return { kind: "notice", message: MORE_THAN_ONE_SIGN_IN };
  const sample = inScope[0];
  if (!sample) return { kind: "notice", message: OPEN_WHILE_CONNECTED };
  if (lockBlocks(sample, input.stored)) return { kind: "notice", message: PHONE_LOCKED };
  const current = inScope.filter((snapshot) => usable(snapshot, input.now));
  if (!path) {
    if (current.length === 0) return { kind: "notice", message: OPEN_WHILE_CONNECTED };
    const sessions = [...current]
      .sort((left, right) => attendanceHref(left.sectionId, left.classSessionId).localeCompare(attendanceHref(right.sectionId, right.classSessionId)))
      .map((snapshot): ShellSession => {
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
  if (!snapshot) return { kind: "notice", message: OPEN_WHILE_CONNECTED };
  const roster = rosterFor(snapshot, rosters);
  if (!roster) return { kind: "notice", message: OPEN_WHILE_CONNECTED };
  if (snapshot.formatVersion !== 1 || roster.formatVersion !== 1 || roster.learners.some((learner) => !learner.serverKnown)) {
    return { kind: "notice", message: OUTDATED_SNAPSHOT };
  }
  const sessionEvents = eventsInSequence(
    events.filter(
      (event) =>
        event.centerId === snapshot.centerId &&
        event.userId === snapshot.userId &&
        event.sectionId === snapshot.sectionId &&
        event.classSessionId === snapshot.classSessionId,
    ),
  );
  // The server mark is the baseline. A newer mark on this phone replaces it on
  // screen and points back at that server row. The older row is not deleted.
  const learners = applyLocalEvents(
    roster.learners.map((learner) => ({
      id: learner.learnerId,
      displayName: learner.displayName,
      learnerCode: learner.learnerCode,
      saved:
        learner.serverAttendanceRecordId && learner.serverStatus
          ? { eventId: learner.serverAttendanceRecordId, status: learner.serverStatus, reasonCode: learner.serverReasonCode }
          : null,
    })),
    sessionEvents,
  );
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
      summary: event.reasonCode ? `${statusLabel(event.status)} · ${reasonLabel(event.reasonCode)}` : statusLabel(event.status),
      correction: Boolean(event.correctsClientEventId || event.correctsServerEventId),
    })),
  };
}

export type KioskNode = {
  textContent: string | null;
  className?: string;
  type?: string;
  disabled?: boolean;
  setAttribute(name: string, value: string): void;
  append(...nodes: Array<KioskNode | string>): void;
  replaceChildren(...nodes: Array<KioskNode | string>): void;
  addEventListener(type: string, listener: () => void): void;
};

export type KioskDocument = {
  getElementById(id: string): KioskNode | null;
  createElement(tag: string): KioskNode;
};

export type KioskEnv = {
  pathname?: string;
  indexedDB?: IDBFactory;
  localStorage?: { getItem(key: string): string | null };
  storage?: StorageProbe | null;
  now?: Date;
};

function el(doc: KioskDocument, tag: string, text?: string, className?: string): KioskNode {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function paintClass(
  doc: KioskDocument,
  root: KioskNode,
  plan: Extract<ShellPlan, { kind: "class" }>,
  drafts: LearnerDraft[],
  message: string | null,
  saving: boolean,
  actions: {
    onStatus: (learnerId: string, status: AttendanceStatusName) => void;
    onReason: (learnerId: string, reason: AbsenceReasonName) => void;
    onSave: () => void;
  },
) {
  const pending = pendingMarks(drafts).length;
  const back = el(doc, "a", "All saved classes");
  back.setAttribute("href", "/kiosk-shell");
  const blocks: KioskNode[] = [
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
        ? `${statusLabel(draft.status)} — not saved yet`
        : onPhone
          ? `Saved: ${statusLabel(draft.status)}`
          : `On the server: ${statusLabel(draft.status)}`;
    card.append(el(doc, "p", statusText));
    if (draft.reasonCode) card.append(el(doc, "p", `Reason: ${reasonLabel(draft.reasonCode)}`));
    const statuses = el(doc, "div");
    for (const status of ATTENDANCE_STATUSES) {
      const button = el(doc, "button", statusLabel(status));
      button.type = "button";
      button.setAttribute("aria-pressed", draft.status === status ? "true" : "false");
      button.addEventListener("click", () => actions.onStatus(draft.learnerId, status));
      statuses.append(button);
    }
    card.append(statuses);
    if (draft.status === "ABSENT" || draft.status === "EXCUSED") {
      const reasons = el(doc, "div");
      reasons.append(el(doc, "p", "Reason, optional. Tap again to clear it."));
      for (const reason of ABSENCE_REASONS) {
        const button = el(doc, "button", reasonLabel(reason));
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
  if (message) blocks.push(el(doc, "p", message, "message"));
  const history = el(doc, "section");
  history.append(el(doc, "h2", "On this phone"));
  if (plan.history.length === 0) history.append(el(doc, "p", "No attendance is waiting on this phone for this class."));
  for (const line of plan.history) {
    const item = el(doc, "p");
    item.append(`${line.displayName}: ${line.summary}`);
    if (line.correction) item.append(" Corrects an earlier mark. The earlier mark is kept.");
    history.append(item);
  }
  blocks.push(history);
  root.replaceChildren(...blocks);
}

export async function mountKioskShell(doc: KioskDocument, env: KioskEnv = {}): Promise<void> {
  const status = doc.getElementById("kiosk-status");
  const root = doc.getElementById("kiosk-root");
  if (!status || !root) return;
  const factory = env.indexedDB ?? globalThis.indexedDB;
  const storage = env.localStorage ?? globalThis.localStorage;
  const pathname = env.pathname ?? globalThis.location?.pathname ?? "";
  const now = () => env.now ?? new Date();
  const probe = () => (env.storage === undefined ? browserStorageProbe() : env.storage);

  async function draw(message: string | null, drafts: LearnerDraft[] | null, saving: boolean) {
    if (!status || !root) return;
    if (!factory) {
      status.textContent = UNREADABLE_RECORDS;
      root.replaceChildren();
      return;
    }
    let catalog: LocalCatalog;
    try {
      catalog = await readLocalCatalog(factory);
    } catch {
      status.textContent = UNREADABLE_RECORDS;
      root.replaceChildren();
      return;
    }
    const plan = planKioskShell({ catalog, stored: readPhone(storage), pathname, now: now() });
    if (plan.kind === "unreadable") {
      status.textContent = plan.message;
      root.replaceChildren();
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
        if (session.kind === "named") item.append(el(doc, "p", session.classTitle), el(doc, "p", session.whenLabel));
        list.append(item);
      }
      root.replaceChildren(list);
      return;
    }
    status.textContent = "Saved on this phone. It has not been sent.";
    const current = drafts ?? plan.learners.map((learner) => ({ ...learner }));
    paintClass(doc, root, plan, current, message, saving, {
      onStatus: (learnerId, attendanceStatus) => {
        const next = current.map((draft) => (draft.learnerId === learnerId ? chooseStatus(draft, attendanceStatus, newLocalEventId) : draft));
        void draw(null, next, false);
      },
      onReason: (learnerId, reason) => {
        const next = current.map((draft) => (draft.learnerId === learnerId ? chooseReason(draft, reason, newLocalEventId) : draft));
        void draw(null, next, false);
      },
      onSave: () => {
        void (async () => {
          const serverIds = new Map(plan.serverRecordIds.map((learner) => [learner.learnerId, learner.serverAttendanceRecordId]));
          const marks = pendingMarks(current).map((mark) => ({ ...mark, serverEventId: serverIds.get(mark.learnerId) ?? null }));
          if (marks.length === 0 || !factory) return;
          await draw(null, current, true);
          const result = await saveLocalAttendance({
            factory,
            storage: probe(),
            owner: plan.owner,
            sectionId: plan.sectionId,
            classSessionId: plan.classSessionId,
            marks,
            phoneNow: now(),
          });
          await draw(result.ok ? result.message : result.message, null, false);
        })();
      },
    });
  }

  try {
    await draw(null, null, false);
  } catch {
    status.textContent = UNREADABLE_RECORDS;
    root.replaceChildren();
  }
}