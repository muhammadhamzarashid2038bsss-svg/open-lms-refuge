// CSV projection of a report that has already passed the whitelist. Cells that
// start with a spreadsheet formula character are prefixed so a funder's
// spreadsheet does not treat them as formulas.

import type { GrantExport } from "./types";

export function grantExportCsv(report: GrantExport): string {
  const lines: string[] = ["record_type,metric,group,value"];
  const reportRow = (metric: string, value: string | number) => {
    lines.push(["report", metric, "", cell(value)].join(","));
  };
  reportRow("mode", report.mode);
  reportRow("report_id", report.reportId);
  reportRow("period_start", report.periodStart);
  reportRow("period_end", report.periodEnd);
  reportRow("as_of", report.asOf);
  reportRow("suppression_min", report.suppressionMin);
  reportRow("pseudonym_scope", report.pseudonymScope);
  reportRow("limitation", report.limitation);
  const count = (metric: string, value: string | number) => {
    lines.push(["count", metric, "", cell(value)].join(","));
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
      lines.push(["breakdown", table.dimension, cell(row.value), cell(row.learners)].join(","));
    }
  }
  for (const row of report.learners) {
    lines.push(["learner", "pseudonym", cell(row.pseudonym), ""].join(","));
  }
  return `${lines.join("\n")}\n`;
}

/// The file name carries the date range only. No learner name or code.
export function exportFilename(periodStart: string, periodEnd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return "grant-export.csv";
  }
  return `grant-export-${periodStart}-to-${periodEnd}.csv`;
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
