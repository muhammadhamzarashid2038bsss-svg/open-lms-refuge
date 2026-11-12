// Builds the Day 14 scoring request from records the center already holds.
// The Python service receives a learner code and numbers. Nicknames, notes,
// phone numbers, and database ids stay in this process.
//
// Cancelled classes are sent as cancelled so the service can ignore them.
// A blank attendance mark is sent as unmarked. Leaving it out would glue the
// absences on either side into one longer run.
// Enrollment dates are calendar dates. A class or assignment outside that
// window is not this learner's work.

import { formatCivilDate, isValidTimeZone, localDateOfInstant, parseIsoDate, type CivilDate } from "../lms/timetable";

export const LEARNER_CODE = /^[A-Z]{2,12}-[A-Z0-9]{2,16}$/;

const APPROVED_FIELDS = [
  "learner_code",
  "as_of",
  "attendance",
  "assignments",
  "grades",
  "thresholds",
] as const;

export type RiskSessionStatus = "SCHEDULED" | "HELD" | "CANCELLED";
export type RiskAttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export type RiskAssignmentKind = "PAPER" | "DIGITAL" | "BOTH" | "IN_CLASS_EXAM";
export type RiskUploadState = "QUEUED" | "UPLOADING" | "STORED" | "FAILED";

export type RiskSession = {
  id: string;
  startsAt: Date;
  status: RiskSessionStatus;
};

export type RiskAttendanceEvent = {
  id: string;
  sessionId: string;
  status: RiskAttendanceStatus;
  reasonCode: string | null;
  syncedAt: Date;
  createdAt: Date;
};

export type RiskAssignment = {
  id: string;
  kind: RiskAssignmentKind;
  dueAt: Date | null;
  maxPoints: string;
};

export type RiskGrade = {
  id: string;
  assignmentId: string;
  points: string;
  openConflict: boolean;
};

export type RiskSubmission = {
  id: string;
  assignmentId: string;
  uploadState: RiskUploadState;
  updatedAt: Date;
};

export type RiskEnrollmentWindow = {
  enrolledOn: Date;
  withdrawnOn: Date | null;
  sessions: RiskSession[];
  attendance: RiskAttendanceEvent[];
  assignments: RiskAssignment[];
  grades: RiskGrade[];
  submissions: RiskSubmission[];
};

export type SessionMark = {
  session_id: string;
  session_date: string;
  status: "present" | "late" | "absent" | "excused" | "cancelled" | "unmarked";
  family_circumstances: boolean;
};

export type GradeMark = {
  assessment_id: string;
  assessment_date: string | null;
  points: number | null;
  maximum: number | null;
  resolved: boolean;
};

export type ScoreRequest = {
  learner_code: string;
  as_of: string;
  attendance: SessionMark[];
  assignments: { expected: number; missing: number };
  grades: GradeMark[];
  thresholds: { watch: number; high: number };
};

export function acceptableLearnerCode(code: string): boolean {
  // The same shape the scoring service accepts. A personal name does not pass.
  return LEARNER_CODE.test(code) && /\d/.test(code);
}

function civilNumber(date: CivilDate): number {
  return date.year * 10000 + date.month * 100 + date.day;
}

function utcCivil(date: Date): CivilDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function classDay(instant: Date, timeZone: string): CivilDate | null {
  return localDateOfInstant(instant, timeZone);
}

function covers(day: CivilDate, enrolledOn: Date, withdrawnOn: Date | null): boolean {
  // Date-only columns are stored as UTC calendar days, matching staff assignment dates.
  const enrolled = utcCivil(enrolledOn);
  if (civilNumber(day) < civilNumber(enrolled)) return false;
  if (!withdrawnOn) return true;
  return civilNumber(day) <= civilNumber(utcCivil(withdrawnOn));
}

function latestEvent(events: RiskAttendanceEvent[]): RiskAttendanceEvent | null {
  let best: RiskAttendanceEvent | null = null;
  for (const event of events) {
    if (!best) {
      best = event;
      continue;
    }
    const synced = event.syncedAt.getTime() - best.syncedAt.getTime();
    if (synced > 0) best = event;
    else if (synced === 0) {
      const created = event.createdAt.getTime() - best.createdAt.getTime();
      if (created > 0) best = event;
      else if (created === 0 && event.id.localeCompare(best.id) > 0) best = event;
    }
  }
  return best;
}

function latestSubmission(rows: RiskSubmission[]): RiskSubmission | null {
  let best: RiskSubmission | null = null;
  for (const row of rows) {
    if (!best) {
      best = row;
      continue;
    }
    const updated = row.updatedAt.getTime() - best.updatedAt.getTime();
    if (updated > 0 || (updated === 0 && row.id.localeCompare(best.id) > 0)) best = row;
  }
  return best;
}

function decimalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const number = Number(trimmed);
  if (!Number.isFinite(number)) return null;
  return number;
}

