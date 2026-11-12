import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSecret } from "../lib/auth/password";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import {
  dismissRiskFlag,
  listRiskSuggestions,
  markCheckInDone,
  runCenterRiskScoring,
  updateRiskThresholds,
} from "../lib/data/risk";
import { prisma } from "../lib/db";
import { RiskServiceError, type ParsedScore } from "../lib/risk/client";
import type { ScoreRequest } from "../lib/risk/payload";

const NICKNAME = "SunnyDay15Secret";
const NOTE = "SYNTHETIC-FAMILY-STORY-DAY15";
const PHONE = "+15555550199";
const GRADE_NOTE = "SYNTHETIC-GRADE-NOTE-DAY15";
const CHECK_IN = "Visit Tuesday morning";
const NOW = new Date("2026-04-30T18:00:00.000Z");

const ids: Record<string, string> = {};
const calls: ScoreRequest[] = [];

function scored(request: ScoreRequest, patch: Partial<ParsedScore> = {}): ParsedScore {
  const watch = patch.watch ?? request.thresholds.watch;
  const high = patch.high ?? request.thresholds.high;
  const score = patch.score === undefined ? 50 : patch.score;
  let riskLevel = patch.riskLevel;
  if (riskLevel === undefined) {
    if (score === null) riskLevel = "Insufficient data";
    else if (score >= high) riskLevel = "High";
    else if (score >= watch) riskLevel = "Watch";
    else riskLevel = null;
  }
  return {
    score,
    riskLevel,
    usableDataPoints: 5,
    minimumUsableDataPoints: 3,
    checkInSuggested: false,
    reasons: ["Attendance needs a person to look.", "This is not a prediction."],
    absence: { available: true, value: 1 },
    missing: { available: true, value: 0, missing: 0, expected: 1 },
    gradeTrend: { available: false, value: null },
    calculationVersion: "day14-v1",
    weightAbsence: 0.5,
    weightMissing: 0.3,
    weightGrade: 0.2,
    watch,
    high,
    ...patch,
    learnerCode: request.learner_code,
  };
}

async function actorOf(userId: string): Promise<Actor> {
  const actor = await loadActor(userId);
  if (!actor) throw new Error("missing actor");
  return actor;
}

