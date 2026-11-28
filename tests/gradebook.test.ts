import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import { createAssignment, loadSectionGradebook } from "../lib/data/assignments";
import { closeWorkingDatabase, localRequest, openWorkingDatabase, runLocalTransaction } from "../lib/device/local-db";
import { saveGradebookMarks } from "../lib/device/gradebook-save";
import { listLocalRecords, markLocalRecords } from "../lib/device/local-records";
import { prisma } from "../lib/db";
import { assertConnectedTestDatabase } from "../lib/test-db/connect";
import {
  acknowledgedAfterSend,
  fileStatusLabel,
  gradebookCell,
  gradeCellBaseline,
  gradeEditingAllowed,
  gradeEntryState,
  pendingGradeForCell,
  planGradebookSaves,
  serverFileStatus,
  validateNewAssignment,
  type GradebookDraft,
  type GradePhoneRow,
  type GradePhoneScope,
} from "../lib/lms/gradebook";
import { MAX_RECORD_MUTATIONS } from "../lib/sync/record-batch";
import { syncLocalRecords } from "../lib/sync/record-sync";

const granted = {
  persist: async () => true,
  estimate: async () => ({ quota: 5_000_000, usage: 1000 }),
};

const owner = {
  centerId: "00000000-0000-4000-8000-0000000000c1",
  userId: "00000000-0000-4000-8000-0000000000a1",
};
const other = { centerId: owner.centerId, userId: "00000000-0000-4000-8000-0000000000b2" };

function factory() {
  return new IDBFactory();
}

function cell(kind: string, points: string, learnerId: string, assignmentId: string) {
  return {
    assignmentId,
    learnerId,
    kind,
    maxPoints: "20.00",
    entered: points,
    currentPoints: null,
    academicNote: null,
    recordId: null,
    baseVector: {},
  };
}

describe("assignment kinds and gradebook planning", () => {
  it("keeps Paper, Digital, and Both as different choices", () => {
    const paper = validateNewAssignment({ title: "Paper sheet", kind: "PAPER", maxPoints: "20" });
    const digital = validateNewAssignment({ title: "Photo sheet", kind: "DIGITAL", maxPoints: "20" });
    const both = validateNewAssignment({ title: "Hybrid sheet", kind: "BOTH", maxPoints: "20" });
    expect(paper.ok && paper.kind).toBe("PAPER");
    expect(digital.ok && digital.kind).toBe("DIGITAL");
    expect(both.ok && both.kind).toBe("BOTH");
    if (!both.ok || !digital.ok) return;
    expect(both.kind).not.toBe(digital.kind);
    expect(validateNewAssignment({ title: "Exam", kind: "IN_CLASS_EXAM", maxPoints: "20" }).ok).toBe(false);
  });

  it("plans every assignment kind as the same grade draft", () => {
    const assignmentId = "00000000-0000-4000-8000-000000000011";
    const planned = planGradebookSaves(
      ["PAPER", "DIGITAL", "BOTH", "IN_CLASS_EXAM"].map((kind, index) =>
        cell(kind, String(index + 1), `00000000-0000-4000-8000-00000000003${index}`, assignmentId),
      ),
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.drafts).toHaveLength(4);
    for (const draft of planned.drafts) {
      expect(Object.keys(draft).sort()).toEqual(
        ["academicNote", "assignmentId", "baseVector", "learnerId", "points", "recordId"].sort(),
      );
    }
  });

  it("skips an unchanged mark and refuses a mark above the maximum", () => {
    const assignmentId = "00000000-0000-4000-8000-000000000011";
    const learnerId = "00000000-0000-4000-8000-000000000022";
    const same = planGradebookSaves([
      { ...cell("PAPER", "14", learnerId, assignmentId), currentPoints: "14.00" },
    ]);
    expect(same.ok && same.ok && same.drafts).toEqual([]);
    const high = planGradebookSaves([cell("BOTH", "21", learnerId, assignmentId)]);
    expect(high.ok).toBe(false);
    const cleared = planGradebookSaves([
      { ...cell("DIGITAL", "", learnerId, assignmentId), currentPoints: "8.00", recordId: learnerId },
    ]);
    expect(cleared.ok).toBe(false);
  });

  it("labels each stored upload state separately", () => {
    const cases = [
      ["QUEUED", "queued", "Waiting to upload"],
      ["UPLOADING", "uploading", "Uploading"],
      ["STORED", "submitted", "Submitted"],
      ["FAILED", "failed", "Upload failed"],
      [null, "not_submitted", "Not submitted"],
    ] as const;
    for (const [stored, status, label] of cases) {
      expect(serverFileStatus(stored)).toBe(status);
      expect(fileStatusLabel(status)).toBe(label);
    }
  });
});

