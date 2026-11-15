// A chart is drawn only from one demographic breakdown. Registered learners,
// attendance sessions, and completed assignments are different units, so they
// are never plotted together. A hidden cell is not turned into zero and is
// not dropped from an otherwise numeric chart: if any cell in the breakdown
// is suppressed, that breakdown is left out.

import type { GrantExport } from "./types";

export type ComparableChart = {
  dimension: "ageBand" | "gender";
  rows: Array<{ label: string; count: number }>;
};

export function comparableChart(report: GrantExport): ComparableChart | null {
  for (const table of report.breakdowns) {
    if (table.rows.length < 2) continue;
    const rows: ComparableChart["rows"] = [];
    let comparable = true;
    for (const row of table.rows) {
      if (typeof row.learners !== "number" || !Number.isInteger(row.learners)) {
        comparable = false;
        break;
      }
      rows.push({ label: row.value, count: row.learners });
    }
    if (comparable) return { dimension: table.dimension, rows };
  }
  return null;
}
