// Approving a funder requirement is a separate protected action from exporting.
// The row is the proof. A caller cannot send a made-up id or a note and have
// it treated as approval. The reason text stays on the row and is not copied
// into the audit log, because free text can name a person.

import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { canExportCenter, type Actor } from "../auth/permissions";
import { writeAuditEvent } from "../data/audit";
import { prisma } from "../db";
import { assertExportServer } from "./guard";
import { EXPORT_DENIED } from "./types";

const REFERENCE = /^[A-Z0-9]{2,16}(?:-[A-Z0-9]{1,16}){0,5}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
// The column is required by the existing table. The screen does not collect a name.
const UNNAMED_FUNDER = "Not recorded";
const REASON_INVALID = "Write an explanation of 10 to 200 characters. Do not include a learner's name.";
const REFERENCE_INVALID = "Use a short reference made of letters, numbers, and hyphens, such as GRANT-2026.";
const ALREADY_OFF = "That requirement is already turned off.";;

export type FunderRequirementResult = { ok: true; id: string } | { ok: false; message: string };

export async function approveFunderRequirement(input: {
  actor: Actor | null;
  centerId: string;
  funderName: string;
  requirementReference: string;
  learnerLevelReason: string;
  crossReportLinkage: boolean;
}): Promise<FunderRequirementResult> {
  assertExportServer();
  if (!input.actor) return { ok: false, message: EXPORT_DENIED };
  const funderName = input.funderName?.trim?.() ?? "";
  const requirementReference = input.requirementReference?.trim?.() ?? "";
  const learnerLevelReason = input.learnerLevelReason?.trim?.() ?? "";
  if (!validText(funderName, 2, 80) || !REFERENCE.test(requirementReference) || !validText(learnerLevelReason, 10, 200)) {
    return { ok: false, message: "The funder requirement could not be saved." };
  }
  if (typeof input.crossReportLinkage !== "boolean") {
    return { ok: false, message: "The funder requirement could not be saved." };
  }
  const actorId = input.actor.id;
  const centerId = input.centerId;
  try {
    return await prisma.$transaction(async (tx) => {
      const actor = await actorFromDatabase(tx, actorId);
      if (!actor || !canExportCenter(actor, centerId)) return { ok: false, message: EXPORT_DENIED };
      const center = await tx.center.findUnique({ where: { id: centerId }, select: { id: true } });
      if (!center) return { ok: false, message: "The funder requirement could not be saved." };
      const id = randomUUID();
      await tx.funderRequirement.create({
        data: {
          id,
          centerId,
          funderName,
          requirementReference,
          learnerLevelReason,
          crossReportLinkage: input.crossReportLinkage,
          approvedById: actor.id,
          approvedAt: new Date(),
          active: true,
        },
      });
      await writeAuditEvent(tx, {
        actor,
        action: "CREATE",
        entityType: "FUNDER_REQUIREMENT",
        entityId: id,
        centerId,
        metadata: {
          source: "funder-requirement",
          status: "active",
          requirementReference,
          crossReportLinkage: input.crossReportLinkage,
        },
      });
      return { ok: true, id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, message: "That requirement reference is already on file for this center." };
    }
    throw error;
  }
}

/// Records an explicit learner-level requirement without asking for a funder name.
/// A blank reference is generated. The explanation stays on the row and out of the audit.
export async function recordLearnerLevelRequirement(input: {
  actor: Actor | null;
  centerId: string;
  learnerLevelReason: string;
  requirementReference?: string;
  crossReportLinkage: boolean;
}): Promise<FunderRequirementResult> {
  const reason = input.learnerLevelReason?.trim?.() ?? "";
  if (!validText(reason, 10, 200)) return { ok: false, message: REASON_INVALID };
  const supplied = input.requirementReference?.trim?.().toUpperCase() ?? "";
  if (supplied.length > 0 && !REFERENCE.test(supplied)) return { ok: false, message: REFERENCE_INVALID };
  return approveFunderRequirement({
    actor: input.actor,
    centerId: input.centerId,
    funderName: UNNAMED_FUNDER,
    requirementReference: supplied.length > 0 ? supplied : generatedReference(),
    learnerLevelReason: reason,
    crossReportLinkage: input.crossReportLinkage,
  });
}

export async function deactivateFunderRequirement(input: {
  actor: Actor | null;
  centerId: string;
  requirementId: string;
}): Promise<FunderRequirementResult> {
  assertExportServer();
  if (!input.actor) return { ok: false, message: EXPORT_DENIED };
  const requirementId = input.requirementId?.trim?.() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requirementId)) {
    return { ok: false, message: EXPORT_DENIED };
  }
  const actorId = input.actor.id;
  const centerId = input.centerId;
  return prisma.$transaction(async (tx) => {
    const actor = await actorFromDatabase(tx, actorId);
    if (!actor || !canExportCenter(actor, centerId)) return { ok: false, message: EXPORT_DENIED };
    const row = await tx.funderRequirement.findFirst({
      where: { id: requirementId, centerId },
      select: { id: true, active: true, requirementReference: true, crossReportLinkage: true },
    });
    if (!row) return { ok: false, message: EXPORT_DENIED };
    if (!row.active) return { ok: false, message: ALREADY_OFF };
    const deactivatedAt = new Date();
    const turnedOff = await tx.funderRequirement.updateMany({
      where: { id: row.id, centerId, active: true },
      data: { active: false, deactivatedAt },
    });
    if (turnedOff.count !== 1) return { ok: false, message: ALREADY_OFF };
    await writeAuditEvent(tx, {
      actor,
      action: "UPDATE",
      entityType: "FUNDER_REQUIREMENT",
      entityId: row.id,
      centerId,
      metadata: {
        source: "funder-requirement",
        status: "inactive",
        requirementReference: row.requirementReference,
        crossReportLinkage: row.crossReportLinkage,
      },
    });
    return { ok: true, id: row.id };
  });
}

