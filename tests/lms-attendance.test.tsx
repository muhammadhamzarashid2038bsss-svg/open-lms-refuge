import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Actor } from "../lib/auth/permissions";
import { loadActor } from "../lib/auth/load-actor";
import { recordAttendance, readAttendanceSheet } from "../lib/data/attendance";
import { createTimetableSession } from "../lib/data/timetable";
import { prisma } from "../lib/db";
import {
  buildSessionHistory,
  chooseReason,
  chooseStatus,
  draftFromLearner,
  normalizeAttendanceBatch,
  pendingMarks,
  sheetCounts,
  WEB_KIOSK_DEVICE_LABEL,
  type AttendanceEventFact,
  type AttendanceLearnerRow,
  type IdFactory,
  type LearnerDraft,
} from "../lib/lms/attendance";
import { AttendanceHistory } from "../components/attendance-history";
import { AttendanceSheetView } from "../components/attendance-sheet";

const holder = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/lib/auth/actor", () => ({
  getActor: async () => holder.actor,
}));

import { GET, POST } from "../app/api/sections/[id]/sessions/[sessionId]/attendance/route";

const assignmentNow = new Date("2026-11-07T12:00:00.000Z");

// Exact titles only. A prefix would also match a class created by hand
// during Day 6 testing, and those rows have to stay.
const TEST_SESSION_TITLES = ["Kiosk automated test session", "Kiosk coverage count session"] as const;

let kioskDevicesSnapshotted = false;
let preexistingKioskDeviceIds: string[] = [];
const testEnrollmentIds: string[] = [];

afterAll(async () => {
  await removeKioskFixtures();
  await prisma.$disconnect();
});

async function snapshotKioskDevices() {
  const devices = await prisma.device.findMany({
    where: { label: WEB_KIOSK_DEVICE_LABEL },
    select: { id: true },
  });
  preexistingKioskDeviceIds = devices.map((device) => device.id);
  kioskDevicesSnapshotted = true;
}

async function removeKioskFixtures() {
  await prisma.$transaction(async (tx) => {
    // The append-only trigger allows a delete only inside this demo-reset
    // switch. The filter below is still only the ids this file creates.
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.attendanceRecord.deleteMany({ where: { clientEventId: { startsWith: "kiosk-test-" } } });
    await tx.classSession.deleteMany({ where: { title: { in: [...TEST_SESSION_TITLES] } } });
    if (testEnrollmentIds.length > 0) {
      await tx.enrollment.deleteMany({ where: { id: { in: testEnrollmentIds } } });
    }
    // A kiosk device that already existed belongs to manual testing.
    // Delete only a device this run created, and only after its test
    // attendance is gone.
    if (!kioskDevicesSnapshotted) return;
    const createdDuringRun = await tx.device.findMany({
      where: {
        label: WEB_KIOSK_DEVICE_LABEL,
        ...(preexistingKioskDeviceIds.length > 0 ? { id: { notIn: preexistingKioskDeviceIds } } : {}),
      },
      select: { id: true, _count: { select: { attendanceRecords: true } } },
    });
    const unused = createdDuringRun
      .filter((device) => device._count.attendanceRecords === 0)
      .map((device) => device.id);
    if (unused.length > 0) await tx.device.deleteMany({ where: { id: { in: unused } } });
  });
}

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id, assignmentNow);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}

async function learnerByCode(code: string) {
  const learner = await prisma.learnerProfile.findFirstOrThrow({
    where: { learnerCode: code, center: { code: "DEMO" } },
    select: { userId: true },
  });
  const actor = await loadActor(learner.userId, assignmentNow);
  if (!actor) throw new Error(`missing learner ${code}`);
  return actor;
}

function ids(prefix: string): IdFactory {
  let n = 0;
  return () => {
    n += 1;
    return { clientEventId: `kiosk-test-${prefix}-${n}`, recordedAt: "2026-11-07T01:00:00.000Z" };
  };
}

function row(overrides: Partial<AttendanceLearnerRow> = {}): AttendanceLearnerRow {
  return {
    id: "learner-1",
    displayName: "Demo Learner 01",
    learnerCode: "LNR-0001",
    saved: null,
    ...overrides,
  };
}

