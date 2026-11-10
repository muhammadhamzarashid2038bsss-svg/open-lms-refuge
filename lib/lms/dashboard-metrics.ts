// LMS-7 measurement rules. The wording teachers see is docs/DASHBOARD_METRICS.md.
// Phone clocks are not used. A classroom phone is often set to the wrong time.
// A cancelled class is left out because the center closed it. That is not an absence.
// An unmarked learner stays unmarked. The teacher may not have reached that row yet.
// A paper mark is not treated as a submitted file. Paper is often collected in class
// and entered later, while a digital file has its own upload state.

import { fileStatusLabel, serverFileStatus } from "./gradebook";
import { clockOfInstant, formatShortDate, isValidTimeZone, localDateOfInstant, type CivilDate } from "./timetable";

export const TRAJECTORY_WINDOW = 8;
export const TRAJECTORY_MINIMUM = 4;
export const TRAJECTORY_THRESHOLD = 10;

const EPSILON = 1e-9;

export const TRAJECTORY_RULE =
  "The trajectory uses the 8 most recent settled marks. It needs at least 4. Each mark is turned into a percent of that assignment's maximum. Marks are ordered by the due date. When there is no due date, they are ordered by the date the assignment was created on the server. The list is split into an earlier half and a later half. When the count is odd, the middle mark is left out of both halves. The middle value of a half is the middle mark when the half has an odd count, or the average of the two middle marks when the half has an even count. Improving means the later middle value is at least 10 percentage points higher and at least two later marks each rose by 10 points. Declining means the later middle value is at least 10 percentage points lower and at least two later marks each fell by 10 points. Anything else with enough marks is Steady. A missing mark, a file with no grade, and an open conflict are left out. One low mark is not enough to call a learner Declining. Attendance is not part of this label.";

export type TrajectoryLabel = "Improving" | "Steady" | "Declining" | "Insufficient data";

export type AssignmentKindName = "PAPER" | "DIGITAL" | "BOTH" | "IN_CLASS_EXAM";

export type UploadStateName = "QUEUED" | "UPLOADING" | "STORED" | "FAILED";

export type AttendanceStatusName = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

export type SessionStatusName = "SCHEDULED" | "HELD" | "CANCELLED";

export type PerformanceInput = {
  now: Date;
  timeZone: string;
  sectionId: string;
  sectionName: string;
  courseTitle: string;
  learners: PerformanceLearner[];
  assignments: PerformanceAssignment[];
  grades: PerformanceGrade[];
  submissions: PerformanceSubmission[];
  sessions: PerformanceSession[];
  attendance: PerformanceAttendance[];
};

export type PerformanceLearner = {
  id: string;
  learnerCode: string;
  displayName: string;
  enrolledOn: Date;
  withdrawnOn: Date | null;
};

export type PerformanceAssignment = {
  id: string;
  title: string;
  kind: AssignmentKindName;
  maxPoints: string;
  dueAt: Date | null;
  createdAt: Date;
};

export type PerformanceGrade = {
  id: string;
  assignmentId: string;
  learnerId: string;
  points: string;
  openConflict: boolean;
};

export type PerformanceSubmission = {
  id: string;
  assignmentId: string;
  learnerId: string;
  uploadState: UploadStateName;
  updatedAt: Date;
  // Server time when this row was stored. Empty until the file arrives.
  // A later retry must not wipe this. The phone clock is not stored here.
  receivedAt: Date | null;
};

export type PerformanceSession = {
  id: string;
  title: string;
  startsAt: Date;
  status: SessionStatusName;
};

export type PerformanceAttendance = {
  id: string;
  sessionId: string;
  learnerId: string;
  status: AttendanceStatusName;
  syncedAt: Date;
  createdAt: Date;
};

export type TrajectoryResult = {
  label: TrajectoryLabel;
  settledCount: number;
  windowCount: number;
  earlierMedian: number | null;
  laterMedian: number | null;
  difference: number | null;
  explanation: string;
};

