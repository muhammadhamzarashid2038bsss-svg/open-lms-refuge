import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as harnessGet } from "../app/kiosk-harness/[...path]/route";
import { GET as shellGet } from "../app/kiosk-shell/route";
import { bundleKioskShell } from "../lib/device/bundle-kiosk-shell";
import { DEVICE_STORAGE_KEY } from "../lib/device/storage-key";
import { kioskShellHtml } from "../lib/device/kiosk-shell-html";
import {
  MORE_THAN_ONE_SIGN_IN,
  OPEN_WHILE_CONNECTED,
  PHONE_LOCKED,
  attendanceHref,
  mountKioskShell,
  parseAttendancePath,
  type KioskDocument,
  type KioskNode,
} from "../lib/device/kiosk-shell";
import {
  closeWorkingDatabase,
  localRequest,
  openWorkingDatabase,
  runLocalTransaction,
} from "../lib/device/local-db";
import { OUTDATED_SNAPSHOT, readLocalCatalog, saveLocalAttendance, storeAuthorizedClass, type ServerMarkInput } from "../lib/device/local-attendance";
import { UNREADABLE_RECORDS } from "../lib/device/offline-decisions";
import type { StorageProbe } from "../lib/device/storage-readiness";
import { statusLabel, type AbsenceReasonName, type AttendanceStatusName } from "../lib/lms/attendance";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const phoneNow = new Date("2026-11-08T08:00:00.000Z");
const owner = { userId: "user-a", centerId: "center-a" };
const other = { userId: "user-b", centerId: "center-b" };
const sectionId = "section-1";
const classSessionId = "session-1";
const otherSessionId = "session-2";
const saved = "Saved on this phone, waiting to send";

const roomy: StorageProbe = {
  persist: async () => true,
  estimate: async () => ({ usage: 0, quota: 50_000_000 }),
};

const learners = [
  { learnerId: "learner-01", displayName: "Demo Learner 01", learnerCode: "LNR-0001" },
  { learnerId: "learner-02", displayName: "Demo Learner 02", learnerCode: "LNR-0002" },
];
const labels = {
  sectionName: "Morning group",
  classTitle: "Literacy class",
  whenLabel: "Monday 9 Nov, 09:00 to 10:00",
};

function withServer(
  rows: { learnerId: string; displayName: string; learnerCode: string }[],
  marks: Record<string, { serverAttendanceRecordId: string | null; serverStatus: AttendanceStatusName | null; serverReasonCode: AbsenceReasonName | null }> = {},
): ServerMarkInput[] {
  return rows.map((learner) => ({
    learnerId: learner.learnerId,
    displayName: learner.displayName,
    learnerCode: learner.learnerCode,
    serverAttendanceRecordId: marks[learner.learnerId]?.serverAttendanceRecordId ?? null,
    serverStatus: marks[learner.learnerId]?.serverStatus ?? null,
    serverReasonCode: marks[learner.learnerId]?.serverReasonCode ?? null,
  }));
}

const otherLearners = [
  { learnerId: "learner-09", displayName: "Demo Learner 09", learnerCode: "LNR-0009" },
];

beforeEach(() => {
  globalThis.IDBKeyRange = IDBKeyRange;
});

function clock(now = phoneNow) {
  return {
    authSessionId: "session-a-1111",
    serverNow: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  };
}

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    raw: data,
  };
}

class FakeNode implements KioskNode {
  textContent: string | null = null;
  className = "";
  type = "";
  disabled = false;
  children: Array<FakeNode | string> = [];
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Array<() => void>>();

  constructor(readonly tag: string) {}

  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }

  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }

  append(...nodes: Array<KioskNode | string>) {
    this.children.push(...(nodes as Array<FakeNode | string>));
  }

  replaceChildren(...nodes: Array<KioskNode | string>) {
    this.children = nodes as Array<FakeNode | string>;
  }

  addEventListener(type: string, listener: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  click() {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }

  text(): string {
    const own = this.textContent ?? "";
    return own + this.children.map((child) => (typeof child === "string" ? child : child.text())).join("");
  }
}