describe("attendance choices", () => {
  it("keeps a chosen status, leaves everyone else unmarked, and does not invent a save", () => {
    const factory = ids("choice");
    const unmarked = draftFromLearner(row({ id: "learner-2", displayName: "Demo Learner 02" }));
    const chosen = chooseStatus(draftFromLearner(row()), "PRESENT", factory);
    expect(chosen.status).toBe("PRESENT");
    expect(chosen.clientEventId).toBe("kiosk-test-choice-1");
    expect(pendingMarks([chosen, unmarked]).map((mark) => mark.learnerId)).toEqual(["learner-1"]);
    const counts = sheetCounts([chosen, unmarked]);
    expect(counts).toMatchObject({ marked: 1, unmarked: 1, pending: 1, unmarkedNames: ["Demo Learner 02"] });
    expect(pendingMarks([unmarked])).toEqual([]);
  });

  it("offers a reason only for absent or excused, and a second tap clears it", () => {
    const factory = ids("reason");
    const absent = chooseStatus(draftFromLearner(row()), "ABSENT", factory);
    const withReason = chooseReason(absent, "TRANSPORT_OR_COST", factory);
    expect(withReason.reasonCode).toBe("TRANSPORT_OR_COST");
    expect(withReason.clientEventId).toBe(absent.clientEventId);
    expect(chooseReason(withReason, "TRANSPORT_OR_COST", factory).reasonCode).toBeNull();

    const present = chooseStatus(withReason, "PRESENT", factory);
    expect(present.reasonCode).toBeNull();
    expect(chooseReason(present, "ILLNESS", factory).reasonCode).toBeNull();

    const excused = chooseStatus(draftFromLearner(row({ id: "learner-3" })), "EXCUSED", factory);
    expect(chooseReason(excused, "FAMILY_CARE", factory).reasonCode).toBe("FAMILY_CARE");
    const late = chooseStatus(excused, "LATE", factory);
    expect(late.reasonCode).toBeNull();
    expect(chooseReason(late, "UNKNOWN", factory)).toMatchObject({ status: "LATE", reasonCode: null });
  });

  it("accepts the five reasons and rejects any other reason or status", () => {
    const base = {
      learnerId: "00000000-0000-4000-8000-000000000001",
      clientEventId: "kiosk-test-valid-reason",
      recordedAt: null,
    };
    for (const reasonCode of [
      "ILLNESS",
      "FAMILY_CARE",
      "TRANSPORT_OR_COST",
      "FAMILY_CIRCUMSTANCES_NOT_RECORDED",
      "UNKNOWN",
      null,
    ] as const) {
      expect(normalizeAttendanceBatch([{ ...base, status: "ABSENT", reasonCode }]).ok).toBe(true);
      expect(normalizeAttendanceBatch([{ ...base, clientEventId: "kiosk-test-excused-1", status: "EXCUSED", reasonCode }]).ok).toBe(
        true,
      );
    }
    expect(normalizeAttendanceBatch([{ ...base, status: "PRESENT", reasonCode: null }]).ok).toBe(true);
    expect(normalizeAttendanceBatch([{ ...base, status: "LATE", reasonCode: null }]).ok).toBe(true);

    expect(normalizeAttendanceBatch([{ ...base, status: "SKIPPED", reasonCode: null }])).toMatchObject({ ok: false });
    expect(normalizeAttendanceBatch([{ ...base, status: "PRESENT", reasonCode: "ILLNESS" }]).ok).toBe(false);
    expect(normalizeAttendanceBatch([{ ...base, status: "LATE", reasonCode: "UNKNOWN" }]).ok).toBe(false);
    expect(
      normalizeAttendanceBatch([{ ...base, status: "ABSENT", reasonCode: "The uncle was detained last week" }]),
    ).toMatchObject({ ok: false });
    expect(normalizeAttendanceBatch([])).toMatchObject({
      ok: false,
      message: "Choose a status for at least one learner. Learners left unmarked are not saved.",
    });
  });

  it("orders a correction by server receipt time and keeps the earlier event", () => {
    const first: AttendanceEventFact = {
      id: "event-absent",
      clientEventId: "kiosk-test-history-1",
      learnerId: "learner-1",
      learnerName: "Demo Learner 01",
      learnerCode: "LNR-0001",
      status: "ABSENT",
      reasonCode: "ILLNESS",
      recordedByName: "Demo Teacher One",
      syncedAt: new Date("2026-09-21T11:00:00.000Z"),
      recordedAt: new Date("2026-09-23T09:00:00.000Z"),
      createdAt: new Date("2026-09-21T11:00:00.000Z"),
      createdOffline: true,
    };
    const correction: AttendanceEventFact = {
      ...first,
      id: "event-present",
      clientEventId: "kiosk-test-history-2",
      status: "PRESENT",
      reasonCode: null,
      syncedAt: new Date("2026-09-21T17:00:00.000Z"),
      recordedAt: new Date("2026-09-21T09:20:00.000Z"),
      createdAt: new Date("2026-09-21T17:00:00.000Z"),
      createdOffline: false,
    };
    const lines = buildSessionHistory([correction, first], "UTC");
    expect(lines.map((line) => line.id)).toEqual(["event-absent", "event-present"]);
    expect(lines[0]).toMatchObject({ kind: "first", supersedesEventId: null, isCurrent: false });
    expect(lines[1]).toMatchObject({
      kind: "correction",
      supersedesEventId: "event-absent",
      isCurrent: true,
    });
    expect(lines[1]?.summary).toContain("Corrects the earlier Absent mark");
    expect(lines[1]?.summary).toContain("The earlier mark is kept");
    expect(lines[1]?.summary).toContain("Present");
  });
});