export type AttendanceRates = {
  eligibleSessions: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  unmarked: number;
  confirmedLabel: string;
  coverageLabel: string;
};

export type FileSummary = {
  expected: number;
  submitted: number;
  overdue: number;
  withDueDate: number;
  overdueLabel: string;
  submittedLabel: string;
};

export type AssignmentPerformanceRow = {
  assignmentId: string;
  title: string;
  kindLabel: string;
  dueLabel: string;
  maxPoints: string;
  pointsLabel: string;
  percentLabel: string;
  gradeStatus: "Graded" | "Awaiting grade" | "Needs review";
  fileStatusLabel: string;
  expectsFile: boolean;
  submittedFile: boolean;
  hasDueDate: boolean;
  overdue: boolean;
};

export type SessionPerformanceRow = {
  sessionId: string;
  title: string;
  whenLabel: string;
  statusLabel: "Present" | "Absent" | "Late" | "Excused" | "Unmarked";
};

export type LearnerReceiptRow = {
  assignmentId: string;
  title: string;
  dueLabel: string;
  result: string;
  receivedOnLabel: string;
};

export type LearnerReceiptTrend = {
  rows: LearnerReceiptRow[];
  receivedByNowLabel: string;
  comparisonNote: string;
  scopeNote: string;
};

export type SectionReceiptRow = {
  assignmentId: string;
  title: string;
  dueLabel: string;
  expectedLabel: string;
  receivedLabel: string;
  rateLabel: string;
};

export type SectionReceiptTrend = {
  rows: SectionReceiptRow[];
  receivedByNowLabel: string;
  comparisonNote: string;
  scopeNote: string;
};

export const RECEIPT_SCOPE_NOTE =
  "Received by now means the server has stored the file, even when it arrived after the due date. This is not an on-time rate. The rate uses learners who are active now. It does not include learners who have left. A learner is expected for a past-due file only when their enrollment date is on or before that due date. The database cannot mark a single assignment as exempt for one learner. Future assignments and assignments with no due date stay outside the rate. At least two past-due file assignments are needed to compare earlier and later results.";

export type LearnerPerformance = {
  id: string;
  learnerCode: string;
  displayName: string;
  gradeAverageLabel: string;
  awaitingGrade: number;
  graded: number;
  needsReview: number;
  files: FileSummary;
  attendance: AttendanceRates;
  cancelledLeftOut: number;
  futureLeftOut: number;
  trajectory: TrajectoryResult;
  rows: AssignmentPerformanceRow[];
  sessions: SessionPerformanceRow[];
  receipts: LearnerReceiptTrend;
};

export type SectionPerformance = {
  sectionId: string;
  sectionName: string;
  courseTitle: string;
  gradeAverageLabel: string;
  learnersInAverage: number;
  awaitingGrade: number;
  needsReview: number;
  files: FileSummary;
  attendance: AttendanceRates;
  cancelledSessions: number;
  futureSessions: number;
  trajectoryCounts: Record<TrajectoryLabel, number>;
  learners: LearnerPerformance[];
  receipts: SectionReceiptTrend;
  rule: string;
  clockLabel: string | null;
};

export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const shown = Object.is(rounded, -0) ? 0 : rounded;
  return `${shown.toFixed(1)}%`;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

