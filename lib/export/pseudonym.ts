// A plain SHA-256 hash of a learner code is not a secret. The recipe is
// public, and learner codes are short, so anyone can hash LNR-0001, LNR-0002,
// and so on until a hash in the file matches. HMAC-SHA-256 mixes in
// EXPORT_SECRET first. Without that key, the same guess does not produce the
// pseudonym. The key stays on the server and is never written into the file.
//
// The default input is the report id plus the learner code, separated by a
// NUL byte so two different splits of the same text cannot collide. Rows in
// one report share a pseudonym for the same learner. A new report id changes
// the pseudonym, so two downloads do not line up by themselves.
//
// A pseudonym that stays the same across reports is used only when a saved
// funder requirement says cross-report linkage is required. The requirement's
// own id replaces the report id in the HMAC input. A caller cannot choose
// that id, and asking for learner-level rows does not turn linkage on.

import { createHmac } from "node:crypto";
import { assertHighEntropySecret } from "./secret";
import { ExportError, type ExportScope } from "./types";

const LEARNER_CODE = /^[A-Z]{2,12}-[A-Z0-9]{2,16}$/;
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function acceptableExportLearnerCode(code: string): boolean {
  // Same shape the risk service accepts. A personal name does not pass.
  return LEARNER_CODE.test(code) && /\d/.test(code);
}

export function canonicalReportId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return REPORT_ID.test(id) ? id : null;
}

export function learnerPseudonym(input: {
  learnerCode: string;
  reportId: string;
  scope: ExportScope;
  secret: string;
}): string {
  assertHighEntropySecret(input.secret);
  if (!acceptableExportLearnerCode(input.learnerCode)) {
    throw new ExportError("A learner code is not in the expected shape.");
  }
  const reportId = canonicalReportId(input.reportId);
  if (!reportId) throw new ExportError("The export needs a unique report id.");
  const scopeId = scopeKey(input.scope, reportId);
  // Version, scope, scope id, and code are fixed fields. NUL cannot appear in
  // a report id, a requirement id, or a learner code, so the join is one-to-one.
  const payload = ["olr-export-v1", input.scope.kind, scopeId, input.learnerCode].join("\0");
  const digest = createHmac("sha256", input.secret).update(payload, "utf8").digest("hex");
  return `ps_${digest}`;
}

function scopeKey(scope: ExportScope, reportId: string): string {
  if (scope.kind === "report") return reportId;
  // The id is the saved requirement row, generated on the server. A short
  // label such as "AB" is not accepted here.
  const requirementId = canonicalReportId(scope.requirementId);
  if (!requirementId) {
    throw new ExportError(
      "A stable pseudonym needs an approved funder requirement. The default is a new pseudonym for each report.",
    );
  }
  return requirementId;
}
