// Append-only audit rows. Metadata is an allowlist of short tokens.
// Note text, passwords, file bytes, and learner names never belong here.
// Check-in actions call recordRiskFlagAudit. Grant exports call recordExportAudit.

import { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../auth/permissions";

type Tx = Prisma.TransactionClient;

export const RECORD_VIEW_FAILED = "The view could not be recorded.";

const SAFE_KEYS = new Set([
  "source",
  "active",
  "field",
  "clientMutationId",
  "clientEventId",
  "conflictId",
  "resolution",
  "resolvedVersionId",
  "handoverId",
  "itemCount",
  "handoffReportId",
  "sectionId",
  "profileCount",
  "learnerCount",
  "reason",
  "reportCount",
  "status",
  "format",
  "mode",
  "periodStart",
  "periodEnd",
  "suppressionMin",
  "pseudonymScope",
  "centerCode",
  "requirementReference",
  "crossReportLinkage",
  "gradeCount",
  "scoredCount",
  "unscoredCount",
  "savedCount",
  "watchThreshold",
  "highThreshold",
  "calculationVersion",
]);

const TOKEN = /^[A-Za-z0-9_.:-]{1,80}$/;

export function auditMetadata(
  input: Record<string, string | number | boolean | null>,
): Prisma.InputJsonObject {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_KEYS.has(key) || value === null) continue;
    if (typeof value === "string") {
      if (!TOKEN.test(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
      continue;
    }
    out[key] = value;
  }
  return out as Prisma.InputJsonObject;
}

/// Keys a person may see. Anything else, including a future unsafe key, is dropped.
export function visibleAuditMetadata(value: unknown): { key: string; value: string }[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rows: { key: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (!SAFE_KEYS.has(key)) continue;
    if (typeof raw === "string" && TOKEN.test(raw)) rows.push({ key, value: raw });
    else if (typeof raw === "number" && Number.isFinite(raw)) rows.push({ key, value: String(raw) });
    else if (typeof raw === "boolean") rows.push({ key, value: raw ? "true" : "false" });
  }
  return rows;
}

export async function writeAuditEvent(
  tx: Tx,
  event: {
    actor: Pick<Actor, "id" | "centerId">;
    action: "VIEW" | "CREATE" | "UPDATE" | "DEACTIVATE" | "EXPORT" | "RESOLVE_CONFLICT" | "GENERATE_HANDOFF" | "UPDATE_RISK_FLAG";
    entityType: "GRADE_ENTRY" | "PROGRESS_NOTE" | "HANDOFF_REPORT" | "RISK_FLAG" | "EXPORT" | "USER" | "ATTENDANCE" | "SUBMISSION" | "SKILL_TAG" | "FUNDER_REQUIREMENT";
    entityId: string;
    metadata: Record<string, string | number | boolean | null>;
    deviceId?: string | null;
    centerId?: string;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      centerId: event.centerId ?? event.actor.centerId,
      actorId: event.actor.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      deviceId: event.deviceId ?? null,
      metadata: auditMetadata(event.metadata),
    },
  });
}

export async function writeRecordViews(
  tx: Tx,
  actor: Pick<Actor, "id" | "centerId">,
  entityType: "GRADE_ENTRY" | "PROGRESS_NOTE" | "HANDOFF_REPORT" | "SUBMISSION",
  entityIds: readonly string[],
  metadata: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (entityIds.length === 0) return;
  const safe = auditMetadata(metadata);
  const written = await tx.auditLog.createMany({
    data: entityIds.map((entityId) => ({
      centerId: actor.centerId,
      actorId: actor.id,
      action: "VIEW" as const,
      entityType,
      entityId,
      metadata: safe,
    })),
  });
  if (written.count !== entityIds.length) throw new Error(RECORD_VIEW_FAILED);
}

/// Day 14–15 can call this when a director updates a real risk flag.
/// It does not create a flag.
export async function recordRiskFlagAudit(
  tx: Tx,
  actor: Pick<Actor, "id" | "centerId">,
  flagId: string,
  status: "OPEN" | "CHECK_IN_DONE" | "DISMISSED",
): Promise<void> {
  await writeAuditEvent(tx, {
    actor,
    action: "UPDATE_RISK_FLAG",
    entityType: "RISK_FLAG",
    entityId: flagId,
    metadata: { source: "risk-flag", status },
  });
}

/// Writes one audit row for a grant export that was actually produced.
/// The row stores the report id, the date range, and the suppression setting.
/// A learner-level export also stores the requirement reference and whether
/// linkage across reports was approved. It does not store learner codes,
/// pseudonyms, the reason text, or the export file.
export async function recordExportAudit(
  tx: Tx,
  actor: Pick<Actor, "id" | "centerId">,
  exportId: string,
  format: "CSV" | "PDF",
  mode: "AGGREGATE" | "PSEUDONYMIZED",
  detail?: {
    periodStart?: string;
    periodEnd?: string;
    suppressionMin?: number;
    pseudonymScope?: "report" | "funder";
    centerCode?: string;
    centerId?: string;
    requirementReference?: string;
    crossReportLinkage?: boolean;
  },
): Promise<void> {
  await writeAuditEvent(tx, {
    actor,
    action: "EXPORT",
    entityType: "EXPORT",
    entityId: exportId,
    centerId: detail?.centerId,
    metadata: {
      source: "grant-export",
      format,
      mode,
      periodStart: detail?.periodStart ?? null,
      periodEnd: detail?.periodEnd ?? null,
      suppressionMin: detail?.suppressionMin ?? null,
      pseudonymScope: detail?.pseudonymScope ?? null,
      centerCode: detail?.centerCode ?? null,
      requirementReference: detail?.requirementReference ?? null,
      crossReportLinkage: detail?.crossReportLinkage ?? null,
    },
  });
}
