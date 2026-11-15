// PDF projection of a report that has already passed the whitelist. It does
// not read the database. PDFKit also copies the document properties into an
// XMP packet, so those properties stay generic: date range and a fixed app
// name, never a center name or a learner field.

import { PDFDocument } from "pdfkit";
import { comparableChart } from "./chart";
import { grantExportRows } from "./csv";
import { assertExportServer } from "./guard";
import type { GrantExport } from "./types";
import { assertExportDocument } from "./whitelist";

const CREATOR = "Open LMS Refuge";

export async function grantExportPdf(report: GrantExport): Promise<Uint8Array> {
  assertExportServer();
  assertExportDocument(report);
  // PDFKit writes the XMP packet only when the file is newer than PDF 1.3.
  // Version 1.4 makes that packet real so the privacy scanner can read the
  // same generic properties that are stored in the document Info dictionary.
  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    pdfVersion: "1.4",
    lang: "en",
    info: {
      Title: `Grant export ${report.periodStart} to ${report.periodEnd}`,
      Subject: report.mode === "aggregate" ? "Aggregate grant export" : "Pseudonymized grant export",
      Creator: CREATOR,
      Producer: "PDFKit",
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (chunk) => {
      chunks.push(chunk);
    });
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", reject);
  });

  doc.fontSize(18).text(report.centerName);
  doc.moveDown(0.4);
  doc.fontSize(11);
  for (const row of grantExportRows(report)) {
    const group = row.group ? ` ${row.group}` : "";
    doc.text(`${row.metric}${group}: ${row.value}`);
  }
  const chart = comparableChart(report);
  if (chart) {
    doc.moveDown(0.6);
    doc.fontSize(14).text("Group sizes");
    doc.moveDown(0.3);
    drawBars(doc, chart.rows);
  }
  doc.end();
  return done;
}

function drawBars(
  doc: PDFDocument,
  rows: ReadonlyArray<{ label: string; count: number }>,
): void {
  const max = Math.max(...rows.map((row) => row.count));
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const labelWidth = 150;
  const barMax = Math.max(20, usable - labelWidth - 8);
  for (const row of rows) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
    const y = doc.y;
    doc.fillColor("#111111").fontSize(10).text(`${row.label}  ${row.count}`, left, y, { width: labelWidth });
    const barWidth = Math.max(2, (row.count / max) * barMax);
    doc.rect(left + labelWidth, y + 2, barWidth, 10).fill("#222222");
    doc.fillColor("#111111");
    doc.y = y + 18;
    doc.x = left;
  }
}
