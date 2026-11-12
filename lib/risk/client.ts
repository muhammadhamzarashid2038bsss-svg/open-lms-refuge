// Server-to-server call. The browser never sees the key or the Python URL.
// A remote service must use HTTPS. Local development may use http on localhost.
// The request body is the Day 14 contract from lib/risk/payload.ts.

import type { ScoreRequest } from "./payload";
import { RISK_UNAVAILABLE } from "./rules";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const VERSION_TOKEN = /^[A-Za-z0-9_.:-]{1,40}$/;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ParsedScore = {
  learnerCode: string;
  score: number | null;
  riskLevel: "Watch" | "High" | "Insufficient data" | null;
  usableDataPoints: number;
  minimumUsableDataPoints: number;
  checkInSuggested: boolean;
  reasons: string[];
  absence: { available: boolean; value: number | null };
  missing: { available: boolean; value: number | null; missing: number | null; expected: number | null };
  gradeTrend: { available: boolean; value: number | null };
  calculationVersion: string;
  weightAbsence: number;
  weightMissing: number;
  weightGrade: number;
  watch: number;
  high: number;
};

export type RiskClientFailure = "unconfigured" | "unavailable" | "timeout" | "rejected" | "invalid";

export class RiskServiceError extends Error {
  readonly code: RiskClientFailure;

  constructor(code: RiskClientFailure) {
    super(RISK_UNAVAILABLE);
    this.name = "RiskServiceError";
    this.code = code;
  }
}

export function resolveRiskServiceUrl(raw: string | undefined): URL | null {
  if (!raw?.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const local = LOCAL_HOSTS.has(url.hostname);
  if (local) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } else if (url.protocol !== "https:") {
    return null;
  }
  return url;
}

export async function scoreLearner(
  request: ScoreRequest,
  options: {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
  } = {},
): Promise<ParsedScore> {
  const env = options.env ?? process.env;
  const key = env.RISK_SERVICE_API_KEY?.trim() ?? "";
  const base = resolveRiskServiceUrl(env.RISK_SERVICE_URL);
  if (!key || !base) throw new RiskServiceError("unconfigured");
  const endpoint = new URL("/score", base.origin);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-risk-service-key": key,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbort(error)) throw new RiskServiceError("timeout");
    throw new RiskServiceError("unavailable");
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) throw new RiskServiceError("rejected");
  if (!response.ok) throw new RiskServiceError(response.status === 422 ? "invalid" : "unavailable");
  const text = await response.text();
  if (text.length > 100_000) throw new RiskServiceError("invalid");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new RiskServiceError("invalid");
  }
  const parsed = parseScoreResponse(body, request);
  if (!parsed) throw new RiskServiceError("invalid");
  return parsed;
}

export function scoreAgreesWithThresholds(
  parsed: Pick<ParsedScore, "score" | "riskLevel" | "watch" | "high" | "weightAbsence" | "weightMissing" | "weightGrade">,
  thresholds: { watch: number; high: number },
): boolean {
  if (!close(parsed.weightAbsence, 0.5) || !close(parsed.weightMissing, 0.3) || !close(parsed.weightGrade, 0.2)) {
    return false;
  }
  if (!close(parsed.watch, thresholds.watch) || !close(parsed.high, thresholds.high)) return false;
  if (parsed.riskLevel === "Insufficient data") return parsed.score === null;
  if (parsed.score === null) return false;
  return levelFor(round2(parsed.score), thresholds.watch, thresholds.high) === parsed.riskLevel;
}

