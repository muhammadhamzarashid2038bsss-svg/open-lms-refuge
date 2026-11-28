// Assignment labels and the gradebook save plan.
// Paper, Digital, Both, and in-class exams all become GradeEntry drafts.
// The kind is a label. It does not pick a second grade format.
// BOTH is a paper mark now plus a digital file later. It is not DIGITAL.

import { canonicalPoints } from "@/lib/sync/record-batch";
import type { VersionVector } from "@/lib/sync/version-vector";

export const CREATABLE_ASSIGNMENT_KINDS = ["PAPER", "DIGITAL", "BOTH"] as const;
export type CreatableAssignmentKind = (typeof CREATABLE_ASSIGNMENT_KINDS)[number];

export function assignmentKindLabel(kind: string): string {
  switch (kind) {
    case "PAPER":
      return "Paper";
    case "DIGITAL":
      return "Digital";
    case "BOTH":
      return "Both";
    case "IN_CLASS_EXAM":
      return "In-class exam";
    default:
      return "Assignment";
  }
}

export function showsFileStatus(kind: string): boolean {
  return kind === "DIGITAL" || kind === "BOTH";
}

/// What the gradebook shows for a server submission. `queued` means the row
/// exists but the upload has not started. `waiting` is only the learner's own
/// phone and is not one of these server states.
export type ServerFileStatus = "not_submitted" | "queued" | "uploading" | "failed" | "submitted";

export function fileStatusLabel(status: ServerFileStatus | "waiting"): string {
  switch (status) {
    case "waiting":
      return "Waiting on this phone";
    case "queued":
      return "Waiting to upload";
    case "uploading":
      return "Uploading";
    case "failed":
      return "Upload failed";
    case "submitted":
      return "Submitted";
    default:
      return "Not submitted";
  }
}

export function serverFileStatus(uploadState: "QUEUED" | "UPLOADING" | "STORED" | "FAILED" | null): ServerFileStatus {
  if (uploadState === "STORED") return "submitted";
  if (uploadState === "FAILED") return "failed";
  if (uploadState === "UPLOADING") return "uploading";
  if (uploadState === "QUEUED") return "queued";
  return "not_submitted";
}

export function assignmentKindNote(kind: string): string {
  switch (kind) {
    case "PAPER":
      return "Paper mark. No file.";
    case "DIGITAL":
      return "Digital file. The learner sends it from Homework files. The mark stays separate.";
    case "BOTH":
      return "Paper mark and digital file. Enter the paper mark here. The file is separate.";
    case "IN_CLASS_EXAM":
      return "In-class paper exam.";
    default:
      return "";
  }
}

export function validateNewAssignment(input: {
  title: unknown;
  kind: unknown;
  maxPoints: unknown;
}):
  | { ok: true; title: string; kind: CreatableAssignmentKind; maxPoints: string }
  | { ok: false; message: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 2 || title.length > 80 || title.includes("\0")) {
    return { ok: false, message: "Give the assignment a short name." };
  }
  const kind = typeof input.kind === "string" ? input.kind.trim() : "";
  if (kind !== "PAPER" && kind !== "DIGITAL" && kind !== "BOTH") {
    return { ok: false, message: "Choose Paper, Digital, or Both." };
  }
  const raw = typeof input.maxPoints === "string" ? input.maxPoints.trim() : "";
  const maxPoints = canonicalPoints(raw);
  if (!maxPoints || maxPoints === "0.00") {
    return { ok: false, message: "Enter a maximum mark greater than zero, such as 20." };
  }
  return { ok: true, title, kind, maxPoints };
}

export function gradebookCell<T extends { assignmentId: string; learnerId: string }>(
  grades: readonly T[],
  assignmentId: string,
  learnerId: string,
): T | null {
  return grades.find((grade) => grade.assignmentId === assignmentId && grade.learnerId === learnerId) ?? null;
}

/// A grade row already stored on this phone. This is not an attendance event.
/// The phone save uses a version vector and a grade record id.
export type GradePhoneRow = {
  centerId: string;
  userId: string;
  localDeviceId: string;
  entityType: string;
  recordId: string;
  versionVector: VersionVector;
  syncState: string;
  content: {
    assignmentId?: string;
    learnerId?: string;
    points?: string;
    academicNote?: string | null;
  };
};

