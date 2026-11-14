// Center totals for one date range. exportCenterCsv is the only public entry
// point: it checks the director or admin, reads PostgreSQL, and writes the
// audit row before returning a file. This function only calculates.
//
// Registered learners are distinct people whose enrollment overlaps the range.
// A second section does not count the same person twice. Retention uses the
// people already enrolled on the first day who are still enrolled on the last.
//
// Attendance numerator: learner-sessions marked Present or Late.
// Attendance denominator: learner-sessions with a recorded status (Present,
// Late, Absent, or Excused). An unmarked session is left out of both, so a
// teacher who did not fill in the sheet does not lower the rate and is not
// counted as an absence. Eligible means Scheduled or Held, the instant is not
// in the future, the center-local day is inside the range and on or before
// today, and the learner's enrollment in that section covers the day.
// Cancelled sessions are left out.
//
// Coverage is recorded marks divided by every eligible learner-session,
// including unmarked ones. The Performance Dashboard uses these same two
// formulas and may say "No attendance recorded yet" or show 0.0% coverage.
// A donor file cannot. Zero learners with a recorded mark is a count of zero,
// and zero is below every center minimum. Saying that nobody was marked, or
// that no class was eligible, would tell the reader that hidden count exactly.
// Those figures use the center's "<" label instead, and they do not show 0
// or 0.0%. A percent is also hidden when either learner group is below the
// minimum, including a rate of 0% or 100%.
//
// Assignment completion uses the evidence the database actually stores.
// Paper and in-class exams are complete only with a settled grade and no open
// conflict. The grade is the only stored evidence; there is no separate
// "handed in" flag. Digital work is complete only when the latest submission
// is stored. Hybrid (BOTH) needs both. An assignment with no due date is not
// in the rate, matching the gradebook rule that an undated task is never overdue.
//
// Dates are calendar dates in the center timezone. The loader converts
// instants before they get here, so a wrong phone clock cannot move a class
// into the range. Enrollment dates are the stored calendar dates, not shifted.

import { formatPercent } from "../lms/dashboard-metrics";
import { formatCivilDate, parseIsoDate } from "../lms/timetable";
import { assertExportServer } from "./guard";
import { acceptableExportLearnerCode, canonicalReportId, learnerPseudonym } from "./pseudonym";
import { assertHighEntropySecret } from "./secret";
import { hideCount, partCanBePublished, suppressCells } from "./suppression";
import {
  AGE_BANDS,
  EXPORT_LIMITATION,
  ExportError,
  GENDERS,
  type AgeBandName,
  type BreakdownDimension,
  type ExportClassMark,
  type ExportEnrollment,
  type ExportFacts,
  type ExportFigure,
  type ExportPerson,
  type ExportRequest,
  type ExportScope,
  type ExportTask,
  type GenderName,
  type GrantExport,
} from "./types";
import { assertExportDocument } from "./whitelist";

const INVALID = "The export could not be built from the center records.";
const COMPLETION_DATE_MISSING = "Completion date missing";
const GENDER_OFF = "Gender is not collected at this center, so it cannot be exported.";
const BREAKDOWN_OFF = "Only age band and gender can be breakdowns.";
const MIN_INVALID = "The small-group minimum must be a whole number from 2 to 100.";
const RANGE_INVALID = "The export dates could not be read.";
const REQUIREMENT_INVALID =
  "A stable pseudonym needs a documented funder requirement id. The default is a new pseudonym for each report.";

const INTERNAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

type Person = { learnerCode: string; ageBand: AgeBandName; gender: GenderName | null };
type Window = {
  learnerCode: string;
  sectionKey: string;
  enrolledOn: string;
  endOn: string | null;
  legacyCompletion: boolean;
};
type Mark = { learnerCode: string; outcome: "confirmed" | "recorded" | "unmarked" };
type TaskRow = { learnerCode: string; complete: boolean };

