import { createHmac, randomUUID } from "node:crypto";
import { PDFDocument } from "pdfkit";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client";
import type { Actor, RoleName } from "../lib/auth/permissions";
import { completeEnrollment } from "../lib/data/enrollment-status";
import { prisma } from "../lib/db";
import { assertConnectedTestDatabase } from "../lib/test-db/connect";
import { buildSectionPerformance } from "../lib/lms/dashboard-metrics";
import { GET as getExport, POST as postExport } from "../app/api/export/route";
import { buildGrantExport } from "../lib/export/aggregate";
import { comparableChart } from "../lib/export/chart";
import { escapeCsvField, grantExportCsv } from "../lib/export/csv";
import { grantExportPdf } from "../lib/export/pdf";
import { learnerLevelOffer, listActiveExportRequirements } from "../lib/export/offer";
import { EXPORT_LIMITATION, type ExportClassMark, type GrantExport } from "../lib/export/types";
import { addCalendarDays, formatCivilDate, localDateOfInstant, parseIsoDate, zonedDateTimeToUtc } from "../lib/lms/timetable";
import * as exportApi from "../lib/export";
import { collectProhibitedValues, LEAK_FOUND, pdfText, scanPdf, scanText } from "./support/export-leakage";

const sessionActor = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/lib/auth/actor", () => ({
  getActor: async () => sessionActor.actor,
}));

const SECRET = "0123456789abcdef".repeat(4);
const SECRET_B = "fedcba9876543210".repeat(4);
const TZ = "America/New_York";
const NICK = "NICK-DAY16-HIDDEN";
const PHONE = "+15555550199";
const NOTE = "NOTE-DAY16-DO-NOT-EXPORT";
const PIN = "pin-day16-not-a-pin";
const PASS = "hash-day16-not-a-password";
const STORAGE = "private/day16/secret-file";
const CHECKSUM = "ab".repeat(32);

let previousSecret: string | undefined;
let seq = 0x160000;

const main = {
  centerId: "",
  directorId: "",
  teacherId: "",
  inactiveId: "",
  learnerUserId: "",
  profileId: "",
  deviceId: "",
  periodStart: "",
  periodEnd: "",
  registeredCodes: [] as string[],
  hiddenCodes: [] as string[],
};

const side = {
  b: "",
  c: "",
  d: "",
  r: "",
  legacy: "",
  directorB: "",
  adminId: "",
  retentionDirectorId: "",
  retentionTeacherId: "",
  beforeId: "",
  duringId: "",
  afterId: "",
  startedDuringId: "",
};

function uid(): string {
  seq += 1;
  return `00000000-0000-4000-a116-${seq.toString(16).padStart(12, "0")}`;
}

function actor(id: string, role: RoleName, centerId: string, active = true): Actor {
  return {
    id,
    role,
    centerId,
    active,
    displayName: "Day 16",
    learnerId: null,
    assignedSectionIds: [],
    enrolledSectionIds: [],
  };
}

function civilToday(timeZone: string): string {
  const local = localDateOfInstant(new Date(), timeZone);
  if (!local) throw new Error("timezone");
  return formatCivilDate(local);
}

function shift(iso: string, days: number): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) throw new Error(iso);
  return formatCivilDate(addCalendarDays(parsed, days));
}

function at(iso: string, hour: number, minute: number, timeZone: string): Date {
  const parsed = parseIsoDate(iso);
  if (!parsed) throw new Error(iso);
  const instant = zonedDateTimeToUtc({ ...parsed, hour, minute }, timeZone);
  if (!instant) throw new Error(`${iso} ${hour}`);
  return instant;
}

function dayDate(iso: string): Date {
  const parsed = parseIsoDate(iso);
  if (!parsed) throw new Error(iso);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out;
}

