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