export function buildGrantExport(input: {
  request: ExportRequest & { reportId: string };
  facts: ExportFacts;
  secret: string;
}): { ok: true; report: GrantExport } | { ok: false; message: string } {
  assertExportServer();
  assertHighEntropySecret(input.secret);
  const request = input.request;
  const min = request.suppressionMin;
  if (!Number.isInteger(min) || min < 2 || min > 100) return { ok: false, message: MIN_INVALID };
  const reportId = canonicalReportId(request.reportId);
  const start = calendarDay(request.periodStart);
  const end = calendarDay(request.periodEnd);
  const asOf = calendarDay(request.asOf);
  if (!reportId || !start || !end || !asOf || start > end) return { ok: false, message: RANGE_INVALID };
  const mode = request.mode ?? "aggregate";
  if (mode !== "aggregate" && mode !== "pseudonymized") return { ok: false, message: INVALID };
  const scope = request.scope ?? { kind: "report" };
  if (!approvedScope(scope)) return { ok: false, message: REQUIREMENT_INVALID };
  const breakdowns = approvedBreakdowns(request.approvedBreakdowns, input.facts.genderEnabled);
  if (!breakdowns.ok) return breakdowns;

  const people = readPeople(input.facts);
  if (!people) return { ok: false, message: INVALID };
  const peopleByCode = new Map(people.map((person) => [person.learnerCode, person]));
  const windows = readWindows(input.facts.enrollments, peopleByCode);
  if (!windows) return { ok: false, message: INVALID };
  const marks = readMarks(input.facts.classes, peopleByCode, windows, start, end, asOf);
  if (!marks) return { ok: false, message: INVALID };
  const tasks = readTasks(input.facts.tasks, peopleByCode, windows, start, end, asOf);
  if (!tasks) return { ok: false, message: INVALID };

  const registered = new Set(windows.filter((window) => overlaps(window, start, end)).map((window) => window.learnerCode));
  const cohort = new Set(windows.filter((window) => covers(window, start)).map((window) => window.learnerCode));
  const retained = new Set(
    [...cohort].filter((code) => windows.some((window) => window.learnerCode === code && covers(window, end))),
  );
  const label = `<${min}`;
  const retainedCount = retained.size;
  const cohortCount = cohort.size;
  const retentionPublished = partCanBePublished(retainedCount, cohortCount, min);
  // A completed row with no completion date might cover this range. Counting
  // it as one day, or as still open, would invent history. Leave it out of the
  // registered count and withhold retention instead of publishing a partial rate.
  const completionDateMissing = windows.some((window) => window.legacyCompletion && window.enrolledOn <= end);

  const report: GrantExport = {
    kind: "grant-export",
    mode,
    reportId,
    periodStart: start,
    periodEnd: end,
    asOf,
    suppressionMin: min,
    pseudonymScope: scope.kind,
    limitation: EXPORT_LIMITATION,
    registeredLearners: hideCount(registered.size, min),
    retentionCohort: completionDateMissing ? COMPLETION_DATE_MISSING : hideCount(cohortCount, min),
    retainedLearners: completionDateMissing ? COMPLETION_DATE_MISSING : retentionPublished ? retainedCount : label,
    retentionRate: completionDateMissing
      ? COMPLETION_DATE_MISSING
      : retentionPublished
        ? formatPercent((retainedCount / cohortCount) * 100)
        : label,
    attendance: attendanceFigures(marks, min, label),
    assignmentCompletion: assignmentFigures(tasks, min, label),
    breakdowns:
      registered.size < min
        ? []
        : breakdowns.dimensions.map((dimension) => ({
            dimension,
            rows: breakdownRows(dimension, registered, peopleByCode, min),
          })),
    learners:
      mode === "pseudonymized" && registered.size >= min
        ? pseudonymRows(registered, reportId, scope, input.secret)
        : [],
  };
  try {
    assertExportDocument(report);
  } catch (error) {
    if (error instanceof ExportError) return { ok: false, message: INVALID };
    throw error;
  }
  return { ok: true, report };
}

function approvedScope(scope: ExportScope): boolean {
  if (scope.kind === "report") return true;
  return scope.kind === "funder" && canonicalReportId(scope.requirementId) !== null;
}

function approvedBreakdowns(
  requested: readonly BreakdownDimension[],
  genderEnabled: boolean,
): { ok: true; dimensions: BreakdownDimension[] } | { ok: false; message: string } {
  const dimensions: BreakdownDimension[] = [];
  for (const dimension of requested) {
    if (dimension !== "ageBand" && dimension !== "gender") return { ok: false, message: BREAKDOWN_OFF };
    if (dimensions.includes(dimension)) continue;
    if (dimension === "gender" && !genderEnabled) return { ok: false, message: GENDER_OFF };
    dimensions.push(dimension);
  }
  return { ok: true, dimensions };
}

