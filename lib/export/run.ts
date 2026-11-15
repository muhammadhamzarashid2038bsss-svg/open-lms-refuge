// The donor-export entry point. It authenticates the actor against PostgreSQL,
// reads that center's saved settings and records, generates a new report id,
// and writes the audit row before a file can be returned. CSV and PDF are two
// projections of that one report. If the audit insert fails, the transaction
// rolls back and this function rejects, so there is no file to send.
//
// The request is a date range and, for a learner-level file, the id of a
// saved funder requirement. Facts, suppression settings, and report ids from
// the caller are not read.

import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { canExportCenter, type Actor } from "../auth/permissions";
import { recordExportAudit } from "../data/audit";
import { prisma } from "../db";
import { formatCivilDate, isValidTimeZone, localDateOfInstant, parseIsoDate } from "../lms/timetable";
import { buildGrantExport } from "./aggregate";
import { exportFilename, grantExportCsv } from "./csv";
import { assertExportServer } from "./guard";
import { loadExportFacts } from "./load";
import { grantExportPdf } from "./pdf";
import { canonicalReportId } from "./pseudonym";
import { readExportSecret } from "./secret";
import { EXPORT_DENIED, type BreakdownDimension, type ExportMode } from "./types";

const RANGE_INVALID = "The export dates could not be read.";
const CLOCK_INVALID = "The center clock could not be read.";
const MIN_INVALID = "This center's small-group minimum cannot be used for an export.";
const REQUIREMENT_MISSING = "A learner-level export needs an active funder requirement approved for this center.";

export type ExportFormat = "csv" | "pdf";

export type CenterExportResult =
  | { ok: true; csv: string; filename: string; reportId: string }
  | { ok: false; message: string };

export type CenterExportFile =
  | {
      ok: true;
      body: Uint8Array;
      filename: string;
      reportId: string;
      contentType: "text/csv; charset=utf-8" | "application/pdf";
    }
  | { ok: false; message: string };

export async function exportCenterCsv(input: {
  actor: Actor | null;
  centerId: string;
  periodStart: string;
  periodEnd: string;
  mode?: ExportMode;
  requirementId?: string;
}): Promise<CenterExportResult> {
  const result = await exportCenterReport({ ...input, format: "csv" });
  if (!result.ok) return result;
  return {
    ok: true,
    csv: new TextDecoder().decode(result.body),
    filename: result.filename,
    reportId: result.reportId,
  };
}

export async function exportCenterReport(input: {
  actor: Actor | null;
  centerId: string;
  periodStart: string;
  periodEnd: string;
  mode?: ExportMode;
  requirementId?: string;
  format?: ExportFormat;
}): Promise<CenterExportFile> {
  assertExportServer();
  if (!input.actor) return { ok: false, message: EXPORT_DENIED };
  const periodStart = calendarDay(input.periodStart);
  const periodEnd = calendarDay(input.periodEnd);
  if (!periodStart || !periodEnd || periodStart > periodEnd) return { ok: false, message: RANGE_INVALID };
  const mode = input.mode ?? "aggregate";
  if (mode !== "aggregate" && mode !== "pseudonymized") return { ok: false, message: RANGE_INVALID };
  const format = input.format ?? "csv";
  if (format !== "csv" && format !== "pdf") return { ok: false, message: RANGE_INVALID };
  const actorId = input.actor.id;
  const centerId = input.centerId;

  return prisma.$transaction(
    async (tx) => {
      const actor = await actorFromDatabase(tx, actorId);
      if (!actor || !canExportCenter(actor, centerId)) return { ok: false, message: EXPORT_DENIED };
      const secret = readExportSecret();
      const center = await tx.center.findUnique({
        where: { id: centerId },
        select: { id: true, name: true, code: true, timezone: true, smallGroupSuppressionMin: true },
      });
      if (!center) return { ok: false, message: "The export could not be built from the center records." };
      if (!isValidTimeZone(center.timezone)) return { ok: false, message: CLOCK_INVALID };
      const suppressionMin = center.smallGroupSuppressionMin;
      if (!Number.isInteger(suppressionMin) || suppressionMin < 2 || suppressionMin > 100) {
        return { ok: false, message: MIN_INVALID };
      }
      const now = new Date();
      const asOfDate = localDateOfInstant(now, center.timezone);
      if (!asOfDate) return { ok: false, message: CLOCK_INVALID };
      const asOf = formatCivilDate(asOfDate);
      const genderField = await tx.centerOptionalField.findUnique({
        where: { centerId_fieldKey: { centerId, fieldKey: "GENDER" } },
        select: { enabled: true },
      });
      const genderEnabled = genderField?.enabled === true;
      const requirement = mode === "pseudonymized" ? await activeRequirement(tx, centerId, input.requirementId) : null;
      if (mode === "pseudonymized" && !requirement) return { ok: false, message: REQUIREMENT_MISSING };
      const loaded = await loadExportFacts(tx, { centerId, timeZone: center.timezone, genderEnabled, now });
      if (!loaded.ok) return loaded;
      const reportId = randomUUID();
      const scope = requirement?.crossReportLinkage
        ? { kind: "funder" as const, requirementId: requirement.id }
        : { kind: "report" as const };
      const breakdowns: BreakdownDimension[] = genderEnabled ? ["ageBand", "gender"] : ["ageBand"];
      const built = buildGrantExport({
        request: {
          centerId,
          centerName: center.name.trim(),
          reportId,
          periodStart,
          periodEnd,
          asOf,
          suppressionMin,
          approvedBreakdowns: breakdowns,
          mode,
          scope,
        },
        facts: loaded.facts,
        secret,
      });
      if (!built.ok) return built;
      const body = format === "pdf" ? await grantExportPdf(built.report) : Buffer.from(grantExportCsv(built.report), "utf8");
      await recordExportAudit(tx, actor, reportId, format === "pdf" ? "PDF" : "CSV", mode === "pseudonymized" ? "PSEUDONYMIZED" : "AGGREGATE", {
        periodStart,
        periodEnd,
        suppressionMin,
        pseudonymScope: scope.kind,
        centerCode: center.code,
        centerId,
        requirementReference: requirement?.requirementReference,
        crossReportLinkage: requirement ? requirement.crossReportLinkage : undefined,
      });
      return {
        ok: true,
        body,
        filename: exportFilename(periodStart, periodEnd, format),
        reportId,
        contentType: format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
      };
    },
    // One transaction so the audit row commits with the decision to return the
    // file. PostgreSQL's default is Read Committed: each query can see a newer
    // commit than the query before it. Repeatable Read takes a snapshot at the
    // first query, so the enrollment, attendance, and grade reads describe the
    // same moment. The 20 second limit is for the local one-connection proxy.
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    },
  );
}

async function activeRequirement(
  tx: Prisma.TransactionClient,
  centerId: string,
  requirementId: string | undefined,
): Promise<{ id: string; requirementReference: string; crossReportLinkage: boolean } | null> {
  const id = canonicalReportId(requirementId ?? "");
  if (!id) return null;
  return tx.funderRequirement.findFirst({
    where: { id, centerId, active: true },
    select: { id: true, requirementReference: true, crossReportLinkage: true },
  });
}

function calendarDay(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = parseIsoDate(value);
  return parsed ? formatCivilDate(parsed) : null;
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