async function exportOneDay(centerId: string, directorId: string, day: string): Promise<string> {
  const result = await exportApi.exportCenterCsv({
    actor: actor(directorId, "CENTER_DIRECTOR", centerId),
    centerId,
    periodStart: day,
    periodEnd: day,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.csv;
}

function field(csv: string, record: string, metric: string, group = ""): string {
  const line = csv.split("\n").find((row) => {
    const parts = parseCsvLine(row);
    return parts[0] === record && parts[1] === metric && (parts[2] ?? "") === group;
  });
  if (!line) throw new Error(`missing ${record}/${metric}/${group}`);
  return parseCsvLine(line)[3] ?? "";
}

function breakdown(csv: string, dimension: string): Array<[string, string]> {
  return csv
    .split("\n")
    .map(parseCsvLine)
    .filter((parts) => parts[0] === "breakdown" && parts[1] === dimension)
    .map((parts) => [parts[2] ?? "", parts[3] ?? ""]);
}

function pseudonyms(csv: string): string[] {
  return csv
    .split("\n")
    .map(parseCsvLine)
    .filter((parts) => parts[0] === "learner")
    .map((parts) => parts[2] ?? "")
    .filter((value) => value.length > 0)
    .sort();
}

function digest(scopeKind: "report" | "funder", scopeId: string, code: string, secret: string): string {
  const payload = ["olr-export-v1", scopeKind, scopeId, code].join("\0");
  return `ps_${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
}

const DAY16_CODES = ["DAY16", "DAY16B", "DAY16C", "DAY16D", "DAY16R", "DAY16L", "DAY16M"] as const;

// One center still uses the shared delete list. The Day 16 setup calls
// removeCenters() with the seven exact codes instead.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for a single-center cleanup
async function removeCenter(code: string): Promise<void> {
  await removeCenters([code]);
}

async function removeCenters(codes: readonly string[]): Promise<void> {
  if (codes.length === 0) return;
  await assertConnectedTestDatabase();
  // One lookup for the exact codes. The local database answers one request at
  // a time, so repeating the full delete list for every center spends the
  // setup hook before any fixture is created. Every later delete uses only
  // the ids this lookup returned.
  const centers = await prisma.center.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true },
  });
  if (centers.length === 0) return;
  const centerIds = centers.map((center) => center.id);
  const inCenters = { section: { course: { centerId: { in: centerIds } } } };
  // Filters use those ids, so a seed that stopped halfway can be removed.
  // The reset switch is repeated because it ends when its transaction commits.
  await prisma.syncConflict.deleteMany({ where: { gradeEntry: { assignment: inCenters } } });
  // maxWait is how long Prisma waits for the single local connection.
  // That wait was measured past the default two seconds while a delete was still finishing.
  const cleanupTransaction = { maxWait: 20000, timeout: 20000 };
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.gradeEntryVersion.deleteMany({ where: { gradeEntry: { assignment: inCenters } } });
    await tx.attendanceRecord.deleteMany({ where: { session: inCenters } });
  }, cleanupTransaction);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.auditLog.deleteMany({ where: { centerId: { in: centerIds } } });
  }, cleanupTransaction);
  await prisma.gradeEntry.deleteMany({ where: { assignment: inCenters } });
  await prisma.submission.deleteMany({ where: { assignment: inCenters } });
  await prisma.classSession.deleteMany({ where: inCenters });
  await prisma.assignment.deleteMany({ where: inCenters });
  await prisma.enrollment.deleteMany({ where: inCenters });
  await prisma.funderRequirement.deleteMany({ where: { centerId: { in: centerIds } } });
  await prisma.device.deleteMany({ where: { centerId: { in: centerIds } } });
  await prisma.section.deleteMany({ where: { course: { centerId: { in: centerIds } } } });
  await prisma.course.deleteMany({ where: { centerId: { in: centerIds } } });
  await prisma.centerOptionalField.deleteMany({ where: { centerId: { in: centerIds } } });
  await prisma.learnerOptionalGender.deleteMany({ where: { learner: { centerId: { in: centerIds } } } });
  await prisma.learnerOptionalContact.deleteMany({ where: { learner: { centerId: { in: centerIds } } } });
  await prisma.$transaction(async (tx) => {
    await tx.learnerProfile.deleteMany({ where: { centerId: { in: centerIds } } });
    await tx.user.deleteMany({ where: { centerId: { in: centerIds } } });
  }, cleanupTransaction);
  await prisma.center.deleteMany({ where: { id: { in: centerIds } } });
}

describe("donor attendance suppression", () => {
  const secret = "0123456789abcdef".repeat(4);
  const reportId = "00000000-0000-4000-8000-0000000000a1";

  function attendanceCsv(min: number, marks: Array<"PRESENT" | "ABSENT" | null> | null): string {
    const count = marks === null ? 6 : marks.length;
    const people = Array.from({ length: count }, (_, index) => ({
      learnerCode: `LNR-P${String(index).padStart(2, "0")}`,
      ageBand: "AGE_15_17" as const,
    }));
    const classes: ExportClassMark[] =
      marks === null
        ? people.map((person, index) => ({
            sessionKey: `cancelled-${index}`,
            sectionKey: "section-1",
            learnerCode: person.learnerCode,
            sessionOn: "2026-02-02",
            sessionStatus: "CANCELLED",
            occurred: true,
            mark: null,
          }))
        : marks.map((mark, index) => ({
            sessionKey: "session-1",
            sectionKey: "section-1",
            learnerCode: people[index]?.learnerCode ?? "",
            sessionOn: "2026-02-02",
            sessionStatus: "HELD",
            occurred: true,
            mark,
          }));
    const built = buildGrantExport({
      secret,
      request: {
        centerId: "00000000-0000-4000-8000-0000000000c1",
        centerName: "Unit Center",
        reportId,
        periodStart: "2026-02-02",
        periodEnd: "2026-02-02",
        asOf: "2026-02-02",
        suppressionMin: min,
        approvedBreakdowns: [],
        mode: "aggregate",
      },
      facts: {
        genderEnabled: false,
        people,
        enrollments: people.map((person) => ({
          learnerCode: person.learnerCode,
          sectionKey: "section-1",
          status: "ACTIVE" as const,
          enrolledOn: "2026-01-01",
          withdrawnOn: null,
          completedOn: null,
        })),
        classes,
        tasks: [],
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);
    return grantExportCsv(built.report);
  }

  it("hides attendance when no learner has a recorded mark", () => {
    const csv = attendanceCsv(4, [null, null, null, null, null, null]);
    expect(field(csv, "count", "attendance_learners")).toBe("6");
    expect(field(csv, "count", "attendance_confirmed")).toBe("<4");
    expect(field(csv, "count", "attendance_eligible")).toBe("<4");
    expect(field(csv, "count", "attendance_rate")).toBe("<4");
    expect(field(csv, "count", "attendance_coverage")).toBe("<4");
    expect(csv).not.toContain("No attendance recorded yet");
    expect(csv).not.toContain("0.0%");
    expect(csv).not.toContain("attendance_rate,,0");
  });

  it("hides attendance when fewer learners than the center minimum have a recorded mark", () => {
    const csv = attendanceCsv(5, ["PRESENT", "PRESENT", null, null, null, null]);
    expect(field(csv, "count", "attendance_learners")).toBe("6");
    expect(field(csv, "count", "attendance_rate")).toBe("<5");
    expect(field(csv, "count", "attendance_coverage")).toBe("<5");
    expect(field(csv, "count", "attendance_confirmed")).toBe("<5");
    expect(field(csv, "count", "attendance_eligible")).toBe("<5");
    expect(csv).not.toContain("100.0%");
    expect(csv).not.toContain("33.3%");
    expect(csv).not.toContain("0.0%");
  });

  it("hides a one-third coverage percentage when the marked-session count is suppressed", async () => {
    const people = Array.from({ length: 5 }, (_, index) => ({
      learnerCode: `LNR-C${String(index).padStart(2, "0")}`,
      ageBand: "AGE_15_17" as const,
    }));
    const classes: ExportClassMark[] = people.flatMap((person) =>
      [0, 1, 2].map((session) => ({
        sessionKey: `session-${session}`,
        sectionKey: "section-1",
        learnerCode: person.learnerCode,
        sessionOn: "2026-02-02",
        sessionStatus: "HELD" as const,
        occurred: true,
        mark: session === 0 ? ("PRESENT" as const) : null,
      })),
    );
    const built = buildGrantExport({
      secret,
      request: {
        centerId: "00000000-0000-4000-8000-0000000000c1",
        centerName: "Unit Center",
        reportId,
        periodStart: "2026-02-02",
        periodEnd: "2026-02-02",
        asOf: "2026-02-02",
        suppressionMin: 5,
        approvedBreakdowns: [],
        mode: "aggregate",
      },
      facts: {
        genderEnabled: false,
        people,
        enrollments: people.map((person) => ({
          learnerCode: person.learnerCode,
          sectionKey: "section-1",
          status: "ACTIVE" as const,
          enrolledOn: "2026-01-01",
          withdrawnOn: null,
          completedOn: null,
        })),
        classes,
        tasks: [],
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);
    const csv = grantExportCsv(built.report);
    expect(field(csv, "count", "attendance_confirmed")).toBe("<5");
    expect(field(csv, "count", "attendance_eligible")).toBe("<5");
    expect(field(csv, "count", "attendance_rate")).toBe("<5");
    expect(field(csv, "count", "attendance_coverage")).toBe("<5");
    expect(csv).not.toContain("33.3%");
    const text = await pdfText(await grantExportPdf(built.report));
    expect(text).toContain("attendance_coverage: <5");
    expect(text).not.toContain("33.3%");
  });

  it("publishes attendance when each underlying learner group meets the center minimum", () => {
    const marks = [
      ...Array<"PRESENT">(5).fill("PRESENT"),
      ...Array<"ABSENT">(5).fill("ABSENT"),
      ...Array<null>(5).fill(null),
    ];
    const csv = attendanceCsv(5, marks);
    expect(field(csv, "count", "attendance_learners")).toBe("15");
    expect(field(csv, "count", "attendance_confirmed")).toBe("5");
    expect(field(csv, "count", "attendance_eligible")).toBe("10");
    expect(field(csv, "count", "attendance_rate")).toBe("50.0%");
    expect(field(csv, "count", "attendance_coverage")).toBe("66.7%");
  });

  it("hides attendance when no session is eligible", () => {
    const csv = attendanceCsv(5, null);
    expect(field(csv, "count", "attendance_learners")).toBe("<5");
    expect(field(csv, "count", "attendance_confirmed")).toBe("<5");
    expect(field(csv, "count", "attendance_eligible")).toBe("<5");
    expect(field(csv, "count", "attendance_rate")).toBe("<5");
    expect(field(csv, "count", "attendance_coverage")).toBe("<5");
    expect(csv).not.toContain("No eligible sessions yet");
    expect(csv).not.toContain("No attendance recorded yet");
    expect(csv).not.toContain("0.0%");
    expect(csv).not.toContain("attendance_learners,,0");
  });
});

describe("export chart and leakage scanner", () => {
  it("charts one breakdown only when every cell is a published learner count", () => {
    const hidden = comparableChart(sampleReport([
      { dimension: "ageBand", rows: [{ value: "AGE_6_8", learners: "<5" }, { value: "AGE_18_24", learners: 12 }] },
    ]));
    expect(hidden).toBeNull();
    const single = comparableChart(sampleReport([
      { dimension: "ageBand", rows: [{ value: "AGE_15_17", learners: 11 }] },
      { dimension: "gender", rows: [{ value: "FEMALE", learners: 6 }, { value: "MALE", learners: 5 }] },
    ]));
    expect(single).toEqual({
      dimension: "gender",
      rows: [
        { label: "FEMALE", count: 6 },
        { label: "MALE", count: 5 },
      ],
    });
  });

  it("detects a prohibited value planted only in a test PDF", async () => {
    const sentinel = "LEAKPROBE-DAY17-VALUE";
    const dirty = await tinyPdf(sentinel, "Clean page");
    expect(await scanPdf(dirty, [sentinel])).toEqual({ ok: false, message: LEAK_FOUND });
    const clean = await tinyPdf("Grant export", "Clean page");
    expect(await scanPdf(clean, [sentinel])).toEqual({ ok: true });
    expect(scanText([`note ${sentinel}`], [sentinel])).toEqual({ ok: false, message: LEAK_FOUND });
    expect(scanText(["LEAKPROBE-  DAY17-VALUE"], [sentinel])).toEqual({ ok: false, message: LEAK_FOUND });
    expect(scanText(["planned work"], ["plan"])).toEqual({ ok: true });
    expect(scanText(["the plan stands"], ["plan"])).toEqual({ ok: false, message: LEAK_FOUND });
  });
});

function sampleReport(breakdowns: GrantExport["breakdowns"]): GrantExport {
  return {
    kind: "grant-export",
    centerName: "Chart Center",
    mode: "aggregate",
    reportId: "11111111-1111-4111-8111-111111111111",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    asOf: "2026-01-31",
    suppressionMin: 5,
    pseudonymScope: "report",
    limitation: EXPORT_LIMITATION,
    registeredLearners: 11,
    retentionCohort: "<5",
    retainedLearners: "<5",
    retentionRate: "<5",
    attendance: { learners: "<5", confirmed: "<5", eligible: "<5", rate: "<5", coverage: "<5" },
    assignmentCompletion: { learners: "<5", completed: "<5", expected: "<5", rate: "<5" },
    breakdowns,
    learners: [],
  };
}

function exportRequest(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request("http://local.test/api/export", {
    method: "POST",
    headers: {
      origin: "http://local.test",
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields),
  });
}

async function expectNoFile(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-disposition")).toBeNull();
  const text = await response.text();
  expect(text.startsWith("%PDF")).toBe(false);
  expect(text.includes("record_type")).toBe(false);
}

function tinyPdf(title: string, pageText: string): Promise<Uint8Array> {
  const doc = new PDFDocument({ info: { Title: title, Creator: "Open LMS Refuge", Producer: "PDFKit" } });
  const chunks: Buffer[] = [];
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.text(pageText);
  doc.end();
  return done;
}

describe("database-backed donor export", () => {
  // A five-statement seed was measured at 26 seconds. A five-minute hook
  // still timed out while deleting leftover day-16 rows, so the hook stays
  // at two minutes. A longer wait does not make the local database faster.
  beforeAll(async () => {
    previousSecret = process.env.EXPORT_SECRET;
    process.env.EXPORT_SECRET = SECRET;
    await removeCenters(DAY16_CODES);
    await seedMain();
    side.b = await seedPlainCenter("DAY16B", 5, TZ, true);
    side.directorB = (await prisma.user.findFirstOrThrow({ where: { centerId: side.b, role: "CENTER_DIRECTOR" } })).id;
    side.adminId = await addStaff(side.b, "ADMIN", "day16b-admin@example.test");
    await seedZeroWork(side.b);
    side.c = await seedBands("DAY16C", [
      ["AGE_6_8", 3],
      ["AGE_18_24", 17],
    ]);
    side.d = await seedBands("DAY16D", [
      ["AGE_6_8", 4],
      ["AGE_9_11", 4],
      ["AGE_18_24", 12],
    ]);
    side.r = await seedRetention();
    side.legacy = await seedLegacyCompletion();
  }, 120000);

  afterAll(async () => {
    try {
      await removeCenters(DAY16_CODES);
      if (previousSecret === undefined) delete process.env.EXPORT_SECRET;
      else process.env.EXPORT_SECRET = previousSecret;
    } finally {
      await prisma.$disconnect();
    }
  }, 120000);

  it("exposes only the protected operations", () => {
    expect(Object.keys(exportApi).sort()).toEqual(
      [
        "EXPORT_DENIED",
        "EXPORT_LIMITATION",
        "approveFunderRequirement",
        "deactivateFunderRequirement",
        "exportCenterCsv",
        "exportCenterReport",
        "listFunderRequirements",
        "recordLearnerLevelRequirement",
      ].sort(),
    );
  });

  it("builds the report from database rows and does not double-count a learner", async () => {
    const result = await exportApi.exportCenterCsv({
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: main.centerId,
      periodStart: main.periodStart,
      periodEnd: main.periodEnd,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe(`grant-export-${main.periodStart}-to-${main.periodEnd}.csv`);
    expect(result.filename).not.toContain("NICK");
    expect(result.filename).not.toContain("LNR");
    expect(field(result.csv, "report", "center_name")).toBe("Day 16 Center");
    expect(field(result.csv, "report", "mode")).toBe("aggregate");
    expect(field(result.csv, "count", "registered_learners")).toBe("11");
    expect(field(result.csv, "count", "retention_cohort")).toBe("11");
    expect(field(result.csv, "count", "retained_learners")).toBe("<5");
    expect(field(result.csv, "count", "retention_rate")).toBe("<5");
    expect(field(result.csv, "count", "attendance_learners")).toBe("10");
    expect(field(result.csv, "count", "attendance_confirmed")).toBe("10");
    expect(field(result.csv, "count", "attendance_eligible")).toBe("20");
    expect(field(result.csv, "count", "attendance_rate")).toBe("50.0%");
    expect(field(result.csv, "count", "attendance_coverage")).toBe("66.7%");
    expect(result.csv).not.toContain("33.3%");
    expect(field(result.csv, "count", "assignment_learners")).toBe("10");
    expect(field(result.csv, "count", "assignment_completed")).toBe("26");
    expect(field(result.csv, "count", "assignment_expected")).toBe("40");
    expect(field(result.csv, "count", "assignment_rate")).toBe("65.0%");
    expect(breakdown(result.csv, "ageBand")).toEqual([["AGE_15_17", "11"]]);
    expect(breakdown(result.csv, "gender")).toEqual([
      ["FEMALE", "6"],
      ["MALE", "5"],
    ]);
    expect(result.csv).not.toContain("NONBINARY");
    expect(pseudonyms(result.csv)).toEqual([]);
    expect(result.csv).not.toContain("'50.0%");
    expect(result.csv).not.toContain("'11");
    expect(result.csv).toContain(`,"${EXPORT_LIMITATION}"`);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "EXPORT", entityId: result.reportId },
    });
    expect(audit.centerId).toBe(main.centerId);
    expect(audit.action).toBe("EXPORT");
    expect(audit.metadata).toMatchObject({
      source: "grant-export",
      format: "CSV",
      mode: "AGGREGATE",
      periodStart: main.periodStart,
      periodEnd: main.periodEnd,
      suppressionMin: 5,
      pseudonymScope: "report",
      centerCode: "DAY16",
    });
    const meta = JSON.stringify(audit.metadata);
    for (const token of [NICK, PHONE, NOTE, PIN, PASS, STORAGE, SECRET, ...main.registeredCodes, ...main.hiddenCodes, main.profileId]) {
      expect(result.csv).not.toContain(token);
      expect(meta).not.toContain(token);
    }
  });

  it("keeps a March 8 New York session on the local calendar day", async () => {
    expect(new Date("2026-03-08T08:00:00.000Z").getTime()).toBeLessThan(Date.now());
    const result = await exportApi.exportCenterCsv({
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: main.centerId,
      periodStart: "2026-03-08",
      periodEnd: "2026-03-08",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(field(result.csv, "count", "attendance_learners")).toBe("6");
    expect(field(result.csv, "count", "attendance_rate")).toBe("<5");
    expect(field(result.csv, "count", "attendance_coverage")).toBe("<5");
  });

  it("leaves a partly unmarked session out of the attendance rate", async () => {
    const result = await exportOneDay(main.centerId, main.directorId, "2026-02-05");
    expect(field(result, "count", "attendance_learners")).toBe("6");
    expect(field(result, "count", "attendance_rate")).toBe("<5");
    expect(field(result, "count", "attendance_coverage")).toBe("<5");
  });

  it("counts a fully marked session from present, late, absent, and excused", async () => {
    const result = await exportOneDay(main.centerId, main.directorId, "2026-02-10");
    expect(field(result, "count", "attendance_learners")).toBe("6");
    expect(field(result, "count", "attendance_confirmed")).toBe("6");
    expect(field(result, "count", "attendance_eligible")).toBe("12");
    expect(field(result, "count", "attendance_rate")).toBe("50.0%");
    expect(field(result, "count", "attendance_coverage")).toBe("<5");
  });

  it("does not treat a completely unmarked session as absence", async () => {
    const result = await exportOneDay(main.centerId, main.directorId, "2026-02-02");
    expect(field(result, "count", "attendance_learners")).toBe("6");
    expect(field(result, "count", "attendance_confirmed")).toBe("<5");
    expect(field(result, "count", "attendance_eligible")).toBe("<5");
    expect(field(result, "count", "attendance_rate")).toBe("<5");
    expect(field(result, "count", "attendance_coverage")).toBe("<5");
    expect(result).not.toContain("No attendance recorded yet");
    expect(result).not.toContain("0.0%");
    expect(result).not.toContain("attendance_rate,,0");
  });

  it("matches the performance dashboard on the same attendance records", async () => {
    const seeded = await seedSharedAttendance();
    const sharedNow = new Date("2026-11-13T12:00:00.000Z");
    const csv = await exportOneDay(seeded.centerId, seeded.directorId, "2026-02-20");
    expect(field(csv, "count", "attendance_rate")).toBe("77.8%");
    expect(field(csv, "count", "attendance_coverage")).toBe("90.0%");

    const model = buildSectionPerformance(await performanceInput(seeded.sectionId, sharedNow));
    expect(model.attendance.confirmedLabel).toBe("77.8%");
    expect(model.attendance.coverageLabel).toBe("90.0%");
    expect(model.cancelledSessions).toBe(1);
    expect(model.futureSessions).toBe(1);
    for (const learner of model.learners) {
      expect(learner.attendance.confirmedLabel).toBe(field(csv, "count", "attendance_rate"));
      expect(learner.attendance.coverageLabel).toBe(field(csv, "count", "attendance_coverage"));
      expect(learner.attendance.present).toBe(6);
      expect(learner.attendance.late).toBe(1);
      expect(learner.attendance.absent).toBe(1);
      expect(learner.attendance.excused).toBe(1);
      expect(learner.attendance.unmarked).toBe(1);
    }

    const presentOnly = await exportOneDay(seeded.centerId, seeded.directorId, "2026-02-21");
    expect(field(presentOnly, "count", "attendance_rate")).toBe("<2");
    expect(field(presentOnly, "count", "attendance_coverage")).toBe("<2");
    expect(presentOnly).not.toContain("100.0%");
    const presentModel = buildSectionPerformance(await performanceInput(seeded.sectionId, sharedNow, "2026-02-21"));
    expect(presentModel.learners[0]?.attendance.confirmedLabel).toBe("100.0%");
    expect(presentModel.learners[0]?.attendance.coverageLabel).toBe("100.0%");

    const blank = await exportOneDay(seeded.centerId, seeded.directorId, "2026-02-22");
    expect(field(blank, "count", "attendance_rate")).toBe("<2");
    expect(field(blank, "count", "attendance_coverage")).toBe("<2");
    expect(blank).not.toContain("No attendance recorded yet");
    expect(blank).not.toContain("0.0%");
    const blankModel = buildSectionPerformance(await performanceInput(seeded.sectionId, sharedNow, "2026-02-22"));
    expect(blankModel.learners[0]?.attendance.confirmedLabel).toBe("No attendance recorded yet");
    expect(blankModel.learners[0]?.attendance.coverageLabel).toBe("0.0%");
  });

  it("counts completed enrollments through the completion date", async () => {
    const teacher = actor(side.retentionTeacherId, "TEACHER", side.r);
    const denied = await completeEnrollment({
      actor: teacher,
      enrollmentId: side.beforeId,
      completedOn: "2026-01-05",
    });
    expect(denied.ok).toBe(false);
    const director = actor(side.retentionDirectorId, "CENTER_DIRECTOR", side.r);
    const completions = [
      [side.beforeId, "2026-01-05"],
      [side.duringId, "2026-01-20"],
      [side.afterId, "2026-02-15"],
      [side.startedDuringId, "2026-01-25"],
    ] as const;
    for (const [enrollmentId, completedOn] of completions) {
      const saved = await completeEnrollment({ actor: director, enrollmentId, completedOn });
      expect(saved.ok).toBe(true);
    }
    const stored = await prisma.enrollment.findMany({
      where: { id: { in: completions.map(([id]) => id) } },
      select: { id: true, status: true, completedOn: true, withdrawnOn: true },
    });
    expect(stored).toHaveLength(4);
    for (const row of stored) {
      expect(row.status).toBe("COMPLETED");
      expect(row.withdrawnOn).toBeNull();
      const expected = completions.find(([id]) => id === row.id)?.[1];
      expect(row.completedOn?.toISOString().slice(0, 10)).toBe(expected);
    }
    const result = await exportApi.exportCenterCsv({
      actor: director,
      centerId: side.r,
      periodStart: "2026-01-10",
      periodEnd: "2026-01-31",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(field(result.csv, "count", "registered_learners")).toBe("9");
    expect(field(result.csv, "count", "retention_cohort")).toBe("8");
    expect(field(result.csv, "count", "retained_learners")).toBe("5");
    expect(field(result.csv, "count", "retention_rate")).toBe("62.5%");
    expect(field(result.csv, "count", "attendance_rate")).toBe("<2");
    expect(field(result.csv, "count", "attendance_coverage")).toBe("<2");
    expect(result.csv).not.toContain("No eligible sessions yet");
    expect(result.csv).not.toContain("0.0%");
    expect(result.csv).not.toContain("attendance_confirmed,,0");
  });

  it("withholds retention when a completed enrollment has no completion date", async () => {
    const director = await prisma.user.findFirstOrThrow({ where: { centerId: side.legacy, role: "CENTER_DIRECTOR" } });
    const result = await exportApi.exportCenterCsv({
      actor: actor(director.id, "CENTER_DIRECTOR", side.legacy),
      centerId: side.legacy,
      periodStart: "2026-01-10",
      periodEnd: "2026-01-31",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(field(result.csv, "count", "registered_learners")).toBe("4");
    expect(field(result.csv, "count", "retention_cohort")).toBe("Completion date missing");
    expect(field(result.csv, "count", "retained_learners")).toBe("Completion date missing");
    expect(field(result.csv, "count", "retention_rate")).toBe("Completion date missing");
    const legacy = await prisma.enrollment.findFirstOrThrow({
      where: { status: "COMPLETED", completedOn: null, learner: { centerId: side.legacy } },
    });
    expect(legacy.completedOn).toBeNull();
  });

  it("records a completion date only for a director of the center or an admin", async () => {
    const section = await prisma.section.findFirstOrThrow({ where: { course: { centerId: side.r } } });
    const person = learnerRow(50);
    const enrollmentId = uid();
    const inactiveId = uid();
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          student(person.userId, side.r),
          staff(inactiveId, side.r, "CENTER_DIRECTOR", "day16r-inactive@example.test", false),
        ],
      });
      await tx.learnerProfile.create({ data: profile(person.profileId, person.userId, side.r, person.code) });
      await tx.enrollment.create({
        data: { ...enrollment(section.id, person.profileId, "ACTIVE", "2026-01-01", null), id: enrollmentId },
      });
    });
    const date = "2026-01-05";
    const attempts = [
      null,
      actor(side.retentionTeacherId, "TEACHER", side.r),
      actor(side.directorB, "CENTER_DIRECTOR", side.b),
      actor(inactiveId, "CENTER_DIRECTOR", side.r, false),
      actor(person.userId, "STUDENT", side.r),
    ];
    for (const attempt of attempts) {
      const denied = await completeEnrollment({ actor: attempt, enrollmentId, completedOn: date });
      expect(denied.ok).toBe(false);
    }
    const withdrawn = await prisma.enrollment.findFirstOrThrow({
      where: { sectionId: section.id, status: "WITHDRAWN" },
    });
    const withdrawnOn = withdrawn.withdrawnOn?.toISOString();
    const blocked = await completeEnrollment({
      actor: actor(side.retentionDirectorId, "CENTER_DIRECTOR", side.r),
      enrollmentId: withdrawn.id,
      completedOn: date,
    });
    expect(blocked.ok).toBe(false);
    const stillWithdrawn = await prisma.enrollment.findUniqueOrThrow({ where: { id: withdrawn.id } });
    expect(stillWithdrawn.status).toBe("WITHDRAWN");
    expect(stillWithdrawn.withdrawnOn?.toISOString()).toBe(withdrawnOn);
    expect(stillWithdrawn.completedOn).toBeNull();

    const saved = await completeEnrollment({
      actor: actor(side.adminId, "ADMIN", side.b),
      enrollmentId,
      completedOn: date,
    });
    expect(saved.ok).toBe(true);
    const stored = await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(stored.status).toBe("COMPLETED");
    expect(stored.withdrawnOn).toBeNull();
    expect(stored.completedOn?.toISOString().slice(0, 10)).toBe(date);
    expect(stored.updatedAt.toISOString().slice(0, 10)).not.toBe(date);
  });

  it("hides a completion count of zero and ignores a requested threshold", async () => {
    const result = await exportApi.exportCenterCsv({
      actor: actor(side.directorB, "CENTER_DIRECTOR", side.b),
      centerId: side.b,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      suppressionMin: 2,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(field(result.csv, "count", "registered_learners")).toBe("6");
    expect(field(result.csv, "count", "assignment_learners")).toBe("6");
    expect(field(result.csv, "count", "assignment_completed")).toBe("<5");
    expect(field(result.csv, "count", "assignment_expected")).toBe("<5");
    expect(field(result.csv, "count", "assignment_rate")).toBe("<5");
    expect(result.csv).not.toContain("0.0%");
    expect(result.csv).not.toContain("assignment_completed,,0");
    expect(result.csv).not.toContain("FEMALE");
    expect(result.csv).not.toContain(PHONE);
    expect(result.csv).not.toContain(NICK);
    await prisma.center.update({ where: { id: side.b }, data: { smallGroupSuppressionMin: 10 } });
    try {
      const hidden = await exportApi.exportCenterCsv({
        actor: actor(side.directorB, "CENTER_DIRECTOR", side.b),
        centerId: side.b,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        suppressionMin: 2,
      } as never);
      expect(hidden.ok).toBe(true);
      if (!hidden.ok) return;
      expect(field(hidden.csv, "count", "registered_learners")).toBe("<10");
      expect(field(hidden.csv, "report", "suppression_min")).toBe("10");
    } finally {
      await prisma.center.update({ where: { id: side.b }, data: { smallGroupSuppressionMin: 5 } });
    }
  });

  it("applies complementary suppression and leaves two small cells hidden", async () => {
    const directorC = await prisma.user.findFirstOrThrow({ where: { centerId: side.c, role: "CENTER_DIRECTOR" } });
    const complementary = await exportApi.exportCenterCsv({
      actor: actor(directorC.id, "CENTER_DIRECTOR", side.c),
      centerId: side.c,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(complementary.ok).toBe(true);
    if (!complementary.ok) return;
    expect(field(complementary.csv, "count", "registered_learners")).toBe("20");
    expect(breakdown(complementary.csv, "ageBand")).toEqual([
      ["AGE_18_24", "<5"],
      ["AGE_6_8", "<5"],
    ]);
    const directorD = await prisma.user.findFirstOrThrow({ where: { centerId: side.d, role: "CENTER_DIRECTOR" } });
    const several = await exportApi.exportCenterCsv({
      actor: actor(directorD.id, "CENTER_DIRECTOR", side.d),
      centerId: side.d,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(several.ok).toBe(true);
    if (!several.ok) return;
    expect(breakdown(several.csv, "ageBand")).toEqual([
      ["AGE_18_24", "12"],
      ["AGE_6_8", "<5"],
      ["AGE_9_11", "<5"],
    ]);
    expect(field(several.csv, "count", "registered_learners")).toBe("20");
  });

  it("refuses a learner-level file unless a saved requirement allows it", async () => {
    const base = {
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: main.centerId,
      periodStart: main.periodStart,
      periodEnd: main.periodEnd,
    };
    const before = await prisma.auditLog.count({ where: { centerId: main.centerId, action: "EXPORT" } });
    const unconfirmed = await exportApi.exportCenterCsv({ ...base, mode: "pseudonymized" });
    expect(unconfirmed).toEqual({
      ok: false,
      message: "A learner-level export needs confirmation that the file is still sensitive and is not anonymous.",
    });
    expect(await prisma.auditLog.count({ where: { centerId: main.centerId, action: "EXPORT" } })).toBe(before);
    const missing = await exportApi.exportCenterCsv({ ...base, mode: "pseudonymized", learnerLevelConfirmed: true });
    expect(missing).toEqual({
      ok: false,
      message: "A learner-level export needs an active funder requirement approved for this center.",
    });
    const forged = await exportApi.exportCenterCsv({ ...base, mode: "pseudonymized", learnerLevelConfirmed: true, requirementId: randomUUID() });
    expect(forged.ok).toBe(false);
    const teacher = await exportApi.approveFunderRequirement({
      actor: actor(main.teacherId, "TEACHER", main.centerId),
      centerId: main.centerId,
      funderName: "Example Fund",
      requirementReference: "FUND-2026-Q1",
      learnerLevelReason: "The written agreement asks for learner rows.",
      crossReportLinkage: false,
    });
    expect(teacher.ok).toBe(false);
    const approved = await exportApi.approveFunderRequirement({
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: main.centerId,
      funderName: "Example Fund",
      requirementReference: "FUND-2026-Q1",
      learnerLevelReason: "The written agreement asks for learner rows.",
      crossReportLinkage: false,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const approvalAudit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "FUNDER_REQUIREMENT", entityId: approved.id },
    });
    expect(approvalAudit.metadata).toMatchObject({
      source: "funder-requirement",
      requirementReference: "FUND-2026-Q1",
      crossReportLinkage: false,
    });
    expect(JSON.stringify(approvalAudit.metadata)).not.toContain("learner rows");
    const other = await exportApi.approveFunderRequirement({
      actor: actor(side.directorB, "CENTER_DIRECTOR", side.b),
      centerId: side.b,
      funderName: "Other Fund",
      requirementReference: "OTHER-2026",
      learnerLevelReason: "This requirement belongs to another center.",
      crossReportLinkage: true,
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    const wrongCenter = await exportApi.exportCenterCsv({ ...base, mode: "pseudonymized", learnerLevelConfirmed: true, requirementId: other.id });
    expect(wrongCenter.ok).toBe(false);
    const linked = await exportApi.approveFunderRequirement({
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: main.centerId,
      funderName: "Example Fund",
      requirementReference: "FUND-2026-LINK",
      learnerLevelReason: "The agreement also asks to link reports.",
      crossReportLinkage: true,
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    const first = await exportApi.exportCenterCsv({ ...base, mode: "pseudonymized", learnerLevelConfirmed: true, requirementId: approved.id });
    const second = await exportApi.exportCenterCsv({ ...base, mode: "pseudonymized", learnerLevelConfirmed: true, requirementId: approved.id });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.reportId).not.toBe(second.reportId);
    expect(pseudonyms(first.csv)).not.toEqual(pseudonyms(second.csv));
    const reportScope = main.registeredCodes.map((code) => digest("report", first.reportId, code, SECRET)).sort();
    expect(pseudonyms(first.csv)).toEqual(reportScope);
    const stableA = await exportApi.exportCenterCsv({ ...base, mode: "pseudonymized", learnerLevelConfirmed: true, requirementId: linked.id });
    const stableB = await exportApi.exportCenterCsv({
      ...base,
      mode: "pseudonymized", learnerLevelConfirmed: true,
      requirementId: linked.id,
      reportId: "11111111-1111-4111-8111-111111111111",
    } as never);
    expect(stableA.ok && stableB.ok).toBe(true);
    if (!stableA.ok || !stableB.ok) return;
    expect(stableA.reportId).not.toBe("11111111-1111-4111-8111-111111111111");
    expect(stableA.reportId).not.toBe(stableB.reportId);
    const stable = main.registeredCodes.map((code) => digest("funder", linked.id, code, SECRET)).sort();
    expect(pseudonyms(stableA.csv)).toEqual(stable);
    expect(pseudonyms(stableB.csv)).toEqual(stable);
    const audited = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "EXPORT", entityId: stableA.reportId } });
    expect(audited.metadata).toMatchObject({
      mode: "PSEUDONYMIZED",
      requirementReference: "FUND-2026-LINK",
      crossReportLinkage: true,
      pseudonymScope: "funder",
      learnerLevelConfirmed: true,
    });
    const auditedText = JSON.stringify(audited.metadata);
    expect(auditedText).not.toContain(main.registeredCodes[0]);
    expect(auditedText).not.toContain("Example Fund");
    expect(auditedText).not.toContain("link reports");
    await prisma.funderRequirement.update({
      where: { id: approved.id },
      data: { active: false, deactivatedAt: new Date() },
    });
    const inactiveRequirement = await exportApi.exportCenterCsv({
      ...base,
      mode: "pseudonymized", learnerLevelConfirmed: true,
      requirementId: approved.id,
    });
    expect(inactiveRequirement.ok).toBe(false);
    process.env.EXPORT_SECRET = SECRET_B;
    try {
      const otherSecret = await exportApi.exportCenterCsv({ ...base, mode: "pseudonymized", learnerLevelConfirmed: true, requirementId: linked.id });
      expect(otherSecret.ok).toBe(true);
      if (!otherSecret.ok) return;
      expect(pseudonyms(otherSecret.csv)).not.toEqual(stable);
      expect(otherSecret.csv).not.toContain(SECRET_B);
    } finally {
      process.env.EXPORT_SECRET = SECRET;
    }
    const after = await prisma.auditLog.count({ where: { centerId: main.centerId, action: "EXPORT" } });
    expect(after).toBeGreaterThan(before);
  });

  it("allows an admin and refuses teachers, learners, inactive accounts, and other centers", async () => {
    const period = { periodStart: main.periodStart, periodEnd: main.periodEnd };
    const allowed = await exportApi.exportCenterCsv({
      actor: actor(side.adminId, "ADMIN", side.b),
      centerId: main.centerId,
      ...period,
    });
    expect(allowed.ok).toBe(true);
    const cases: Array<Actor | null> = [
      null,
      actor(main.teacherId, "TEACHER", main.centerId),
      actor(main.teacherId, "CENTER_DIRECTOR", main.centerId),
      actor(main.learnerUserId, "STUDENT", main.centerId),
      actor(main.inactiveId, "CENTER_DIRECTOR", main.centerId, true),
      actor(side.directorB, "CENTER_DIRECTOR", side.b),
    ];
    for (const person of cases) {
      const denied = await exportApi.exportCenterCsv({ actor: person, centerId: main.centerId, ...period });
      expect(denied).toEqual({ ok: false, message: exportApi.EXPORT_DENIED });
    }
  });

  it("does not return a file when the audit insert fails", async () => {
    const before = await prisma.auditLog.count({ where: { centerId: main.centerId, action: "EXPORT" } });
    const original = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation((async (arg: unknown, options?: unknown) => {
      if (typeof arg !== "function") return original(arg as never, options as never);
      return original(async (tx: Prisma.TransactionClient) => {
        const wrapped = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === "auditLog") {
              const model = Reflect.get(target, prop, receiver) as object;
              return new Proxy(model, {
                get(inner, key, innerReceiver) {
                  if (key === "create") return () => Promise.reject(new Error("audit failed"));
                  const value = Reflect.get(inner, key, innerReceiver);
                  return typeof value === "function" ? value.bind(inner) : value;
                },
              });
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return (arg as (client: Prisma.TransactionClient) => Promise<unknown>)(wrapped as Prisma.TransactionClient);
      }, options as never);
    }) as typeof prisma.$transaction);
    try {
      await expect(
        exportApi.exportCenterCsv({
          actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
          centerId: main.centerId,
          periodStart: main.periodStart,
          periodEnd: main.periodEnd,
        }),
      ).rejects.toThrow(/audit failed/);
      await expect(
        exportApi.exportCenterReport({
          actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
          centerId: main.centerId,
          periodStart: main.periodStart,
          periodEnd: main.periodEnd,
          format: "pdf",
        }),
      ).rejects.toThrow(/audit failed/);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.auditLog.count({ where: { centerId: main.centerId, action: "EXPORT" } });
    expect(after).toBe(before);
  });

  it("rejects an unusable center setting or date range", async () => {
    const base = {
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: main.centerId,
      periodStart: main.periodStart,
      periodEnd: main.periodEnd,
    };
    await prisma.center.update({ where: { id: main.centerId }, data: { smallGroupSuppressionMin: 1 } });
    try {
      const low = await exportApi.exportCenterCsv(base);
      expect(low).toEqual({ ok: false, message: "This center's small-group minimum cannot be used for an export." });
    } finally {
      await prisma.center.update({ where: { id: main.centerId }, data: { smallGroupSuppressionMin: 5 } });
    }
    await prisma.center.update({ where: { id: main.centerId }, data: { timezone: "Not/AZone" } });
    try {
      const zone = await exportApi.exportCenterCsv(base);
      expect(zone).toEqual({ ok: false, message: "The center clock could not be read." });
    } finally {
      await prisma.center.update({ where: { id: main.centerId }, data: { timezone: TZ } });
    }
    const inverted = await exportApi.exportCenterCsv({ ...base, periodStart: "2026-05-02", periodEnd: "2026-05-01" });
    expect(inverted).toEqual({ ok: false, message: "The export dates could not be read." });
    const impossible = await exportApi.exportCenterCsv({ ...base, periodStart: "2026-02-31", periodEnd: "2026-03-01" });
    expect(impossible.ok).toBe(false);
    process.env.EXPORT_SECRET = "replace-with-a-long-random-secret";
    try {
      await expect(exportApi.exportCenterCsv(base)).rejects.toThrow(/EXPORT_SECRET/);
    } finally {
      process.env.EXPORT_SECRET = SECRET;
    }
  });

  it("lets an active admin export two centers and denies an inactive admin", async () => {
    const period = { periodStart: "2026-01-01", periodEnd: "2026-01-31" };
    const admin = actor(side.adminId, "ADMIN", side.b);
    const first = await exportApi.exportCenterCsv({ actor: admin, centerId: main.centerId, ...period });
    const second = await exportApi.exportCenterCsv({ actor: admin, centerId: side.b, ...period });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(field(first.csv, "report", "center_name")).toBe("Day 16 Center");
    expect(field(second.csv, "report", "center_name")).toBe("DAY16B");
    const directorDenied = await exportApi.exportCenterCsv({
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: side.b,
      ...period,
    });
    expect(directorDenied).toEqual({ ok: false, message: exportApi.EXPORT_DENIED });
    const inactiveAdmin = await addStaff(main.centerId, "ADMIN", "day17-inactive-admin@example.test");
    await prisma.user.update({
      where: { id: inactiveAdmin },
      data: { active: false, deactivatedAt: new Date("2026-02-02T00:00:00.000Z") },
    });
    const deniedMain = await exportApi.exportCenterCsv({
      actor: actor(inactiveAdmin, "ADMIN", main.centerId, true),
      centerId: main.centerId,
      periodStart: main.periodStart,
      periodEnd: main.periodEnd,
    });
    const deniedOther = await exportApi.exportCenterCsv({
      actor: actor(inactiveAdmin, "ADMIN", side.b, true),
      centerId: side.b,
      ...period,
    });
    expect(deniedMain).toEqual({ ok: false, message: exportApi.EXPORT_DENIED });
    expect(deniedOther).toEqual({ ok: false, message: exportApi.EXPORT_DENIED });
  });

  it("offers the learner-level warning only when an active requirement exists", async () => {
    expect(learnerLevelOffer(0)).toEqual({ offered: false, warning: null, confirmationLabel: null });
    const saved = await exportApi.approveFunderRequirement({
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: main.centerId,
      funderName: "Example Fund",
      requirementReference: "FUND-DAY17-WARN",
      learnerLevelReason: "Rows are required for this test only.",
      crossReportLinkage: false,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const rows = await listActiveExportRequirements(main.centerId);
    const offer = learnerLevelOffer(rows.length);
    expect(offer.offered).toBe(true);
    expect(offer.warning).toBe("Pseudonymized learner-level data is still sensitive and is not anonymous.");
    expect(offer.confirmationLabel).toBe(
      "I confirm that a funder requires learner-level reporting for this download, and that this file is still sensitive and is not anonymous.",
    );
    expect(rows.some((row) => row.id === saved.id)).toBe(true);
    expect(rows.every((row) => !("learnerLevelReason" in row))).toBe(true);
    await prisma.funderRequirement.update({
      where: { id: saved.id },
      data: { active: false, deactivatedAt: new Date() },
    });
    const after = await listActiveExportRequirements(main.centerId);
    expect(after.some((row) => row.id === saved.id)).toBe(false);
    expect(learnerLevelOffer(after.filter((row) => row.id === saved.id).length).offered).toBe(false);
  });

  it("records, shows, and turns off a learner-level requirement without a funder name", async () => {
    const director = actor(main.directorId, "CENTER_DIRECTOR", main.centerId);
    const reason = "The agreement asks for learner rows in this test.";
    let generatedId: string | null = null;
    const recorded = await exportApi.recordLearnerLevelRequirement({
      actor: director,
      centerId: main.centerId,
      learnerLevelReason: reason,
      requirementReference: "grant-day26",
      crossReportLinkage: false,
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    try {
      const row = await prisma.funderRequirement.findUniqueOrThrow({ where: { id: recorded.id } });
      expect(row.funderName).toBe("Not recorded");
      expect(row.requirementReference).toBe("GRANT-DAY26");
      expect(row.active).toBe(true);
      const listed = await exportApi.listFunderRequirements(director, main.centerId);
      const shown = listed?.find((item) => item.id === recorded.id);
      expect(shown?.active).toBe(true);
      expect(shown?.learnerLevelReason).toBe(reason);
      expect(shown?.recordedLabel.length).toBeGreaterThan(0);
      const activeRows = await listActiveExportRequirements(main.centerId);
      expect(activeRows.some((item) => item.id === recorded.id)).toBe(true);
      const createAudit = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: "FUNDER_REQUIREMENT", entityId: recorded.id, action: "CREATE" },
      });
      const createText = JSON.stringify(createAudit.metadata);
      expect(createAudit.metadata).toMatchObject({
        source: "funder-requirement",
        status: "active",
        requirementReference: "GRANT-DAY26",
        crossReportLinkage: false,
      });
      expect(createText).not.toContain(reason);
      expect(createText).not.toContain("Not recorded");
      expect(createText).not.toContain(main.registeredCodes[0]);

      const generated = await exportApi.recordLearnerLevelRequirement({
        actor: director,
        centerId: main.centerId,
        learnerLevelReason: "A second agreement asks for rows too.",
        crossReportLinkage: false,
      });
      expect(generated.ok).toBe(true);
      if (!generated.ok) return;
      generatedId = generated.id;
      const generatedRow = await prisma.funderRequirement.findUniqueOrThrow({ where: { id: generated.id } });
      expect(generatedRow.requirementReference).toMatch(/^REQ-[A-F0-9]{8}$/);

      expect(await exportApi.recordLearnerLevelRequirement({
        actor: actor(main.teacherId, "TEACHER", main.centerId),
        centerId: main.centerId,
        learnerLevelReason: reason,
        crossReportLinkage: false,
      })).toEqual({ ok: false, message: exportApi.EXPORT_DENIED });
      expect(await exportApi.recordLearnerLevelRequirement({
        actor: actor(main.learnerUserId, "STUDENT", main.centerId),
        centerId: main.centerId,
        learnerLevelReason: reason,
        crossReportLinkage: false,
      })).toEqual({ ok: false, message: exportApi.EXPORT_DENIED });
      expect(await exportApi.deactivateFunderRequirement({
        actor: actor(side.directorB, "CENTER_DIRECTOR", side.b),
        centerId: main.centerId,
        requirementId: recorded.id,
      })).toEqual({ ok: false, message: exportApi.EXPORT_DENIED });
      expect(await exportApi.listFunderRequirements(actor(side.directorB, "CENTER_DIRECTOR", side.b), main.centerId)).toBeNull();

      const unconfirmed = await exportApi.exportCenterCsv({
        actor: director,
        centerId: main.centerId,
        periodStart: main.periodStart,
        periodEnd: main.periodEnd,
        mode: "pseudonymized",
        requirementId: recorded.id,
      });
      expect(unconfirmed.ok).toBe(false);
      const learnerFile = await exportApi.exportCenterCsv({
        actor: director,
        centerId: main.centerId,
        periodStart: main.periodStart,
        periodEnd: main.periodEnd,
        mode: "pseudonymized",
        learnerLevelConfirmed: true,
        requirementId: recorded.id,
      });
      expect(learnerFile.ok).toBe(true);

      const turnedOff = await exportApi.deactivateFunderRequirement({
        actor: director,
        centerId: main.centerId,
        requirementId: recorded.id,
      });
      expect(turnedOff.ok).toBe(true);
      const history = await exportApi.listFunderRequirements(director, main.centerId);
      const closed = history?.find((item) => item.id === recorded.id);
      expect(closed?.active).toBe(false);
      expect(closed?.deactivatedLabel).toBeTruthy();
      expect((await listActiveExportRequirements(main.centerId)).some((item) => item.id === recorded.id)).toBe(false);
      const afterClose = await exportApi.exportCenterCsv({
        actor: director,
        centerId: main.centerId,
        periodStart: main.periodStart,
        periodEnd: main.periodEnd,
        mode: "pseudonymized",
        learnerLevelConfirmed: true,
        requirementId: recorded.id,
      });
      expect(afterClose.ok).toBe(false);
      const aggregate = await exportApi.exportCenterCsv({
        actor: director,
        centerId: main.centerId,
        periodStart: main.periodStart,
        periodEnd: main.periodEnd,
      });
      expect(aggregate.ok).toBe(true);
      if (!aggregate.ok) return;
      expect(field(aggregate.csv, "report", "mode")).toBe("aggregate");
      const offAudit = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: "FUNDER_REQUIREMENT", entityId: recorded.id, action: "UPDATE" },
      });
      const offText = JSON.stringify(offAudit.metadata);
      expect(offAudit.metadata).toMatchObject({
        source: "funder-requirement",
        status: "inactive",
        requirementReference: "GRANT-DAY26",
      });
      expect(offText).not.toContain(reason);
      expect(offText).not.toContain(main.registeredCodes[0]);
    } finally {
      const ids = [recorded.id, generatedId].filter((id): id is string => id !== null);
      await prisma.funderRequirement.updateMany({
        where: { id: { in: ids }, active: true },
        data: { active: false, deactivatedAt: new Date() },
      });
    }
  });

  it("writes the same privacy-safe figures to csv and pdf", async () => {
    const address = "14 Synthetic Lane West";
    const birth = "1990-04-17";
    const grades = await prisma.gradeEntry.findMany({
      where: { academicNote: { not: null }, assignment: { section: { course: { centerId: main.centerId } } } },
      select: { id: true, academicNote: true },
      take: 2,
    });
    const first = grades[0];
    const second = grades[1];
    expect(first && second).toBeTruthy();
    if (!first || !second) return;
    try {
      await prisma.gradeEntry.update({ where: { id: first.id }, data: { academicNote: address } });
      await prisma.gradeEntry.update({ where: { id: second.id }, data: { academicNote: birth } });
      const prohibited = await collectProhibitedValues(main.centerId, [process.env.EXPORT_SECRET ?? ""]);
      expect(prohibited.some((value) => value === address)).toBe(true);
      expect(prohibited.some((value) => value === birth)).toBe(true);
      const input = {
        actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
        centerId: main.centerId,
        periodStart: main.periodStart,
        periodEnd: main.periodEnd,
      };
      const csv = await exportApi.exportCenterCsv(input);
      const pdf = await exportApi.exportCenterReport({ ...input, format: "pdf" });
      expect(csv.ok && pdf.ok).toBe(true);
      if (!csv.ok || !pdf.ok) return;
      expect(csv.filename).toBe(`grant-export-${main.periodStart}-to-${main.periodEnd}.csv`);
      expect(pdf.filename).toBe(`grant-export-${main.periodStart}-to-${main.periodEnd}.pdf`);
      const centerName = field(csv.csv, "report", "center_name");
      expect(scanText([csv.csv, csv.filename], prohibited, [centerName])).toEqual({ ok: true });
      expect(await scanPdf(pdf.body, prohibited, [centerName])).toEqual({ ok: true });
      const text = await pdfText(pdf.body);
      expect(text).toContain("Day 16 Center");
      expect(text).toContain(`period_start: ${main.periodStart}`);
      expect(text).toContain(`period_end: ${main.periodEnd}`);
      expect(text).toContain(`registered_learners: ${field(csv.csv, "count", "registered_learners")}`);
      expect(text).toContain(`retention_rate: ${field(csv.csv, "count", "retention_rate")}`);
      expect(text).toContain(`attendance_rate: ${field(csv.csv, "count", "attendance_rate")}`);
      expect(text).toContain("Group sizes");
      expect(text).not.toContain("ps_");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "EXPORT", entityId: pdf.reportId } });
      expect(audit.metadata).toMatchObject({ format: "PDF", mode: "AGGREGATE" });
    } finally {
      await prisma.gradeEntry.update({ where: { id: first.id }, data: { academicNote: first.academicNote } });
      await prisma.gradeEntry.update({ where: { id: second.id }, data: { academicNote: second.academicNote } });
    }
  });

  it("omits the chart when a breakdown hides a small group", async () => {
    const director = await prisma.user.findFirstOrThrow({ where: { centerId: side.d, role: "CENTER_DIRECTOR" } });
    const result = await exportApi.exportCenterReport({
      actor: actor(director.id, "CENTER_DIRECTOR", side.d),
      centerId: side.d,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      format: "pdf",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = await pdfText(result.body);
    expect(text).toContain("registered_learners: 20");
    expect(text).toContain("AGE_6_8: <5");
    expect(text).toContain("AGE_18_24: 12");
    expect(text).not.toContain("Group sizes");
  });

  it("rejects a download that is not a same-origin request from an allowed account", async () => {
    const fields = { format: "csv", periodStart: main.periodStart, periodEnd: main.periodEnd };
    await expectNoFile(await getExport(), 405);
    sessionActor.actor = null;
    await expectNoFile(await postExport(exportRequest(fields)), 401);
    sessionActor.actor = actor(main.directorId, "CENTER_DIRECTOR", side.b);
    await expectNoFile(await postExport(exportRequest(fields, { origin: "https://evil.example" })), 403);
    await expectNoFile(
      await postExport(exportRequest(fields, { origin: "http://local.test", "sec-fetch-site": "cross-site" })),
      403,
    );
    await expectNoFile(await postExport(exportRequest({ ...fields, format: "html" })), 400);
    await expectNoFile(await postExport(exportRequest({ ...fields, periodStart: "2026-02-31" })), 400);
    await expectNoFile(
      await postExport(exportRequest({ ...fields, periodStart: "2026-05-02", periodEnd: "2026-05-01" })),
      400,
    );
    await expectNoFile(
      await postExport(exportRequest({ ...fields, mode: "pseudonymized", learnerLevelConfirmed: "yes", requirementId: "not-an-id" })),
      400,
    );
    await expectNoFile(
      await postExport(exportRequest({ ...fields, mode: "pseudonymized", learnerLevelConfirmed: "yes", requirementId: randomUUID() })),
      400,
    );
    const savedRequirement = await exportApi.approveFunderRequirement({
      actor: actor(main.directorId, "CENTER_DIRECTOR", main.centerId),
      centerId: main.centerId,
      funderName: "Example Fund",
      requirementReference: "FUND-ROUTE-YES",
      learnerLevelReason: "Rows are required for this route test only.",
      crossReportLinkage: false,
    });
    expect(savedRequirement.ok).toBe(true);
    if (!savedRequirement.ok) return;
    await expectNoFile(
      await postExport(exportRequest({ ...fields, mode: "pseudonymized", requirementId: savedRequirement.id })),
      400,
    );
    await expectNoFile(
      await postExport(exportRequest({
        ...fields,
        mode: "pseudonymized",
        requirementId: savedRequirement.id,
        learnerLevelConfirmed: "true",
      })),
      400,
    );
    sessionActor.actor = actor(main.teacherId, "TEACHER", main.centerId);
    await expectNoFile(
      await postExport(exportRequest({
        ...fields,
        mode: "pseudonymized",
        requirementId: savedRequirement.id,
        learnerLevelConfirmed: "yes",
      })),
      403,
    );
    sessionActor.actor = actor(main.directorId, "CENTER_DIRECTOR", main.centerId);
    const confirmedDownload = await postExport(exportRequest({
      ...fields,
      mode: "pseudonymized",
      requirementId: savedRequirement.id,
      learnerLevelConfirmed: "yes",
    }));
    expect(confirmedDownload.status).toBe(200);
    const confirmedCsv = await confirmedDownload.text();
    expect(field(confirmedCsv, "report", "mode")).toBe("pseudonymized");
    expect(confirmedCsv).not.toContain(NICK);
    const pageRefusal = await postExport(exportRequest({
      ...fields,
      format: "pdf",
      mode: "pseudonymized",
      requirementId: savedRequirement.id,
      returnTo: "page",
    }));
    expect(pageRefusal.status).toBe(303);
    expect(pageRefusal.headers.get("content-disposition")).toBeNull();
    const location = pageRefusal.headers.get("location") ?? "";
    expect(location).toContain("/export?");
    expect(location).toContain("error=confirmation");
    expect(location).toContain(`from=${main.periodStart}`);
    expect(location).toContain(`to=${main.periodEnd}`);
    expect(location).toContain("format=pdf");
    expect(location).toContain("mode=pseudonymized");
    const refusalBody = await pageRefusal.text();
    expect(refusalBody.includes("record_type")).toBe(false);
    expect(refusalBody.startsWith("%PDF")).toBe(false);
    expect(refusalBody.startsWith("{")).toBe(false);
    const pageDownload = await postExport(exportRequest({
      ...fields,
      mode: "pseudonymized",
      requirementId: savedRequirement.id,
      learnerLevelConfirmed: "yes",
      returnTo: "page",
    }));
    expect(pageDownload.status).toBe(200);
    expect(pageDownload.headers.get("content-disposition")).toContain("grant-export");
    const plain = await postExport(exportRequest(fields));
    expect(plain.status).toBe(200);
    expect(field(await plain.text(), "report", "mode")).toBe("aggregate");
    const directed = await postExport(exportRequest({ ...fields, centerId: side.b }));
    expect(directed.status).toBe(200);
    expect(field(await directed.text(), "report", "center_name")).toBe("Day 16 Center");
    sessionActor.actor = actor(side.adminId, "ADMIN", side.b);
    const adminMain = await postExport(exportRequest({ ...fields, centerId: main.centerId }));
    const adminOther = await postExport(exportRequest({ ...fields, periodStart: "2026-01-01", periodEnd: "2026-01-31", centerId: side.b }));
    expect(adminMain.status).toBe(200);
    expect(adminOther.status).toBe(200);
    expect(field(await adminMain.text(), "report", "center_name")).toBe("Day 16 Center");
    expect(field(await adminOther.text(), "report", "center_name")).toBe("DAY16B");
    await expectNoFile(await postExport(exportRequest({ ...fields, centerId: randomUUID() })), 403);
    await expectNoFile(await postExport(exportRequest({ ...fields, centerId: "not-a-center" })), 403);
    const existingInactive = await prisma.user.findFirst({
      where: { email: "day17-inactive-admin@example.test" },
      select: { id: true },
    });
    const inactiveAdmin = existingInactive ?? {
      id: await addStaff(main.centerId, "ADMIN", "day17-inactive-admin@example.test"),
    };
    await prisma.user.update({
      where: { id: inactiveAdmin.id },
      data: { active: false, deactivatedAt: new Date("2026-02-02T00:00:00.000Z") },
    });
    sessionActor.actor = actor(inactiveAdmin.id, "ADMIN", main.centerId, true);
    await expectNoFile(await postExport(exportRequest({ ...fields, centerId: main.centerId })), 403);
    sessionActor.actor = actor(main.directorId, "CENTER_DIRECTOR", main.centerId);
    const pdf = await postExport(exportRequest({ ...fields, format: "pdf" }));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe(
      `attachment; filename="grant-export-${main.periodStart}-to-${main.periodEnd}.pdf"`,
    );
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 5)).toString("utf8")).toBe("%PDF-");
  });

  it("prefixes formula text and leaves real numbers alone", () => {
    expect(escapeCsvField("=1+1")).toBe("'=1+1");
    expect(escapeCsvField("+1")).toBe("'+1");
    expect(escapeCsvField("-1")).toBe("'-1");
    expect(escapeCsvField("@sum")).toBe("'@sum");
    expect(escapeCsvField("\t1")).toBe("'\t1");
    expect(escapeCsvField("\r1")).toBe("\"'\r1\"");
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField(12)).toBe("12");
    expect(escapeCsvField("50.0%")).toBe("50.0%");
    expect(escapeCsvField("<5")).toBe("<5");
    const csv = grantExportCsv({
      kind: "grant-export",
      centerName: "Formula Center",
      mode: "aggregate",
      reportId: "11111111-1111-4111-8111-111111111111",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOf: "2026-01-31",
      suppressionMin: 5,
      pseudonymScope: "report",
      limitation: EXPORT_LIMITATION,
      registeredLearners: 12,
      retentionCohort: "<5",
      retainedLearners: "<5",
      retentionRate: "<5",
      attendance: { learners: "<5", confirmed: "<5", eligible: "<5", rate: "<5", coverage: "<5" },
      assignmentCompletion: { learners: "<5", completed: "<5", expected: "<5", rate: "<5" },
      breakdowns: [],
      learners: [{ pseudonym: "=1+1" }],
    } satisfies GrantExport);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain(",,12");
    expect(csv).not.toContain("'12");
  });
});

async function seedMain(): Promise<void> {
  const today = civilToday(TZ);
  main.periodStart = shift(today, -20);
  main.periodEnd = shift(today, 10);
  const presentDay = shift(today, -18);
  const unmarkedDay = shift(today, -16);
  const ekeepEnd = shift(today, -5);
  const ewdnEnd = shift(today, -40);
  const ecompDay = shift(today, -80);
  const centerId = uid();
  const directorId = uid();
  const teacherId = uid();
  const inactiveId = uid();
  const deviceId = uid();
  const courseId = uid();
  const morningId = uid();
  const afternoonId = uid();
  const dstSectionId = uid();
  main.centerId = centerId;
  main.directorId = directorId;
  main.teacherId = teacherId;
  main.inactiveId = inactiveId;
  main.deviceId = deviceId;

  const learners = Array.from({ length: 10 }, (_, index) => ({
    userId: uid(),
    profileId: uid(),
    code: `LNR-D16${String(index + 1).padStart(3, "0")}`,
    gender: index < 5 ? ("FEMALE" as const) : ("MALE" as const),
  }));
  main.learnerUserId = learners[0]?.userId ?? "";
  main.profileId = learners[0]?.profileId ?? "";
  main.registeredCodes = learners.map((learner) => learner.code);
  const keep = { userId: uid(), profileId: uid(), code: "LNR-D16KEEP" };
  const withdrawn = { userId: uid(), profileId: uid(), code: "LNR-D16WDN" };
  const completed = { userId: uid(), profileId: uid(), code: "LNR-D16CMP" };
  main.registeredCodes.push(keep.code);
  main.hiddenCodes = [withdrawn.code, completed.code];

  await prisma.$transaction(async (tx) => {
    await tx.center.create({
      data: { id: centerId, name: "Day 16 Center", code: "DAY16", timezone: TZ, smallGroupSuppressionMin: 5 },
    });
    await tx.centerOptionalField.createMany({
      data: [
        { id: uid(), centerId, fieldKey: "GENDER", enabled: true },
        { id: uid(), centerId, fieldKey: "CONTACT_PHONE", enabled: true },
      ],
    });
    await tx.user.createMany({
      data: [
        staff(directorId, centerId, "CENTER_DIRECTOR", "day16-director@example.test", true),
        staff(teacherId, centerId, "TEACHER", "day16-teacher@example.test", true),
        staff(inactiveId, centerId, "CENTER_DIRECTOR", "day16-inactive@example.test", false),
        ...[...learners, keep, withdrawn, completed].map((learner) => student(learner.userId, centerId)),
      ],
    });
    await tx.learnerProfile.createMany({
      data: [
        ...learners.map((learner) => profile(learner.profileId, learner.userId, centerId, learner.code)),
        profile(keep.profileId, keep.userId, centerId, keep.code),
        profile(withdrawn.profileId, withdrawn.userId, centerId, withdrawn.code),
        profile(completed.profileId, completed.userId, centerId, completed.code),
      ],
    });
    await tx.learnerOptionalGender.createMany({
      data: [
        ...learners.map((learner) => ({ learnerId: learner.profileId, gender: learner.gender })),
        { learnerId: keep.profileId, gender: "FEMALE" as const },
        { learnerId: withdrawn.profileId, gender: "MALE" as const },
        { learnerId: completed.profileId, gender: "NONBINARY" as const },
      ],
    });
    await tx.learnerOptionalContact.create({ data: { learnerId: learners[0]?.profileId ?? "", phoneE164: PHONE } });
  }, { timeout: 60000 });

  // People are committed before classes. One transaction that also inserted
  // every class, mark, grade, and file exceeded 60 seconds while it was still
  // creating the class rows one at a time.
  const present = uid();
  const recordedAbsent = uid();
  const unmarked = uid();
  const cancelled = uid();
  const future = uid();
  const dstOut = uid();
  const dstIn = uid();
  const dstUnmarked = uid();
  const blankDay = uid();
  const partialPresent = uid();
  const partialBlank = uid();
  const fullLate = uid();
  const fullOther = uid();
  const lateToday = at(today, 23, 30, TZ);
  const laterToday = lateToday.getTime() > Date.now() ? uid() : null;
  const sessions = [
    sessionRow(present, morningId, at(presentDay, 10, 0, TZ), "HELD"),
    sessionRow(recordedAbsent, morningId, at(shift(today, -14), 10, 0, TZ), "HELD"),
    sessionRow(unmarked, morningId, at(unmarkedDay, 10, 0, TZ), "HELD"),
    sessionRow(cancelled, morningId, at(unmarkedDay, 12, 0, TZ), "CANCELLED"),
    sessionRow(future, morningId, at(main.periodEnd, 10, 0, TZ), "SCHEDULED"),
    sessionRow(dstOut, dstSectionId, new Date("2026-03-08T04:30:00.000Z"), "HELD"),
    sessionRow(dstIn, dstSectionId, new Date("2026-03-08T08:00:00.000Z"), "HELD"),
    sessionRow(dstUnmarked, dstSectionId, new Date("2026-03-08T20:00:00.000Z"), "HELD"),
    sessionRow(blankDay, dstSectionId, at("2026-02-02", 10, 0, TZ), "HELD"),
    sessionRow(partialPresent, dstSectionId, at("2026-02-05", 10, 0, TZ), "HELD"),
    sessionRow(partialBlank, dstSectionId, at("2026-02-05", 12, 0, TZ), "HELD"),
    sessionRow(fullLate, dstSectionId, at("2026-02-10", 10, 0, TZ), "HELD"),
    sessionRow(fullOther, dstSectionId, at("2026-02-10", 12, 0, TZ), "HELD"),
  ];
  if (laterToday) sessions.push(sessionRow(laterToday, morningId, lateToday, "SCHEDULED"));

    // The local database runs one query at a time. These rows used to be 61
    // attendance inserts, 14 class inserts, 7 assignment inserts, 21 grade
    // inserts, 2 version inserts, 1 conflict insert, 25 file inserts, and 10
    // assignment lookups. Each table is now inserted once.
    const attendance = [
      ...learners.flatMap((learner, index) => [
        attendanceRow(present, learner.profileId, "PRESENT", new Date("2026-10-02T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z")),
        attendanceRow(recordedAbsent, learner.profileId, "ABSENT", new Date("2026-10-04T00:00:00.000Z"), new Date("2026-10-04T00:00:00.000Z")),
        ...(index === 0
          ? [attendanceRow(present, learner.profileId, "ABSENT", new Date("2026-10-01T00:00:00.000Z"), new Date("2026-12-01T00:00:00.000Z"))]
          : []),
        attendanceRow(cancelled, learner.profileId, "ABSENT", new Date("2026-10-03T00:00:00.000Z"), new Date("2026-10-03T00:00:00.000Z")),
      ]),
      ...learners.slice(0, 6).flatMap((learner, index) => [
        attendanceRow(dstOut, learner.profileId, "ABSENT", new Date("2026-03-08T05:00:00.000Z"), new Date("2026-03-08T05:00:00.000Z")),
        attendanceRow(dstIn, learner.profileId, "PRESENT", new Date("2026-03-08T09:00:00.000Z"), new Date("2026-03-08T09:00:00.000Z")),
        attendanceRow(partialPresent, learner.profileId, "PRESENT", new Date("2026-02-05T15:00:00.000Z"), new Date("2026-02-05T15:00:00.000Z")),
        attendanceRow(fullLate, learner.profileId, "LATE", new Date("2026-02-10T15:00:00.000Z"), new Date("2026-02-10T15:00:00.000Z")),
        attendanceRow(
          fullOther,
          learner.profileId,
          index < 3 ? "ABSENT" : "EXCUSED",
          new Date("2026-02-10T16:00:00.000Z"),
          new Date("2026-02-10T16:00:00.000Z"),
        ),
      ]),
    ];
    await prisma.$transaction(async (tx) => {
      await tx.device.create({ data: { id: deviceId, centerId, label: "Day 16 phone", registeredById: directorId } });
      await tx.course.create({
        data: { id: courseId, centerId, title: "Day 16 course", code: "DAY16", academicYear: 2026, semester: "SEMESTER_1" },
      });
      await tx.section.createMany({
        data: [
          { id: morningId, courseId, name: "Morning" },
          { id: afternoonId, courseId, name: "Afternoon" },
          { id: dstSectionId, courseId, name: "March" },
        ],
      });
      await tx.enrollment.createMany({
        data: [
          ...learners.map((learner) => enrollment(morningId, learner.profileId, "ACTIVE", "2026-01-01", null)),
          enrollment(afternoonId, learners[0]?.profileId ?? "", "ACTIVE", "2026-01-01", null),
          ...learners.slice(0, 6).map((learner) => enrollment(dstSectionId, learner.profileId, "ACTIVE", "2026-01-01", null)),
          enrollment(afternoonId, keep.profileId, "WITHDRAWN", "2026-01-01", ekeepEnd),
          enrollment(morningId, withdrawn.profileId, "WITHDRAWN", "2026-01-01", ewdnEnd),
          enrollment(afternoonId, completed.profileId, "COMPLETED", ecompDay, null, ecompDay),
        ],
      });
      await tx.classSession.createMany({ data: sessions });
      await tx.attendanceRecord.createMany({ data: attendance });
    }, { timeout: 60000 });

    const due = at(unmarkedDay, 12, 0, TZ);
    const paper = uid();
    const digital = uid();
    const both = uid();
    const exam = uid();
    const undated = uid();
    const futurePaper = uid();
    const zeroPaper = uid();
    const assignments = [
      assignmentRow(paper, morningId, teacherId, "PAPER", due, "10.00"),
      assignmentRow(digital, morningId, teacherId, "DIGITAL", due, "10.00"),
      assignmentRow(both, morningId, teacherId, "BOTH", due, "10.00"),
      assignmentRow(exam, morningId, teacherId, "IN_CLASS_EXAM", due, "10.00"),
      assignmentRow(undated, morningId, teacherId, "DIGITAL", null, "10.00"),
      assignmentRow(futurePaper, morningId, teacherId, "PAPER", at(main.periodEnd, 12, 0, TZ), "10.00"),
      assignmentRow(zeroPaper, morningId, teacherId, "PAPER", due, "0.00"),
    ];

    const gradedAt = new Date("2026-10-04T00:00:00.000Z");
    const grades: Prisma.GradeEntryCreateManyInput[] = [];
    const gradeVersions: Prisma.GradeEntryVersionCreateManyInput[] = [];
    let conflictEntryId = "";
    let conflictVersionA = "";
    let conflictVersionB = "";
    const pushGrade = (assignmentId: string, learnerId: string, conflict: boolean) => {
      const id = uid();
      grades.push(gradeRow(id, assignmentId, learnerId, teacherId, deviceId, gradedAt));
      if (!conflict) return;
      conflictEntryId = id;
      conflictVersionA = uid();
      conflictVersionB = uid();
      const version = {
        gradeEntryId: id,
        recordedById: teacherId,
        deviceId,
        versionVector: { [deviceId]: 1 },
        deviceRecordedAt: gradedAt,
        createdOffline: false,
        points: "8.00",
      };
      gradeVersions.push(
        { ...version, id: conflictVersionA, syncedAt: gradedAt },
        { ...version, id: conflictVersionB, syncedAt: new Date("2026-10-05T00:00:00.000Z"), points: "9.00" },
      );
    };
    for (const learner of learners.slice(0, 7)) {
      pushGrade(paper, learner.profileId, learner === learners[5]);
      if (learner !== learners[6]) pushGrade(both, learner.profileId, false);
      pushGrade(exam, learner.profileId, false);
    }
    pushGrade(paper, withdrawn.profileId, false);
    await prisma.$transaction(async (tx) => {
    await tx.assignment.createMany({ data: assignments });
    await tx.gradeEntry.createMany({ data: grades });
    await tx.gradeEntryVersion.createMany({ data: gradeVersions });
    await tx.syncConflict.create({
      data: {
        id: uid(),
        entityType: "GRADE_ENTRY",
        state: "OPEN",
        gradeEntryId: conflictEntryId,
        gradeVersionAId: conflictVersionA,
        gradeVersionBId: conflictVersionB,
        shownGradeVersionId: conflictVersionB,
      },
    });

    const submissions: Prisma.SubmissionCreateManyInput[] = [];
    let queuedId = "";
    let firstStoredId = "";
    for (const learner of learners.slice(0, 7)) {
      const storedId = uid();
      submissions.push(submission(storedId, digital, learner.profileId, teacherId, deviceId, "STORED"));
      if (learner === learners[0]) {
        queuedId = uid();
        firstStoredId = storedId;
        submissions.push(submission(queuedId, digital, learner.profileId, teacherId, deviceId, "QUEUED"));
      }
      submissions.push(submission(uid(), both, learner.profileId, teacherId, deviceId, "STORED"));
    }
    for (const learner of learners) {
      submissions.push(submission(uid(), undated, learner.profileId, teacherId, deviceId, "STORED"));
    }
    await tx.submission.createMany({ data: submissions });
    await tx.$executeRaw`UPDATE "submissions" SET "updatedAt" = ${new Date("2026-03-01T00:00:00.000Z")} WHERE "id" = ${queuedId}::uuid`;
    await tx.$executeRaw`UPDATE "submissions" SET "updatedAt" = ${new Date("2026-03-02T00:00:00.000Z")} WHERE "id" = ${firstStoredId}::uuid`;
  }, { timeout: 60000 });
}

async function seedPlainCenter(code: string, min: number, timeZone: string, gender: boolean): Promise<string> {
  const centerId = uid();
  const directorId = uid();
  await prisma.$transaction(async (tx) => {
    await tx.center.create({
      data: { id: centerId, name: code, code, timezone: timeZone, smallGroupSuppressionMin: min },
    });
    await tx.centerOptionalField.createMany({
      data: [
        { id: uid(), centerId, fieldKey: "GENDER", enabled: gender },
        { id: uid(), centerId, fieldKey: "CONTACT_PHONE", enabled: false },
      ],
    });
    await tx.user.create({ data: staff(directorId, centerId, "CENTER_DIRECTOR", `${code.toLowerCase()}-director@example.test`, true) });
  }, { timeout: 60000 });
  return centerId;
}

async function seedZeroWork(centerId: string): Promise<void> {
  const courseId = uid();
  const sectionId = uid();
  const teacherId = await addStaff(centerId, "TEACHER", "day16b-teacher@example.test");
  const learners = Array.from({ length: 6 }, () => ({ userId: uid(), profileId: uid(), code: `LNR-B${uid().slice(-4).toUpperCase()}` }));
  await prisma.centerOptionalField.update({
    where: { centerId_fieldKey: { centerId, fieldKey: "CONTACT_PHONE" } },
    data: { enabled: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({ data: learners.map((learner) => student(learner.userId, centerId)) });
    await tx.learnerProfile.createMany({
      data: learners.map((learner) => profile(learner.profileId, learner.userId, centerId, learner.code)),
    });
    await tx.learnerOptionalGender.createMany({
      data: learners.map((learner) => ({ learnerId: learner.profileId, gender: "FEMALE" as const })),
    });
    await tx.learnerOptionalContact.create({ data: { learnerId: learners[0]?.profileId ?? "", phoneE164: PHONE } });
    await tx.course.create({
      data: { id: courseId, centerId, title: "Day 16B", code: "DAY16B", academicYear: 2026, semester: "SEMESTER_1" },
    });
    await tx.section.create({ data: { id: sectionId, courseId, name: "Group" } });
    await tx.enrollment.createMany({
      data: learners.map((learner) => enrollment(sectionId, learner.profileId, "ACTIVE", "2026-01-01", null)),
    });
    await tx.assignment.create({
      data: {
        id: uid(),
        sectionId,
        title: "Ungraded paper",
        kind: "PAPER",
        dueAt: new Date("2026-01-15T15:00:00.000Z"),
        maxPoints: "10.00",
        createdById: teacherId,
      },
    });
  }, { timeout: 60000 });
  await prisma.centerOptionalField.update({
    where: { centerId_fieldKey: { centerId, fieldKey: "GENDER" } },
    data: { enabled: false },
  });
}

async function seedBands(code: string, bands: Array<[string, number]>): Promise<string> {
  const centerId = await seedPlainCenter(code, 5, "UTC", false);
  const courseId = uid();
  const sectionId = uid();
  const learners: { userId: string; profileId: string; code: string; band: string }[] = [];
  for (const [band, count] of bands) {
    for (let index = 0; index < count; index += 1) {
      learners.push({ userId: uid(), profileId: uid(), code: `LNR-${code}${learners.length.toString().padStart(2, "0")}`.replace("DAY", "D"), band });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({ data: learners.map((learner) => student(learner.userId, centerId)) });
    await tx.learnerProfile.createMany({
      data: learners.map((learner) => ({
        ...profile(learner.profileId, learner.userId, centerId, learner.code),
        ageBand: learner.band as "AGE_6_8",
      })),
    });
    await tx.course.create({
      data: { id: courseId, centerId, title: code, code, academicYear: 2026, semester: "SEMESTER_1" },
    });
    await tx.section.create({ data: { id: sectionId, courseId, name: "Group" } });
    await tx.enrollment.createMany({
      data: learners.map((learner) => enrollment(sectionId, learner.profileId, "ACTIVE", "2026-01-01", null)),
    });
  }, { timeout: 60000 });
  return centerId;
}

async function seedRetention(): Promise<string> {
  const centerId = await seedPlainCenter("DAY16R", 2, "UTC", false);
  side.retentionDirectorId = (await prisma.user.findFirstOrThrow({ where: { centerId, role: "CENTER_DIRECTOR" } })).id;
  side.retentionTeacherId = await addStaff(centerId, "TEACHER", "day16r-teacher@example.test");
  const courseId = uid();
  const sectionId = uid();
  side.beforeId = uid();
  side.duringId = uid();
  side.afterId = uid();
  side.startedDuringId = uid();
  const active = Array.from({ length: 4 }, (_, index) => learnerRow(index));
  const withdrawn = Array.from({ length: 2 }, (_, index) => learnerRow(index + 4));
  const dated = [side.beforeId, side.duringId, side.afterId, side.startedDuringId].map((id, index) => ({
    ...learnerRow(index + 6),
    enrollmentId: id,
    enrolledOn: index === 3 ? "2026-01-20" : "2026-01-01",
  }));
  const futureLegacy = learnerRow(10);
  const people = [
    ...active,
    ...withdrawn,
    ...dated.map((person) => ({ userId: person.userId, profileId: person.profileId, code: person.code })),
    futureLegacy,
  ];
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({ data: people.map((person) => student(person.userId, centerId)) });
    await tx.learnerProfile.createMany({
      data: people.map((person) => profile(person.profileId, person.userId, centerId, person.code)),
    });
    await tx.course.create({
      data: { id: courseId, centerId, title: "Day 16R", code: "DAY16R", academicYear: 2026, semester: "SEMESTER_1" },
    });
    await tx.section.create({ data: { id: sectionId, courseId, name: "Group" } });
    await tx.enrollment.createMany({
      data: [
        ...active.map((person) => enrollment(sectionId, person.profileId, "ACTIVE", "2026-01-01", null)),
        ...withdrawn.map((person) => enrollment(sectionId, person.profileId, "WITHDRAWN", "2026-01-01", "2026-01-15")),
        ...dated.map((person) => ({
          ...enrollment(sectionId, person.profileId, "ACTIVE", person.enrolledOn, null),
          id: person.enrollmentId,
        })),
        // Completed after the reporting period, with no stored completion date.
        // It cannot intersect January, so it must not withhold that report.
        enrollment(sectionId, futureLegacy.profileId, "COMPLETED", "2026-02-01", null),
      ],
    });
  }, { timeout: 60000 });
  return centerId;
}

async function seedLegacyCompletion(): Promise<string> {
  const centerId = await seedPlainCenter("DAY16L", 2, "UTC", false);
  const courseId = uid();
  const sectionId = uid();
  const active = Array.from({ length: 4 }, (_, index) => learnerRow(index + 20));
  const legacy = learnerRow(30);
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({ data: [...active, legacy].map((person) => student(person.userId, centerId)) });
    await tx.learnerProfile.createMany({
      data: [...active, legacy].map((person) => profile(person.profileId, person.userId, centerId, person.code)),
    });
    await tx.course.create({
      data: { id: courseId, centerId, title: "Day 16L", code: "DAY16L", academicYear: 2026, semester: "SEMESTER_1" },
    });
    await tx.section.create({ data: { id: sectionId, courseId, name: "Group" } });
    await tx.enrollment.createMany({
      data: [
        ...active.map((person) => enrollment(sectionId, person.profileId, "ACTIVE", "2026-01-01", null)),
        enrollment(sectionId, legacy.profileId, "COMPLETED", "2026-01-01", null),
      ],
    });
  }, { timeout: 60000 });
  return centerId;
}

function learnerRow(index: number): { userId: string; profileId: string; code: string } {
  return { userId: uid(), profileId: uid(), code: `LNR-R16${String(index).padStart(2, "0")}` };
}

async function seedSharedAttendance(): Promise<{ centerId: string; directorId: string; sectionId: string }> {
  const centerId = await seedPlainCenter("DAY16M", 2, "UTC", false);
  const directorId = (await prisma.user.findFirstOrThrow({ where: { centerId, role: "CENTER_DIRECTOR" } })).id;
  const courseId = uid();
  const sectionId = uid();
  const learners = [0, 1].map((index) => learnerRow(40 + index));
  const marks = ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "LATE", "ABSENT", "EXCUSED"] as const;
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({ data: learners.map((learner) => student(learner.userId, centerId)) });
    await tx.learnerProfile.createMany({
      data: learners.map((learner) => profile(learner.profileId, learner.userId, centerId, learner.code)),
    });
    await tx.course.create({
      data: { id: courseId, centerId, title: "Day 16M", code: "DAY16M", academicYear: 2026, semester: "SEMESTER_1" },
    });
    await tx.section.create({ data: { id: sectionId, courseId, name: "Group" } });
    const deviceId = uid();
    await tx.device.create({ data: { id: deviceId, centerId, label: "Day 16M phone", registeredById: directorId } });
    await tx.enrollment.createMany({
      data: learners.map((learner) => enrollment(sectionId, learner.profileId, "ACTIVE", "2026-01-01", null)),
    });
    const recorded = marks.map((_, index) => sessionRow(
      uid(),
      sectionId,
      new Date(`2026-02-20T${String(8 + index).padStart(2, "0")}:00:00.000Z`),
      "HELD",
    ));
    const cancelled = sessionRow(uid(), sectionId, new Date("2026-02-20T18:00:00.000Z"), "CANCELLED");
    const presentOnly = sessionRow(uid(), sectionId, new Date("2026-02-21T08:00:00.000Z"), "HELD");
    await tx.classSession.createMany({
      data: [
        ...recorded,
        sessionRow(uid(), sectionId, new Date("2026-02-20T17:00:00.000Z"), "HELD"),
        cancelled,
        sessionRow(uid(), sectionId, new Date("2026-12-01T08:00:00.000Z"), "SCHEDULED"),
        presentOnly,
        sessionRow(uid(), sectionId, new Date("2026-02-22T08:00:00.000Z"), "HELD"),
      ],
    });
    const attendance: Prisma.AttendanceRecordCreateManyInput[] = [];
    for (const learner of learners) {
      for (let index = 0; index < marks.length; index += 1) {
        const sessionId = recorded[index]?.id ?? "";
        if (index === 0) {
          attendance.push(attendanceRow(sessionId, learner.profileId, "ABSENT", new Date("2026-02-20T07:00:00.000Z"), new Date("2026-02-20T07:00:00.000Z"), deviceId, directorId));
        }
        attendance.push(attendanceRow(
          sessionId,
          learner.profileId,
          marks[index] ?? "PRESENT",
          new Date(`2026-02-20T${String(19).padStart(2, "0")}:${String(index).padStart(2, "0")}:00.000Z`),
          new Date("2026-02-20T06:00:00.000Z"),
          deviceId,
          directorId,
        ));
      }
      attendance.push(attendanceRow(cancelled.id ?? "", learner.profileId, "ABSENT", new Date("2026-02-20T18:30:00.000Z"), new Date("2026-02-20T18:30:00.000Z"), deviceId, directorId));
      attendance.push(attendanceRow(presentOnly.id ?? "", learner.profileId, "PRESENT", new Date("2026-02-21T09:00:00.000Z"), new Date("2026-02-21T09:00:00.000Z"), deviceId, directorId));
    }
    await tx.attendanceRecord.createMany({ data: attendance });
  }, { timeout: 60000 });
  return { centerId, directorId, sectionId };
}

async function performanceInput(sectionId: string, now: Date, day: string | null = null) {
  const section = await prisma.section.findUniqueOrThrow({
    where: { id: sectionId },
    include: { course: true, enrollments: { include: { learner: true } } },
  });
  const sessions = await prisma.classSession.findMany({ where: { sectionId } });
  const chosen = sessions.filter((session) => {
    const date = session.startsAt.toISOString().slice(0, 10);
    if (day) return date === day;
    return date === "2026-02-20" || date === "2026-12-01";
  });
  const events = chosen.length
    ? await prisma.attendanceRecord.findMany({ where: { sessionId: { in: chosen.map((session) => session.id) } } })
    : [];
  return {
    now,
    timeZone: "UTC" as const,
    sectionId,
    sectionName: section.name,
    courseTitle: section.course.title,
    learners: section.enrollments.map((enrollment) => ({
      id: enrollment.learnerId,
      learnerCode: enrollment.learner.learnerCode,
      displayName: enrollment.learner.displayName,
      enrolledOn: enrollment.enrolledOn,
      withdrawnOn: enrollment.withdrawnOn,
    })),
    assignments: [],
    grades: [],
    submissions: [],
    sessions: chosen.map((session) => ({
      id: session.id,
      title: session.title,
      startsAt: session.startsAt,
      status: session.status,
    })),
    attendance: events.map((event) => ({
      id: event.id,
      sessionId: event.sessionId,
      learnerId: event.learnerId,
      status: event.status,
      syncedAt: event.syncedAt,
      createdAt: event.createdAt,
    })),
  };
}

async function addStaff(centerId: string, role: "ADMIN" | "TEACHER" | "CENTER_DIRECTOR", email: string): Promise<string> {
  const id = uid();
  await prisma.user.create({ data: staff(id, centerId, role, email, true) });
  return id;
}

function staff(id: string, centerId: string, role: "ADMIN" | "TEACHER" | "CENTER_DIRECTOR", email: string, active: boolean) {
  return {
    id,
    centerId,
    role,
    email,
    passwordHash: PASS,
    displayName: NICK,
    active,
    deactivatedAt: active ? null : new Date("2026-01-02T00:00:00.000Z"),
  };
}

function student(id: string, centerId: string) {
  return { id, centerId, role: "STUDENT" as const, email: null, passwordHash: null, displayName: null, active: true };
}

function profile(id: string, userId: string, centerId: string, learnerCode: string) {
  return { id, userId, centerId, learnerCode, displayName: NICK, ageBand: "AGE_15_17" as const, pinHash: PIN };
}

function enrollment(
  sectionId: string,
  learnerId: string,
  status: "ACTIVE" | "WITHDRAWN" | "COMPLETED",
  enrolledOn: string,
  withdrawnOn: string | null,
  completedOn: string | null = null,
) {
  return {
    id: uid(),
    sectionId,
    learnerId,
    status,
    enrolledOn: dayDate(enrolledOn),
    withdrawnOn: withdrawnOn ? dayDate(withdrawnOn) : null,
    completedOn: completedOn ? dayDate(completedOn) : null,
  };
}

function sessionRow(
  id: string,
  sectionId: string,
  startsAt: Date,
  status: "HELD" | "SCHEDULED" | "CANCELLED",
): Prisma.ClassSessionCreateManyInput {
  return {
    id,
    sectionId,
    title: "Session",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
    deliveryMode: "IN_PERSON",
    status,
  };
}

function attendanceRow(
  sessionId: string,
  learnerId: string,
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED",
  syncedAt: Date,
  recordedAt: Date,
  deviceId = main.deviceId,
  recordedById = main.teacherId,
): Prisma.AttendanceRecordCreateManyInput {
  return {
    id: uid(),
    clientEventId: uid(),
    learnerId,
    sessionId,
    status,
    deviceId,
    recordedById,
    recordedAt,
    syncedAt,
    createdAt: syncedAt,
    createdOffline: false,
  };
}

function gradeRow(
  id: string,
  assignmentId: string,
  learnerId: string,
  teacherId: string,
  deviceId: string,
  when: Date,
): Prisma.GradeEntryCreateManyInput {
  return {
    id,
    assignmentId,
    learnerId,
    points: "8.00",
    academicNote: NOTE,
    recordedById: teacherId,
    deviceId,
    versionVector: { [deviceId]: 1 },
    deviceRecordedAt: when,
    syncedAt: when,
    createdOffline: false,
  };
}

function assignmentRow(
  id: string,
  sectionId: string,
  teacherId: string,
  kind: "PAPER" | "DIGITAL" | "BOTH" | "IN_CLASS_EXAM",
  dueAt: Date | null,
  maxPoints: string,
): Prisma.AssignmentCreateManyInput {
  return { id, sectionId, title: kind, kind, dueAt, maxPoints, createdById: teacherId };
}

function submission(
  id: string,
  assignmentId: string,
  learnerId: string,
  teacherId: string,
  deviceId: string,
  uploadState: "STORED" | "QUEUED",
) {
  const when = new Date("2026-10-04T00:00:00.000Z");
  return {
    id,
    clientSubmissionId: id,
    assignmentId,
    learnerId,
    submittedById: teacherId,
    uploadState,
    byteSize: 12,
    mimeType: "application/pdf",
    checksumSha256: CHECKSUM,
    storageKey: STORAGE,
    deviceId,
    createdOffline: false,
    queuedAt: when,
    receivedAt: uploadState === "STORED" ? when : null,
  };
}