function readPeople(facts: ExportFacts): Person[] | null {
  const seen = new Set<string>();
  const people: Person[] = [];
  for (const raw of facts.people) {
    const person = copyPerson(raw, facts.genderEnabled);
    if (!person || seen.has(person.learnerCode)) return null;
    seen.add(person.learnerCode);
    people.push(person);
  }
  return people;
}

function copyPerson(raw: ExportPerson, genderEnabled: boolean): Person | null {
  const learnerCode = raw.learnerCode;
  const ageBand = raw.ageBand;
  if (!acceptableExportLearnerCode(learnerCode)) return null;
  if (!(AGE_BANDS as readonly string[]).includes(ageBand)) return null;
  if (!genderEnabled || raw.gender == null) return { learnerCode, ageBand, gender: null };
  if (!(GENDERS as readonly string[]).includes(raw.gender)) return null;
  return { learnerCode, ageBand, gender: raw.gender };
}

function readWindows(rows: readonly ExportEnrollment[], people: Map<string, Person>): Window[] | null {
  const windows: Window[] = [];
  for (const raw of rows) {
    if (!people.has(raw.learnerCode) || !INTERNAL_KEY.test(raw.sectionKey)) return null;
    const enrolledOn = calendarDay(raw.enrolledOn);
    const withdrawnOn = raw.withdrawnOn === null ? null : calendarDay(raw.withdrawnOn);
    const completedOn = raw.completedOn === null ? null : calendarDay(raw.completedOn);
    if (!enrolledOn || (raw.withdrawnOn !== null && !withdrawnOn) || (raw.completedOn !== null && !completedOn)) return null;
    if ((withdrawnOn && withdrawnOn < enrolledOn) || (completedOn && completedOn < enrolledOn)) return null;
    // ACTIVE stays open. WITHDRAWN ends on withdrawnOn, and that day still counts.
    // COMPLETED ends on completedOn, the same inclusive way. A completed row
    // with no date is legacy data: it is not one day and it is not still open.
    let endOn: string | null;
    let legacyCompletion = false;
    if (raw.status === "ACTIVE") {
      if (withdrawnOn || completedOn) return null;
      endOn = null;
    } else if (raw.status === "WITHDRAWN") {
      if (!withdrawnOn || completedOn) return null;
      endOn = withdrawnOn;
    } else if (raw.status === "COMPLETED") {
      if (withdrawnOn) return null;
      if (completedOn) endOn = completedOn;
      else {
        endOn = null;
        legacyCompletion = true;
      }
    } else {
      return null;
    }
    windows.push({ learnerCode: raw.learnerCode, sectionKey: raw.sectionKey, enrolledOn, endOn, legacyCompletion });
  }
  return windows;
}

function readMarks(
  rows: readonly ExportClassMark[],
  people: Map<string, Person>,
  windows: readonly Window[],
  start: string,
  end: string,
  asOf: string,
): Mark[] | null {
  const seen = new Map<string, string>();
  const marks: Mark[] = [];
  for (const raw of rows) {
    if (!people.has(raw.learnerCode) || !INTERNAL_KEY.test(raw.sessionKey) || !INTERNAL_KEY.test(raw.sectionKey)) return null;
    const sessionOn = calendarDay(raw.sessionOn);
    if (!sessionOn) return null;
    if (!knownStatus(raw.sessionStatus) || !knownMark(raw.mark) || typeof raw.occurred !== "boolean") return null;
    const signature = `${raw.sessionStatus}|${raw.mark ?? ""}|${sessionOn}|${raw.occurred}`;
    const key = `${raw.learnerCode}\0${raw.sessionKey}`;
    const previous = seen.get(key);
    if (previous && previous !== signature) return null;
    seen.set(key, signature);
    if (previous) continue;
    const eligible =
      raw.occurred &&
      (raw.sessionStatus === "SCHEDULED" || raw.sessionStatus === "HELD") &&
      sessionOn >= start &&
      sessionOn <= end &&
      sessionOn <= asOf &&
      windows.some(
        (window) => window.learnerCode === raw.learnerCode && window.sectionKey === raw.sectionKey && covers(window, sessionOn),
      );
    if (!eligible) continue;
    const outcome =
      raw.mark === "PRESENT" || raw.mark === "LATE"
        ? "confirmed"
        : raw.mark === "ABSENT" || raw.mark === "EXCUSED"
          ? "recorded"
          : "unmarked";
    marks.push({ learnerCode: raw.learnerCode, outcome });
  }
  return marks;
}