/// Which class this gradebook is allowed to show. Assignment and learner ids
/// are the ones on this section. Another section's assignment is not in the set.
export type GradePhoneScope = {
  centerId: string;
  userId: string;
  deviceId: string | null;
  assignmentIds: ReadonlySet<string>;
  learnerIds: ReadonlySet<string>;
};

export type PendingGrade = {
  points: string;
  academicNote: string | null;
  recordId: string;
  versionVector: VersionVector;
};

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function gradeContent(
  content: GradePhoneRow["content"],
): { assignmentId: string; learnerId: string; points: string; academicNote: string | null } | null {
  if (typeof content.assignmentId !== "string" || typeof content.learnerId !== "string" || typeof content.points !== "string") {
    return null;
  }
  if (content.academicNote !== null && content.academicNote !== undefined && typeof content.academicNote !== "string") return null;
  return {
    assignmentId: content.assignmentId.toLowerCase(),
    learnerId: content.learnerId.toLowerCase(),
    points: content.points,
    academicNote: content.academicNote ?? null,
  };
}

/// The newest grade still waiting on this phone for one learner and assignment.
/// Acknowledged, conflict, stale, and rejected rows are not waiting. They must
/// not cover the server mark. Matching uses the stored ids and this phone's
/// centre, teacher, and device. It does not match on the mark alone.
function latestGrade(
  scope: GradePhoneScope,
  assignmentId: string,
  learnerId: string,
  rows: readonly GradePhoneRow[],
  syncState: string,
): PendingGrade | null {
  if (!scope.deviceId) return null;
  const assignment = assignmentId.toLowerCase();
  const learner = learnerId.toLowerCase();
  if (!scope.assignmentIds.has(assignment) || !scope.learnerIds.has(learner)) return null;
  let best: PendingGrade | null = null;
  let bestCount = -1;
  for (const row of rows) {
    if (row.entityType !== "GRADE_ENTRY" || row.syncState !== syncState) continue;
    if (row.centerId !== scope.centerId || row.userId !== scope.userId || row.localDeviceId !== scope.deviceId) continue;
    const content = gradeContent(row.content);
    if (!content || !sameId(content.assignmentId, assignment) || !sameId(content.learnerId, learner)) continue;
    const count = row.versionVector[scope.deviceId] ?? 0;
    if (count < bestCount) continue;
    bestCount = count;
    best = {
      points: content.points,
      academicNote: content.academicNote,
      recordId: row.recordId,
      versionVector: row.versionVector,
    };
  }
  return best;
}

export function pendingGradeForCell(
  scope: GradePhoneScope,
  assignmentId: string,
  learnerId: string,
  rows: readonly GradePhoneRow[],
): PendingGrade | null {
  return latestGrade(scope, assignmentId, learnerId, rows, "pending");
}

/// The waiting mark from this visit that the server has now accepted.
/// Older acknowledged rows are ignored, so a reload can trust the server copy.
/// A row that is still waiting stays pending and is not described as accepted.
export function acknowledgedAfterSend(
  scope: GradePhoneScope,
  assignmentId: string,
  learnerId: string,
  before: readonly GradePhoneRow[],
  after: readonly GradePhoneRow[],
): PendingGrade | null {
  const waiting = pendingGradeForCell(scope, assignmentId, learnerId, before);
  if (!waiting) return null;
  if (pendingGradeForCell(scope, assignmentId, learnerId, after)) return null;
  const accepted = latestGrade(scope, assignmentId, learnerId, after, "acknowledged");
  if (!accepted || accepted.recordId !== waiting.recordId || accepted.points !== waiting.points) return null;
  return accepted;
}

/// The number already stored. A waiting phone mark is the stored number.
/// Comparing a phone mark with the older server mark would save it again.
export function gradeCellBaseline(input: {
  pending: PendingGrade | null;
  acknowledged?: PendingGrade | null;
  server: { id: string; points: string; academicNote: string | null; versionVector: VersionVector } | null;
}): {
  currentPoints: string | null;
  academicNote: string | null;
  recordId: string | null;
  baseVector: VersionVector | undefined;
} {
  const stored = input.pending ?? input.acknowledged ?? null;
  if (stored) {
    return {
      currentPoints: stored.points,
      academicNote: stored.academicNote,
      recordId: stored.recordId,
      baseVector: stored.versionVector,
    };
  }
  return {
    currentPoints: input.server?.points ?? null,
    academicNote: input.server?.academicNote ?? null,
    recordId: input.server?.id ?? null,
    baseVector: input.server?.versionVector,
  };
}

