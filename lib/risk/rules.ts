// Shared checks for the director risk screens.
// Dismissal uses the closed list already stored on RiskFlag. A free-text
// reason would invite a family story, which this product does not keep.

export const RISK_UNAVAILABLE =
  "The risk check could not be completed. Saved suggestions are unchanged. You can try again when the scoring service is available.";

export const RISK_DENIED = "You cannot run a risk assessment for this center.";

export const RISK_FLAG_DENIED = "That suggestion is not available.";

export const THRESHOLD_INVALID =
  "Watch and High must be whole numbers from 0 to 100, and Watch must be lower than High.";

export const NOTE_INVALID = "Keep the operational note to 160 characters, without a line break.";

export const NOTE_WARNING =
  "Optional. Write a short operational note only, such as who will visit. Do not write family circumstances, legal status, or a private story.";

export const DISMISS_WARNING =
  "Choose a short operational reason. Do not write family circumstances or a private story.";

export const DISMISS_REASONS = [
  { value: "NOT_NEEDED", label: "Not needed" },
  { value: "ALREADY_SUPPORTED", label: "Already supported" },
  { value: "DATA_ERROR", label: "The records look wrong" },
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number]["value"];

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,80}$/;
const NOTE_MAX = 160;

export function validIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY.test(value);
}

export function parseThresholds(
  watchRaw: string,
  highRaw: string,
): { ok: true; watch: number; high: number } | { ok: false; message: string } {
  if (!/^\d{1,3}$/.test(watchRaw.trim()) || !/^\d{1,3}$/.test(highRaw.trim())) {
    return { ok: false, message: THRESHOLD_INVALID };
  }
  const watch = Number(watchRaw.trim());
  const high = Number(highRaw.trim());
  if (!Number.isInteger(watch) || !Number.isInteger(high)) return { ok: false, message: THRESHOLD_INVALID };
  if (watch < 0 || watch > 100 || high < 0 || high > 100 || watch >= high) {
    return { ok: false, message: THRESHOLD_INVALID };
  }
  return { ok: true, watch, high };
}

export function cleanOperationalNote(
  raw: string,
): { ok: true; note: string | null } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, note: null };
  if (trimmed.length > NOTE_MAX || /[\u0000-\u001F]/.test(trimmed)) {
    return { ok: false, message: NOTE_INVALID };
  }
  return { ok: true, note: trimmed };
}

export function parseDismissReason(raw: string): DismissReason | null {
  const found = DISMISS_REASONS.find((reason) => reason.value === raw);
  return found ? found.value : null;
}

export function dismissLabel(value: string | null): string {
  return DISMISS_REASONS.find((reason) => reason.value === value)?.label ?? "Dismissed";
}