const assignmentA = "00000000-0000-4000-8000-000000000011";
const assignmentB = "00000000-0000-4000-8000-000000000012";
const learnerA = "00000000-0000-4000-8000-000000000022";
const learnerB = "00000000-0000-4000-8000-000000000023";
const otherCenter = "00000000-0000-4000-8000-0000000000c2";
const deviceId = "00000000-0000-4000-8000-0000000000d1";
const otherDevice = "00000000-0000-4000-8000-0000000000d2";
const recordA = "00000000-0000-4000-8000-000000000099";

function phoneScope(center = owner.centerId, user = owner.userId, device: string | null = deviceId): GradePhoneScope {
  return {
    centerId: center,
    userId: user,
    deviceId: device,
    assignmentIds: new Set([assignmentA, assignmentB]),
    learnerIds: new Set([learnerA, learnerB]),
  };
}

function phoneRow(overrides: {
  points?: string;
  assignmentId?: string;
  learnerId?: string;
  centerId?: string;
  userId?: string;
  localDeviceId?: string;
  entityType?: string;
  recordId?: string;
  versionVector?: GradePhoneRow["versionVector"];
  syncState?: string;
} = {}): GradePhoneRow {
  return {
    centerId: overrides.centerId ?? owner.centerId,
    userId: overrides.userId ?? owner.userId,
    localDeviceId: overrides.localDeviceId ?? deviceId,
    entityType: overrides.entityType ?? "GRADE_ENTRY",
    recordId: overrides.recordId ?? recordA,
    versionVector: overrides.versionVector ?? { [deviceId]: 1 },
    syncState: overrides.syncState ?? "pending",
    content: {
      assignmentId: overrides.assignmentId ?? assignmentA,
      learnerId: overrides.learnerId ?? learnerA,
      points: overrides.points ?? "10.00",
      academicNote: null,
    },
  };
}

