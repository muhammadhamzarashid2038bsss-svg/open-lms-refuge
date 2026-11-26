// What the Export screen is allowed to show. Reading an active funder
// requirement is not the same as creating one. This file does not insert a
// requirement.

import { prisma } from "../db";
import { assertExportServer } from "./guard";

export const LEARNER_LEVEL_WARNING =
  "Pseudonymized learner-level data is still sensitive and is not anonymous.";

export const LEARNER_LEVEL_CONFIRMATION =
  "I confirm that a funder requires learner-level reporting for this download, and that this file is still sensitive and is not anonymous.";

// Shown on the Export page when the download route sends the browser back.
// The route still refuses the file. This text is the same refusal, not a second check.
export const CONFIRMATION_MISSING =
  "A learner-level export needs confirmation that the file is still sensitive and is not anonymous.";

export function learnerLevelOffer(activeCount: number): {
  offered: boolean;
  warning: string | null;
  confirmationLabel: string | null;
} {
  if (!Number.isInteger(activeCount) || activeCount < 1) {
    return { offered: false, warning: null, confirmationLabel: null };
  }
  return { offered: true, warning: LEARNER_LEVEL_WARNING, confirmationLabel: LEARNER_LEVEL_CONFIRMATION };
}

/// The reason text stays in the database. It can name a person, so the screen
/// receives the funder label and the short reference only.
export async function listActiveExportRequirements(centerId: string): Promise<
  Array<{ id: string; funderName: string; requirementReference: string; crossReportLinkage: boolean }>
> {
  assertExportServer();
  return prisma.funderRequirement.findMany({
    where: { centerId, active: true },
    select: { id: true, funderName: true, requirementReference: true, crossReportLinkage: true },
    orderBy: { requirementReference: "asc" },
  });
}

export async function listExportCenters(): Promise<Array<{ id: string; name: string; code: string }>> {
  assertExportServer();
  return prisma.center.findMany({
    select: { id: true, name: true, code: true },
    orderBy: [{ name: "asc" }, { code: "asc" }],
  });
}
