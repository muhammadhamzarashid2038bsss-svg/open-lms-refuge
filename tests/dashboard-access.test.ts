import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import { loadCenterPerformance, loadLearnerPerformance, loadSectionPerformance } from "../lib/data/dashboard";
import { prisma } from "../lib/db";

const now = new Date("2026-11-11T12:00:00.000Z");
const gradeViewsSince = new Date();

describe("dashboard authorization and seeded counts", () => {
  let morningId = "";
  let afternoonId = "";
  let teacherOne: Actor;
  let teacherTwo: Actor;
  let director: Actor;
  let admin: Actor;
  let learner: Actor;
  let morningLearnerId = "";
  let afternoonLearnerId = "";

  afterAll(async () => {
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
          at: { gte: gradeViewsSince },
          metadata: { equals: { source: "online" } },
        },
      });
    });
  });

  beforeAll(async () => {
    const morning = await prisma.section.findFirstOrThrow({
      where: { name: "Morning Group", course: { center: { code: "DEMO" } } },
      select: { id: true },
    });
    const afternoon = await prisma.section.findFirstOrThrow({
      where: { name: "Afternoon Group", course: { center: { code: "DEMO" } } },
      select: { id: true },
    });
    morningId = morning.id;
    afternoonId = afternoon.id;
    teacherOne = await actorByEmail("teacher.one@demo.invalid");
    teacherTwo = await actorByEmail("teacher.two@demo.invalid");
    director = await actorByEmail("director@demo.invalid");
    admin = await actorByEmail("admin@demo.invalid");
    const morningLearner = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { id: true, userId: true },
    });
    const afternoonLearner = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0016", center: { code: "DEMO" } },
      select: { id: true },
    });
    morningLearnerId = morningLearner.id;
    afternoonLearnerId = afternoonLearner.id;
    const loaded = await loadActor(morningLearner.userId);
    if (!loaded) throw new Error("missing learner");
    learner = loaded;
  });

  it("returns nothing for another teacher's section, another center, or a role outside the dashboard", async () => {
    expect(await loadSectionPerformance(teacherTwo, morningId, now)).toBeNull();
    expect(await loadSectionPerformance(teacherOne, afternoonId, now)).toBeNull();
    expect(await loadSectionPerformance(learner, morningId, now)).toBeNull();
    expect(await loadSectionPerformance(admin, morningId, now)).toBeNull();
    expect(await loadSectionPerformance({ ...teacherOne, active: false }, morningId, now)).toBeNull();
    expect(await loadSectionPerformance({ ...director, centerId: "00000000-0000-4000-8000-000000009999" }, morningId, now)).toBeNull();
    expect(await loadLearnerPerformance(teacherOne, morningId, afternoonLearnerId, now)).toBeNull();
    expect(await loadCenterPerformance(teacherOne, now)).toBeNull();
    expect(await loadCenterPerformance(learner, now)).toBeNull();
  });

  it("matches a hand count of the seeded morning attendance for learner LNR-0001", async () => {
    const page = await loadLearnerPerformance(teacherOne, morningId, morningLearnerId, now);
    const directorPage = await loadSectionPerformance(director, morningId, now);
    expect(page).not.toBeNull();
    expect(directorPage).not.toBeNull();
    if (!page || !directorPage) return;

    const enrollment = await prisma.enrollment.findFirstOrThrow({
      where: { sectionId: morningId, learnerId: morningLearnerId, status: "ACTIVE" },
      select: { enrolledOn: true, withdrawnOn: true },
    });
    const sessions = await prisma.classSession.findMany({
      where: { sectionId: morningId },
      select: { id: true, status: true, startsAt: true, title: true },
    });
    const events = await prisma.attendanceRecord.findMany({
      where: { learnerId: morningLearnerId, sessionId: { in: sessions.map((session) => session.id) } },
      select: { id: true, sessionId: true, status: true, syncedAt: true, createdAt: true },
    });
    const hand = handAttendance(sessions, events, now, enrollment.enrolledOn, enrollment.withdrawnOn);
    expect(page.learner.attendance.eligibleSessions).toBe(hand.eligible);
    expect(page.learner.attendance.present).toBe(hand.present);
    expect(page.learner.attendance.late).toBe(hand.late);
    expect(page.learner.attendance.absent).toBe(hand.absent);
    expect(page.learner.attendance.excused).toBe(hand.excused);
    expect(page.learner.attendance.unmarked).toBe(hand.unmarked);
    expect(page.learner.attendance.confirmedLabel).toBe(hand.confirmedLabel);
    expect(page.learner.attendance.coverageLabel).toBe(hand.coverageLabel);
    expect(page.learner.sessions.some((session) => session.statusLabel === "Absent" && session.title.toLowerCase().includes("cancelled"))).toBe(false);

    const demoSessions = sessions.filter((session) => session.title.startsWith("Demo session"));
    const demoHand = handAttendance(demoSessions, events, now, enrollment.enrolledOn, enrollment.withdrawnOn);
    expect(demoSessions).toHaveLength(12);
    expect(demoHand.eligible).toBe(11);
    expect(demoHand.present).toBe(7);
    expect(demoHand.absent).toBe(4);
    expect(demoHand.late).toBe(0);
    expect(demoHand.excused).toBe(0);
    expect(demoHand.unmarked).toBe(0);
    expect(demoHand.confirmedLabel).toBe("63.6%");
    expect(demoHand.coverageLabel).toBe("100.0%");

    const photo = page.learner.rows.find((row) => row.title === "Demo photo homework");
    const paper = page.learner.rows.find((row) => row.title === "Demo paper homework 1");
    expect(paper?.gradeStatus).toBe("Graded");
    expect(paper?.fileStatusLabel).toBe("Not a file submission");
    expect(photo?.fileStatusLabel).toBe("Submitted");
    expect(photo?.gradeStatus).toBe("Graded");
    expect(page.learner.receipts.rows.map((row) => row.title)).not.toContain("Demo paper homework 1");
    expect(page.learner.receipts.rows.find((row) => row.title === "Demo photo homework")).toMatchObject({ result: "Received" });
    expect(page.learner.receipts.rows.find((row) => row.title === "Demo photo homework")?.receivedOnLabel).not.toBe("—");
    expect(page.learner.receipts.scopeNote).toContain("not an on-time rate");
    expect(directorPage.receipts.rows.some((row) => row.title.startsWith("Demo paper"))).toBe(false);

    const center = await loadCenterPerformance(director, now);
    expect(center?.sections.map((section) => section.sectionId)).toEqual(expect.arrayContaining([morningId, afternoonId]));
    expect(directorPage.learners.find((item) => item.id === morningLearnerId)?.attendance.confirmedLabel).toBe(
      page.learner.attendance.confirmedLabel,
    );
  });

  it("shows the queued photo as a file that is not graded as a submission, and leaves the open conflict out", async () => {
    const queuedLearner = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0004", center: { code: "DEMO" } },
      select: { id: true },
    });
    const conflictLearner = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0003", center: { code: "DEMO" } },
      select: { id: true },
    });
    const queued = await loadLearnerPerformance(teacherOne, morningId, queuedLearner.id, now);
    const conflict = await loadLearnerPerformance(teacherOne, morningId, conflictLearner.id, now);
    expect(queued?.learner.rows.find((row) => row.title === "Demo photo homework")).toMatchObject({
      gradeStatus: "Graded",
      fileStatusLabel: "Waiting to upload. Overdue.",
      submittedFile: false,
    });
    expect(queued?.learner.receipts.rows.find((row) => row.title === "Demo photo homework")).toMatchObject({
      result: "Not received",
      receivedOnLabel: "—",
    });
    const open = await prisma.syncConflict.count({
      where: { state: "OPEN", gradeEntry: { learnerId: conflictLearner.id, assignment: { sectionId: morningId } } },
    });
    expect(open).toBeGreaterThan(0);
    expect(conflict?.learner.rows.find((row) => row.title === "Demo paper homework 1")?.gradeStatus).toBe("Needs review");
    if (conflict && conflict.learner.rows.filter((row) => row.title.startsWith("Demo ")).length === 4 && conflict.learner.graded === 3) {
      expect(conflict.learner.trajectory.label).toBe("Insufficient data");
    }
  });
});