export type GradeEntryStatus = "phone" | "unsaved" | "acknowledged" | "server";

/// What the box shows. A typed change is unsaved. A waiting phone mark is not
/// described as the server mark. A confirmed server mark stays the server mark
/// when nothing is waiting on the phone.
export type GradePhoneRead = "loading" | "ready" | "unavailable" | "failed";

/// Editing stays off until this visit has read the phone. An unread phone is
/// not an empty list: the server number must not be saved over a hidden mark.
export function gradeEditingAllowed(read: GradePhoneRead): boolean {
  return read === "ready";
}

export function gradeEntryState(input: {
  typed: string | null;
  pendingPoints: string | null;
  acknowledgedPoints?: string | null;
  fallbackPoints: string | null;
}): { display: string; status: GradeEntryStatus } {
  const acknowledgedPoints = input.acknowledgedPoints ?? null;
  const baseline = input.pendingPoints ?? acknowledgedPoints ?? input.fallbackPoints;
  if (input.typed !== null) {
    const typed = input.typed.trim();
    const typedPoints = typed.length > 0 ? canonicalPoints(typed) : null;
    const baselinePoints = baseline ? canonicalPoints(baseline) : null;
    if (typedPoints && typedPoints === baselinePoints) {
      if (input.pendingPoints) return { display: input.typed, status: "phone" };
      if (acknowledgedPoints) return { display: input.typed, status: "acknowledged" };
      return { display: input.typed, status: "server" };
    }
    return { display: input.typed, status: "unsaved" };
  }
  if (input.pendingPoints) return { display: input.pendingPoints, status: "phone" };
  if (acknowledgedPoints) return { display: acknowledgedPoints, status: "acknowledged" };
  return { display: input.fallbackPoints ?? "", status: "server" };
}

export type GradebookCellInput = {
  assignmentId: string;
  learnerId: string;
  kind: string;
  maxPoints: string;
  entered: string;
  currentPoints: string | null;
  academicNote: string | null;
  recordId: string | null;
  baseVector: VersionVector | undefined;
};

export type GradebookDraft = {
  assignmentId: string;
  learnerId: string;
  points: string;
  academicNote: string | null;
  recordId: string | null;
  baseVector: VersionVector;
};

function pointsGreater(points: string, maxPoints: string): boolean {
  const cents = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  };
  return cents(points) > cents(maxPoints);
}

export function planGradebookSaves(
  cells: readonly GradebookCellInput[],
): { ok: true; drafts: GradebookDraft[] } | { ok: false; message: string } {
  const drafts: GradebookDraft[] = [];
  for (const cell of cells) {
    if (typeof cell.kind !== "string") {
      return { ok: false, message: "This assignment could not be saved." };
    }
    const entered = cell.entered.trim();
    if (entered.length === 0) {
      if (cell.currentPoints) {
        return { ok: false, message: "A saved mark cannot be erased. Enter the new number." };
      }
      continue;
    }
    const points = canonicalPoints(entered);
    if (!points) return { ok: false, message: "Enter a mark as a number, such as 14 or 14.50." };
    const maxPoints = canonicalPoints(cell.maxPoints);
    if (!maxPoints || pointsGreater(points, maxPoints)) {
      return { ok: false, message: "A mark is higher than that assignment allows. That mark was not saved." };
    }
    // currentPoints is the mark already stored. That is the waiting phone mark
    // when one exists, and the server mark otherwise. A phone mark must not be
    // saved again only because it differs from the older server mark.
    const current = cell.currentPoints ? canonicalPoints(cell.currentPoints) : null;
    if (current === points) continue;
    drafts.push({
      assignmentId: cell.assignmentId,
      learnerId: cell.learnerId,
      points,
      academicNote: cell.academicNote,
      recordId: cell.recordId,
      baseVector: cell.baseVector ?? {},
    });
  }
  return { ok: true, drafts };
}