export type FunderRequirementView = {
  id: string;
  requirementReference: string;
  learnerLevelReason: string;
  crossReportLinkage: boolean;
  active: boolean;
  recordedLabel: string;
  deactivatedLabel: string | null;
};

/// History for the Export page. The explanation is shown here so the director
/// can review the decision. It is not copied into the audit row or the file.
export async function listFunderRequirements(
  actor: Actor | null,
  centerId: string,
): Promise<FunderRequirementView[] | null> {
  assertExportServer();
  if (!actor || !canExportCenter(actor, centerId)) return null;
  const center = await prisma.center.findUnique({
    where: { id: centerId },
    select: { timezone: true },
  });
  if (!center) return null;
  const rows = await prisma.funderRequirement.findMany({
    where: { centerId },
    select: {
      id: true,
      requirementReference: true,
      learnerLevelReason: true,
      crossReportLinkage: true,
      active: true,
      approvedAt: true,
      deactivatedAt: true,
    },
    orderBy: [{ approvedAt: "desc" }, { requirementReference: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    requirementReference: row.requirementReference,
    learnerLevelReason: row.learnerLevelReason,
    crossReportLinkage: row.crossReportLinkage,
    active: row.active,
    recordedLabel: dayLabel(row.approvedAt, center.timezone),
    deactivatedLabel: row.deactivatedAt ? dayLabel(row.deactivatedAt, center.timezone) : null,
  }));
}

function generatedReference(): string {
  return `REQ-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function dayLabel(value: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium" }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function validText(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max && !CONTROL.test(value);
}

async function actorFromDatabase(tx: Prisma.TransactionClient, userId: string): Promise<Actor | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true, centerId: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    centerId: user.centerId,
    active: user.active,
    displayName: "",
    learnerId: null,
    assignedSectionIds: [],
    enrolledSectionIds: [],
  };
}