export function buildSectionPerformance(input: PerformanceInput): SectionPerformance {
  const clockOk = isValidTimeZone(input.timeZone);
  const assignments = [...input.assignments].sort(compareAssignments);
  const built = input.learners.map((learner) => buildLearner(input, learner, assignments, clockOk));
  const learners = built.map((item) => item.learner);
  const averages = built.flatMap((item) => (item.average === null ? [] : [item.average]));
  const sectionAverage = mean(averages);
  return {
    sectionId: input.sectionId,
    sectionName: input.sectionName,
    courseTitle: input.courseTitle,
    gradeAverageLabel: sectionAverage === null ? "No graded work" : formatPercent(sectionAverage),
    learnersInAverage: averages.length,
    awaitingGrade: learners.reduce((sum, learner) => sum + learner.awaitingGrade, 0),
    needsReview: learners.reduce((sum, learner) => sum + learner.needsReview, 0),
    files: summarizeFiles(learners.map((learner) => learner.files)),
    attendance: sectionAttendance(learners.map((learner) => learner.attendance), clockOk),
    cancelledSessions: input.sessions.filter((session) => session.status === "CANCELLED").length,
    futureSessions: input.sessions.filter((session) => session.status !== "CANCELLED" && session.startsAt.getTime() > input.now.getTime()).length,
    trajectoryCounts: countLabels(learners.map((learner) => learner.trajectory.label)),
    learners,
    receipts: sectionReceipts(input, clockOk),
    rule: TRAJECTORY_RULE,
    clockLabel: clockOk ? null : "The center clock could not be read.",
  };
}

function buildLearner(
  input: PerformanceInput,
  learner: PerformanceLearner,
  assignments: PerformanceAssignment[],
  clockOk: boolean,
): { learner: LearnerPerformance; average: number | null } {
  const rows = assignments.map((assignment) => assignmentRow(input, learner.id, assignment));
  const settled = settledPercents(input, learner.id, assignments);
  const average = mean(settled.map((item) => item.percent));
  const attendance = clockOk
    ? learnerAttendance(input, learner)
    : {
        rates: emptyAttendance("The center clock could not be read."),
        sessions: [],
        cancelledLeftOut: 0,
        futureLeftOut: 0,
      };
  return {
    average,
    learner: {
    id: learner.id,
    learnerCode: learner.learnerCode,
    displayName: learner.displayName,
    gradeAverageLabel: average === null ? "No graded work" : formatPercent(average),
    awaitingGrade: rows.filter((row) => row.gradeStatus === "Awaiting grade").length,
    graded: rows.filter((row) => row.gradeStatus === "Graded").length,
    needsReview: rows.filter((row) => row.gradeStatus === "Needs review").length,
    files: fileSummary(rows),
    attendance: attendance.rates,
    cancelledLeftOut: attendance.cancelledLeftOut,
    futureLeftOut: attendance.futureLeftOut,
    trajectory: trajectoryFromPercents(settled),
    rows,
    sessions: attendance.sessions,
    receipts: learnerReceipts(input, learner, clockOk),
  },
  };
}

function assignmentRow(input: PerformanceInput, learnerId: string, assignment: PerformanceAssignment): AssignmentPerformanceRow {
  const grade = input.grades.find((item) => item.assignmentId === assignment.id && item.learnerId === learnerId) ?? null;
  const file = expectsFile(assignment.kind) ? latestSubmission(input.submissions, assignment.id, learnerId) : null;
  const percent = grade ? percentOf(grade.points, assignment.maxPoints) : null;
  const fileExpected = expectsFile(assignment.kind);
  const stored = file?.uploadState === "STORED";
  const overdue = fileExpected && assignment.dueAt !== null && assignment.dueAt.getTime() < input.now.getTime() && !stored;
  const fileLabel = fileExpected ? fileStatusLabel(serverFileStatus(file?.uploadState ?? null)) : "Not a file submission";
  return {
    assignmentId: assignment.id,
    title: assignment.title,
    kindLabel: kindLabel(assignment.kind),
    dueLabel: dueLabel(assignment.dueAt, input.timeZone),
    maxPoints: formatPoints(assignment.maxPoints),
    pointsLabel: grade ? formatPoints(grade.points) : "—",
    percentLabel: percent === null ? "—" : formatPercent(percent),
    gradeStatus: grade ? (grade.openConflict ? "Needs review" : "Graded") : "Awaiting grade",
    fileStatusLabel: overdue ? `${fileLabel}. Overdue.` : fileLabel,
    expectsFile: fileExpected,
    submittedFile: fileExpected && stored,
    hasDueDate: assignment.dueAt !== null,
    overdue,
  };
}