describe("attendance kiosk screen", () => {
  function draft(overrides: Partial<LearnerDraft>): LearnerDraft {
    return {
      learnerId: "learner-1",
      displayName: "Demo Learner 01",
      learnerCode: "LNR-0001",
      saved: null,
      status: null,
      reasonCode: null,
      clientEventId: null,
      recordedAt: null,
      ...overrides,
    };
  }

  it("shows unmarked learners apart from marked ones, with large keyboard buttons", () => {
    const html = renderToStaticMarkup(
      <AttendanceSheetView
        learners={[
          draft({ learnerId: "learner-1", displayName: "Demo Learner 01" }),
          draft({
            learnerId: "learner-2",
            displayName: "Demo Learner 02",
            learnerCode: "LNR-0002",
            status: "PRESENT",
            clientEventId: "kiosk-test-screen-1",
            recordedAt: "2026-11-07T01:00:00.000Z",
          }),
        ]}
        cancelled={false}
        saving={false}
        message={null}
        onStatus={() => undefined}
        onReason={() => undefined}
        onSave={() => undefined}
      />,
    );
    const unmarked = html.slice(html.indexOf('id="learner-learner-1"'), html.indexOf('id="learner-learner-2"'));
    const markedStart = html.indexOf('id="learner-learner-2"');
    const marked = html.slice(markedStart, html.indexOf("</article>", markedStart));
    expect(unmarked).toContain("Not marked yet");
    expect(unmarked).toContain("border-dashed");
    expect(marked).toContain("not saved yet");
    expect(marked).not.toContain("Not marked yet");
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("sm:grid-cols-4");
    expect(html).toContain("min-h-16");
    expect(html).toContain("Demo Learner 01");
    expect(html).toContain("Still unmarked");
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(4);
    expect(buttons.every((button) => button.includes('type="button"'))).toBe(true);
    expect(html).not.toContain('tabindex="-1"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("shows only the fixed reason list for an absence, and no free-text box", () => {
    const html = renderToStaticMarkup(
      <AttendanceSheetView
        learners={[draft({ status: "ABSENT" })]}
        cancelled={false}
        saving={false}
        message={null}
        onStatus={() => undefined}
        onReason={() => undefined}
        onSave={() => undefined}
      />,
    );
    for (const reason of [
      "Illness",
      "Family care",
      "Transport or cost",
      "Family circumstances (details not recorded)",
      "Unknown",
    ]) {
      expect(html).toContain(reason);
    }
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<input");
    expect(html).toContain("Reason, optional");

    const present = renderToStaticMarkup(
      <AttendanceSheetView
        learners={[draft({ status: "PRESENT" })]}
        cancelled={false}
        saving={false}
        message={null}
        onStatus={() => undefined}
        onReason={() => undefined}
        onSave={() => undefined}
      />,
    );
    expect(present).not.toContain("Transport or cost");
    expect(present).not.toContain("<textarea");
  });

  it("renders session history as read-only text", () => {
    const html = renderToStaticMarkup(
      <AttendanceHistory
        lines={[
          {
            id: "event-absent",
            learnerId: "learner-1",
            learnerName: "Demo Learner 01",
            learnerCode: "LNR-0001",
            statusLabel: "Absent",
            reasonLabel: null,
            recordedByName: "Demo Teacher One",
            receivedLabel: "21 Sep 2026, 11:00",
            kind: "first",
            summary: "First mark: Absent.",
            supersedesEventId: null,
            isCurrent: false,
          },
          {
            id: "event-present",
            learnerId: "learner-1",
            learnerName: "Demo Learner 01",
            learnerCode: "LNR-0001",
            statusLabel: "Present",
            reasonLabel: null,
            recordedByName: "Demo Teacher One",
            receivedLabel: "21 Sep 2026, 17:00",
            kind: "correction",
            summary: "Corrects the earlier Absent mark. The sheet now shows Present. The earlier mark is kept.",
            supersedesEventId: "event-absent",
            isCurrent: true,
          },
        ]}
      />,
    );
    expect(html.indexOf("First mark: Absent.")).toBeLessThan(html.indexOf("Corrects the earlier Absent mark"));
    expect(html).toContain("The earlier mark is kept");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<input");
  });
});

describe("attendance saves", () => {
  let morningId = "";
  let afternoonId = "";
  let sessionId = "";
  let learners: { id: string; displayName: string }[] = [];
  let teacherOne: Actor;
  let teacherTwo: Actor;
  let teacherThree: Actor;
  let director: Actor;
  let admin: Actor;
  let morningLearner: Actor;

  beforeAll(async () => {
    await snapshotKioskDevices();
    await removeKioskFixtures();
    morningId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    afternoonId = (
      await prisma.section.findFirstOrThrow({
        where: { name: "Afternoon Group", course: { center: { code: "DEMO" } } },
        select: { id: true },
      })
    ).id;
    teacherOne = await actorByEmail("teacher.one@demo.invalid");
    teacherTwo = await actorByEmail("teacher.two@demo.invalid");
    teacherThree = await actorByEmail("teacher.three@demo.invalid");
    director = await actorByEmail("director@demo.invalid");
    admin = await actorByEmail("admin@demo.invalid");
    morningLearner = await learnerByCode("LNR-0001");
    const created = await createTimetableSession(teacherOne, morningId, {
      title: "Kiosk automated test session",
      weekday: "MONDAY",
      startTime: "09:00",
      endTime: "10:00",
      weekOf: "2027-08-02",
      deliveryMode: "IN_PERSON",
      meetingUrl: null,
      linkedResourceId: null,
    });
    if (!created.ok) throw new Error(created.message);
    sessionId = created.sessionId;
    learners = (
      await prisma.enrollment.findMany({
        where: { sectionId: morningId, status: "ACTIVE" },
        select: { learner: { select: { id: true, displayName: true } } },
        orderBy: { learner: { displayName: "asc" } },
      })
    ).map((row) => row.learner);
    if (learners.length < 15) throw new Error("expected the morning class to have at least 15 learners");
  });

  function mark(
    index: number,
    status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED",
    reasonCode: string | null,
    clientEventId: string,
  ) {
    const learner = learners[index];
    if (!learner) throw new Error(`missing learner ${index}`);
    return {
      learnerId: learner.id,
      status,
      reasonCode,
      clientEventId,
      recordedAt: "2026-11-07T01:00:00.000Z",
    };
  }

  async function rowsFor(clientEventId: string) {
    return prisma.attendanceRecord.findMany({
      where: { clientEventId },
      select: { id: true, status: true, reasonCode: true, learnerId: true, sessionId: true },
    });
  }

  it("saves only the learners who were marked", async () => {
    const saved = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(0, "PRESENT", null, "kiosk-test-only-marked"),
    ]);
    expect(saved).toEqual({ ok: true, created: 1, alreadyStored: 0 });
    expect(await rowsFor("kiosk-test-only-marked")).toHaveLength(1);
    const unmarked = await prisma.attendanceRecord.count({
      where: { sessionId, learnerId: learners[1]?.id },
    });
    expect(unmarked).toBe(0);
    const sheet = await readAttendanceSheet(teacherOne, morningId, sessionId);
    expect(sheet.kind).toBe("ok");
    if (sheet.kind !== "ok") return;
    expect(sheet.sheet.learners.find((learner) => learner.id === learners[0]?.id)?.saved?.status).toBe("PRESENT");
    expect(sheet.sheet.learners.find((learner) => learner.id === learners[1]?.id)?.saved).toBeNull();
  });

  it("stores each allowed reason and refuses a reason that is not on the list", async () => {
    const reasons = [
      "ILLNESS",
      "FAMILY_CARE",
      "TRANSPORT_OR_COST",
      "FAMILY_CIRCUMSTANCES_NOT_RECORDED",
      "UNKNOWN",
    ] as const;
    const saved = await recordAttendance(
      teacherOne,
      morningId,
      sessionId,
      reasons.map((reason, index) => mark(index + 2, index === 4 ? "EXCUSED" : "ABSENT", reason, `kiosk-test-reason-${reason}`)),
    );
    expect(saved).toEqual({ ok: true, created: 5, alreadyStored: 0 });
    for (const reason of reasons) {
      const rows = await rowsFor(`kiosk-test-reason-${reason}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reasonCode).toBe(reason);
      expect(rows[0]?.status).toBe(reason === "UNKNOWN" ? "EXCUSED" : "ABSENT");
    }

    const blank = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(7, "ABSENT", null, "kiosk-test-reason-blank"),
    ]);
    expect(blank).toMatchObject({ ok: true, created: 1 });
    expect((await rowsFor("kiosk-test-reason-blank"))[0]?.reasonCode).toBeNull();

    const before = await prisma.attendanceRecord.count({ where: { sessionId } });
    const rejected = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(1, "ABSENT", "family had to move suddenly", "kiosk-test-reason-free-text"),
    ]);
    expect(rejected.ok).toBe(false);
    expect(await rowsFor("kiosk-test-reason-free-text")).toHaveLength(0);
    expect(
      (
        await recordAttendance(teacherOne, morningId, sessionId, [
          mark(1, "PRESENT", "ILLNESS", "kiosk-test-reason-on-present"),
        ])
      ).ok,
    ).toBe(false);
    expect(
      (
        await recordAttendance(teacherOne, morningId, sessionId, [mark(1, "LATE", "UNKNOWN", "kiosk-test-reason-on-late")])
      ).ok,
    ).toBe(false);
    expect(await prisma.attendanceRecord.count({ where: { sessionId } })).toBe(before);
    expect(await prisma.attendanceRecord.count({ where: { sessionId, learnerId: learners[1]?.id } })).toBe(0);
  });

  it("adds a correction as a new row and leaves the original row unchanged", async () => {
    const first = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(8, "ABSENT", "ILLNESS", "kiosk-test-correction-original"),
    ]);
    expect(first).toMatchObject({ ok: true, created: 1 });
    const original = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { clientEventId: "kiosk-test-correction-original" },
    });

    const corrected = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(8, "PRESENT", null, "kiosk-test-correction-next"),
    ]);
    expect(corrected).toMatchObject({ ok: true, created: 1 });

    const still = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: original.id } });
    expect(still.status).toBe("ABSENT");
    expect(still.reasonCode).toBe("ILLNESS");
    expect(still.clientEventId).toBe("kiosk-test-correction-original");

    await expect(
      prisma.attendanceRecord.update({ where: { id: original.id }, data: { status: "LATE" } }),
    ).rejects.toThrow(/append-only/);
    expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: original.id } })).status).toBe("ABSENT");

    const sheet = await readAttendanceSheet(teacherOne, morningId, sessionId);
    expect(sheet.kind).toBe("ok");
    if (sheet.kind !== "ok") return;
    expect(sheet.sheet.learners.find((learner) => learner.id === learners[8]?.id)?.saved?.status).toBe("PRESENT");
    const lines = sheet.sheet.history.filter((line) => line.learnerId === learners[8]?.id);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "first", supersedesEventId: null, isCurrent: false });
    expect(lines[1]).toMatchObject({
      kind: "correction",
      supersedesEventId: original.id,
      isCurrent: true,
    });
    expect(lines[1]?.summary).toContain("earlier mark is kept");
  });

  it("treats the same client event id as one mark and refuses a different mark with that id", async () => {
    const id = "kiosk-test-idempotent-mark";
    const first = await recordAttendance(teacherOne, morningId, sessionId, [mark(9, "LATE", null, id)]);
    expect(first).toEqual({ ok: true, created: 1, alreadyStored: 0 });
    const again = await recordAttendance(teacherOne, morningId, sessionId, [mark(9, "LATE", null, id)]);
    expect(again).toEqual({ ok: true, created: 0, alreadyStored: 1 });
    expect(await rowsFor(id)).toHaveLength(1);

    const clash = await recordAttendance(teacherOne, morningId, sessionId, [mark(9, "ABSENT", null, id)]);
    expect(clash).toMatchObject({ ok: false, code: "conflict" });
    expect(await rowsFor(id)).toEqual([expect.objectContaining({ status: "LATE", reasonCode: null })]);
  });

  it("lets an assigned teacher or the director record, and hides the class from everyone else", async () => {
    const demo = await prisma.attendanceRecord.findFirstOrThrow({
      where: { clientEventId: "demo-att-morning-2-4" },
      select: { sessionId: true, learnerId: true },
    });
    const afternoon = await prisma.classSession.findFirstOrThrow({
      where: { sectionId: afternoonId, title: "Demo session 1" },
      select: { id: true },
    });

    expect((await readAttendanceSheet(teacherTwo, morningId, sessionId)).kind).toBe("hidden");
    expect((await readAttendanceSheet(teacherThree, afternoonId, afternoon.id)).kind).toBe("hidden");
    expect((await readAttendanceSheet(teacherOne, morningId, afternoon.id)).kind).toBe("hidden");
    expect((await readAttendanceSheet(admin, morningId, sessionId)).kind).toBe("hidden");
    expect((await readAttendanceSheet(morningLearner, morningId, sessionId)).kind).toBe("hidden");
    expect(
      (await recordAttendance(teacherTwo, morningId, sessionId, [mark(10, "PRESENT", null, "kiosk-test-blocked-teacher")]))
        .ok,
    ).toBe(false);
    expect(await rowsFor("kiosk-test-blocked-teacher")).toHaveLength(0);

    const directorSaved = await recordAttendance(director, morningId, sessionId, [
      mark(10, "PRESENT", null, "kiosk-test-director"),
    ]);
    expect(directorSaved).toMatchObject({ ok: true, created: 1 });

    const history = await readAttendanceSheet(teacherOne, morningId, demo.sessionId);
    expect(history.kind).toBe("ok");
    if (history.kind !== "ok") return;
    const lines = history.sheet.history.filter((line) => line.learnerId === demo.learnerId);
    expect(lines.map((line) => line.kind)).toEqual(["first", "correction"]);
    expect(lines[0]?.summary).toContain("Absent");
    expect(lines[1]?.summary).toContain("Present");
    expect(lines[1]?.isCurrent).toBe(true);
    expect(history.sheet.learners.find((learner) => learner.id === demo.learnerId)?.saved?.status).toBe("PRESENT");
    expect((await readAttendanceSheet(teacherTwo, morningId, demo.sessionId)).kind).toBe("hidden");
  });

  it("saves through the API once, ignores a family note, and rejects a repeated different mark", async () => {
    holder.actor = teacherOne;
    try {
      const created = await POST(
        new Request("http://local.test/api/attendance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            marks: [
              {
                ...mark(12, "ABSENT", "ILLNESS", "kiosk-test-http-mark"),
                note: "uncle was detained",
                familyDetails: "moved after a raid",
              },
            ],
          }),
        }),
        { params: Promise.resolve({ id: morningId, sessionId }) },
      );
      expect(created.status).toBe(200);
      expect(await created.json()).toEqual({ created: 1, alreadyStored: 0 });
      expect(await rowsFor("kiosk-test-http-mark")).toEqual([
        expect.objectContaining({ status: "ABSENT", reasonCode: "ILLNESS" }),
      ]);

      const replay = await POST(
        new Request("http://local.test/api/attendance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ marks: [mark(12, "ABSENT", "ILLNESS", "kiosk-test-http-mark")] }),
        }),
        { params: Promise.resolve({ id: morningId, sessionId }) },
      );
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ created: 0, alreadyStored: 1 });
      expect(await rowsFor("kiosk-test-http-mark")).toHaveLength(1);

      holder.actor = teacherTwo;
      const blocked = await POST(
        new Request("http://local.test/api/attendance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ marks: [mark(11, "PRESENT", null, "kiosk-test-http-blocked")] }),
        }),
        { params: Promise.resolve({ id: morningId, sessionId }) },
      );
      expect(blocked.status).toBe(404);
      expect(await rowsFor("kiosk-test-http-blocked")).toHaveLength(0);

      holder.actor = null;
      const signedOut = await GET(new Request("http://local.test/api/attendance"), {
        params: Promise.resolve({ id: morningId, sessionId }),
      });
      expect(signedOut.status).toBe(401);

      holder.actor = teacherOne;
      const sheet = await GET(new Request("http://local.test/api/attendance"), {
        params: Promise.resolve({ id: morningId, sessionId }),
      });
      expect(sheet.status).toBe(200);
      const body = (await sheet.json()) as { history: { id: string }[]; learners: { id: string; saved: { status: string } | null }[] };
      expect(body.learners.find((learner) => learner.id === learners[1]?.id)?.saved).toBeNull();
      expect(body.history.some((line) => line.id.length > 0)).toBe(true);
    } finally {
      holder.actor = null;
    }
  });

  it("stores an excused mark with status EXCUSED", async () => {
    const saved = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(13, "EXCUSED", "FAMILY_CARE", "kiosk-test-excused-status"),
    ]);
    expect(saved).toEqual({ ok: true, created: 1, alreadyStored: 0 });
    const rows = await rowsFor("kiosk-test-excused-status");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("EXCUSED");
    expect(rows[0]?.reasonCode).toBe("FAMILY_CARE");
  });

  it("saves exactly the marked learners and leaves everyone else unmarked", async () => {
    const created = await createTimetableSession(teacherOne, morningId, {
      title: "Kiosk coverage count session",
      weekday: "MONDAY",
      startTime: "09:00",
      endTime: "10:00",
      weekOf: "2028-01-03",
      deliveryMode: "IN_PERSON",
      meetingUrl: null,
      linkedResourceId: null,
    });
    if (!created.ok) throw new Error(created.message);
    const marked = [learners[0], learners[1]];
    if (!marked[0] || !marked[1]) throw new Error("missing learners for the count session");
    const saved = await recordAttendance(teacherOne, morningId, created.sessionId, [
      mark(0, "PRESENT", null, "kiosk-test-count-present"),
      mark(1, "LATE", null, "kiosk-test-count-late"),
    ]);
    expect(saved).toEqual({ ok: true, created: 2, alreadyStored: 0 });
    const rows = await prisma.attendanceRecord.findMany({
      where: { sessionId: created.sessionId },
      select: { learnerId: true, status: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.learnerId).sort()).toEqual(marked.map((learner) => learner.id).sort());
    expect(rows.find((row) => row.learnerId === marked[0]?.id)?.status).toBe("PRESENT");
    expect(rows.find((row) => row.learnerId === marked[1]?.id)?.status).toBe("LATE");
    const markedIds = new Set(marked.map((learner) => learner.id));
    for (const learner of learners) {
      if (markedIds.has(learner.id)) continue;
      const extra = await prisma.attendanceRecord.count({
        where: { sessionId: created.sessionId, learnerId: learner.id },
      });
      expect(extra).toBe(0);
    }
  });

  it("rejects two marks that share one save id and writes nothing", async () => {
    const before = await prisma.attendanceRecord.count({ where: { sessionId } });
    const saved = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(2, "PRESENT", null, "kiosk-test-dup-batch"),
      mark(3, "ABSENT", "ILLNESS", "kiosk-test-dup-batch"),
    ]);
    expect(saved).toEqual({
      ok: false,
      code: "invalid",
      message: "Each mark needs its own save id.",
    });
    expect(await rowsFor("kiosk-test-dup-batch")).toHaveLength(0);
    expect(await prisma.attendanceRecord.count({ where: { sessionId } })).toBe(before);
  });

  it("keeps one row when two identical saves arrive together", async () => {
    const calls = [
      recordAttendance(teacherOne, morningId, sessionId, [mark(14, "PRESENT", null, "kiosk-test-race-same")]),
      recordAttendance(teacherOne, morningId, sessionId, [mark(14, "PRESENT", null, "kiosk-test-race-same")]),
    ];
    const settled = await Promise.allSettled(calls);
    const results = settled.map((item) => {
      if (item.status === "rejected") throw item.reason;
      return item.value;
    });
    const created = results.filter((result) => result.ok && result.created === 1);
    const replayed = results.filter((result) => result.ok && result.created === 0 && result.alreadyStored === 1);
    expect(created).toHaveLength(1);
    expect(replayed).toHaveLength(1);
    const rows = await rowsFor("kiosk-test-race-same");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PRESENT");
    expect(rows[0]?.learnerId).toBe(learners[14]?.id);
  });

  it("keeps one row when two different saves reuse one save id together", async () => {
    const calls = [
      recordAttendance(teacherOne, morningId, sessionId, [mark(11, "PRESENT", null, "kiosk-test-race-conflict")]),
      recordAttendance(teacherOne, morningId, sessionId, [mark(11, "ABSENT", "ILLNESS", "kiosk-test-race-conflict")]),
    ];
    const settled = await Promise.allSettled(calls);
    const results = settled.map((item) => {
      if (item.status === "rejected") throw item.reason;
      return item.value;
    });
    const created = results.filter((result) => result.ok && result.created === 1);
    const refused = results.filter((result) => !result.ok && result.code === "conflict");
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const rows = await rowsFor("kiosk-test-race-conflict");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.learnerId).toBe(learners[11]?.id);
    expect(["PRESENT", "ABSENT"]).toContain(rows[0]?.status);
    if (rows[0]?.status === "ABSENT") expect(rows[0]?.reasonCode).toBe("ILLNESS");
    if (rows[0]?.status === "PRESENT") expect(rows[0]?.reasonCode).toBeNull();
  });

  it("reuses one web kiosk device for the same teacher and a different device for another staff member", async () => {
    const teacherBefore = await prisma.device.findMany({
      where: { label: WEB_KIOSK_DEVICE_LABEL, registeredById: teacherOne.id },
      select: { id: true },
    });
    const directorBefore = await prisma.device.findMany({
      where: { label: WEB_KIOSK_DEVICE_LABEL, registeredById: director.id },
      select: { id: true },
    });

    const teacherFirst = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(0, "PRESENT", null, "kiosk-test-device-teacher-a"),
    ]);
    const teacherSecond = await recordAttendance(teacherOne, morningId, sessionId, [
      mark(0, "LATE", null, "kiosk-test-device-teacher-b"),
    ]);
    expect(teacherFirst.ok && teacherSecond.ok).toBe(true);
    const teacherRows = await prisma.attendanceRecord.findMany({
      where: { clientEventId: { in: ["kiosk-test-device-teacher-a", "kiosk-test-device-teacher-b"] } },
      select: { deviceId: true },
    });
    expect(teacherRows).toHaveLength(2);
    expect(teacherRows[0]?.deviceId).toBe(teacherRows[1]?.deviceId);
    const teacherDeviceId = teacherRows[0]?.deviceId;
    if (!teacherDeviceId) throw new Error("missing teacher kiosk device");
    if (teacherBefore.length > 0) {
      expect(teacherBefore.map((device) => device.id)).toContain(teacherDeviceId);
    }
    expect(await prisma.device.count({ where: { label: WEB_KIOSK_DEVICE_LABEL, registeredById: teacherOne.id } })).toBe(
      Math.max(teacherBefore.length, 1),
    );
    const teacherDevice = await prisma.device.findUniqueOrThrow({
      where: { id: teacherDeviceId },
      select: { label: true, registeredById: true, centerId: true },
    });
    expect(teacherDevice).toEqual({
      label: WEB_KIOSK_DEVICE_LABEL,
      registeredById: teacherOne.id,
      centerId: teacherOne.centerId,
    });

    const directorFirst = await recordAttendance(director, morningId, sessionId, [
      mark(12, "PRESENT", null, "kiosk-test-device-director-a"),
    ]);
    const directorSecond = await recordAttendance(director, morningId, sessionId, [
      mark(12, "ABSENT", "ILLNESS", "kiosk-test-device-director-b"),
    ]);
    expect(directorFirst.ok && directorSecond.ok).toBe(true);
    const directorRows = await prisma.attendanceRecord.findMany({
      where: { clientEventId: { in: ["kiosk-test-device-director-a", "kiosk-test-device-director-b"] } },
      select: { deviceId: true },
    });
    expect(directorRows).toHaveLength(2);
    expect(directorRows[0]?.deviceId).toBe(directorRows[1]?.deviceId);
    const directorDeviceId = directorRows[0]?.deviceId;
    if (!directorDeviceId) throw new Error("missing director kiosk device");
    expect(directorDeviceId).not.toBe(teacherDeviceId);
    if (directorBefore.length > 0) {
      expect(directorBefore.map((device) => device.id)).toContain(directorDeviceId);
    }
    expect(await prisma.device.count({ where: { label: WEB_KIOSK_DEVICE_LABEL, registeredById: director.id } })).toBe(
      Math.max(directorBefore.length, 1),
    );
    const directorDevice = await prisma.device.findUniqueOrThrow({
      where: { id: directorDeviceId },
      select: { label: true, registeredById: true, centerId: true },
    });
    expect(directorDevice).toEqual({
      label: WEB_KIOSK_DEVICE_LABEL,
      registeredById: director.id,
      centerId: director.centerId,
    });
  });

  it("does not save attendance for a learner who is not in the class", async () => {
    const outsider = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0016", center: { code: "DEMO" } },
      select: { id: true },
    });
    const enrolled = await prisma.enrollment.count({
      where: { sectionId: morningId, learnerId: outsider.id, status: "ACTIVE" },
    });
    expect(enrolled).toBe(0);
    const before = await prisma.attendanceRecord.count({ where: { sessionId } });
    const saved = await recordAttendance(teacherOne, morningId, sessionId, [
      {
        learnerId: outsider.id,
        status: "PRESENT",
        reasonCode: null,
        clientEventId: "kiosk-test-not-enrolled",
        recordedAt: "2026-11-07T01:00:00.000Z",
      },
    ]);
    expect(saved).toEqual({ ok: false, code: "invalid", message: "That learner is not in this class." });
    expect(await rowsFor("kiosk-test-not-enrolled")).toHaveLength(0);
    expect(await prisma.attendanceRecord.count({ where: { sessionId, learnerId: outsider.id } })).toBe(0);
    expect(await prisma.attendanceRecord.count({ where: { sessionId } })).toBe(before);
  });

  it("does not save attendance for a learner whose enrollment is withdrawn", async () => {
    const withdrawnLearner = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0017", center: { code: "DEMO" } },
      select: { id: true },
    });
    const existing = await prisma.enrollment.findUnique({
      where: { sectionId_learnerId: { sectionId: morningId, learnerId: withdrawnLearner.id } },
      select: { id: true },
    });
    expect(existing).toBeNull();
    const enrollment = await prisma.enrollment.create({
      data: {
        sectionId: morningId,
        learnerId: withdrawnLearner.id,
        status: "WITHDRAWN",
        enrolledOn: new Date("2026-09-01T00:00:00.000Z"),
        withdrawnOn: new Date("2026-10-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    testEnrollmentIds.push(enrollment.id);
    try {
      const before = await prisma.attendanceRecord.count({ where: { sessionId } });
      const saved = await recordAttendance(teacherOne, morningId, sessionId, [
        {
          learnerId: withdrawnLearner.id,
          status: "PRESENT",
          reasonCode: null,
          clientEventId: "kiosk-test-withdrawn",
          recordedAt: "2026-11-07T01:00:00.000Z",
        },
      ]);
      expect(saved).toEqual({ ok: false, code: "invalid", message: "That learner is not in this class." });
      expect(await rowsFor("kiosk-test-withdrawn")).toHaveLength(0);
      expect(await prisma.attendanceRecord.count({ where: { sessionId, learnerId: withdrawnLearner.id } })).toBe(0);
      expect(await prisma.attendanceRecord.count({ where: { sessionId } })).toBe(before);
    } finally {
      await prisma.enrollment.deleteMany({ where: { id: enrollment.id } });
    }
  });
});
