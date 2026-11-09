// Turns one health check into a reachability result.
// navigator.onLine is accepted and ignored. A phone often says it is online
// when the school server cannot be reached, and the other way around.
// Only HTTP 200 with exactly {"status":"ok"} and a JSON content type means
// the server was reached and the sign-in is usable. Stage 2 will provide
// the route. This file does not fetch.

export type HealthResponseFacts = {
  status: number;
  type?: string;
  redirected?: boolean;
  contentType?: string | null;
  bodyText?: string;
};

export type HealthFacts = {
  /** Present so callers can show they passed it. It never changes the result. */
  navigatorOnline?: boolean;
  error?: "network" | "timeout";
  response?: HealthResponseFacts;
};

export type HealthClass =
  | { state: "authenticated" }
  | { state: "unauthorized" }
  | {
      state: "unavailable";
      reason: "redirect" | "html" | "server_error" | "network" | "timeout" | "unexpected";
    };

const HEALTH_KEYS = ["status"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonContentType(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function htmlContentType(value: string | null | undefined): boolean {
  if (!value) return false;
  const media = value.split(";", 1)[0]?.trim().toLowerCase();
  return media === "text/html" || media === "application/xhtml+xml";
}

function htmlBody(body: string): boolean {
  const start = body.trimStart().slice(0, 200).toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

function isRedirect(response: HealthResponseFacts): boolean {
  if (response.redirected === true || response.type === "opaqueredirect") return true;
  if (response.status === 0) return true;
  return response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308;
}

function exactHealthBody(body: string): { status: string } | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return null;
    const keys = Object.keys(parsed);
    if (keys.length !== HEALTH_KEYS.length || HEALTH_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(parsed, key))) return null;
    if (typeof parsed.status !== "string") return null;
    return { status: parsed.status };
  } catch {
    return null;
  }
}

/// Classify a finished check. A missing response is an unavailable network,
/// including when the phone reports itself online.
export function classifyHealth(facts: HealthFacts): HealthClass {
  if (facts.error === "timeout") return { state: "unavailable", reason: "timeout" };
  if (facts.error === "network" || !facts.response) return { state: "unavailable", reason: "network" };

  const response = facts.response;
  if (isRedirect(response)) return { state: "unavailable", reason: "redirect" };
  if (response.status >= 500 && response.status <= 599) return { state: "unavailable", reason: "server_error" };

  const body = response.bodyText ?? "";
  if (htmlContentType(response.contentType) || htmlBody(body)) return { state: "unavailable", reason: "html" };
  if (response.status === 401 || response.status === 403) return { state: "unauthorized" };

  const health = jsonContentType(response.contentType) ? exactHealthBody(body) : null;
  if (response.status === 200 && health?.status === "ok") return { state: "authenticated" };
  if (health?.status === "unauthorized") return { state: "unauthorized" };
  return { state: "unavailable", reason: "unexpected" };
}