describe("pending grades on the gradebook", () => {
  beforeEach(() => {
    globalThis.IDBKeyRange = IDBKeyRange;
  });

  it("shows the newest waiting mark for this learner and assignment only", () => {
    const older = phoneRow({ points: "9.00", versionVector: { [deviceId]: 1 } });
    const newer = phoneRow({ points: "12.00", versionVector: { [deviceId]: 2 }, recordId: recordA });
    const pending = pendingGradeForCell(phoneScope(), assignmentA, learnerA, [
      older,
      newer,
      phoneRow({ points: "3.00", learnerId: learnerB }),
      phoneRow({ points: "4.00", assignmentId: "00000000-0000-4000-8000-0000000000aa" }),
      phoneRow({ points: "5.00", centerId: otherCenter }),
      phoneRow({ points: "6.00", userId: other.userId }),
      phoneRow({ points: "7.00", localDeviceId: otherDevice }),
      phoneRow({ points: "8.00", syncState: "acknowledged", versionVector: { [deviceId]: 9 } }),
      phoneRow({ points: "1.00", syncState: "conflict" }),
      phoneRow({ points: "2.00", syncState: "stale" }),
      phoneRow({ points: "2.50", syncState: "rejected" }),
      { ...phoneRow({ points: "15.00" }), entityType: "PROGRESS_NOTE" },
    ]);
    expect(pending?.points).toBe("12.00");
    expect(pending?.recordId).toBe(recordA);
    expect(pendingGradeForCell(phoneScope(), assignmentB, learnerA, [newer])).toBeNull();
    expect(pendingGradeForCell(phoneScope(owner.centerId, owner.userId, null), assignmentA, learnerA, [newer])).toBeNull();
    const serverOnly = gradeEntryState({ typed: null, pendingPoints: null, fallbackPoints: "4.00" });
    expect(serverOnly).toEqual({ display: "4.00", status: "server" });
    const onPhone = gradeEntryState({ typed: null, pendingPoints: pending?.points ?? null, fallbackPoints: "4.00" });
    expect(onPhone).toEqual({ display: "12.00", status: "phone" });
  });

  it("does not save a waiting mark again until the teacher changes it", async () => {
    const indexedDB = factory();
    const first = await saveGradebookMarks(
      indexedDB,
      owner,
      [
        {
          assignmentId: assignmentA,
          learnerId: learnerA,
          points: "10.00",
          academicNote: "steady",
          recordId: recordA,
          baseVector: {},
        },
      ],
      { storage: granted },
    );
    expect(first.ok).toBe(true);
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.mutations).toHaveLength(1);
    const scope = phoneScope(owner.centerId, owner.userId, listed.deviceId);
    const pending = pendingGradeForCell(scope, assignmentA, learnerA, listed.mutations);
    expect(pending?.points).toBe("10.00");
    const baseline = gradeCellBaseline({
      pending,
      server: { id: "00000000-0000-4000-8000-000000000088", points: "4.00", academicNote: null, versionVector: {} },
    });
    expect(baseline.currentPoints).toBe("10.00");
    expect(baseline.recordId).toBe(listed.mutations[0]?.recordId);
    const untouched = planGradebookSaves([
      {
        assignmentId: assignmentA,
        learnerId: learnerA,
        kind: "PAPER",
        maxPoints: "20.00",
        entered: baseline.currentPoints ?? "",
        currentPoints: baseline.currentPoints,
        academicNote: baseline.academicNote,
        recordId: baseline.recordId,
        baseVector: baseline.baseVector,
      },
      {
        assignmentId: assignmentB,
        learnerId: learnerB,
        kind: "PAPER",
        maxPoints: "20.00",
        entered: "6.00",
        currentPoints: "6.00",
        academicNote: null,
        recordId: "00000000-0000-4000-8000-000000000077",
        baseVector: {},
      },
    ]);
    expect(untouched.ok && untouched.drafts).toEqual([]);
    const savedAgain = await saveGradebookMarks(indexedDB, owner, untouched.ok ? untouched.drafts : [], { storage: granted });
    expect(savedAgain.saved).toBe(0);
    const still = await listLocalRecords(indexedDB, owner);
    expect(still.ok && still.mutations).toHaveLength(1);

    const edited = planGradebookSaves([
      {
        assignmentId: assignmentA,
        learnerId: learnerA,
        kind: "PAPER",
        maxPoints: "20.00",
        entered: "11",
        currentPoints: baseline.currentPoints,
        academicNote: baseline.academicNote,
        recordId: baseline.recordId,
        baseVector: baseline.baseVector,
      },
      {
        assignmentId: assignmentB,
        learnerId: learnerB,
        kind: "PAPER",
        maxPoints: "20.00",
        entered: "",
        currentPoints: null,
        academicNote: null,
        recordId: null,
        baseVector: {},
      },
    ]);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.drafts).toHaveLength(1);
    expect(edited.drafts[0]).toMatchObject({
      assignmentId: assignmentA,
      learnerId: learnerA,
      points: "11.00",
      academicNote: "steady",
      baseVector: pending?.versionVector,
    });
    const wiped = planGradebookSaves([
      {
        assignmentId: assignmentA,
        learnerId: learnerA,
        kind: "PAPER",
        maxPoints: "20.00",
        entered: "",
        currentPoints: baseline.currentPoints,
        academicNote: baseline.academicNote,
        recordId: baseline.recordId,
        baseVector: baseline.baseVector,
      },
    ]);
    expect(wiped.ok).toBe(false);
    const second = await saveGradebookMarks(indexedDB, owner, edited.drafts, { storage: granted });
    expect(second.saved).toBe(1);
    const after = await listLocalRecords(indexedDB, owner);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.mutations).toHaveLength(2);
    expect(after.mutations.every((item) => "points" in item.content && item.content.learnerId === learnerA)).toBe(true);
    expect(after.mutations.every((item) => "points" in item.content && item.content.assignmentId === assignmentA)).toBe(true);
    const latest = pendingGradeForCell(phoneScope(owner.centerId, owner.userId, after.deviceId), assignmentA, learnerA, after.mutations);
    expect(latest?.points).toBe("11.00");
    expect(latest?.versionVector[after.deviceId ?? ""]).toBe(2);
  });

  it("keeps editing off until the phone grades have been read", () => {
    expect(gradeEditingAllowed("loading")).toBe(false);
    expect(gradeEditingAllowed("unavailable")).toBe(false);
    expect(gradeEditingAllowed("failed")).toBe(false);
    expect(gradeEditingAllowed("ready")).toBe(true);
  });

  it("keeps a sent mark as the baseline and writes one later edit", async () => {
    const indexedDB = factory();
    const server = {
      id: "00000000-0000-4000-8000-000000000088",
      points: "4.00",
      academicNote: null,
      versionVector: {},
    };
    const saved = await saveGradebookMarks(
      indexedDB,
      owner,
      [
        {
          assignmentId: assignmentA,
          learnerId: learnerA,
          points: "12.00",
          academicNote: "steady",
          recordId: recordA,
          baseVector: server.versionVector,
        },
      ],
      { storage: granted },
    );
    expect(saved.saved).toBe(1);
    const before = await listLocalRecords(indexedDB, owner);
    expect(before.ok).toBe(true);
    if (!before.ok || !before.mutations[0]) return;
    const recorded = await markLocalRecords(indexedDB, owner, [
      { clientMutationId: before.mutations[0].clientMutationId, syncState: "acknowledged" },
    ]);
    expect(recorded).toBe(true);
    const after = await listLocalRecords(indexedDB, owner);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const scope = phoneScope(owner.centerId, owner.userId, after.deviceId);
    const accepted = acknowledgedAfterSend(scope, assignmentA, learnerA, before.mutations, after.mutations);
    expect(accepted?.points).toBe("12.00");
    expect(accepted?.recordId).toBe(recordA);
    expect(accepted?.versionVector).toEqual(before.mutations[0].versionVector);
    expect(acknowledgedAfterSend(scope, assignmentA, learnerA, [], after.mutations)).toBeNull();
    expect(acknowledgedAfterSend(scope, assignmentA, learnerA, before.mutations, before.mutations)).toBeNull();
    const conflicted = after.mutations.map((row) => ({ ...row, syncState: "conflict" }));
    expect(acknowledgedAfterSend(scope, assignmentA, learnerA, before.mutations, conflicted)).toBeNull();

    const baseline = gradeCellBaseline({ pending: null, acknowledged: accepted, server });
    expect(baseline.currentPoints).toBe("12.00");
    expect(baseline.baseVector).toEqual(accepted?.versionVector);
    expect(baseline.recordId).toBe(recordA);
    const shown = gradeEntryState({
      typed: null,
      pendingPoints: null,
      acknowledgedPoints: accepted?.points ?? null,
      fallbackPoints: server.points,
    });
    expect(shown).toEqual({ display: "12.00", status: "acknowledged" });
    const unchanged = planGradebookSaves([
      {
        assignmentId: assignmentA,
        learnerId: learnerA,
        kind: "PAPER",
        maxPoints: "20.00",
        entered: "12.00",
        currentPoints: baseline.currentPoints,
        academicNote: baseline.academicNote,
        recordId: baseline.recordId,
        baseVector: baseline.baseVector,
      },
    ]);
    expect(unchanged.ok && unchanged.drafts).toEqual([]);
    const wiped = planGradebookSaves([
      {
        assignmentId: assignmentA,
        learnerId: learnerA,
        kind: "PAPER",
        maxPoints: "20.00",
        entered: "",
        currentPoints: baseline.currentPoints,
        academicNote: baseline.academicNote,
        recordId: baseline.recordId,
        baseVector: baseline.baseVector,
      },
    ]);
    expect(wiped.ok).toBe(false);
    const edited = planGradebookSaves([
      {
        assignmentId: assignmentA,
        learnerId: learnerA,
        kind: "PAPER",
        maxPoints: "20.00",
        entered: "13",
        currentPoints: baseline.currentPoints,
        academicNote: baseline.academicNote,
        recordId: baseline.recordId,
        baseVector: baseline.baseVector,
      },
    ]);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.drafts).toHaveLength(1);
    expect(edited.drafts[0]).toMatchObject({
      points: "13.00",
      academicNote: "steady",
      recordId: recordA,
      baseVector: accepted?.versionVector,
    });
    const second = await saveGradebookMarks(indexedDB, owner, edited.drafts, { storage: granted });
    expect(second.saved).toBe(1);
    const finalList = await listLocalRecords(indexedDB, owner);
    expect(finalList.ok).toBe(true);
    if (!finalList.ok) return;
    expect(finalList.mutations).toHaveLength(2);
    const stillAccepted = finalList.mutations.filter((row) => row.syncState === "acknowledged");
    const waiting = finalList.mutations.filter((row) => row.syncState === "pending");
    expect(stillAccepted).toHaveLength(1);
    expect(waiting).toHaveLength(1);
    expect(stillAccepted[0] && "points" in stillAccepted[0].content && stillAccepted[0].content.points).toBe("12.00");
    expect(waiting[0] && "points" in waiting[0].content && waiting[0].content.points).toBe("13.00");
    expect(waiting[0]?.versionVector[finalList.deviceId ?? ""]).toBe(2);
    const pendingWins = gradeCellBaseline({
      pending: {
        points: "13.00",
        academicNote: "steady",
        recordId: recordA,
        versionVector: waiting[0]?.versionVector ?? {},
      },
      acknowledged: accepted,
      server,
    });
    expect(pendingWins.currentPoints).toBe("13.00");
  });
});