export function parseScoreResponse(body: unknown, request: ScoreRequest): ParsedScore | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.learner_code !== request.learner_code) return null;
  const applied = record.applied;
  if (!applied || typeof applied !== "object" || Array.isArray(applied)) return null;
  const settings = applied as Record<string, unknown>;
  const version = settings.calculation_version;
  if (typeof version !== "string" || !VERSION_TOKEN.test(version)) return null;
  const weightAbsence = finite(settings.weight_absence);
  const weightMissing = finite(settings.weight_missing);
  const weightGrade = finite(settings.weight_grade);
  const watch = finite(settings.watch);
  const high = finite(settings.high);
  if (
    weightAbsence === null ||
    weightMissing === null ||
    weightGrade === null ||
    watch === null ||
    high === null
  ) {
    return null;
  }
  // Day 15 keeps the approved weights. A threshold change must not retune them.
  if (!close(weightAbsence, 0.5) || !close(weightMissing, 0.3) || !close(weightGrade, 0.2)) return null;
  if (Math.abs(weightAbsence + weightMissing + weightGrade - 1) > 0.0001) return null;
  if (!close(watch, request.thresholds.watch) || !close(high, request.thresholds.high)) return null;
  if (watch < 0 || high > 100 || watch >= high) return null;

  const riskLevel = record.risk_level;
  if (riskLevel !== null && riskLevel !== "Watch" && riskLevel !== "High" && riskLevel !== "Insufficient data") {
    return null;
  }
  const rawScore = record.score;
  const score = rawScore === null ? null : finite(rawScore);
  if (rawScore !== null && score === null) return null;
  if (score !== null && (score < 0 || score > 100)) return null;
  if (riskLevel === "Insufficient data") {
    if (score !== null) return null;
  } else if (score === null) {
    return null;
  } else if (levelFor(round2(score), watch, high) !== riskLevel) {
    return null;
  }

  const absence = indicator(record.indicators, "absence");
  const missing = missingIndicator(record.indicators);
  const gradeTrend = indicator(record.indicators, "grade_trend");
  if (!absence || !missing || !gradeTrend) return null;
  if (typeof record.check_in_suggested !== "boolean") return null;
  if (!Array.isArray(record.reasons) || record.reasons.length > 20) return null;
  const reasons: string[] = [];
  for (const reason of record.reasons) {
    if (typeof reason !== "string" || reason.length === 0 || reason.length > 2000) return null;
    reasons.push(reason);
  }
  const usable = finite(record.usable_data_points);
  const minimum = finite(record.minimum_usable_data_points);
  if (usable === null || minimum === null || usable < 0 || minimum < 1) return null;

  return {
    learnerCode: request.learner_code,
    score: score === null ? null : round2(score),
    riskLevel,
    usableDataPoints: usable,
    minimumUsableDataPoints: minimum,
    checkInSuggested: record.check_in_suggested,
    reasons,
    absence,
    missing,
    gradeTrend,
    calculationVersion: version,
    weightAbsence,
    weightMissing,
    weightGrade,
    watch,
    high,
  };
}

function indicator(
  source: unknown,
  key: string,
): { available: boolean; value: number | null } | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const row = (source as Record<string, unknown>)[key];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const reading = row as Record<string, unknown>;
  if (typeof reading.available !== "boolean") return null;
  if (!reading.available) {
    if (reading.value !== null) return null;
    return { available: false, value: null };
  }
  const value = finite(reading.value);
  if (value === null || value < 0 || value > 1) return null;
  return { available: true, value: round4(value) };
}

function missingIndicator(
  source: unknown,
): { available: boolean; value: number | null; missing: number | null; expected: number | null } | null {
  const base = indicator(source, "missing_assignments");
  if (!base || !source || typeof source !== "object" || Array.isArray(source)) return null;
  const row = (source as Record<string, unknown>).missing_assignments;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const reading = row as Record<string, unknown>;
  const missing = reading.missing === null ? null : finite(reading.missing);
  const expected = reading.expected === null ? null : finite(reading.expected);
  if (reading.missing !== null && missing === null) return null;
  if (reading.expected !== null && expected === null) return null;
  return { ...base, missing, expected };
}

function levelFor(score: number, watch: number, high: number): "Watch" | "High" | null {
  if (score >= high) return "High";
  if (score >= watch) return "Watch";
  return null;
}

function finite(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function close(value: number, expected: number): boolean {
  return Math.abs(value - expected) < 0.0001;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
