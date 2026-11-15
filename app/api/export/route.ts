import { getActor } from "@/lib/auth/actor";
import { resolveExportCenter } from "@/lib/export/center";
import { exportCenterReport } from "@/lib/export/run";
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
  const actor = await getActor();
  if (!actor) return noFile(401, "Sign in required.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return noFile(400, FORMAT_INVALID);
  }

  const format = strictChoice(form.get("format"), ["csv", "pdf"] as const);
  const mode = strictMode(form.get("mode"));
  const periodStart = strictDay(form.get("periodStart"));
  const periodEnd = strictDay(form.get("periodEnd"));
  if (!format || !mode) return noFile(400, FORMAT_INVALID);
  if (!periodStart || !periodEnd || periodStart > periodEnd) return noFile(400, DATE_INVALID);

  const postedCenter = textField(form.get("centerId"));
  const center = await resolveExportCenter({ userId: actor.id, postedCenterId: postedCenter });
  if (!center.ok) return noFile(403, EXPORT_DENIED);

  const requirementId = textField(form.get("requirementId"));
  try {
    const result = await exportCenterReport({
      actor,
      centerId: center.centerId,
      periodStart,
      periodEnd,
      mode,
      format,
      requirementId: requirementId ?? undefined,
    });
    if (!result.ok) {
      const status = result.message === EXPORT_DENIED ? 403 : 400;
      return noFile(status, result.message);
    }
    if (!/^grant-export-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.(csv|pdf)$/.test(result.filename)) {
      return noFile(500, NOT_RECORDED);
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
    return noFile(500, NOT_RECORDED);
  }
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