describe("offline gradebook saves", () => {
  beforeEach(() => {
    globalThis.IDBKeyRange = IDBKeyRange;
  });

  it("stores a new mark and a later edit under the same grade id", async () => {
    const indexedDB = factory();
    const assignmentId = "00000000-0000-4000-8000-000000000011";
    const learnerId = "00000000-0000-4000-8000-000000000022";
    const recordId = "00000000-0000-4000-8000-000000000099";
    const draft = (points: string, baseVector: GradebookDraft["baseVector"]): GradebookDraft => ({
      assignmentId,
      learnerId,
      points,
      academicNote: "steady",
      recordId,
      baseVector,
    });
    const first = await saveGradebookMarks(indexedDB, owner, [draft("10", {})], { storage: granted });
    expect(first.ok).toBe(true);
    expect(first.message).toBe("Saved on this phone, waiting to send");
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.mutations).toHaveLength(1);
    expect(listed.mutations[0]?.recordId).toBe(recordId);
    expect(listed.mutations[0]?.entityType).toBe("GRADE_ENTRY");
    const deviceId = listed.mutations[0]?.localDeviceId ?? "";
    expect(listed.mutations[0]?.versionVector).toEqual({ [deviceId]: 1 });
    const second = await saveGradebookMarks(
      indexedDB,
      owner,
      [draft("12", listed.mutations[0]?.versionVector ?? {})],
      { storage: granted },
    );
    expect(second.ok).toBe(true);
    const again = await listLocalRecords(indexedDB, owner);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.mutations.map((item) => item.recordId)).toEqual([recordId, recordId]);
    expect(again.mutations.map((item) => item.versionVector[deviceId]).sort()).toEqual([1, 2]);
  });

  it("reuses the phone's grade id when the server has no row yet", async () => {
    const indexedDB = factory();
    const assignmentId = "00000000-0000-4000-8000-000000000011";
    const learnerId = "00000000-0000-4000-8000-000000000022";
    const blank: GradebookDraft = {
      assignmentId,
      learnerId,
      points: "7.00",
      academicNote: null,
      recordId: null,
      baseVector: {},
    };
    expect((await saveGradebookMarks(indexedDB, owner, [blank], { storage: granted })).ok).toBe(true);
    expect((await saveGradebookMarks(indexedDB, owner, [{ ...blank, points: "8.00" }], { storage: granted })).ok).toBe(true);
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(new Set(listed.mutations.map((item) => item.recordId)).size).toBe(1);
    const deviceId = listed.mutations[0]?.localDeviceId ?? "";
    expect(listed.mutations.map((item) => item.versionVector[deviceId]).sort()).toEqual([1, 2]);
  });

  it("does not call a mark saved when the browser will not promise to keep it", async () => {
    const indexedDB = factory();
    const held = await saveGradebookMarks(
      indexedDB,
      owner,
      [
        {
          assignmentId: "00000000-0000-4000-8000-000000000011",
          learnerId: "00000000-0000-4000-8000-000000000022",
          points: "8.00",
          academicNote: null,
          recordId: null,
          baseVector: {},
        },
      ],
      { storage: { persist: async () => false, estimate: async () => ({ quota: 5000, usage: 0 }) } },
    );
    expect(held.ok).toBe(true);
    expect(held.message).toBe("This edit is on this phone, waiting to send. This browser did not promise to keep it.");
    expect(held.message).not.toContain("Saved on this phone");
    const full = await saveGradebookMarks(
      indexedDB,
      owner,
      [
        {
          assignmentId: "00000000-0000-4000-8000-000000000011",
          learnerId: "00000000-0000-4000-8000-000000000033",
          points: "8.00",
          academicNote: null,
          recordId: null,
          baseVector: {},
        },
      ],
      { storage: { persist: async () => false, estimate: async () => ({ quota: 10, usage: 10 }) } },
    );
    expect(full.ok).toBe(false);
    expect(full.message.toLowerCase()).toContain("not saved");
    expect(full.message).not.toContain("Saved on this phone");
  });

  it("refuses a locked phone and does not write attendance", async () => {
    const indexedDB = factory();
    const opened = await openWorkingDatabase(indexedDB);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await runLocalTransaction(opened.db, ["deviceLock"], "readwrite", (tx) =>
      localRequest(tx.objectStore("deviceLock").put({
        key: "current",
        lock: { lockId: "lock-1", userId: other.userId, centerId: owner.centerId, authSessionId: "session-1" },
      })),
    );
    closeWorkingDatabase(opened.db);
    const saved = await saveGradebookMarks(
      indexedDB,
      owner,
      [
        {
          assignmentId: "00000000-0000-4000-8000-000000000011",
          learnerId: "00000000-0000-4000-8000-000000000022",
          points: "7.00",
          academicNote: null,
          recordId: null,
          baseVector: {},
        },
      ],
      { storage: granted },
    );
    expect(saved.ok).toBe(false);
    expect(saved.message).not.toContain("Saved on this phone");
    const after = await openWorkingDatabase(indexedDB);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const events = await runLocalTransaction(after.db, ["events"], "readonly", (tx) =>
      localRequest(tx.objectStore("events").getAll()),
    );
    closeWorkingDatabase(after.db);
    expect(events).toEqual([]);
  });

  it("sends ten grade edits in the existing batch and leaves the eleventh waiting", async () => {
    const indexedDB = factory();
    const assignmentId = "00000000-0000-4000-8000-000000000011";
    const drafts: GradebookDraft[] = Array.from({ length: MAX_RECORD_MUTATIONS + 1 }, (_, index) => ({
      assignmentId,
      learnerId: `00000000-0000-4000-8000-0000000001${index.toString(16).padStart(2, "0")}`,
      points: "5.00",
      academicNote: null,
      recordId: null,
      baseVector: {},
    }));
    const saved = await saveGradebookMarks(indexedDB, owner, drafts, { storage: granted });
    expect(saved.saved).toBe(11);
    const bodies: { version?: number; mutations?: { entityType?: string; clientMutationId?: string }[] }[] = [];
    const first = await syncLocalRecords({
      factory: indexedDB,
      account: owner,
      fetchImpl: async (url, init) => {
        expect(url).toBe("/api/sync/records");
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        return new Response(
          JSON.stringify({
            results: body.mutations.map((item: { clientMutationId: string }) => ({
              clientMutationId: item.clientMutationId,
              outcome: "accepted",
            })),
          }),
          { status: 200 },
        );
      },
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.version).toBe(1);
    expect(bodies[0]?.mutations).toHaveLength(MAX_RECORD_MUTATIONS);
    expect(bodies[0]?.mutations?.every((item) => item.entityType === "GRADE_ENTRY")).toBe(true);
    expect(JSON.stringify(bodies[0])).not.toContain("storageKey");
    expect(first.ok).toBe(false);
    expect(first.pending).toBe(1);
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.mutations.filter((item) => item.syncState === "pending")).toHaveLength(1);
    expect(listed.mutations.filter((item) => item.syncState === "acknowledged")).toHaveLength(MAX_RECORD_MUTATIONS);
  });
});

