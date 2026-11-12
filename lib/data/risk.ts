// Director scoring and check-in suggestions.
// The Python service is called from here, on the server, with a shared key.
// A failed call does not invent a score and does not delete an older flag.
// One learner's failure does not roll back the learners already saved.

import { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../auth/permissions";
import { canManageCenterRisk, canViewRiskSuggestions } from "../auth/permissions";
import { prisma } from "../db";
import { formatCivilDate, formatShortDate, isValidTimeZone, localDateOfInstant, parseIsoDate } from "../lms/timetable";
import { scoreLearner, scoreAgreesWithThresholds, RiskServiceError, type ParsedScore } from "../risk/client";
import {
  buildScoreRequest,
  type RiskAssignmentKind,
  type RiskAttendanceStatus,
  type RiskEnrollmentWindow,
  type RiskSessionStatus,
  type RiskUploadState,
  type ScoreRequest,
} from "../risk/payload";
import {
  RISK_DENIED,
  RISK_FLAG_DENIED,
  RISK_UNAVAILABLE,
  cleanOperationalNote,
  dismissLabel,
  parseDismissReason,
  parseThresholds,
  validIdempotencyKey,
  type DismissReason,
} from "../risk/rules";
import { recordRiskFlagAudit, writeAuditEvent } from "./audit";

const CALCULATION_VERSION = "day14-v1";

export type RiskScorer = (request: ScoreRequest) => Promise<ParsedScore>;

export type RiskRunResult =
  | { ok: true; message: string; complete: boolean }
  | { ok: false; message: string; complete: false };

export type SuggestionCard = {
  id: string;
  nickname: string;
  level: "WATCH" | "HIGH" | "INSUFFICIENT_DATA" | "NONE";
  levelLabel: string;
  scoreLabel: string;
  reasons: string[];
  checkInSuggested: boolean;
  scoringDate: string;
  status: "OPEN" | "CHECK_IN_DONE" | "DISMISSED";
  statusLabel: string;
  dismissLabel: string | null;
  note: string | null;
  actionable: boolean;
};

export type SuggestionPage = {
  watch: number;
  high: number;
  belowWatch: number;
  suggestions: SuggestionCard[];
  earlier: SuggestionCard[];
};

type FlagRow = {
  id: string;
  learnerId: string;
  score: Prisma.Decimal | null;
  level: "INSUFFICIENT_DATA" | "NONE" | "WATCH" | "HIGH";
  reasons: string[];
  checkInSuggested: boolean;
  scoringDate: Date | null;
  status: "OPEN" | "CHECK_IN_DONE" | "DISMISSED";
  dismissReason: DismissReason | null;
  checkInNote: string | null;
  createdAt: Date;
  learner: { displayName: string };
};

export async function listRiskSuggestions(actor: Actor): Promise<SuggestionPage | null> {
  if (!canViewRiskSuggestions(actor)) return null;
  const center = await prisma.center.findUnique({
    where: { id: actor.centerId },
    select: { id: true, watchRiskThreshold: true, highRiskThreshold: true },
  });
  if (!center) return null;
  const flags = await prisma.riskFlag.findMany({
    where: { centerId: actor.centerId },
    select: {
      id: true,
      learnerId: true,
      score: true,
      level: true,
      reasons: true,
      checkInSuggested: true,
      scoringDate: true,
      status: true,
      dismissReason: true,
      checkInNote: true,
      createdAt: true,
      learner: { select: { displayName: true } },
    },
    orderBy: [{ scoringDate: "desc" }, { createdAt: "desc" }],
  });
  // One screen view. Not one audit row per learner.
  await prisma.$transaction(async (tx) => {
    await writeAuditEvent(tx, {
      actor,
      action: "VIEW",
      entityType: "RISK_FLAG",
      entityId: "check-in-suggestions",
      metadata: { source: "risk-suggestions", learnerCount: flags.length },
    });
  });
  return {
    watch: center.watchRiskThreshold,
    high: center.highRiskThreshold,
    ...groupFlags(flags),
  };
}

export async function runCenterRiskScoring(
  actor: Actor,
  input: { idempotencyKey: string; now?: Date; scorer?: RiskScorer },
): Promise<RiskRunResult> {
  if (!canManageCenterRisk(actor, actor.centerId)) return { ok: false, message: RISK_DENIED, complete: false };
  if (!validIdempotencyKey(input.idempotencyKey)) {
    return { ok: false, message: "The assessment could not be started. Refresh the page and try again.", complete: false };
  }
  const now = input.now ?? new Date();
  const scorer = input.scorer ?? ((request: ScoreRequest) => scoreLearner(request));
  const center = await prisma.center.findUnique({
    where: { id: actor.centerId },
    select: { id: true, timezone: true, watchRiskThreshold: true, highRiskThreshold: true },
  });
  if (!center || !isValidTimeZone(center.timezone)) {
    return { ok: false, message: "The center clock could not be read. No new suggestions were saved.", complete: false };
  }
  const scoringDay = localDateOfInstant(now, center.timezone);
  if (!scoringDay) {
    return { ok: false, message: "The center clock could not be read. No new suggestions were saved.", complete: false };
  }
  const scoringDate = formatCivilDate(scoringDay);
  const thresholds = { watch: center.watchRiskThreshold, high: center.highRiskThreshold };
  const profiles = await loadProfiles(actor.centerId);
  let runId: string | null = null;
  try {
    const run = await openRun({
      centerId: actor.centerId,
      actorId: actor.id,
      idempotencyKey: input.idempotencyKey,
      scoringDate,
      learnerCount: profiles.length,
      thresholds,
    });
    runId = run.id;
    await prisma.$transaction(async (tx) => {
      await writeAuditEvent(tx, {
        actor,
        action: "CREATE",
        entityType: "RISK_FLAG",
        entityId: run.id,
        metadata: {
          source: "risk-scoring",
          status: "STARTED",
          learnerCount: profiles.length,
          clientMutationId: input.idempotencyKey,
          calculationVersion: CALCULATION_VERSION,
        },
      });
    });

    let unscored = 0;
    let serviceFailures = 0;
    let attempted = 0;
    for (const profile of profiles) {
      const existing = await prisma.riskFlag.findFirst({
        where: { scoringRunId: run.id, learnerId: profile.learnerId },
        select: { id: true },
      });
      // A retry must not reset Check-in done or Dismiss on the flag already saved.
      if (existing) continue;
      const built = buildScoreRequest({
        learnerCode: profile.learnerCode,
        enrollments: profile.enrollments,
        scoringDate,
        timeZone: center.timezone,
        now,
        thresholds,
      });
      if (!built.ok) {
        unscored += 1;
        continue;
      }
      attempted += 1;
      let parsed: ParsedScore;
      try {
        parsed = await scorer(built.request);
      } catch (error) {
        unscored += 1;
        if (error instanceof RiskServiceError || !(error instanceof Error)) serviceFailures += 1;
        else serviceFailures += 1;
        continue;
      }
      if (parsed.learnerCode !== built.request.learner_code || !scoreAgreesWithThresholds(parsed, thresholds)) {
        unscored += 1;
        serviceFailures += 1;
        continue;
      }
      try {
        await prisma.riskFlag.create({ data: flagData(run.id, profile.learnerId, actor.centerId, parsed, scoringDate) });
      } catch (error) {
        if (!isUnique(error)) throw error;
      }
    }

    const savedCount = await prisma.riskFlag.count({ where: { scoringRunId: run.id } });
    const status = unscored === 0 ? "COMPLETED" : savedCount > 0 ? "PARTIAL" : "FAILED";
    await prisma.riskScoringRun.update({
      where: { id: run.id },
      data: { status, savedCount, unscoredCount: unscored, completedAt: new Date() },
    });
    await prisma.$transaction(async (tx) => {
      await writeAuditEvent(tx, {
        actor,
        action: "UPDATE_RISK_FLAG",
        entityType: "RISK_FLAG",
        entityId: run.id,
        metadata: {
          source: "risk-scoring",
          status,
          learnerCount: profiles.length,
          savedCount,
          unscoredCount: unscored,
          calculationVersion: CALCULATION_VERSION,
        },
      });
    });

    if (savedCount === 0 && attempted > 0 && serviceFailures === attempted) {
      return { ok: false, message: RISK_UNAVAILABLE, complete: false };
    }
    const insufficient = await prisma.riskFlag.count({
      where: { scoringRunId: run.id, level: "INSUFFICIENT_DATA" },
    });
    const message = [
      `Checked ${profiles.length} ${profiles.length === 1 ? "learner" : "learners"}.`,
      `Saved ${savedCount} ${savedCount === 1 ? "result" : "results"}.`,
      unscored === 0 ? "" : `${unscored} ${unscored === 1 ? "learner" : "learners"} could not be scored.`,
      insufficient === 0
        ? ""
        : insufficient === 1
          ? "1 learner does not have enough information for a score, so that learner is not shown as Watch or High."
          : `${insufficient} learners do not have enough information for a score, so they are not shown as Watch or High.`,
    ]
      .filter(Boolean)
      .join(" ");
    return { ok: true, message, complete: unscored === 0 };
  } catch {
    if (runId) {
      await prisma.riskScoringRun
        .update({ where: { id: runId }, data: { status: "FAILED", completedAt: new Date() } })
        .catch(() => undefined);
    }
    return { ok: false, message: RISK_UNAVAILABLE, complete: false };
  }
}

export async function markCheckInDone(
  actor: Actor,
  flagId: string,
  noteRaw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!canManageCenterRisk(actor, actor.centerId)) return { ok: false, message: RISK_FLAG_DENIED };
  const note = cleanOperationalNote(noteRaw);
  if (!note.ok) return note;
  return prisma.$transaction(async (tx) => {
    const flag = await tx.riskFlag.findFirst({
      where: { id: flagId, centerId: actor.centerId },
      select: { id: true, status: true },
    });
    if (!flag || flag.status !== "OPEN") return { ok: false, message: RISK_FLAG_DENIED };
    await tx.riskFlag.update({
      where: { id: flag.id },
      data: {
        status: "CHECK_IN_DONE",
        checkInNote: note.note,
        dismissReason: null,
        resolvedAt: new Date(),
        resolvedById: actor.id,
      },
    });
    // The note stays on the flag. It is not copied into the audit metadata.
    await recordRiskFlagAudit(tx, actor, flag.id, "CHECK_IN_DONE");
    return { ok: true };
  });
}

