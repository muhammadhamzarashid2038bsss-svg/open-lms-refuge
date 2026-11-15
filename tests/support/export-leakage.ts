// Test-only reader for grant exports. It collects stored values that must not
// appear in a file, then searches the whole CSV or the parsed PDF. A hit
// returns a fixed message and does not include the value.

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
// The current pdfjs-dist build expects Uint8Array hex helpers that this
// Node version does not provide. The legacy build includes those helpers
// and is the build Mozilla documents for Node.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { prisma } from "../../lib/db";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
).href;
const standardFontDataUrl = pathToFileURL(
  path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep,
).href;

export const LEAK_FOUND = "The leakage scanner found a prohibited value.";
export const PDF_UNREADABLE = "The leakage scanner could not read the PDF.";

export type LeakScan = { ok: true } | { ok: false; message: string };

export function scanText(
  parts: readonly string[],
  prohibited: readonly string[],
  allowed: readonly string[] = [],
): LeakScan {
  const needles = prohibited.flatMap((value) => {
    const folded = normalize(value);
    if (folded.length < 4) return [];
    return [{ folded, compact: squash(folded), short: folded.length < 8 }];
  });
  let foldedHay = normalize(parts.join("\n"));
  let compactHay = squash(foldedHay);
  // The center name is allowed in the report body. Remove that exact phrase
  // before searching so a code hidden inside the name is not a false hit,
  // while the same code anywhere else still is.
  for (const value of allowed) {
    const folded = normalize(value);
    if (folded.length < 4) continue;
    foldedHay = foldedHay.split(folded).join(" ");
    compactHay = compactHay.split(squash(folded)).join("");
  }
  for (const needle of needles) {
    if (needle.short) {
      const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(needle.folded)}(?:$|[^\\p{L}\\p{N}])`, "u");
      if (pattern.test(foldedHay)) return { ok: false, message: LEAK_FOUND };
      continue;
    }
    if (foldedHay.includes(needle.folded) || compactHay.includes(needle.compact)) {
      return { ok: false, message: LEAK_FOUND };
    }
  }
  return { ok: true };
}

export async function scanPdf(
  bytes: Uint8Array,
  prohibited: readonly string[],
  allowed: readonly string[] = [],
): Promise<LeakScan> {
  let parts: string[];
  try {
    parts = await pdfParts(new Uint8Array(bytes));
  } catch {
    return { ok: false, message: PDF_UNREADABLE };
  }
  const parsed = scanText(parts, prohibited, allowed);
  if (!parsed.ok) return parsed;
  return scanText([Buffer.from(bytes).toString("latin1")], prohibited, allowed);
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const parts = await pdfParts(new Uint8Array(bytes));
  return parts.join("\n");
}

export async function collectProhibitedValues(centerId: string, extra: readonly string[] = []): Promise<string[]> {
  const center = await prisma.center.findUnique({
    where: { id: centerId },
    select: { id: true, name: true, code: true },
  });
  const allowedName = normalize(center?.name ?? "");
  const [users, profiles, contacts, grades, gradeVersions, notes, noteVersions, resources, flags, requirements, devices, submissions, enrollments, sections, courses, assignments, sessions] =
    await Promise.all([
      prisma.user.findMany({ where: { centerId }, select: { id: true, email: true, displayName: true, passwordHash: true } }),
      prisma.learnerProfile.findMany({
        where: { centerId },
        select: { id: true, userId: true, learnerCode: true, displayName: true, pinHash: true },
      }),
      prisma.learnerOptionalContact.findMany({
        where: { learner: { centerId } },
        select: { learnerId: true, phoneE164: true },
      }),
      prisma.gradeEntry.findMany({
        where: { assignment: { section: { course: { centerId } } } },
        select: { id: true, academicNote: true, learnerId: true },
      }),
      prisma.gradeEntryVersion.findMany({
        where: { gradeEntry: { assignment: { section: { course: { centerId } } } } },
        select: { id: true, academicNote: true },
      }),
      prisma.progressNote.findMany({
        where: { learner: { centerId } },
        select: { id: true, body: true, customSkillLabel: true },
      }),
      prisma.progressNoteVersion.findMany({
        where: { progressNote: { learner: { centerId } } },
        select: { id: true, body: true },
      }),
      prisma.resource.findMany({ where: { course: { centerId } }, select: { id: true, bodyText: true } }),
      prisma.riskFlag.findMany({ where: { centerId }, select: { id: true, checkInNote: true, learnerId: true, reasons: true } }),
      prisma.funderRequirement.findMany({
        where: { centerId },
        select: { id: true, learnerLevelReason: true, approvedById: true },
      }),
      prisma.device.findMany({ where: { centerId }, select: { id: true, label: true } }),
      prisma.submission.findMany({
        where: { assignment: { section: { course: { centerId } } } },
        select: { id: true, storageKey: true, checksumSha256: true, learnerId: true },
      }),
      prisma.enrollment.findMany({ where: { learner: { centerId } }, select: { id: true, learnerId: true, sectionId: true } }),
      prisma.section.findMany({ where: { course: { centerId } }, select: { id: true, courseId: true } }),
      prisma.course.findMany({ where: { centerId }, select: { id: true } }),
      prisma.assignment.findMany({ where: { section: { course: { centerId } } }, select: { id: true, sectionId: true } }),
      prisma.classSession.findMany({ where: { section: { course: { centerId } } }, select: { id: true, sectionId: true } }),
    ]);

  const values: string[] = [...extra];
  if (center) {
    values.push(center.id, center.code);
  }
  for (const row of users) values.push(row.id, row.email ?? "", row.displayName ?? "", row.passwordHash ?? "");
  for (const row of profiles) values.push(row.id, row.userId, row.learnerCode, row.displayName, row.pinHash);
  for (const row of contacts) values.push(row.learnerId, row.phoneE164);
  for (const row of grades) values.push(row.id, row.learnerId, row.academicNote ?? "");
  for (const row of gradeVersions) values.push(row.id, row.academicNote ?? "");
  for (const row of notes) values.push(row.id, row.body, row.customSkillLabel ?? "");
  for (const row of noteVersions) values.push(row.id, row.body);
  for (const row of resources) values.push(row.id, row.bodyText ?? "");
  for (const row of flags) values.push(row.id, row.learnerId, row.checkInNote ?? "", ...row.reasons);
  for (const row of requirements) values.push(row.id, row.learnerLevelReason, row.approvedById);
  for (const row of devices) values.push(row.id, row.label);
  for (const row of submissions) values.push(row.id, row.learnerId, row.storageKey, row.checksumSha256);
  for (const row of enrollments) values.push(row.id, row.learnerId, row.sectionId);
  for (const row of sections) values.push(row.id, row.courseId);
  for (const row of courses) values.push(row.id);
  for (const row of assignments) values.push(row.id, row.sectionId);
  for (const row of sessions) values.push(row.id, row.sectionId);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const folded = normalize(value);
    if (folded.length < 4 || folded === allowedName || seen.has(folded)) continue;
    seen.add(folded);
    unique.push(value.trim());
  }
  return unique;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function squash(value: string): string {
  return value.replace(/\s+/g, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function pdfParts(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes, standardFontDataUrl, useSystemFonts: true });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const pieces: string[] = [];
      for (const item of content.items) {
        if (typeof item === "object" && item !== null && "str" in item && typeof item.str === "string") pieces.push(item.str);
      }
      parts.push(pieces.join(" "), pieces.join(""));
      page.cleanup();
    }
    const metadata = await doc.getMetadata();
    parts.push(JSON.stringify(metadata.info ?? {}));
    if (metadata.metadata) {
      const raw = metadata.metadata.getRaw();
      parts.push(typeof raw === "string" ? raw : JSON.stringify(raw));
      for (const entry of metadata.metadata) parts.push(JSON.stringify(entry));
    }
    const attachments = await doc.getAttachments();
    if (attachments) {
      for (const [id, attachment] of attachments) {
        parts.push(id, attachment.filename, attachment.rawFilename, attachment.description);
        const content = attachment.content ?? (await doc.getAttachmentContent(id));
        if (content) parts.push(Buffer.from(content).toString("utf8"));
      }
    }
    return parts;
  } finally {
    await task.destroy();
  }
}
