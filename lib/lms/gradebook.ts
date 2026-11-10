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
