import { liveSubmissionDeps, type SubmissionResult } from "@/lib/data/submissions";

export function submissionResponse(result: SubmissionResult): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}

export async function readSubmissionJson(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; result: SubmissionResult }> {
  let text = "";
  try {
    text = await request.text();
  } catch {
    return { ok: false, result: { status: 400, body: { error: "This upload request is not valid.", code: "INVALID", acknowledged: false } } };
  }
  if (text.length > 4000) {
    return { ok: false, result: { status: 400, body: { error: "This upload request is not valid.", code: "INVALID", acknowledged: false } } };
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, result: { status: 400, body: { error: "This upload request is not valid.", code: "INVALID", acknowledged: false } } };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, result: { status: 400, body: { error: "This upload request is not valid.", code: "INVALID", acknowledged: false } } };
  }
}

export function submissionDeps(now = new Date()) {
  return liveSubmissionDeps(now);
}