describe("section gradebook records", () => {
  const gradeViewsSince = new Date();
  let morningId = "";
  let teacherOne: Actor;
  let teacherTwo: Actor;
  let director: Actor;
  let learner: Actor;

  async function removeDay10() {
    await assertConnectedTestDatabase();
    await prisma.assignment.deleteMany({
      where: { title: { startsWith: "Day10 " }, gradeEntries: { none: {} } },
    });
  }

  beforeAll(async () => {
    morningId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    teacherOne = await actorByEmail("teacher.one@demo.invalid");
    teacherTwo = await actorByEmail("teacher.two@demo.invalid");
    director = await actorByEmail("director@demo.invalid");
    const learnerUser = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { userId: true },
    });
    const loaded = await loadActor(learnerUser.userId);
    if (!loaded) throw new Error("missing learner");
    learner = loaded;
    await removeDay10();
  });

  afterAll(async () => {
    try {
      await removeDay10();
      await removeOnlineGradeViews(gradeViewsSince);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("lets the assigned teacher create Paper, Digital, and Both", async () => {
    const examsBefore = await prisma.assignment.findMany({
      where: { sectionId: morningId, kind: "IN_CLASS_EXAM" },
      select: { id: true, kind: true, title: true },
      orderBy: { title: "asc" },
    });
    expect(examsBefore.length).toBeGreaterThan(0);
    const created = [];
    for (const kind of ["PAPER", "DIGITAL", "BOTH"] as const) {
      const result = await createAssignment(teacherOne, {
        sectionId: morningId,
        title: `Day10 ${kind}`,
        kind,
        maxPoints: "15",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.kind).toBe(kind);
      created.push(result);
    }
    const stored = await prisma.assignment.findMany({
      where: { id: { in: created.map((item) => item.assignmentId) } },
      select: { id: true, kind: true, maxPoints: true },
    });
    expect(stored.map((item) => item.kind).sort()).toEqual(["BOTH", "DIGITAL", "PAPER"]);
    expect(stored.every((item) => item.maxPoints.toFixed(2) === "15.00")).toBe(true);
    const examsAfter = await prisma.assignment.findMany({
      where: { sectionId: morningId, kind: "IN_CLASS_EXAM" },
      select: { id: true, kind: true, title: true },
      orderBy: { title: "asc" },
    });
    expect(examsAfter).toEqual(examsBefore);
    const refused = await createAssignment(teacherTwo, {
      sectionId: morningId,
      title: "Day10 refused",
      kind: "PAPER",
      maxPoints: "10",
    });
    expect(refused.ok).toBe(false);
    expect(await prisma.assignment.count({ where: { title: "Day10 refused" } })).toBe(0);
    expect(
      (
        await createAssignment(director, {
          sectionId: morningId,
          title: "Day10 director",
          kind: "BOTH",
          maxPoints: "10",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await createAssignment({ ...teacherOne, active: false }, {
          sectionId: morningId,
          title: "Day10 inactive",
          kind: "PAPER",
          maxPoints: "10",
        })
      ).ok,
    ).toBe(false);
  });

  it("shows enrolled learners, every assignment kind, and the saved mark in that cell", async () => {
    const book = await loadSectionGradebook(teacherOne, morningId);
    expect(book).not.toBeNull();
    if (!book) return;
    const enrolled = await prisma.enrollment.findMany({
      where: { sectionId: morningId, status: "ACTIVE" },
      select: { learnerId: true },
      orderBy: { learner: { learnerCode: "asc" } },
    });
    expect(book.learners.map((learner) => learner.id)).toEqual(enrolled.map((row) => row.learnerId));
    expect(book.learners.every((learner) => learner.displayName.length > 0 && learner.learnerCode.length > 0)).toBe(true);
    const assignments = await prisma.assignment.findMany({
      where: { sectionId: morningId },
      select: { id: true, kind: true },
    });
    expect(book.assignments.map((item) => item.id).sort()).toEqual(assignments.map((item) => item.id).sort());
    expect(book.assignments.some((item) => item.kind === "IN_CLASS_EXAM")).toBe(true);
    expect(book.assignments.some((item) => item.kind === "PAPER")).toBe(true);
    expect(book.assignments.some((item) => item.kind === "DIGITAL")).toBe(true);
    expect(book.files.some((item) => item.status === "submitted")).toBe(true);
    const dbGrades = await prisma.gradeEntry.findMany({
      where: { assignment: { sectionId: morningId } },
      select: { id: true, assignmentId: true, learnerId: true, points: true },
    });
    expect(dbGrades.length).toBeGreaterThan(0);
    for (const row of dbGrades) {
      const cell = gradebookCell(book.grades, row.assignmentId, row.learnerId);
      expect(cell?.id).toBe(row.id);
      expect(cell?.points).toBe(new Prisma.Decimal(row.points).toFixed(2));
    }
    const open = await prisma.syncConflict.findFirst({
      where: { state: "OPEN", entityType: "GRADE_ENTRY", gradeEntry: { assignment: { sectionId: morningId } } },
      select: { gradeEntryId: true },
    });
    expect(open?.gradeEntryId).toBeTruthy();
    expect(book.grades.find((grade) => grade.id === open?.gradeEntryId)?.provisional).toBe(true);
    expect(await loadSectionGradebook(teacherTwo, morningId)).toBeNull();
    expect(await loadSectionGradebook(director, morningId)).toBeNull();
    expect(await loadSectionGradebook(learner, morningId)).toBeNull();
    expect(await loadSectionGradebook({ ...teacherOne, active: false }, morningId)).toBeNull();
  });
});

async function removeOnlineGradeViews(since: Date) {
  await assertConnectedTestDatabase();
  const users = await prisma.user.findMany({
    where: { email: { in: ["teacher.one@demo.invalid", "director@demo.invalid"] } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.auditLog.deleteMany({
      where: {
        action: "VIEW",
        entityType: "GRADE_ENTRY",
        actorId: { in: ids },
        at: { gte: since },
        metadata: { equals: { source: "online" } },
      },
    });
  });
}

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}