function settledPercents(
  input: PerformanceInput,
  learnerId: string,
  assignments: PerformanceAssignment[],
): { percent: number; when: number; createdAt: number; assignmentId: string }[] {
  const settled = [];
  for (const assignment of assignments) {
    const grade = input.grades.find((item) => item.assignmentId === assignment.id && item.learnerId === learnerId);
    if (!grade || grade.openConflict) continue;
    const percent = percentOf(grade.points, assignment.maxPoints);
    if (percent === null) continue;
    const when = assignment.dueAt ?? assignment.createdAt;
    settled.push({
      percent,
      when: when.getTime(),
      createdAt: assignment.createdAt.getTime(),
      assignmentId: assignment.id,
    });
  }
  settled.sort((a, b) => a.when - b.when || a.createdAt - b.createdAt || a.assignmentId.localeCompare(b.assignmentId));
  return settled;
}

export function trajectoryFromPercents(
  settled: readonly { percent: number }[],
): TrajectoryResult {
  const settledCount = settled.length;
  const window = settled.slice(Math.max(0, settled.length - TRAJECTORY_WINDOW));
  if (window.length < TRAJECTORY_MINIMUM) {
    return {
      label: "Insufficient data",
      settledCount,
      windowCount: window.length,
      earlierMedian: null,
      laterMedian: null,
      difference: null,
      explanation: `Insufficient data. ${markCount(settledCount)} ${settledCount === 1 ? "is" : "are"} settled. The trajectory needs 4 settled marks before it chooses Improving, Steady, or Declining. Missing marks, files without a grade, and open conflicts are left out.`,
    };
  }
  const values = dropChronologicalMiddle(window.map((item) => item.percent));
  const mid = values.length / 2;
  const earlier = values.slice(0, mid);
  const later = values.slice(mid);
  const earlierMedian = median(earlier);
  const laterMedian = median(later);
  if (earlierMedian === null || laterMedian === null) {
    return {
      label: "Insufficient data",
      settledCount,
      windowCount: window.length,
      earlierMedian,
      laterMedian,
      difference: null,
      explanation: "Insufficient data. The two halves could not be compared.",
    };
  }
  const difference = laterMedian - earlierMedian;
  const rose = later.filter((value) => gte(value, earlierMedian + TRAJECTORY_THRESHOLD)).length;
  const fell = later.filter((value) => lte(value, earlierMedian - TRAJECTORY_THRESHOLD)).length;
  let label: TrajectoryLabel = "Steady";
  if (gte(difference, TRAJECTORY_THRESHOLD) && rose >= 2) label = "Improving";
  else if (lte(difference, -TRAJECTORY_THRESHOLD) && fell >= 2) label = "Declining";
  const change = `${formatSigned(difference)} percentage points`;
  return {
    label,
    settledCount,
    windowCount: window.length,
    earlierMedian,
    laterMedian,
    difference,
    explanation: `Earlier middle value ${formatPercent(earlierMedian)}. Later middle value ${formatPercent(laterMedian)}. Change ${change}. ${TRAJECTORY_RULE} Label: ${label}.`,
  };
}

function dropChronologicalMiddle(values: number[]): number[] {
  if (values.length % 2 === 0) return values;
  const middle = Math.floor(values.length / 2);
  return values.filter((_, index) => index !== middle);
}