export async function dismissRiskFlag(
  actor: Actor,
  flagId: string,
  reasonRaw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!canManageCenterRisk(actor, actor.centerId)) return { ok: false, message: RISK_FLAG_DENIED };
  const reason = parseDismissReason(reasonRaw);
  if (!reason) return { ok: false, message: "Choose a reason from the list." };
  return prisma.$transaction(async (tx) => {
    const flag = await tx.riskFlag.findFirst({
      where: { id: flagId, centerId: actor.centerId },
      select: { id: true, status: true },
    });
    if (!flag || flag.status !== "OPEN") return { ok: false, message: RISK_FLAG_DENIED };
    await tx.riskFlag.update({
      where: { id: flag.id },
      data: {
        status: "DISMISSED",
        dismissReason: reason,
        checkInNote: null,
        resolvedAt: new Date(),
        resolvedById: actor.id,
      },
    });
    // The reason stays on the flag. It is not copied into the audit metadata.
    await recordRiskFlagAudit(tx, actor, flag.id, "DISMISSED");
    return { ok: true };
  });
}

export async function updateRiskThresholds(
  actor: Actor,
  watchRaw: string,
  highRaw: string,
): Promise<{ ok: true; watch: number; high: number } | { ok: false; message: string }> {
  if (!canManageCenterRisk(actor, actor.centerId)) return { ok: false, message: RISK_DENIED };
  const parsed = parseThresholds(watchRaw, highRaw);
  if (!parsed.ok) return parsed;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.center.update({
        where: { id: actor.centerId },
        data: { watchRiskThreshold: parsed.watch, highRiskThreshold: parsed.high },
      });
      await writeAuditEvent(tx, {
        actor,
        action: "UPDATE",
        entityType: "RISK_FLAG",
        entityId: actor.centerId,
        metadata: {
          source: "risk-thresholds",
          watchThreshold: parsed.watch,
          highThreshold: parsed.high,
        },
      });
    });
  } catch {
    return { ok: false, message: "Those levels could not be saved." };
  }
  return { ok: true, watch: parsed.watch, high: parsed.high };
}

