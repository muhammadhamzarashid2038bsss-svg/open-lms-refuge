import { getActor } from "@/lib/auth/actor";
import { resolveExportCenter } from "@/lib/export/center";
import { CONFIRMATION_MISSING } from "@/lib/export/offer";
import { exportCenterReport, REQUIREMENT_MISSING } from "@/lib/export/run";
import { EXPORT_DENIED } from "@/lib/export/types";
import { syncPostAllowed } from "@/lib/http/sync";
import { formatCivilDate, parseIsoDate } from "@/lib/lms/timetable";

// PDFKit reads font files from disk, so this route must run on Node.js.
// With cache components enabled, Next.js already uses the Node.js runtime and
// rejects an explicit runtime setting. The package is also kept out of the
// bundle in next.config.ts.

const DATE_INVALID = "The export dates could not be read.";
const FORMAT_INVALID = "The export format could not be read.";
const ORIGIN_REJECTED = "This page cannot export a report.";
const NOT_RECORDED = "The export could not be recorded.";

function noFile(status: number, message: string): Response {
  return Response.json(
    { error: message },
    { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

export function GET(): Response {
  return noFile(405, "The export is requested from the Export page.");
}

export async function POST(request: Request): Promise<Response> {
  if (!syncPostAllowed(request)) return noFile(403, ORIGIN_REJECTED);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return noFile(400, FORMAT_INVALID);
  }

  const actor = await getActor();
  if (!actor) return reply(request, form, 401, "Sign in required.");

  const format = strictChoice(form.get("format"), ["csv", "pdf"] as const);
  const mode = strictMode(form.get("mode"));
  const periodStart = strictDay(form.get("periodStart"));
  const periodEnd = strictDay(form.get("periodEnd"));
  if (!format || !mode) return reply(request, form, 400, FORMAT_INVALID);
  if (!periodStart || !periodEnd || periodStart > periodEnd) return reply(request, form, 400, DATE_INVALID);

  const postedCenter = textField(form.get("centerId"));
  const center = await resolveExportCenter({ userId: actor.id, postedCenterId: postedCenter });
  if (!center.ok) return reply(request, form, 403, EXPORT_DENIED, postedCenter);

  const requirementId = textField(form.get("requirementId"));
  // Only the exact confirmation value counts. A hidden field or the word
  // "true" is not a confirmation.
  const learnerLevelConfirmed = textField(form.get("learnerLevelConfirmed")) === "yes";
  try {
    const result = await exportCenterReport({
      actor,
      centerId: center.centerId,
      periodStart,
      periodEnd,
      mode,
      format,
      requirementId: requirementId ?? undefined,
      learnerLevelConfirmed,
    });
    if (!result.ok) {
      const status = result.message === EXPORT_DENIED ? 403 : 400;
      return reply(request, form, status, result.message, center.centerId);
    }
    if (!/^grant-export-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.(csv|pdf)$/.test(result.filename)) {
      return reply(request, form, 500, NOT_RECORDED, center.centerId);
    }
    return new Response(Buffer.from(result.body), {
      status: 200,
      headers: {
        "content-type": result.contentType,
        "content-disposition": `attachment; filename="${result.filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return reply(request, form, 500, NOT_RECORDED, center.centerId);
  }
}

// A phone form treats the response as the next page. JSON would be shown as
// raw text, and the dates the director typed would be lost. The Export page
// sends returnTo=page so a refusal comes back as a short code. Requests
// without that field, including the automated checks, still receive JSON.
// The confirmation rule itself is unchanged.
function reply(request: Request, form: FormData, status: number, message: string, centerId?: string | null): Response {
  if (form.get("returnTo") !== "page") return noFile(status, message);
  if (status === 401) return Response.redirect(new URL("/", request.url), 303);
  const query = new URLSearchParams();
  query.set("error", errorCode(message));
  const start = strictDay(form.get("periodStart"));
  const end = strictDay(form.get("periodEnd"));
  const format = strictChoice(form.get("format"), ["csv", "pdf"] as const);
  const mode = textField(form.get("mode"));
  const requirementId = textField(form.get("requirementId"));
  const center = centerId && isUuid(centerId) ? centerId : textField(form.get("centerId"));
  if (start) query.set("from", start);
  if (end) query.set("to", end);
  if (format) query.set("format", format);
  if (mode === "aggregate" || mode === "pseudonymized") query.set("mode", mode);
  if (requirementId && isUuid(requirementId)) query.set("requirement", requirementId);
  if (center && isUuid(center)) query.set("center", center);
  return Response.redirect(new URL(`/export?${query.toString()}`, request.url), 303);
}

function errorCode(message: string): string {
  if (message === CONFIRMATION_MISSING) return "confirmation";
  if (message === REQUIREMENT_MISSING) return "requirement";
  if (message === DATE_INVALID) return "dates";
  if (message === FORMAT_INVALID) return "format";
  if (message === EXPORT_DENIED || message === ORIGIN_REJECTED) return "denied";
  return "failed";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function textField(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function strictChoice<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return allowed.find((item) => item === text) ?? null;
}

function strictMode(value: FormDataEntryValue | null): "aggregate" | "pseudonymized" | null {
  if (value === null) return "aggregate";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return "aggregate";
  if (text === "aggregate" || text === "pseudonymized") return text;
  return null;
}

function strictDay(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const parsed = parseIsoDate(text);
  if (!parsed) return null;
  const canonical = formatCivilDate(parsed);
  return canonical === text ? canonical : null;
}