function readTasks(
  rows: readonly ExportTask[],
  people: Map<string, Person>,
  windows: readonly Window[],
  start: string,
  end: string,
  asOf: string,
): TaskRow[] | null {
  const seen = new Map<string, string>();
  const tasks: TaskRow[] = [];
  for (const raw of rows) {
    if (!people.has(raw.learnerCode) || !INTERNAL_KEY.test(raw.taskKey) || !INTERNAL_KEY.test(raw.sectionKey)) return null;
    const dueOn = calendarDay(raw.dueOn);
    if (!dueOn || !knownKind(raw.kind)) return null;
    if (typeof raw.settledGrade !== "boolean" || typeof raw.storedFile !== "boolean" || typeof raw.duePassed !== "boolean") return null;
    const complete = taskComplete(raw);
    const signature = `${dueOn}|${raw.kind}|${complete}|${raw.duePassed}`;
    const key = `${raw.learnerCode}\0${raw.taskKey}`;
    const previous = seen.get(key);
    if (previous && previous !== signature) return null;
    seen.set(key, signature);
    if (previous) continue;
    const expected =
      raw.duePassed &&
      dueOn >= start &&
      dueOn <= end &&
      dueOn <= asOf &&
      windows.some(
        (window) => window.learnerCode === raw.learnerCode && window.sectionKey === raw.sectionKey && covers(window, dueOn),
      );
    if (!expected) continue;
    tasks.push({ learnerCode: raw.learnerCode, complete });
  }
  return tasks;
}

function attendanceFigures(marks: readonly Mark[], min: number, label: string): GrantExport["attendance"] {
  const byLearner = new Map<string, { eligible: number; marked: number; confirmed: number; gap: boolean; unmarked: boolean }>();
  for (const mark of marks) {
    const row = byLearner.get(mark.learnerCode) ?? { eligible: 0, marked: 0, confirmed: 0, gap: false, unmarked: false };
    row.eligible += 1;
    if (mark.outcome === "unmarked") row.unmarked = true;
    else row.marked += 1;
    if (mark.outcome === "confirmed") row.confirmed += 1;
    // Only a recorded Absent or Excused is a non-confirmation. Unmarked is not.
    if (mark.outcome === "recorded") row.gap = true;
    byLearner.set(mark.learnerCode, row);
  }
  let eligible = 0;
  let marked = 0;
  let confirmed = 0;
  let gapLearners = 0;
  let confirmedLearners = 0;
  let recordedLearners = 0;
  let unmarkedLearners = 0;
  for (const row of byLearner.values()) {
    eligible += row.eligible;
    marked += row.marked;
    confirmed += row.confirmed;
    if (row.gap) gapLearners += 1;
    if (row.confirmed > 0) confirmedLearners += 1;
    if (row.marked > 0) recordedLearners += 1;
    if (row.unmarked) unmarkedLearners += 1;
  }
  const base = byLearner.size;
  // Both learner groups must be large enough. A rate of 0% or 100% means one
  // of those groups is zero, so the rate and the session totals stay hidden.
  // The published eligible count is the marked sessions, the rate's denominator.
  // Coverage uses every eligible session. It is hidden when the recorded group
  // or the unmarked group is below the minimum, which hides 0% and 100%.
  // marked === 0 and eligible === 0 are the same rule: the underlying learner
  // group is zero, so the center's "<min" label is used. Do not divide by zero
  // and do not substitute a sentence that names that exact zero.
  const publish = marked > 0 && base >= min && confirmedLearners >= min && gapLearners >= min;
  const publishCoverage = eligible > 0 && base >= min && recordedLearners >= min && unmarkedLearners >= min;
  return {
    learners: hideCount(base, min),
    confirmed: publish ? confirmed : label,
    eligible: publish ? marked : label,
    rate: publish ? formatPercent((confirmed / marked) * 100) : label,
    coverage: publishCoverage ? formatPercent((marked / eligible) * 100) : label,
  };
}