async function openRun(input: {
  centerId: string;
  actorId: string;
  idempotencyKey: string;
  scoringDate: string;
  learnerCount: number;
  thresholds: { watch: number; high: number };
}): Promise<{ id: string }> {
  const existing = await prisma.riskScoringRun.findUnique({
    where: { centerId_idempotencyKey: { centerId: input.centerId, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (existing) {
    await prisma.riskScoringRun.update({ where: { id: existing.id }, data: { status: "RUNNING" } });
    return existing;
  }
  try {
    return await prisma.riskScoringRun.create({
      data: {
        centerId: input.centerId,
        idempotencyKey: input.idempotencyKey,
        requestedById: input.actorId,
        scoringDate: isoDate(input.scoringDate),
        status: "RUNNING",
        learnerCount: input.learnerCount,
        calculationVersion: CALCULATION_VERSION,
        watchThreshold: input.thresholds.watch,
        highThreshold: input.thresholds.high,
        weightAbsence: new Prisma.Decimal("0.500"),
        weightMissing: new Prisma.Decimal("0.300"),
        weightGrade: new Prisma.Decimal("0.200"),
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
    const raced = await prisma.riskScoringRun.findUniqueOrThrow({
      where: { centerId_idempotencyKey: { centerId: input.centerId, idempotencyKey: input.idempotencyKey } },
      select: { id: true },
    });
    return raced;
  }
}

function flagData(
  scoringRunId: string,
  learnerId: string,
  centerId: string,
  parsed: ParsedScore,
  scoringDate: string,
): Prisma.RiskFlagCreateInput {
  const level = storedLevel(parsed);
  return {
    learner: { connect: { id: learnerId } },
    center: { connect: { id: centerId } },
    scoringRun: { connect: { id: scoringRunId } },
    score: parsed.score === null ? null : new Prisma.Decimal(parsed.score.toFixed(2)),
    level,
    reasonCodes: reasonCodes(parsed),
    checkInSuggested: parsed.checkInSuggested,
    reasons: parsed.reasons,
    indicatorSnapshot: {
      usableDataPoints: parsed.usableDataPoints,
      minimumUsableDataPoints: parsed.minimumUsableDataPoints,
      absence: parsed.absence,
      missingAssignments: parsed.missing,
      gradeTrend: parsed.gradeTrend,
    },
    scoringDate: isoDate(scoringDate),
    calculationVersion: parsed.calculationVersion,
    weightAbsence: new Prisma.Decimal(parsed.weightAbsence.toFixed(3)),
    weightMissing: new Prisma.Decimal(parsed.weightMissing.toFixed(3)),
    weightGrade: new Prisma.Decimal(parsed.weightGrade.toFixed(3)),
    watchThreshold: Math.round(parsed.watch),
    highThreshold: Math.round(parsed.high),
    absenceAvailable: parsed.absence.available,
    absenceValue: decimalOrNull(parsed.absence.available, parsed.absence.value),
    missingAvailable: parsed.missing.available,
    missingValue: decimalOrNull(parsed.missing.available, parsed.missing.value),
    gradeTrendAvailable: parsed.gradeTrend.available,
    gradeTrendValue: decimalOrNull(parsed.gradeTrend.available, parsed.gradeTrend.value),
    status: "OPEN",
    computedAt: new Date(),
  };
}

function storedLevel(parsed: ParsedScore): "INSUFFICIENT_DATA" | "NONE" | "WATCH" | "HIGH" {
  if (parsed.riskLevel === "Insufficient data") return "INSUFFICIENT_DATA";
  if (parsed.riskLevel === "High") return "HIGH";
  if (parsed.riskLevel === "Watch") return "WATCH";
  return "NONE";
}

function reasonCodes(
  parsed: ParsedScore,
): ("CONSECUTIVE_UNEXCUSED_ABSENCES" | "MISSING_ASSIGNMENTS" | "GRADE_SLOPE" | "CHECK_IN_SUGGESTED")[] {
  const codes: ("CONSECUTIVE_UNEXCUSED_ABSENCES" | "MISSING_ASSIGNMENTS" | "GRADE_SLOPE" | "CHECK_IN_SUGGESTED")[] = [];
  if (parsed.absence.available && (parsed.absence.value ?? 0) > 0) codes.push("CONSECUTIVE_UNEXCUSED_ABSENCES");
  if (parsed.missing.available && (parsed.missing.value ?? 0) > 0) codes.push("MISSING_ASSIGNMENTS");
  if (parsed.gradeTrend.available && (parsed.gradeTrend.value ?? 0) > 0) codes.push("GRADE_SLOPE");
  // The family-circumstances suggestion is not added to the numerical score.
  if (parsed.checkInSuggested) codes.push("CHECK_IN_SUGGESTED");
  return codes;
}

function decimalOrNull(available: boolean, value: number | null): Prisma.Decimal | null {
  if (!available || value === null) return null;
  return new Prisma.Decimal(value.toFixed(4));
}

function isoDate(value: string): Date {
  const parsed = parseIsoDate(value);
  if (!parsed) throw new Error("The scoring date is not a calendar day.");
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function loadProfiles(centerId: string): Promise<
  { learnerId: string; learnerCode: string; enrollments: RiskEnrollmentWindow[] }[]
> {
  const profiles = await prisma.learnerProfile.findMany({
    where: { centerId },
    select: {
      id: true,
      learnerCode: true,
      enrollments: {
        select: {
          enrolledOn: true,
          withdrawnOn: true,
          section: {
            select: {
              sessions: { select: { id: true, startsAt: true, status: true } },
              assignments: { select: { id: true, kind: true, dueAt: true, maxPoints: true } },
            },
          },
        },
      },
      attendanceRecords: {
        select: { id: true, sessionId: true, status: true, reasonCode: true, syncedAt: true, createdAt: true },
      },
      gradeEntries: {
        select: {
          id: true,
          assignmentId: true,
          points: true,
          conflicts: { where: { state: "OPEN" }, select: { id: true } },
        },
      },
      submissions: { select: { id: true, assignmentId: true, uploadState: true, updatedAt: true } },
    },
    orderBy: { learnerCode: "asc" },
  });
  return profiles.map((profile) => ({
    learnerId: profile.id,
    learnerCode: profile.learnerCode,
    enrollments: profile.enrollments.map((enrollment) => {
      const sessionIds = new Set(enrollment.section.sessions.map((session) => session.id));
      const assignmentIds = new Set(enrollment.section.assignments.map((assignment) => assignment.id));
      return {
        enrolledOn: enrollment.enrolledOn,
        withdrawnOn: enrollment.withdrawnOn,
        sessions: enrollment.section.sessions.map((session) => ({
          id: session.id,
          startsAt: session.startsAt,
          status: session.status as RiskSessionStatus,
        })),
        attendance: profile.attendanceRecords
          .filter((event) => sessionIds.has(event.sessionId))
          .map((event) => ({
            id: event.id,
            sessionId: event.sessionId,
            status: event.status as RiskAttendanceStatus,
            reasonCode: event.reasonCode,
            syncedAt: event.syncedAt,
            createdAt: event.createdAt,
          })),
        assignments: enrollment.section.assignments.map((assignment) => ({
          id: assignment.id,
          kind: assignment.kind as RiskAssignmentKind,
          dueAt: assignment.dueAt,
          maxPoints: assignment.maxPoints.toString(),
        })),
        grades: profile.gradeEntries
          .filter((grade) => assignmentIds.has(grade.assignmentId))
          .map((grade) => ({
            id: grade.id,
            assignmentId: grade.assignmentId,
            points: grade.points.toString(),
            openConflict: grade.conflicts.length > 0,
          })),
        submissions: profile.submissions
          .filter((submission) => assignmentIds.has(submission.assignmentId))
          .map((submission) => ({
            id: submission.id,
            assignmentId: submission.assignmentId,
            uploadState: submission.uploadState as RiskUploadState,
            updatedAt: submission.updatedAt,
          })),
      };
    }),
  }));
}

function groupFlags(flags: FlagRow[]): { belowWatch: number; suggestions: SuggestionCard[]; earlier: SuggestionCard[] } {
  const groups = new Map<string, FlagRow[]>();
  for (const flag of flags) {
    const list = groups.get(flag.learnerId) ?? [];
    list.push(flag);
    groups.set(flag.learnerId, list);
  }
  const suggestions: SuggestionCard[] = [];
  const earlier: SuggestionCard[] = [];
  let belowWatch = 0;
  for (const rows of groups.values()) {
    const [latest, ...rest] = rows;
    if (!latest) continue;
    if (showSuggestion(latest)) suggestions.push(toCard(latest, true));
    else belowWatch += 1;
    for (const row of rest) earlier.push(toCard(row, false));
  }
  suggestions.sort((a, b) => a.nickname.localeCompare(b.nickname) || b.scoringDate.localeCompare(a.scoringDate));
  earlier.sort((a, b) => b.scoringDate.localeCompare(a.scoringDate) || a.nickname.localeCompare(b.nickname));
  return { belowWatch, suggestions, earlier };
}

function showSuggestion(flag: FlagRow): boolean {
  if (flag.level === "WATCH" || flag.level === "HIGH" || flag.level === "INSUFFICIENT_DATA") return true;
  if (flag.checkInSuggested) return true;
  return flag.status !== "OPEN";
}

function toCard(flag: FlagRow, current: boolean): SuggestionCard {
  const scoringDate = flag.scoringDate
    ? formatShortDate({
        year: flag.scoringDate.getUTCFullYear(),
        month: flag.scoringDate.getUTCMonth() + 1,
        day: flag.scoringDate.getUTCDate(),
      })
    : "Date not stored";
  return {
    id: flag.id,
    nickname: flag.learner.displayName,
    level: flag.level,
    levelLabel: levelLabel(flag.level),
    scoreLabel: flag.score === null ? "No score" : flag.score.toString(),
    reasons: flag.reasons,
    checkInSuggested: flag.checkInSuggested,
    scoringDate,
    status: flag.status,
    statusLabel: statusLabel(flag),
    dismissLabel: flag.status === "DISMISSED" ? dismissLabel(flag.dismissReason) : null,
    note: current ? flag.checkInNote : null,
    actionable: current && flag.status === "OPEN" && showSuggestion(flag),
  };
}

function levelLabel(level: FlagRow["level"]): string {
  if (level === "HIGH") return "High";
  if (level === "WATCH") return "Watch";
  if (level === "INSUFFICIENT_DATA") return "Insufficient data";
  return "Below Watch";
}

function statusLabel(flag: FlagRow): string {
  if (flag.status === "CHECK_IN_DONE") return "Check-in done";
  if (flag.status === "DISMISSED") return "Dismissed";
  if (flag.checkInSuggested) return "Check-in suggested";
  if (flag.level === "INSUFFICIENT_DATA") return "Insufficient data";
  return "Open";
}