function observationId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(4, "0")}`;
}

function expectsFile(kind: RiskAssignmentKind): boolean {
  return kind === "DIGITAL" || kind === "BOTH";
}

export function buildScoreRequest(input: {
  learnerCode: string;
  enrollments: RiskEnrollmentWindow[];
  scoringDate: string;
  timeZone: string;
  now: Date;
  thresholds: { watch: number; high: number };
}): { ok: true; request: ScoreRequest } | { ok: false; reason: "code" | "clock" } {
  if (!acceptableLearnerCode(input.learnerCode)) return { ok: false, reason: "code" };
  if (!isValidTimeZone(input.timeZone) || !parseIsoDate(input.scoringDate)) return { ok: false, reason: "clock" };
  const scoring = parseIsoDate(input.scoringDate);
  if (!scoring) return { ok: false, reason: "clock" };

  const attendanceDrafts: { sortDate: string; sourceId: string; status: SessionMark["status"]; family: boolean }[] = [];
  const gradeDrafts: {
    sortDate: string;
    sourceId: string;
    points: number | null;
    maximum: number | null;
    resolved: boolean;
  }[] = [];
  let expected = 0;
  let missing = 0;

  for (const enrollment of input.enrollments) {
    for (const session of enrollment.sessions) {
      const day = classDay(session.startsAt, input.timeZone);
      if (!day) continue;
      // A class that has not started is not an absence, even on the scoring date.
      if (session.startsAt.getTime() > input.now.getTime()) continue;
      if (civilNumber(day) > civilNumber(scoring)) continue;
      if (!covers(day, enrollment.enrolledOn, enrollment.withdrawnOn)) continue;
      if (session.status === "CANCELLED") {
        attendanceDrafts.push({
          sortDate: formatCivilDate(day),
          sourceId: session.id,
          status: "cancelled",
          family: false,
        });
        continue;
      }
      if (session.status !== "SCHEDULED" && session.status !== "HELD") continue;
      const current = latestEvent(enrollment.attendance.filter((event) => event.sessionId === session.id));
      // One current mark. Older corrections stay in the database and are not sent again.
      const status = current ? current.status : "UNMARKED";
      const family =
        (status === "ABSENT" || status === "EXCUSED") &&
        current?.reasonCode === "FAMILY_CIRCUMSTANCES_NOT_RECORDED";
      attendanceDrafts.push({
        sortDate: formatCivilDate(day),
        sourceId: session.id,
        status: markStatus(status),
        family,
      });
    }

    for (const assignment of enrollment.assignments) {
      if (!assignment.dueAt) continue;
      const due = classDay(assignment.dueAt, input.timeZone);
      if (!due) continue;
      if (civilNumber(due) > civilNumber(scoring)) continue;
      if (!covers(due, enrollment.enrolledOn, enrollment.withdrawnOn)) continue;
      const grade = enrollment.grades.find((item) => item.assignmentId === assignment.id) ?? null;
      const settled = settledMark(grade, assignment.maxPoints);
      if (expectsFile(assignment.kind)) {
        // A file that is still uploading is not finished work. An empty grade is not
        // the same thing as a missing file, so ungraded work is not added as a second count.
        expected += 1;
        const submission = latestSubmission(
          enrollment.submissions.filter((item) => item.assignmentId === assignment.id),
        );
        if (!submission || submission.uploadState !== "STORED") missing += 1;
      } else if (settled) {
        // Paper and exams have no file. A settled mark is finished work.
        // An ungraded paper mark is left out of both counts.
        expected += 1;
      }
      if (!settled && !grade?.openConflict) continue;
      gradeDrafts.push({
        sortDate: formatCivilDate(due),
        sourceId: assignment.id,
        points: settled ? settled.points : null,
        maximum: settled ? settled.maximum : null,
        resolved: settled !== null,
      });
    }
  }

  attendanceDrafts.sort((a, b) => a.sortDate.localeCompare(b.sortDate) || a.sourceId.localeCompare(b.sourceId));
  gradeDrafts.sort((a, b) => a.sortDate.localeCompare(b.sortDate) || a.sourceId.localeCompare(b.sourceId));

  const request: ScoreRequest = {
    learner_code: input.learnerCode,
    as_of: input.scoringDate,
    attendance: attendanceDrafts.map((row, index) => ({
      session_id: observationId("ses", index),
      session_date: row.sortDate,
      status: row.status,
      family_circumstances: row.family,
    })),
    assignments: { expected, missing },
    grades: gradeDrafts.map((row, index) => ({
      assessment_id: observationId("grd", index),
      assessment_date: row.sortDate,
      points: row.points,
      maximum: row.maximum,
      resolved: row.resolved,
    })),
    thresholds: { watch: input.thresholds.watch, high: input.thresholds.high },
  };
  return { ok: true, request };
}

function markStatus(status: RiskAttendanceStatus | "UNMARKED"): SessionMark["status"] {
  switch (status) {
    case "PRESENT":
      return "present";
    case "LATE":
      return "late";
    case "ABSENT":
      return "absent";
    case "EXCUSED":
      return "excused";
    default:
      return "unmarked";
  }
}

function settledMark(
  grade: RiskGrade | null,
  maxPoints: string,
): { points: number; maximum: number } | null {
  if (!grade || grade.openConflict) return null;
  const points = decimalNumber(grade.points);
  const maximum = decimalNumber(maxPoints);
  if (points === null || maximum === null || maximum <= 0 || points > maximum) return null;
  return { points, maximum };
}

/// The JSON object that is safe to send. Used by tests to prove the shape.
export function scoreRequestFields(request: ScoreRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of APPROVED_FIELDS) body[key] = request[key];
  return body;
}
