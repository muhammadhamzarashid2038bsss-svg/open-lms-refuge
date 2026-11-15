// Shared shapes for the FEAT-4 donor export. The report object is the only
// thing that may leave this module. Learner codes, names, and database ids
// are inputs, not fields on GrantExport.

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

export const EXPORT_DENIED = "You cannot export this center's report.";

export const EXPORT_LIMITATION =
  "Small counts stay hidden, and a second count is hidden when publishing it would reveal the first by subtraction. Overlapping date ranges and outside knowledge can still narrow a hidden group. Age and gender stay in separate tables.";

export const AGE_BANDS = [
  "UNDER_6",
  "AGE_6_8",
  "AGE_9_11",
  "AGE_12_14",
  "AGE_15_17",
  "AGE_18_24",
  "AGE_25_PLUS",
] as const;

export type AgeBandName = (typeof AGE_BANDS)[number];

export const GENDERS = ["FEMALE", "MALE", "NONBINARY", "PREFER_NOT_TO_SAY"] as const;

export type GenderName = (typeof GENDERS)[number];

export type BreakdownDimension = "ageBand" | "gender";

export type ExportMode = "aggregate" | "pseudonymized";

/// Report scope is the default. Funder scope keeps one pseudonym across
/// reports, and only when the saved requirement row says linkage is required.
/// requirementId is that row's server-generated id, not a label the caller typed.
export type ExportScope = { kind: "report" } | { kind: "funder"; requirementId: string };

export type ExportPerson = {
  learnerCode: string;
  ageBand: AgeBandName;
  gender?: GenderName | null;
};

export type ExportEnrollment = {
  learnerCode: string;
  sectionKey: string;
  status: "ACTIVE" | "WITHDRAWN" | "COMPLETED";
  enrolledOn: string;
  withdrawnOn: string | null;
  /// Inclusive last enrolled day when status is COMPLETED. Null on a legacy
  /// completed row that was stored before this date existed.
  completedOn: string | null;
};

export type ExportClassMark = {
  sessionKey: string;
  sectionKey: string;
  learnerCode: string;
  sessionOn: string;
  sessionStatus: "SCHEDULED" | "HELD" | "CANCELLED";
  /// False when the session instant is still in the future. The calendar day
  /// alone is not enough: a class later today is not eligible yet.
  occurred: boolean;
  mark: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | null;
};

export type ExportTask = {
  taskKey: string;
  sectionKey: string;
  learnerCode: string;
  dueOn: string;
  /// False when the due instant is still in the future.
  duePassed: boolean;
  kind: "PAPER" | "DIGITAL" | "BOTH" | "IN_CLASS_EXAM";
  settledGrade: boolean;
  storedFile: boolean;
};

/// Facts already reduced to the fields this module is allowed to read.
/// The protected export builds this from PostgreSQL. It is not a request body.
/// Dates are calendar dates in the center timezone, YYYY-MM-DD.
/// Phone clocks are not a source of order. A class session's current mark is
/// the one the server received last.
export type ExportFacts = {
  genderEnabled: boolean;
  people: readonly ExportPerson[];
  enrollments: readonly ExportEnrollment[];
  classes: readonly ExportClassMark[];
  tasks: readonly ExportTask[];
};

export type ExportRequest = {
  centerId: string;
  /// The center's own name. It is not a learner's name. The protected export
  /// reads it from the center row. A caller cannot substitute a different one.
  centerName: string;
  reportId?: string;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  suppressionMin: number;
  approvedBreakdowns: readonly BreakdownDimension[];
  mode?: ExportMode;
  scope?: ExportScope;
};

/// A count, a percent such as "83.3%", or a hidden-group label such as "<5".
export type ExportFigure = number | string;

export type GrantExport = {
  kind: "grant-export";
  /// Printed in the report body. Kept out of the file name and PDF properties.
  centerName: string;
  mode: ExportMode;
  reportId: string;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  suppressionMin: number;
  pseudonymScope: "report" | "funder";
  limitation: string;
  registeredLearners: ExportFigure;
  retentionCohort: ExportFigure;
  retainedLearners: ExportFigure;
  retentionRate: ExportFigure;
  attendance: {
    learners: ExportFigure;
    confirmed: ExportFigure;
    eligible: ExportFigure;
    rate: ExportFigure;
    coverage: ExportFigure;
  };
  assignmentCompletion: {
    learners: ExportFigure;
    completed: ExportFigure;
    expected: ExportFigure;
    rate: ExportFigure;
  };
  breakdowns: Array<{
    dimension: BreakdownDimension;
    rows: Array<{ value: string; learners: ExportFigure }>;
  }>;
  learners: Array<{ pseudonym: string }>;
};

export type ExportAuditEntry = {
  reportId: string;
  mode: ExportMode;
  periodStart: string;
  periodEnd: string;
  suppressionMin: number;
  pseudonymScope: "report" | "funder";
};
