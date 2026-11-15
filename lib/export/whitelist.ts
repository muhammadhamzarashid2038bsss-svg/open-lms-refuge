// Fixed server-side allowlist. A field is exportable only when its name is in
// this set. Names, contact details, addresses, birth dates, legal status,
// notes, secrets, learner codes, and database ids are not in the set, so they
// cannot be added by a request parameter.

import {
  AGE_BANDS,
  EXPORT_LIMITATION,
  ExportError,
  GENDERS,
  type GrantExport,
} from "./types";

export const EXPORT_FIELD_WHITELIST = [
  "kind",
  "centerName",
  "mode",
  "reportId",
  "periodStart",
  "periodEnd",
  "asOf",
  "suppressionMin",
  "pseudonymScope",
  "limitation",
  "registeredLearners",
  "retentionCohort",
  "retainedLearners",
  "retentionRate",
  "attendance",
  "learners",
  "confirmed",
  "eligible",
  "rate",
  "coverage",
  "assignmentCompletion",
  "completed",
  "expected",
  "breakdowns",
  "dimension",
  "rows",
  "value",
  "pseudonym",
] as const;

const WHITELIST = new Set<string>(EXPORT_FIELD_WHITELIST);

export const NEVER_EXPORT_FIELDS = [
  "displayName",
  "name",
  "nickname",
  "firstName",
  "lastName",
  "email",
  "phone",
  "phoneE164",
  "contact",
  "address",
  "birthDate",
  "dateOfBirth",
  "immigrationStatus",
  "legalStatus",
  "note",
  "notes",
  "progressNote",
  "academicNote",
  "bodyText",
  "pin",
  "pinHash",
  "password",
  "passwordHash",
  "learnerId",
  "userId",
  "learnerCode",
  "deviceId",
  "clientEventId",
  "taskKey",
  "sessionKey",
  "centerId",
] as const;

const AGE = new Set<string>(AGE_BANDS);
const GENDER = new Set<string>([...GENDERS, "NOT_RECORDED"]);
const PERCENT = /^\d+\.\d%$/;
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PSEUDONYM = /^ps_[0-9a-f]{64}$/;

const TOP_LEVEL = [
  "kind",
  "centerName",
  "mode",
  "reportId",
  "periodStart",
  "periodEnd",
  "asOf",
  "suppressionMin",
  "pseudonymScope",
  "limitation",
  "registeredLearners",
  "retentionCohort",
  "retainedLearners",
  "retentionRate",
  "attendance",
  "assignmentCompletion",
  "breakdowns",
  "learners",
] as const;

export function assertExportDocument(report: GrantExport): void {
  walkKeys(report);
  exactKeys(report, TOP_LEVEL);
  if (report.kind !== "grant-export") fail("kind");
  if (!acceptableCenterName(report.centerName)) fail("centerName");
  if (report.mode !== "aggregate" && report.mode !== "pseudonymized") fail("mode");
  if (!REPORT_ID.test(report.reportId)) fail("reportId");
  if (!DAY.test(report.periodStart) || !DAY.test(report.periodEnd) || !DAY.test(report.asOf)) fail("date");
  if (!Number.isInteger(report.suppressionMin) || report.suppressionMin < 2) fail("suppressionMin");
  if (report.pseudonymScope !== "report" && report.pseudonymScope !== "funder") fail("pseudonymScope");
  if (report.limitation !== EXPORT_LIMITATION) fail("limitation");
  assertFigure(report.registeredLearners, report.suppressionMin);
  assertFigure(report.retentionCohort, report.suppressionMin);
  assertFigure(report.retainedLearners, report.suppressionMin);
  assertRate(report.retentionRate, report.suppressionMin);
  exactKeys(report.attendance, ["learners", "confirmed", "eligible", "rate", "coverage"]);
  assertFigure(report.attendance.learners, report.suppressionMin);
  assertFigure(report.attendance.confirmed, report.suppressionMin);
  assertFigure(report.attendance.eligible, report.suppressionMin);
  assertRate(report.attendance.rate, report.suppressionMin);
  assertRate(report.attendance.coverage, report.suppressionMin);
  exactKeys(report.assignmentCompletion, ["learners", "completed", "expected", "rate"]);
  assertFigure(report.assignmentCompletion.learners, report.suppressionMin);
  assertFigure(report.assignmentCompletion.completed, report.suppressionMin);
  assertFigure(report.assignmentCompletion.expected, report.suppressionMin);
  assertRate(report.assignmentCompletion.rate, report.suppressionMin);
  for (const table of report.breakdowns) {
    exactKeys(table, ["dimension", "rows"]);
    if (table.dimension !== "ageBand" && table.dimension !== "gender") fail("dimension");
    const allowed = table.dimension === "ageBand" ? AGE : GENDER;
    for (const row of table.rows) {
      exactKeys(row, ["value", "learners"]);
      if (!allowed.has(row.value)) fail("value");
      assertFigure(row.learners, report.suppressionMin);
    }
  }
  for (const row of report.learners) {
    exactKeys(row, ["pseudonym"]);
    if (!PSEUDONYM.test(row.pseudonym)) fail("pseudonym");
  }
}

function exactKeys(value: object, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) {
    throw new ExportError("The export contained a field that is not on the whitelist.");
  }
}

function walkKeys(value: unknown, seen = new Set<unknown>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!WHITELIST.has(key)) {
      throw new ExportError(`Field "${key}" cannot be exported.`);
    }
    walkKeys(child, seen);
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/// A center name may be shown to a funder. It is rejected when it is empty,
/// very long, or contains a control character, so it cannot smuggle a note.
export function acceptableCenterName(value: string): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !CONTROL.test(value);
}

const SAFE_PHRASE = new Set(["Completion date missing"]);

function assertFigure(value: unknown, min: number): void {
  // A published count below the minimum, including zero, is a leak.
  // "Completion date missing" names a date the database does not have.
  // A sentence that says nobody was marked, or that no class was eligible,
  // states an exact zero and is rejected here.
  if (typeof value === "number" && Number.isInteger(value) && value >= min) return;
  if (value === `<${min}`) return;
  if (typeof value === "string" && SAFE_PHRASE.has(value)) return;
  fail("count");
}

function assertRate(value: unknown, min: number): void {
  if (typeof value === "string" && (value === `<${min}` || PERCENT.test(value) || SAFE_PHRASE.has(value))) return;
  fail("rate");
}

function fail(field: string): never {
  throw new ExportError(`The export contained an unsafe ${field}.`);
}