function handAttendance(
  sessions: { id: string; status: string; startsAt: Date }[],
  events: { id: string; sessionId: string; status: string; syncedAt: Date; createdAt: Date }[],
  at: Date,
  enrolledOn: Date,
  withdrawnOn: Date | null,
) {
  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;
  let unmarked = 0;
  let eligible = 0;
  for (const session of sessions) {
    if (session.status === "CANCELLED" || session.startsAt.getTime() > at.getTime()) continue;
    if (session.status !== "HELD" && session.status !== "SCHEDULED") continue;
    const day = civilUtc(session.startsAt);
    if (day < civilUtc(enrolledOn)) continue;
    if (withdrawnOn && day > civilUtc(withdrawnOn)) continue;
    eligible += 1;
    const marks = events.filter((event) => event.sessionId === session.id);
    marks.sort((a, b) => a.syncedAt.getTime() - b.syncedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const current = marks.at(-1);
    if (!current) unmarked += 1;
    else if (current.status === "PRESENT") present += 1;
    else if (current.status === "LATE") late += 1;
    else if (current.status === "ABSENT") absent += 1;
    else if (current.status === "EXCUSED") excused += 1;
  }
  const marked = present + late + absent + excused;
  const confirmedLabel = eligible === 0 ? "No eligible sessions yet" : marked === 0 ? "No attendance recorded yet" : formatHand((present + late) / eligible);
  const coverageLabel = eligible === 0 ? "No eligible sessions yet" : marked === 0 ? "No attendance recorded yet" : formatHand(marked / eligible);
  return { eligible, present, late, absent, excused, unmarked, confirmedLabel, coverageLabel };
}

function formatHand(rate: number): string {
  return `${(Math.round(rate * 1000) / 10).toFixed(1)}%`;
}

function civilUtc(date: Date): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}