function learnerAttendance(
  input: PerformanceInput,
  learner: PerformanceLearner,
): { rates: AttendanceRates; sessions: SessionPerformanceRow[]; cancelledLeftOut: number; futureLeftOut: number } {
  const counts = { eligibleSessions: 0, present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 };
  const sessions: SessionPerformanceRow[] = [];
  let cancelledLeftOut = 0;
  let futureLeftOut = 0;
  const ordered = [...input.sessions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  for (const session of ordered) {
    if (session.status === "CANCELLED") {
      cancelledLeftOut += 1;
      continue;
    }
    if (session.startsAt.getTime() > input.now.getTime()) {
      futureLeftOut += 1;
      continue;
    }
    if (session.status !== "SCHEDULED" && session.status !== "HELD") continue;
    if (!sessionInEnrollment(session.startsAt, learner, input.timeZone)) continue;
    counts.eligibleSessions += 1;
    const current = latestAttendance(input.attendance.filter((event) => event.sessionId === session.id && event.learnerId === learner.id));
    const statusLabel = current ? statusWord(current.status) : "Unmarked";
    if (statusLabel === "Present") counts.present += 1;
    else if (statusLabel === "Late") counts.late += 1;
    else if (statusLabel === "Absent") counts.absent += 1;
    else if (statusLabel === "Excused") counts.excused += 1;
    else counts.unmarked += 1;
    sessions.push({
      sessionId: session.id,
      title: session.title,
      whenLabel: dueLabel(session.startsAt, input.timeZone),
      statusLabel,
    });
  }
  return { rates: attendanceFromCounts(counts), sessions, cancelledLeftOut, futureLeftOut };
}

export function attendanceFromCounts(counts: Omit<AttendanceRates, "confirmedLabel" | "coverageLabel">): AttendanceRates {
  const marked = counts.present + counts.late + counts.absent + counts.excused;
  return {
    ...counts,
    confirmedLabel: rateLabel(counts.present + counts.late, counts.eligibleSessions, marked),
    coverageLabel: rateLabel(marked, counts.eligibleSessions, marked),
  };
}

function rateLabel(numerator: number, eligible: number, marked: number): string {
  if (eligible === 0) return "No eligible sessions yet";
  if (marked === 0) return "No attendance recorded yet";
  return formatPercent((numerator / eligible) * 100);
}

function emptyAttendance(label: string): AttendanceRates {
  return {
    eligibleSessions: 0,
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    unmarked: 0,
    confirmedLabel: label,
    coverageLabel: label,
  };
}

function latestAttendance(events: PerformanceAttendance[]): PerformanceAttendance | null {
  let best: PerformanceAttendance | null = null;
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

function sessionInEnrollment(startsAt: Date, learner: PerformanceLearner, timeZone: string): boolean {
  const sessionDay = localDateOfInstant(startsAt, timeZone);
  const enrolledDay = localDateOfInstant(learner.enrolledOn, timeZone);
  if (!sessionDay || !enrolledDay) return false;
  if (civilNumber(sessionDay) < civilNumber(enrolledDay)) return false;
  if (!learner.withdrawnOn) return true;
  const withdrawnDay = localDateOfInstant(learner.withdrawnOn, timeZone);
  if (!withdrawnDay) return false;
  return civilNumber(sessionDay) <= civilNumber(withdrawnDay);
}

function fileSummary(rows: AssignmentPerformanceRow[]): FileSummary {
  const fileRows = rows.filter((row) => row.expectsFile);
  return labelFiles({
    expected: fileRows.length,
    submitted: fileRows.filter((row) => row.submittedFile).length,
    overdue: fileRows.filter((row) => row.overdue).length,
    withDueDate: fileRows.filter((row) => row.hasDueDate).length,
  });
}

function summarizeFiles(parts: FileSummary[]): FileSummary {
  return labelFiles({
    expected: parts.reduce((sum, part) => sum + part.expected, 0),
    submitted: parts.reduce((sum, part) => sum + part.submitted, 0),
    overdue: parts.reduce((sum, part) => sum + part.overdue, 0),
    withDueDate: parts.reduce((sum, part) => sum + part.withDueDate, 0),
  });
}

function labelFiles(counts: Omit<FileSummary, "overdueLabel" | "submittedLabel">): FileSummary {
  let overdueLabel = "None overdue";
  if (counts.expected === 0) overdueLabel = "No digital file expected";
  else if (counts.withDueDate === 0) overdueLabel = "No due dates set";
  else if (counts.overdue > 0) overdueLabel = `${counts.overdue} of ${counts.withDueDate}`;
  return {
    ...counts,
    overdueLabel,
    submittedLabel: counts.expected === 0 ? "No digital file expected" : `${counts.submitted} of ${counts.expected}`,
  };
}

function sectionAttendance(parts: AttendanceRates[], clockOk: boolean): AttendanceRates {
  const pooled = attendanceFromCounts(sumAttendance(parts));
  if (clockOk) return pooled;
  return {
    ...pooled,
    confirmedLabel: "The center clock could not be read.",
    coverageLabel: "The center clock could not be read.",
  };
}

function sumAttendance(parts: AttendanceRates[]): Omit<AttendanceRates, "confirmedLabel" | "coverageLabel"> {
  return {
    eligibleSessions: parts.reduce((sum, part) => sum + part.eligibleSessions, 0),
    present: parts.reduce((sum, part) => sum + part.present, 0),
    late: parts.reduce((sum, part) => sum + part.late, 0),
    absent: parts.reduce((sum, part) => sum + part.absent, 0),
    excused: parts.reduce((sum, part) => sum + part.excused, 0),
    unmarked: parts.reduce((sum, part) => sum + part.unmarked, 0),
  };
}

function countLabels(labels: TrajectoryLabel[]): Record<TrajectoryLabel, number> {
  return {
    Improving: labels.filter((label) => label === "Improving").length,
    Steady: labels.filter((label) => label === "Steady").length,
    Declining: labels.filter((label) => label === "Declining").length,
    "Insufficient data": labels.filter((label) => label === "Insufficient data").length,
  };
}

const CLOCK_UNREADABLE = "The center clock could not be read.";

type DueKind = "past" | "future" | "undated";

function fileAssignments(input: PerformanceInput): PerformanceAssignment[] {
  return [...input.assignments].filter((assignment) => expectsFile(assignment.kind)).sort(compareAssignments);
}

function dueKind(assignment: PerformanceAssignment, now: Date): DueKind {
  if (!assignment.dueAt) return "undated";
  return assignment.dueAt.getTime() < now.getTime() ? "past" : "future";
}

// A stored file counts once the server recorded receivedAt. The earliest time
// is the arrival. A later failed retry is a different row and does not erase it.
function earliestReceipt(submissions: PerformanceSubmission[], assignmentId: string, learnerId: string): Date | null {
  let best: Date | null = null;
  for (const submission of submissions) {
    if (submission.assignmentId !== assignmentId || submission.learnerId !== learnerId) continue;
    if (submission.uploadState !== "STORED" || submission.receivedAt === null) continue;
    if (!best || submission.receivedAt.getTime() < best.getTime()) best = submission.receivedAt;
  }
  return best;
}

// Enrollment and due dates are calendar days in the center timezone.
// A learner who joined after the work was already due is not counted as missing it.
function enrolledOnOrBeforeDue(dueAt: Date, learner: PerformanceLearner, timeZone: string): boolean {
  const dueDay = localDateOfInstant(dueAt, timeZone);
  const enrolledDay = localDateOfInstant(learner.enrolledOn, timeZone);
  if (!dueDay || !enrolledDay) return false;
  return civilNumber(enrolledDay) <= civilNumber(dueDay);
}

function learnerReceipts(input: PerformanceInput, learner: PerformanceLearner, clockOk: boolean): LearnerReceiptTrend {
  if (!clockOk) return emptyLearnerReceipts();
  const rows: LearnerReceiptRow[] = [];
  let expected = 0;
  let received = 0;
  let comparable = 0;
  let pastDue = 0;
  for (const assignment of fileAssignments(input)) {
    const kind = dueKind(assignment, input.now);
    const arrived = earliestReceipt(input.submissions, assignment.id, learner.id);
    const expectedForRate = kind === "past" && assignment.dueAt !== null && enrolledOnOrBeforeDue(assignment.dueAt, learner, input.timeZone);
    if (kind === "past") pastDue += 1;
    if (expectedForRate) {
      comparable += 1;
      expected += 1;
      if (arrived) received += 1;
    }
    rows.push({
      assignmentId: assignment.id,
      title: assignment.title,
      dueLabel: dueLabel(assignment.dueAt, input.timeZone),
      result: learnerReceiptResult(kind, expectedForRate, arrived !== null),
      receivedOnLabel: arrived ? receivedOnLabel(arrived, input.timeZone) : "—",
    });
  }
  return {
    rows,
    receivedByNowLabel: receivedByNowLabel(received, expected),
    comparisonNote: comparisonNote(comparable, pastDue),
    scopeNote: RECEIPT_SCOPE_NOTE,
  };
}

function learnerReceiptResult(kind: DueKind, expectedForRate: boolean, arrived: boolean): string {
  if (kind === "undated") return arrived ? "Received" : "No due date";
  if (kind === "future") return arrived ? "Received" : "Not due yet";
  if (!expectedForRate) return "Enrolled after the due date";
  return arrived ? "Received" : "Not received";
}

function sectionReceipts(input: PerformanceInput, clockOk: boolean): SectionReceiptTrend {
  if (!clockOk) return emptySectionReceipts();
  const rows: SectionReceiptRow[] = [];
  let expected = 0;
  let received = 0;
  let comparable = 0;
  let pastDue = 0;
  for (const assignment of fileAssignments(input)) {
    const kind = dueKind(assignment, input.now);
    const arrivals = input.learners.flatMap((learner) => {
      const at = earliestReceipt(input.submissions, assignment.id, learner.id);
      return at ? [at] : [];
    });
    if (kind !== "past" || assignment.dueAt === null) {
      rows.push({
        assignmentId: assignment.id,
        title: assignment.title,
        dueLabel: dueLabel(assignment.dueAt, input.timeZone),
        expectedLabel: "—",
        receivedLabel: String(arrivals.length),
        rateLabel: kind === "undated" ? "No due date" : "Not due yet",
      });
      continue;
    }
    pastDue += 1;
    const dueAt = assignment.dueAt;
    const eligible = input.learners.filter((learner) => enrolledOnOrBeforeDue(dueAt, learner, input.timeZone));
    const receivedCount = eligible.filter((learner) => earliestReceipt(input.submissions, assignment.id, learner.id) !== null).length;
    if (eligible.length > 0) comparable += 1;
    expected += eligible.length;
    received += receivedCount;
    rows.push({
      assignmentId: assignment.id,
      title: assignment.title,
      dueLabel: dueLabel(dueAt, input.timeZone),
      expectedLabel: String(eligible.length),
      receivedLabel: String(receivedCount),
      rateLabel: eligible.length === 0 ? "Not expected" : rateText(receivedCount, eligible.length),
    });
  }
  return {
    rows,
    receivedByNowLabel: receivedByNowLabel(received, expected),
    comparisonNote: comparisonNote(comparable, pastDue),
    scopeNote: RECEIPT_SCOPE_NOTE,
  };
}

function receivedByNowLabel(received: number, expected: number): string {
  if (expected === 0) return "No due file assignments yet";
  return rateText(received, expected);
}

function rateText(received: number, expected: number): string {
  return `${received} of ${expected}, ${formatPercent((received / expected) * 100)}`;
}

function comparisonNote(comparable: number, pastDue: number): string {
  if (comparable >= 2) return "The rows are in due-date order. Compare earlier due dates with later ones.";
  if (comparable === 1) return "One dated file assignment is not enough to compare earlier and later work.";
  if (pastDue > 0) return "No learner was enrolled on or before a due date, so there is nothing to compare yet.";
  return "No due file assignments yet.";
}

function emptyLearnerReceipts(): LearnerReceiptTrend {
  return {
    rows: [],
    receivedByNowLabel: CLOCK_UNREADABLE,
    comparisonNote: CLOCK_UNREADABLE,
    scopeNote: CLOCK_UNREADABLE,
  };
}

function emptySectionReceipts(): SectionReceiptTrend {
  return {
    rows: [],
    receivedByNowLabel: CLOCK_UNREADABLE,
    comparisonNote: CLOCK_UNREADABLE,
    scopeNote: CLOCK_UNREADABLE,
  };
}

function receivedOnLabel(value: Date, timeZone: string): string {
  const local = localDateOfInstant(value, timeZone);
  const clock = clockOfInstant(value, timeZone);
  if (!local || !clock) return CLOCK_UNREADABLE;
  return `${formatShortDate(local)}, ${clock}`;
}

function expectsFile(kind: AssignmentKindName): boolean {
  return kind === "DIGITAL" || kind === "BOTH";
}

function latestSubmission(
  submissions: PerformanceSubmission[],
  assignmentId: string,
  learnerId: string,
): PerformanceSubmission | null {
  let best: PerformanceSubmission | null = null;
  for (const submission of submissions) {
    if (submission.assignmentId !== assignmentId || submission.learnerId !== learnerId) continue;
    if (!best) {
      best = submission;
      continue;
    }
    const updated = submission.updatedAt.getTime() - best.updatedAt.getTime();
    if (updated > 0 || (updated === 0 && submission.id.localeCompare(best.id) > 0)) best = submission;
  }
  return best;
}

function percentOf(points: string, maxPoints: string): number | null {
  const score = Number(points);
  const max = Number(maxPoints);
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
  return (score / max) * 100;
}

function compareAssignments(a: PerformanceAssignment, b: PerformanceAssignment): number {
  const aMissing = a.dueAt === null ? 1 : 0;
  const bMissing = b.dueAt === null ? 1 : 0;
  if (aMissing !== bMissing) return aMissing - bMissing;
  const aDue = a.dueAt?.getTime() ?? 0;
  const bDue = b.dueAt?.getTime() ?? 0;
  if (aDue !== bDue) return aDue - bDue;
  const title = a.title.localeCompare(b.title);
  if (title !== 0) return title;
  return a.id.localeCompare(b.id);
}

function dueLabel(value: Date | null, timeZone: string): string {
  if (!value) return "No due date";
  const local = localDateOfInstant(value, timeZone);
  return local ? formatShortDate(local) : "No due date";
}

function formatPoints(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value;
}

function kindLabel(kind: AssignmentKindName): string {
  switch (kind) {
    case "PAPER":
      return "Paper";
    case "DIGITAL":
      return "Digital";
    case "BOTH":
      return "Both";
    case "IN_CLASS_EXAM":
      return "In-class exam";
  }
}

function statusWord(status: AttendanceStatusName): "Present" | "Absent" | "Late" | "Excused" {
  switch (status) {
    case "PRESENT":
      return "Present";
    case "ABSENT":
      return "Absent";
    case "LATE":
      return "Late";
    case "EXCUSED":
      return "Excused";
  }
}

function civilNumber(date: CivilDate): number {
  return date.year * 10000 + date.month * 100 + date.day;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function gte(value: number, threshold: number): boolean {
  return value + EPSILON >= threshold;
}

function lte(value: number, threshold: number): boolean {
  return value - EPSILON <= threshold;
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const shown = Object.is(rounded, -0) ? 0 : rounded;
  const text = shown.toFixed(1);
  return shown > 0 ? `+${text}` : text;
}

function markCount(count: number): string {
  return `${count} settled ${count === 1 ? "mark" : "marks"}`;
}
