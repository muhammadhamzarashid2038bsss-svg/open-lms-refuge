// CSV projection of a report that has already passed the whitelist. The row
// list is shared with the PDF so the two files cannot disagree. Cells that
// start with a spreadsheet formula character are prefixed so a funder's
// spreadsheet does not treat them as formulas.

import type { ExportFigure, GrantExport } from "./types";

export type ExportRow = {
  record: string;
  metric: string;
  group: string;
  value: string;
};

export function grantExportRows(report: GrantExport): ExportRow[] {
  const rows: ExportRow[] = [];
  const reportRow = (metric: string, value: string | number) => {
    rows.push({ record: "report", metric, group: "", value: String(value) });
  };
  reportRow("center_name", report.centerName);
  reportRow("mode", report.mode);
  reportRow("report_id", report.reportId);
  reportRow("period_start", report.periodStart);
  reportRow("period_end", report.periodEnd);
  reportRow("as_of", report.asOf);
  reportRow("suppression_min", report.suppressionMin);
  reportRow("pseudonym_scope", report.pseudonymScope);
  reportRow("limitation", report.limitation);
  const count = (metric: string, value: ExportFigure) => {
    rows.push({ record: "count", metric, group: "", value: String(value) });
  };
  count("registered_learners", report.registeredLearners);
  count("retention_cohort", report.retentionCohort);
  count("retained_learners", report.retainedLearners);
  count("retention_rate", report.retentionRate);
  count("attendance_learners", report.attendance.learners);
  count("attendance_confirmed", report.attendance.confirmed);
  count("attendance_eligible", report.attendance.eligible);
  count("attendance_rate", report.attendance.rate);
  count("attendance_coverage", report.attendance.coverage);
  count("assignment_learners", report.assignmentCompletion.learners);
  count("assignment_completed", report.assignmentCompletion.completed);
  count("assignment_expected", report.assignmentCompletion.expected);
  count("assignment_rate", report.assignmentCompletion.rate);
  for (const table of report.breakdowns) {
    for (const row of table.rows) {
      rows.push({
        record: "breakdown",
        metric: table.dimension,
        group: row.value,
        value: String(row.learners),
      });
    }
  }
  for (const row of report.learners) {
    rows.push({ record: "learner", metric: "pseudonym", group: row.pseudonym, value: "" });
  }
  return rows;
}

export function grantExportCsv(report: GrantExport): string {
  const lines = ["record_type,metric,group,value"];
  for (const row of grantExportRows(report)) {
    lines.push([row.record, row.metric, cell(row.group), cell(row.value)].join(","));
  }
  return `${lines.join("\n")}\n`;
}

/// The file name carries the date range only. No learner name, learner code,
/// or center name. A center could be named after a person.
export function exportFilename(periodStart: string, periodEnd: string, format: "csv" | "pdf" = "csv"): string {
  const extension = format === "pdf" ? "pdf" : "csv";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return `grant-export.${extension}`;
  }
  return `grant-export-${periodStart}-to-${periodEnd}.${extension}`;
}

export function escapeCsvField(value: string | number): string {
  return cell(value);
}

function cell(value: string | number): string {
  const text = String(value);
  // Prefix formula characters on text. Numbers are already plain digits or a
  // percent, so a real count is not rewritten. A leading minus on a number
  // would be prefixed; this export does not emit negative numbers.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