class FakeDocument implements KioskDocument {
  readonly status = new FakeNode("p");
  readonly root = new FakeNode("div");

  getElementById(id: string): KioskNode | null {
    if (id === "kiosk-status") return this.status;
    if (id === "kiosk-root") return this.root;
    return null;
  }

  createElement(tag: string): KioskNode {
    return new FakeNode(tag);
  }
}

function walk(node: FakeNode, visit: (node: FakeNode) => void) {
  visit(node);
  for (const child of node.children) {
    if (typeof child !== "string") walk(child, visit);
  }
}

function buttons(node: FakeNode, label: string): FakeNode[] {
  const found: FakeNode[] = [];
  walk(node, (item) => {
    if (item.tag === "button" && item.textContent === label) found.push(item);
  });
  return found;
}

function links(node: FakeNode): FakeNode[] {
  const found: FakeNode[] = [];
  walk(node, (item) => {
    if (item.tag === "a") found.push(item);
  });
  return found;
}

async function settle() {
  for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function rows(factory: IDBFactory, store: "events" | "snapshots" | "rosters") {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return await runLocalTransaction(opened.db, [store], "readonly", (tx) => localRequest(tx.objectStore(store).getAll()));
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

async function authorize(
  factory: IDBFactory,
  input: {
    owner: { userId: string; centerId: string };
    sectionId: string;
    classSessionId: string;
    learners: { learnerId: string; displayName: string; learnerCode: string }[];
    labels?: { sectionName: string; classTitle: string; whenLabel: string };
    marks?: Record<string, { serverAttendanceRecordId: string | null; serverStatus: AttendanceStatusName | null; serverReasonCode: AbsenceReasonName | null }>;
  },
) {
  const stored = await storeAuthorizedClass({
    factory,
    storage: roomy,
    owner: input.owner,
    sectionId: input.sectionId,
    classSessionId: input.classSessionId,
    ...labels,
    ...input.labels,
    clock: clock(),
    learners: withServer(input.learners, input.marks),
    phoneNow,
  });
  expect(stored.ok).toBe(true);
}

async function show(factory: IDBFactory, pathname: string, storage = memory()) {
  const doc = new FakeDocument();
  await mountKioskShell(doc, {
    pathname,
    indexedDB: factory,
    localStorage: storage,
    storage: roomy,
    now: phoneNow,
  });
  return { doc, storage };
}

const classPath = attendanceHref(sectionId, classSessionId);

describe("offline kiosk shell", () => {
  it("keeps the empty document free of learner names and private records", () => {
    const html = kioskShellHtml("var ready = true;");
    expect(html).toContain("Checking this phone");
    expect(html).toContain("That lock is not encryption");
    expect(html).not.toContain("Demo Learner");
    expect(html).not.toContain("LNR-");
    expect(html).not.toContain("olr_session=");
    expect(html).not.toContain("__next");
    const script = readFileSync(join(root, "public", "kiosk", "shell.js"), "utf8");
    expect(script).toBe(bundleKioskShell());
    expect(script).not.toContain("Demo Learner");
    expect(script).not.toContain("LNR-");
    expect(script).not.toContain("saveAttendanceAction");
    expect(script).not.toContain("serviceWorker.register");
    expect(script).not.toContain("next/navigation");
    expect(script).not.toContain("hydrateRoot");
    expect(script).not.toContain('require("react")');
    expect(script).not.toContain("demo-password");
  });

  it("lists a class that was opened while connected", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    const { doc } = await show(factory, "/kiosk-shell");
    expect(doc.status.textContent).toBe("Classes saved on this phone");
    const anchors = links(doc.root);
    expect(anchors.map((anchor) => anchor.textContent)).toEqual(["Morning group"]);
    expect(doc.root.text()).toContain("Literacy class");
    expect(doc.root.text()).toContain("Monday 9 Nov, 09:00 to 10:00");
    expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual([classPath]);
    expect(doc.root.text()).not.toContain("Demo Learner");
    expect(doc.root.text()).not.toContain("LNR-");
  });

  it("loads the class named by the attendance address", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    await authorize(factory, {
      owner,
      sectionId,
      classSessionId: otherSessionId,
      learners: otherLearners,
    });
    const { doc } = await show(factory, `/kiosk-harness${classPath}`);
    expect(parseAttendancePath(`/kiosk-harness${classPath}`)).toEqual({ sectionId, classSessionId });
    expect(doc.root.text()).toContain("Demo Learner 01");
    expect(doc.root.text()).toContain("LNR-0001");
    expect(doc.root.text()).not.toContain("Demo Learner 09");
    expect(doc.root.text()).toContain("Waiting to send: 0");
    expect(doc.root.text()).toContain("Not marked yet");
    const back = links(doc.root).find((anchor) => anchor.textContent === "All saved classes");
    expect(back?.getAttribute("href")).toBe("/kiosk-shell");
  });

  it("hides the roster when this class has no saved snapshot", async () => {
    const { doc } = await show(new IDBFactory(), classPath);
    expect(doc.status.textContent).toBe(OPEN_WHILE_CONNECTED);
    expect(doc.root.text()).toBe("");
    expect(doc.root.text()).not.toContain("Demo Learner");
  });

  it("hides an expired snapshot and keeps the waiting marks", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    const marked = await saveLocalAttendance({
      factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      marks: [
        {
          learnerId: "learner-01",
          status: "PRESENT",
          reasonCode: null,
          serverEventId: null,
          clientEventId: crypto.randomUUID(),
          recordedAt: phoneNow.toISOString(),
        },
      ],
      phoneNow,
    });
    expect(marked.ok).toBe(true);
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok) throw new Error(opened.reason);
    await runLocalTransaction(opened.db, ["snapshots"], "readwrite", async (tx) => {
      const stored = await localRequest(tx.objectStore("snapshots").getAll());
      expect(Array.isArray(stored)).toBe(true);
      for (const row of stored as { expiresAt: string; serverNowAtIssue: string }[]) {
        row.expiresAt = row.serverNowAtIssue;
        await localRequest(tx.objectStore("snapshots").put(row));
      }
    });
    closeWorkingDatabase(opened.db);
    const before = await readLocalCatalog(factory);
    const { doc } = await show(factory, classPath);
    const after = await readLocalCatalog(factory);
    expect(doc.status.textContent).toBe(OPEN_WHILE_CONNECTED);
    expect(doc.root.text()).not.toContain("Demo Learner");
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.events).toEqual(before.events);
    expect(after.events).toHaveLength(1);
  });

  it("does not show another account's roster", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    await authorize(factory, {
      owner: other,
      sectionId: "section-9",
      classSessionId: "session-9",
      learners: otherLearners,
    });
    const list = await show(factory, "/kiosk-shell");
    const first = await show(factory, classPath);
    const second = await show(factory, attendanceHref("section-9", "session-9"));
    for (const view of [list, first, second]) {
      const text = `${view.doc.status.textContent ?? ""} ${view.doc.root.text()}`;
      expect(view.doc.status.textContent).toBe(MORE_THAN_ONE_SIGN_IN);
      expect(text).not.toContain("Demo Learner");
      expect(text).not.toContain("LNR-");
    }
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    expect(catalog.snapshots).toHaveLength(2);
    expect(catalog.rosters).toHaveLength(2);
  });

  it("keeps the roster hidden while the phone is locked", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    const marked = await saveLocalAttendance({
      factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      marks: [
        {
          learnerId: "learner-01",
          status: "LATE",
          reasonCode: null,
          serverEventId: null,
          clientEventId: crypto.randomUUID(),
          recordedAt: phoneNow.toISOString(),
        },
      ],
      phoneNow,
    });
    expect(marked.ok).toBe(true);
    const locked = JSON.stringify({
      lock: { lockId: "lock-1", userId: owner.userId, centerId: owner.centerId },
      items: [],
      releases: [],
    });
    const storage = memory({ [DEVICE_STORAGE_KEY]: locked });
    const { doc } = await show(factory, classPath, storage);
    expect(doc.status.textContent).toBe(PHONE_LOCKED);
    expect(doc.root.text()).not.toContain("Demo Learner");
    expect(storage.getItem(DEVICE_STORAGE_KEY)).toBe(locked);
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok && catalog.events).toHaveLength(1);
  });

  it("does not describe an unreadable database as an empty class", async () => {
    const blocked = {
      open() {
        throw new Error("storage blocked");
      },
    } as unknown as IDBFactory;
    const failed = await show(blocked, classPath);
    expect(failed.doc.status.textContent).toBe(UNREADABLE_RECORDS);
    expect(failed.doc.root.text()).toBe("");
    expect(failed.doc.status.textContent).not.toBe(OPEN_WHILE_CONNECTED);
    expect(`${failed.doc.status.textContent} ${failed.doc.root.text()}`).not.toContain("Waiting to send: 0");

    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    const marked = await saveLocalAttendance({
      factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      marks: [
        {
          learnerId: "learner-01",
          status: "PRESENT",
          reasonCode: null,
          serverEventId: null,
          clientEventId: crypto.randomUUID(),
          recordedAt: phoneNow.toISOString(),
        },
      ],
      phoneNow,
    });
    expect(marked.ok).toBe(true);
    const before = await rows(factory, "events");
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok) throw new Error(opened.reason);
    await runLocalTransaction(opened.db, ["snapshots"], "readwrite", async (tx) => {
      await localRequest(tx.objectStore("snapshots").put({ id: "broken" }));
    });
    closeWorkingDatabase(opened.db);
    const corrupt = await show(factory, classPath);
    expect(corrupt.doc.status.textContent).toBe(UNREADABLE_RECORDS);
    expect(corrupt.doc.root.text()).not.toContain("Demo Learner");
    expect(corrupt.doc.root.text()).not.toContain("Waiting to send");
    expect(await rows(factory, "events")).toEqual(before);
  });

  it("shows saved marks and a correction, and saves the next mark on this phone", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    const { doc } = await show(factory, classPath);
    buttons(doc.root, statusLabel("PRESENT"))[0]?.click();
    await settle();
    const save = buttons(doc.root, "Save attendance")[0];
    expect(save?.disabled).toBe(false);
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(String(args[0]));
      throw new Error("The shell must not upload marks");
    }) as typeof fetch;
    try {
      save?.click();
      await settle();
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toEqual([]);
    expect(doc.root.text()).toContain(saved);
    expect(doc.root.text()).toContain("Waiting to send: 1");
    expect(doc.root.text()).toContain("Saved: Present");
    buttons(doc.root, statusLabel("ABSENT"))[0]?.click();
    await settle();
    buttons(doc.root, "Save attendance")[0]?.click();
    await settle();
    expect(doc.root.text()).toContain("Waiting to send: 2");
    expect(doc.root.text()).toContain("Saved: Absent");
    expect(doc.root.text()).toContain("Corrects an earlier mark. The earlier mark is kept.");
    expect(doc.root.text()).toContain("Present");
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const ordered = [...catalog.events].sort((left, right) => left.sequence - right.sequence);
    expect(ordered.map((event) => event.sequence)).toEqual([1, 2]);
    expect(ordered[0]?.syncState).toBe("pending");
    expect(ordered[1]?.correctsClientEventId).toBe(ordered[0]?.clientEventId);
    expect(ordered.every((event) => event.correctsServerEventId === null)).toBe(true);
  });

  it("serves the same document at a class address without the signed-in page", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    const shell = shellGet();
    const harness = harnessGet();
    expect(shell.headers.get("cache-control")).toBe("no-store");
    expect(harness.headers.get("content-type")).toContain("text/html");
    const shellHtml = await shell.text();
    const harnessHtml = await harness.text();
    expect(harnessHtml).toBe(shellHtml);
    expect(harnessHtml.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(harnessHtml).not.toContain("Demo Learner");
    expect(harnessHtml).not.toContain("__next_f");
    expect(harnessHtml).not.toContain("saveAttendanceAction");
    const script = harnessHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const doc = new FakeDocument();
    // The shell script reads the page clock. A saved sign-in goes idle after
    // 30 minutes, so this page stays at the moment the class was saved.
    class SavedClassClock extends Date {
      constructor(...args: unknown[]) {
        const supplied = args.length === 0 ? null : (Reflect.construct(Date, args) as Date);
        super(supplied === null ? phoneNow.getTime() : supplied.getTime());
      }

      static override now(): number {
        return phoneNow.getTime();
      }
    }
    const context: Record<string, unknown> = {
      document: doc,
      indexedDB: factory,
      localStorage: memory(),
      location: { pathname: `/kiosk-harness${classPath}` },
      crypto: globalThis.crypto,
      console,
      TextEncoder,
      TextDecoder,
      URL,
      Date: SavedClassClock,
      Math,
      JSON,
      Promise,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Symbol,
      RegExp,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      ReferenceError,
      Uint8Array,
      ArrayBuffer,
      Intl,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      decodeURIComponent,
      encodeURIComponent,
      queueMicrotask,
      setTimeout,
      clearTimeout,
      structuredClone,
    };
    context.globalThis = context;
    vm.createContext(context);
    const failures: unknown[] = [];
    const onRejection = (reason: unknown) => failures.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      vm.runInContext(script ?? "", context);
      await settle();
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(failures).toEqual([]);
    expect(doc.root.text()).toContain("Demo Learner 01");
    expect(doc.root.text()).toContain("Waiting to send: 0");
    expect(doc.status.textContent).not.toContain("Hydration");
    expect(links(doc.root).some((anchor) => anchor.getAttribute("href") === "/kiosk-shell")).toBe(true);
  });

  it("keeps an existing server Present mark on the phone", async () => {
    const factory = new IDBFactory();
    const serverAttendanceRecordId = "00000000-0000-4000-8000-000000000101";
    await authorize(factory, {
      owner,
      sectionId,
      classSessionId,
      learners: [learners[0]!],
      marks: { "learner-01": { serverAttendanceRecordId, serverStatus: "PRESENT", serverReasonCode: null } },
    });
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    expect(catalog.rosters[0]?.learners[0]).toMatchObject({ serverKnown: true, serverAttendanceRecordId, serverStatus: "PRESENT", serverReasonCode: null });
    const { doc } = await show(factory, classPath);
    expect(doc.root.text()).toContain("On the server: Present");
  });

  it("keeps Absent, Late, and Excused marks and their reasons", async () => {
    const factory = new IDBFactory();
    const rows = [
      { learnerId: "learner-02", displayName: "Demo Learner 02", learnerCode: "LNR-0002" },
      { learnerId: "learner-03", displayName: "Demo Learner 03", learnerCode: "LNR-0003" },
      { learnerId: "learner-04", displayName: "Demo Learner 04", learnerCode: "LNR-0004" },
    ];
    await authorize(factory, {
      owner,
      sectionId,
      classSessionId,
      learners: rows,
      marks: {
        "learner-02": { serverAttendanceRecordId: "00000000-0000-4000-8000-000000000102", serverStatus: "ABSENT", serverReasonCode: "ILLNESS" },
        "learner-03": { serverAttendanceRecordId: "00000000-0000-4000-8000-000000000103", serverStatus: "LATE", serverReasonCode: null },
        "learner-04": { serverAttendanceRecordId: "00000000-0000-4000-8000-000000000104", serverStatus: "EXCUSED", serverReasonCode: "FAMILY_CARE" },
      },
    });
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    expect(catalog.rosters[0]?.learners.map((learner) => [learner.serverStatus, learner.serverReasonCode])).toEqual([
      ["ABSENT", "ILLNESS"],
      ["LATE", null],
      ["EXCUSED", "FAMILY_CARE"],
    ]);
    const { doc } = await show(factory, classPath);
    expect(doc.root.text()).toContain("On the server: Absent");
    expect(doc.root.text()).toContain("Illness");
    expect(doc.root.text()).toContain("On the server: Late");
    expect(doc.root.text()).toContain("On the server: Excused");
    expect(doc.root.text()).toContain("Family care");
  });

  it("stores explicit nulls when the learner had no server attendance record", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners: [learners[0]!] });
    const stored = (await rows(factory, "rosters")) as { learners: Record<string, unknown>[] }[];
    const learner = stored[0]?.learners[0];
    expect(learner).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(learner, "serverAttendanceRecordId")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(learner, "serverStatus")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(learner, "serverReasonCode")).toBe(true);
    expect(learner?.serverAttendanceRecordId).toBeNull();
    expect(learner?.serverStatus).toBeNull();
    expect(learner?.serverReasonCode).toBeNull();
    const { doc } = await show(factory, classPath);
    expect(doc.root.text()).toContain("Not marked yet");
  });

  it("points the first offline correction at the original server record", async () => {
    const factory = new IDBFactory();
    const serverAttendanceRecordId = "00000000-0000-4000-8000-000000000101";
    await authorize(factory, {
      owner,
      sectionId,
      classSessionId,
      learners: [learners[0]!],
      marks: { "learner-01": { serverAttendanceRecordId, serverStatus: "PRESENT", serverReasonCode: null } },
    });
    const { doc } = await show(factory, classPath);
    buttons(doc.root, statusLabel("ABSENT"))[0]?.click();
    await settle();
    buttons(doc.root, "Save attendance")[0]?.click();
    await settle();
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    expect(catalog.events).toHaveLength(1);
    expect(catalog.events[0]?.correctsServerEventId).toBe(serverAttendanceRecordId);
    expect(catalog.events[0]?.correctsClientEventId).toBeNull();
    expect(catalog.events[0]?.status).toBe("ABSENT");
  });

  it("points the next correction at the earlier local mark and leaves the first mark unchanged", async () => {
    const factory = new IDBFactory();
    const serverAttendanceRecordId = "00000000-0000-4000-8000-000000000101";
    await authorize(factory, {
      owner,
      sectionId,
      classSessionId,
      learners: [learners[0]!],
      marks: { "learner-01": { serverAttendanceRecordId, serverStatus: "PRESENT", serverReasonCode: null } },
    });
    const { doc } = await show(factory, classPath);
    buttons(doc.root, statusLabel("ABSENT"))[0]?.click();
    await settle();
    buttons(doc.root, "Save attendance")[0]?.click();
    await settle();
    const firstCatalog = await readLocalCatalog(factory);
    expect(firstCatalog.ok).toBe(true);
    if (!firstCatalog.ok) return;
    const first = firstCatalog.events[0];
    expect(first).toBeTruthy();
    buttons(doc.root, statusLabel("LATE"))[0]?.click();
    await settle();
    buttons(doc.root, "Save attendance")[0]?.click();
    await settle();
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    const ordered = [...catalog.events].sort((left, right) => left.sequence - right.sequence);
    expect(ordered).toHaveLength(2);
    expect(ordered[0]).toEqual(first);
    expect(ordered[1]?.correctsClientEventId).toBe(first?.clientEventId);
    expect(ordered[1]?.correctsServerEventId).toBeNull();
    expect(ordered[1]?.status).toBe("LATE");
    expect(catalog.rosters[0]?.learners[0]?.serverAttendanceRecordId).toBe(serverAttendanceRecordId);
  });

  it("refuses an older snapshot for a new correction and keeps the waiting marks", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    const marked = await saveLocalAttendance({
      factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      phoneNow,
      marks: [
        {
          learnerId: "learner-01",
          status: "PRESENT",
          reasonCode: null,
          serverEventId: null,
          clientEventId: crypto.randomUUID(),
          recordedAt: phoneNow.toISOString(),
        },
      ],
    });
    expect(marked.ok).toBe(true);
    const before = await readLocalCatalog(factory);
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok) throw new Error(opened.reason);
    await runLocalTransaction(opened.db, ["snapshots", "rosters"], "readwrite", async (tx) => {
      const snapshots = (await localRequest(tx.objectStore("snapshots").getAll())) as Record<string, unknown>[];
      for (const row of snapshots) {
        delete row.formatVersion;
        delete row.sectionName;
        delete row.classTitle;
        delete row.whenLabel;
        await localRequest(tx.objectStore("snapshots").put(row));
      }
      const rosters = (await localRequest(tx.objectStore("rosters").getAll())) as { learners: Record<string, unknown>[] }[];
      for (const row of rosters) {
        delete (row as { formatVersion?: unknown }).formatVersion;
        for (const learner of row.learners) {
          delete learner.serverAttendanceRecordId;
          delete learner.serverStatus;
          delete learner.serverReasonCode;
        }
        await localRequest(tx.objectStore("rosters").put(row));
      }
    });
    closeWorkingDatabase(opened.db);
    const rejected = await saveLocalAttendance({
      factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      phoneNow,
      marks: [
        {
          learnerId: "learner-01",
          status: "ABSENT",
          reasonCode: null,
          serverEventId: null,
          clientEventId: crypto.randomUUID(),
          recordedAt: phoneNow.toISOString(),
        },
      ],
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).toBe(OUTDATED_SNAPSHOT);
    const after = await readLocalCatalog(factory);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.events).toEqual(before.events);
    expect(after.events).toHaveLength(1);
    const { doc } = await show(factory, classPath);
    expect(doc.status.textContent).toBe(OUTDATED_SNAPSHOT);
    expect(doc.root.text()).not.toContain("Not marked yet");
    expect(doc.root.text()).not.toContain("Demo Learner");
  });

  it("names each saved class with its section, title, and time", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners: [learners[0]!] });
    await authorize(factory, {
      owner,
      sectionId,
      classSessionId: otherSessionId,
      learners: otherLearners,
      labels: { sectionName: "Afternoon group", classTitle: "Numbers class", whenLabel: "Tuesday 10 Nov, 14:00 to 15:00" },
    });
    const { doc } = await show(factory, "/kiosk-shell");
    const text = doc.root.text();
    expect(text).toContain("Morning group");
    expect(text).toContain("Literacy class");
    expect(text).toContain("Monday 9 Nov, 09:00 to 10:00");
    expect(text).toContain("Afternoon group");
    expect(text).toContain("Numbers class");
    expect(text).toContain("Tuesday 10 Nov, 14:00 to 15:00");
    expect(links(doc.root).map((anchor) => anchor.getAttribute("href"))).toEqual([
      classPath,
      attendanceHref(sectionId, otherSessionId),
    ]);
  });

  it("keeps learner names and meeting links out of the session list", async () => {
    const factory = new IDBFactory();
    await authorize(factory, { owner, sectionId, classSessionId, learners });
    const { doc } = await show(factory, "/kiosk-shell");
    expect(doc.root.text()).not.toContain("Demo Learner");
    expect(doc.root.text()).not.toContain("LNR-");
    expect(doc.root.text()).not.toContain("meetingUrl");
    expect(doc.root.text()).not.toContain("https://");
    const stored = JSON.stringify(await rows(factory, "snapshots"));
    expect(stored).not.toContain("Demo Learner");
    expect(stored).not.toContain("LNR-");
    expect(stored).not.toContain("meetingUrl");
    expect(stored).not.toContain("https://");
    expect(stored).toContain("Morning group");
    expect(stored).toContain("Literacy class");
    expect(stored).toContain("Monday 9 Nov, 09:00 to 10:00");
  });
});