function assignmentFigures(tasks: readonly TaskRow[], min: number, label: string): GrantExport["assignmentCompletion"] {
  const byLearner = new Map<string, { expected: number; completed: number; anyComplete: boolean; anyIncomplete: boolean }>();
  for (const task of tasks) {
    const row = byLearner.get(task.learnerCode) ?? { expected: 0, completed: 0, anyComplete: false, anyIncomplete: false };
    row.expected += 1;
    if (task.complete) {
      row.completed += 1;
      row.anyComplete = true;
    } else {
      row.anyIncomplete = true;
    }
    byLearner.set(task.learnerCode, row);
  }
  let expected = 0;
  let completed = 0;
  let completers = 0;
  let incompleteLearners = 0;
  for (const row of byLearner.values()) {
    expected += row.expected;
    completed += row.completed;
    if (row.anyComplete) completers += 1;
    if (row.anyIncomplete) incompleteLearners += 1;
  }
  const base = byLearner.size;
  // Completers and learners with any unfinished task are both learner counts.
  // Zero completers is hidden, including the completed-task total of 0.
  const publish = base >= min && completers >= min && incompleteLearners >= min;
  return {
    learners: hideCount(base, min),
    completed: publish ? completed : label,
    expected: publish ? expected : label,
    rate: publish ? formatPercent(expected === 0 ? 0 : (completed / expected) * 100) : label,
  };
}

function breakdownRows(
  dimension: BreakdownDimension,
  registered: ReadonlySet<string>,
  people: Map<string, Person>,
  min: number,
): Array<{ value: string; learners: ExportFigure }> {
  const counts = new Map<string, number>();
  for (const code of registered) {
    const person = people.get(code);
    if (!person) continue;
    const key = dimension === "ageBand" ? person.ageBand : (person.gender ?? "NOT_RECORDED");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const released = suppressCells(
    [...counts.entries()].map(([key, count]) => ({ key, count })),
    min,
  );
  return [...released.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, learners]) => ({ value, learners }));
}

function pseudonymRows(
  registered: ReadonlySet<string>,
  reportId: string,
  scope: ExportScope,
  secret: string,
): Array<{ pseudonym: string }> {
  // Demographics stay in the aggregate tables. Putting age and gender on the
  // same learner row can re-identify someone even when each column, on its
  // own, looks large enough. The caller withholds the whole list when the
  // registered group is below the minimum, because counting the rows would
  // reveal that hidden size.
  const rows: Array<{ pseudonym: string }> = [];
  const seen = new Set<string>();
  for (const learnerCode of registered) {
    const pseudonym = learnerPseudonym({ learnerCode, reportId, scope, secret });
    if (seen.has(pseudonym)) throw new Error(INVALID);
    seen.add(pseudonym);
    rows.push({ pseudonym });
  }
  rows.sort((a, b) => a.pseudonym.localeCompare(b.pseudonym));
  return rows;
}

function taskComplete(task: ExportTask): boolean {
  if (task.kind === "PAPER" || task.kind === "IN_CLASS_EXAM") return task.settledGrade;
  if (task.kind === "DIGITAL") return task.storedFile;
  return task.settledGrade && task.storedFile;
}

function covers(window: Window, date: string): boolean {
  if (window.legacyCompletion) return false;
  if (date < window.enrolledOn) return false;
  if (window.endOn !== null && date > window.endOn) return false;
  return true;
}

function overlaps(window: Window, start: string, end: string): boolean {
  if (window.legacyCompletion) return false;
  if (window.enrolledOn > end) return false;
  if (window.endOn !== null && window.endOn < start) return false;
  return true;
}

function calendarDay(value: string): string | null {
  const parsed = parseIsoDate(value);
  return parsed ? formatCivilDate(parsed) : null;
}

function knownStatus(value: ExportClassMark["sessionStatus"]): boolean {
  return value === "SCHEDULED" || value === "HELD" || value === "CANCELLED";
}

function knownMark(value: ExportClassMark["mark"]): boolean {
  return value === null || value === "PRESENT" || value === "ABSENT" || value === "LATE" || value === "EXCUSED";
}

function knownKind(value: ExportTask["kind"]): boolean {
  return value === "PAPER" || value === "DIGITAL" || value === "BOTH" || value === "IN_CLASS_EXAM";
}