async function removeCenter(code: string): Promise<void> {
  const center = await prisma.center.findUnique({ where: { code }, select: { id: true } });
  if (!center) return;
  const users = await prisma.user.findMany({ where: { centerId: center.id }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  const sections = await prisma.section.findMany({ where: { course: { centerId: center.id } }, select: { id: true } });
  const sectionIds = sections.map((section) => section.id);
  const sessions = sectionIds.length === 0 ? [] : await prisma.classSession.findMany({ where: { sectionId: { in: sectionIds } }, select: { id: true } });
  const sessionIds = sessions.map((session) => session.id);
  const notes = sectionIds.length === 0 ? [] : await prisma.progressNote.findMany({ where: { sectionId: { in: sectionIds } }, select: { id: true } });
  const noteIds = notes.map((note) => note.id);
  await prisma.riskFlag.deleteMany({ where: { centerId: center.id } });
  await prisma.riskScoringRun.deleteMany({ where: { centerId: center.id } });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    if (sessionIds.length > 0) await tx.attendanceRecord.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.auditLog.deleteMany({ where: { centerId: center.id } });
  });
  if (noteIds.length > 0) {
    await prisma.progressNoteVersion.deleteMany({ where: { progressNoteId: { in: noteIds } } });
    await prisma.progressNote.deleteMany({ where: { id: { in: noteIds } } });
  }
  if (sectionIds.length > 0) await prisma.gradeEntry.deleteMany({ where: { assignment: { sectionId: { in: sectionIds } } } });
  if (sectionIds.length > 0) await prisma.assignment.deleteMany({ where: { sectionId: { in: sectionIds } } });
  if (sessionIds.length > 0) await prisma.classSession.deleteMany({ where: { id: { in: sessionIds } } });
  if (sectionIds.length > 0) await prisma.sectionTeacher.deleteMany({ where: { sectionId: { in: sectionIds } } });
  if (sectionIds.length > 0) await prisma.enrollment.deleteMany({ where: { sectionId: { in: sectionIds } } });
  if (sectionIds.length > 0) await prisma.section.deleteMany({ where: { id: { in: sectionIds } } });
  await prisma.course.deleteMany({ where: { centerId: center.id } });
  await prisma.learnerOptionalContact.deleteMany({ where: { learner: { centerId: center.id } } });
  await prisma.centerOptionalField.deleteMany({ where: { centerId: center.id } });
  await prisma.device.deleteMany({ where: { centerId: center.id } });
  if (userIds.length > 0) await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.$transaction(async (tx) => {
    await tx.learnerProfile.deleteMany({ where: { centerId: center.id } });
    if (userIds.length > 0) await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
  await prisma.center.delete({ where: { id: center.id } });
}

describe("director risk scoring", () => {
  let director: Actor;
  let teacher: Actor;
  let learner: Actor;
  let admin: Actor;
  let otherDirector: Actor;

  beforeAll(async () => {
    await removeCenter("DAY15");
    await removeCenter("DAY15B");
    const passwordHash = hashSecret("day15-password");
    const pinHash = hashSecret("1234");
    const center = await prisma.center.create({
      data: { name: "Day15 Center", code: "DAY15", timezone: "UTC" },
      select: { id: true, watchRiskThreshold: true, highRiskThreshold: true },
    });
    ids.center = center.id;
    expect(center.watchRiskThreshold).toBe(40);
    expect(center.highRiskThreshold).toBe(70);
    async function staff(key: string, role: "ADMIN" | "CENTER_DIRECTOR" | "TEACHER", email: string) {
      const user = await prisma.user.create({
        data: { centerId: center.id, role, email, passwordHash, displayName: key, active: true },
        select: { id: true },
      });
      ids[key] = user.id;
    }
    await staff("director", "CENTER_DIRECTOR", "director@day15.invalid");
    await staff("teacher", "TEACHER", "teacher@day15.invalid");
    await staff("admin", "ADMIN", "admin@day15.invalid");
    const other = await prisma.center.create({
      data: { name: "Day15 Other", code: "DAY15B", timezone: "UTC" },
      select: { id: true },
    });
    ids.other = other.id;
    const otherUser = await prisma.user.create({
      data: {
        centerId: other.id,
        role: "CENTER_DIRECTOR",
        email: "director@day15b.invalid",
        passwordHash,
        displayName: "Other",
        active: true,
      },
      select: { id: true },
    });
    ids.otherDirector = otherUser.id;
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { centerId: center.id, role: "STUDENT", active: true },
        select: { id: true },
      });
      const profile = await tx.learnerProfile.create({
        data: {
          userId: user.id,
          centerId: center.id,
          learnerCode: "LNR-D1501",
          displayName: NICKNAME,
          ageBand: "AGE_12_14",
          pinHash,
        },
        select: { id: true },
      });
      const badUser = await tx.user.create({
        data: { centerId: center.id, role: "STUDENT", active: true },
        select: { id: true },
      });
      const bad = await tx.learnerProfile.create({
        data: {
          userId: badUser.id,
          centerId: center.id,
          learnerCode: "SUNNY",
          displayName: "NameLikeCode",
          ageBand: "AGE_12_14",
          pinHash,
        },
        select: { id: true },
      });
      return { userId: user.id, profileId: profile.id, badId: bad.id };
    });
    ids.learnerUser = created.userId;
    ids.learner = created.profileId;
    ids.badLearner = created.badId;
    ids.device = crypto.randomUUID();
    await prisma.device.create({ data: { id: ids.device, centerId: center.id, label: "Day15 phone" } });
    await prisma.centerOptionalField.create({
      data: { centerId: center.id, fieldKey: "CONTACT_PHONE", enabled: true },
    });
    await prisma.learnerOptionalContact.create({ data: { learnerId: ids.learner, phoneE164: PHONE } });
    const course = await prisma.course.create({
      data: { centerId: center.id, title: "Day15 course", code: "D15", academicYear: 2026, semester: "SEMESTER_1" },
      select: { id: true },
    });
    const section = await prisma.section.create({
      data: { courseId: course.id, name: "Day15 group" },
      select: { id: true },
    });
    ids.section = section.id;
    await prisma.enrollment.create({
      data: { sectionId: section.id, learnerId: ids.learner, enrolledOn: new Date("2026-04-01T00:00:00.000Z"), status: "ACTIVE" },
    });
    const session = await prisma.classSession.create({
      data: {
        sectionId: section.id,
        title: "Day15 class",
        startsAt: new Date("2026-04-06T09:00:00.000Z"),
        endsAt: new Date("2026-04-06T10:00:00.000Z"),
        deliveryMode: "IN_PERSON",
        status: "HELD",
      },
      select: { id: true },
    });
    ids.session = session.id;
    await prisma.attendanceRecord.create({
      data: {
        clientEventId: crypto.randomUUID(),
        learnerId: ids.learner,
        sessionId: session.id,
        status: "ABSENT",
        reasonCode: "FAMILY_CIRCUMSTANCES_NOT_RECORDED",
        deviceId: ids.device,
        recordedById: ids.teacher,
        recordedAt: new Date("2026-04-06T09:00:00.000Z"),
        syncedAt: new Date("2026-04-06T09:05:00.000Z"),
        createdOffline: false,
      },
    });
    const assignment = await prisma.assignment.create({
      data: {
        sectionId: section.id,
        title: "Day15 paper",
        kind: "PAPER",
        dueAt: new Date("2026-04-02T09:00:00.000Z"),
        maxPoints: "10.00",
        createdById: ids.teacher,
      },
      select: { id: true },
    });
    ids.assignment = assignment.id;
    await prisma.gradeEntry.create({
      data: {
        assignmentId: assignment.id,
        learnerId: ids.learner,
        points: "0.00",
        academicNote: GRADE_NOTE,
        recordedById: ids.teacher,
        deviceId: ids.device,
        versionVector: { [ids.device]: 1 },
        deviceRecordedAt: new Date("2026-04-03T00:00:00.000Z"),
        syncedAt: new Date("2026-04-08T00:00:00.000Z"),
        createdOffline: false,
      },
    });
    await prisma.progressNote.create({
      data: {
        learnerId: ids.learner,
        sectionId: section.id,
        authorId: ids.teacher,
        body: NOTE,
        skillGaps: [],
        deviceId: ids.device,
        versionVector: { [ids.device]: 1 },
        deviceRecordedAt: new Date("2026-04-03T00:00:00.000Z"),
        syncedAt: new Date("2026-04-03T00:00:00.000Z"),
        createdOffline: false,
      },
    });
    director = await actorOf(ids.director);
    teacher = await actorOf(ids.teacher);
    learner = await actorOf(ids.learnerUser);
    admin = await actorOf(ids.admin);
    otherDirector = await actorOf(ids.otherDirector);
  });

  afterAll(async () => {
    await removeCenter("DAY15");
    await removeCenter("DAY15B");
  });

  it("saves a real score, skips a bad code, and does not save a failed or mismatched response", async () => {
    const failed = await runCenterRiskScoring(director, {
      idempotencyKey: "day15-fail-1",
      now: NOW,
      scorer: async () => {
        throw new RiskServiceError("unavailable");
      },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.message).not.toContain("ECONNREFUSED");
    expect(await prisma.riskFlag.count({ where: { centerId: ids.center } })).toBe(0);

    calls.length = 0;
    const first = await runCenterRiskScoring(director, {
      idempotencyKey: "day15-run-1",
      now: NOW,
      scorer: async (request) => {
        calls.push(request);
        return scored(request);
      },
    });
    expect(first.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify(calls[0]);
    expect(sent).not.toContain(NICKNAME);
    expect(sent).not.toContain(NOTE);
    expect(sent).not.toContain(PHONE);
    expect(sent).not.toContain(GRADE_NOTE);
    expect(sent).not.toContain(ids.learner);
    expect(sent).not.toContain(ids.session);
    expect(sent).not.toContain(ids.assignment);
    expect(calls[0]?.learner_code).toBe("LNR-D1501");
    expect(calls[0]?.thresholds).toEqual({ watch: 40, high: 70 });
    expect(calls[0]?.attendance[0]?.family_circumstances).toBe(true);
    expect(calls[0]?.grades[0]?.points).toBe(0);
    expect(Object.keys(calls[0] ?? {}).sort()).toEqual([
      "as_of",
      "assignments",
      "attendance",
      "grades",
      "learner_code",
      "thresholds",
    ]);

    const flags = await prisma.riskFlag.findMany({ where: { centerId: ids.center } });
    expect(flags).toHaveLength(1);
    const flag = flags[0];
    expect(flag?.learnerId).toBe(ids.learner);
    expect(Number(flag?.score)).toBe(50);
    expect(flag?.level).toBe("WATCH");
    expect(flag?.calculationVersion).toBe("day14-v1");
    expect(Number(flag?.weightAbsence)).toBe(0.5);
    expect(Number(flag?.weightMissing)).toBe(0.3);
    expect(Number(flag?.weightGrade)).toBe(0.2);
    expect(flag?.watchThreshold).toBe(40);
    expect(flag?.highThreshold).toBe(70);
    expect(flag?.absenceAvailable).toBe(true);
    expect(Number(flag?.absenceValue)).toBe(1);
    expect(flag?.gradeTrendAvailable).toBe(false);
    expect(flag?.gradeTrendValue).toBeNull();
    expect(flag?.status).toBe("OPEN");
    expect(flag?.checkInSuggested).toBe(false);

    const mismatched = await runCenterRiskScoring(director, {
      idempotencyKey: "day15-mismatch",
      now: NOW,
      scorer: async (request) => scored(request, { score: 50, riskLevel: "High" }),
    });
    expect(mismatched.ok).toBe(false);
    expect(await prisma.riskFlag.count({ where: { scoringRun: { idempotencyKey: "day15-mismatch" } } })).toBe(0);

    const retry = await runCenterRiskScoring(director, {
      idempotencyKey: "day15-run-1",
      now: NOW,
      scorer: async () => {
        throw new Error("must not be called for a saved learner, and the bad code is skipped");
      },
    });
    expect(retry.ok).toBe(true);
    expect(await prisma.riskFlag.count({ where: { centerId: ids.center } })).toBe(1);

    const noted = await markCheckInDone(director, flag?.id ?? "", CHECK_IN);
    expect(noted.ok).toBe(true);
    const empty = await markCheckInDone(director, flag?.id ?? "", "   ");
    expect(empty.ok).toBe(false);
    const tooLong = await markCheckInDone(teacher, flag?.id ?? "", "");
    expect(tooLong.ok).toBe(false);
    const afterNote = await prisma.riskFlag.findUniqueOrThrow({ where: { id: flag?.id ?? "" } });
    expect(afterNote.status).toBe("CHECK_IN_DONE");
    expect(afterNote.checkInNote).toBe(CHECK_IN);
    expect(afterNote.resolvedById).toBe(director.id);

    const preserved = await runCenterRiskScoring(director, {
      idempotencyKey: "day15-run-1",
      now: NOW,
      scorer: async () => {
        throw new Error("saved learner");
      },
    });
    expect(preserved.ok).toBe(true);
    const still = await prisma.riskFlag.findUniqueOrThrow({ where: { id: flag?.id ?? "" } });
    expect(still.status).toBe("CHECK_IN_DONE");
    expect(still.checkInNote).toBe(CHECK_IN);

    const second = await runCenterRiskScoring(director, {
      idempotencyKey: "day15-run-2",
      now: NOW,
      scorer: async (request) =>
        scored(request, {
          score: null,
          riskLevel: "Insufficient data",
          checkInSuggested: true,
          absence: { available: false, value: null },
          missing: { available: false, value: null, missing: null, expected: null },
          reasons: ["Check-in suggested. No private details stored."],
          calculationVersion: "day14-v1",
        }),
    });
    expect(second.ok).toBe(true);
    const history = await prisma.riskFlag.findMany({ where: { learnerId: ids.learner }, orderBy: { createdAt: "asc" } });
    expect(history).toHaveLength(2);
    expect(history[0]?.status).toBe("CHECK_IN_DONE");
    expect(history[0]?.checkInNote).toBe(CHECK_IN);
    expect(history[1]?.score).toBeNull();
    expect(history[1]?.level).toBe("INSUFFICIENT_DATA");
    expect(history[1]?.checkInSuggested).toBe(true);
    expect(Number(history[1]?.score ?? 0)).not.toBeGreaterThan(0);

    const dismissed = await dismissRiskFlag(director, history[1]?.id ?? "", "NOT_NEEDED");
    expect(dismissed.ok).toBe(true);
    const guessed = await dismissRiskFlag(director, crypto.randomUUID(), "NOT_NEEDED");
    expect(guessed.ok).toBe(false);
    const cross = await dismissRiskFlag(otherDirector, history[1]?.id ?? "", "DATA_ERROR");
    expect(cross.ok).toBe(false);
    const stored = await prisma.riskFlag.findUniqueOrThrow({ where: { id: history[1]?.id ?? "" } });
    expect(stored.status).toBe("DISMISSED");
    expect(stored.dismissReason).toBe("NOT_NEEDED");

    const page = await listRiskSuggestions(director);
    expect(page?.suggestions.some((card) => card.nickname === NICKNAME)).toBe(true);
    expect(await listRiskSuggestions(teacher)).toBeNull();
    expect(await listRiskSuggestions(learner)).toBeNull();
    expect(await listRiskSuggestions(admin)).toBeNull();
    expect((await listRiskSuggestions(otherDirector))?.suggestions).toEqual([]);

    const audits = await prisma.auditLog.findMany({ where: { centerId: ids.center } });
    const metadata = JSON.stringify(audits.map((row) => row.metadata));
    expect(metadata).not.toContain(NICKNAME);
    expect(metadata).not.toContain(NOTE);
    expect(metadata).not.toContain(PHONE);
    expect(metadata).not.toContain(GRADE_NOTE);
    expect(metadata).not.toContain(CHECK_IN);
    expect(metadata).not.toContain("NOT_NEEDED");
    expect(audits.some((row) => row.action === "VIEW" && row.entityType === "RISK_FLAG")).toBe(true);
    expect(audits.some((row) => row.action === "CREATE" && row.entityType === "RISK_FLAG")).toBe(true);
    expect(audits.some((row) => row.metadata && JSON.stringify(row.metadata).includes("CHECK_IN_DONE"))).toBe(true);
    expect(audits.some((row) => row.metadata && JSON.stringify(row.metadata).includes("DISMISSED"))).toBe(true);
  });

  it("keeps threshold changes inside the director's center and rejects an invalid pair", async () => {
    expect(await updateRiskThresholds(teacher, "30", "80")).toEqual({ ok: false, message: expect.any(String) });
    expect(await updateRiskThresholds(director, "-1", "70")).toMatchObject({ ok: false });
    expect(await updateRiskThresholds(director, "101", "70")).toMatchObject({ ok: false });
    expect(await updateRiskThresholds(director, "70", "70")).toMatchObject({ ok: false });
    expect(await updateRiskThresholds(director, "80", "70")).toMatchObject({ ok: false });
    const other = await updateRiskThresholds(otherDirector, "10", "20");
    expect(other.ok).toBe(true);
    const unchanged = await prisma.center.findUniqueOrThrow({ where: { id: ids.center } });
    expect(unchanged.watchRiskThreshold).toBe(40);
    expect(unchanged.highRiskThreshold).toBe(70);

    const saved = await updateRiskThresholds(director, "55", "90");
    expect(saved).toEqual({ ok: true, watch: 55, high: 90 });
    const run = await runCenterRiskScoring(director, {
      idempotencyKey: "day15-levels",
      now: NOW,
      scorer: async (request) => {
        expect(request.thresholds).toEqual({ watch: 55, high: 90 });
        return scored(request, { score: 50 });
      },
    });
    expect(run.ok).toBe(true);
    const flag = await prisma.riskFlag.findFirstOrThrow({
      where: { scoringRun: { idempotencyKey: "day15-levels" }, learnerId: ids.learner },
    });
    expect(flag.level).toBe("NONE");
    expect(Number(flag.score)).toBe(50);
    expect(flag.watchThreshold).toBe(55);
    expect(flag.highThreshold).toBe(90);
    const older = await prisma.riskFlag.findFirstOrThrow({
      where: { scoringRun: { idempotencyKey: "day15-run-1" } },
    });
    expect(older.watchThreshold).toBe(40);
    expect(older.status).toBe("CHECK_IN_DONE");

    await prisma.user.update({
      where: { id: director.id },
      data: { active: false, deactivatedAt: new Date("2026-04-30T00:00:00.000Z") },
    });
    expect(await loadActor(director.id)).toBeNull();
    const inactive = await runCenterRiskScoring(
      { ...director, active: false },
      {
        idempotencyKey: "day15-inactive",
        now: NOW,
        scorer: async () => {
          throw new Error("inactive");
        },
      },
    );
    expect(inactive.ok).toBe(false);
    await prisma.user.update({ where: { id: director.id }, data: { active: true, deactivatedAt: null } });
  });
});
