import { describe, expect, it } from "vitest";
import { parseScoreResponse, resolveRiskServiceUrl, scoreLearner, RiskServiceError } from "../lib/risk/client";
import type { ScoreRequest } from "../lib/risk/payload";
import { RISK_UNAVAILABLE } from "../lib/risk/rules";

const KEY = "synthetic-risk-service-key";
const request: ScoreRequest = {
  learner_code: "LNR-0007",
  as_of: "2026-04-30",
  attendance: [],
  assignments: { expected: 0, missing: 0 },
  grades: [],
  thresholds: { watch: 40, high: 70 },
};

function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    learner_code: "LNR-0007",
    score: 50,
    risk_level: "Watch",
    usable_data_points: 5,
    minimum_usable_data_points: 3,
    indicators: {
      absence: { available: true, value: 1 },
      missing_assignments: { available: false, value: null, missing: null, expected: 0 },
      grade_trend: { available: false, value: null },
    },
    reasons: ["A person should review the indicators."],
    check_in_suggested: false,
    note: "Starting estimates only.",
    applied: {
      calculation_version: "day14-v1",
      weight_absence: 0.5,
      weight_missing: 0.3,
      weight_grade: 0.2,
      watch: 40,
      high: 70,
    },
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("risk service client", () => {
  it("accepts localhost over http and requires https for any other host", () => {
    expect(resolveRiskServiceUrl("http://127.0.0.1:8000")?.origin).toBe("http://127.0.0.1:8000");
    expect(resolveRiskServiceUrl("http://localhost:8000")?.origin).toBe("http://localhost:8000");
    expect(resolveRiskServiceUrl("https://risk.example.test")?.origin).toBe("https://risk.example.test");
    expect(resolveRiskServiceUrl("http://risk.example.test")).toBeNull();
    expect(resolveRiskServiceUrl("http://user:secret@127.0.0.1:8000")).toBeNull();
  });

  it("sends the service key and keeps it out of the parsed result", async () => {
    let seenKey = "";
    let seenUrl = "";
    const parsed = await scoreLearner(request, {
      env: { RISK_SERVICE_URL: "http://127.0.0.1:8000", RISK_SERVICE_API_KEY: KEY },
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        seenKey = new Headers(init?.headers).get("x-risk-service-key") ?? "";
        return jsonResponse(200, responseBody());
      },
    });
    expect(seenUrl).toBe("http://127.0.0.1:8000/score");
    expect(seenKey).toBe(KEY);
    expect(parsed.score).toBe(50);
    expect(parsed.riskLevel).toBe("Watch");
    expect(JSON.stringify(parsed)).not.toContain(KEY);
  });

  it("refuses a missing key, a refusal, a timeout, and a malformed body without a stack", async () => {
    await expect(scoreLearner(request, { env: { RISK_SERVICE_URL: "http://127.0.0.1:8000" } })).rejects.toMatchObject({
      code: "unconfigured",
    });

    await expect(
      scoreLearner(request, {
        env: { RISK_SERVICE_URL: "http://127.0.0.1:8000", RISK_SERVICE_API_KEY: KEY },
        fetchImpl: async () => jsonResponse(401, { detail: KEY }),
      }),
    ).rejects.toMatchObject({ code: "rejected", message: RISK_UNAVAILABLE });

    await expect(
      scoreLearner(request, {
        env: { RISK_SERVICE_URL: "http://127.0.0.1:8000", RISK_SERVICE_API_KEY: KEY },
        fetchImpl: async () => {
          throw new TypeError("connect ECONNREFUSED");
        },
      }),
    ).rejects.toMatchObject({ code: "unavailable" });

    await expect(
      scoreLearner(request, {
        env: { RISK_SERVICE_URL: "http://127.0.0.1:8000", RISK_SERVICE_API_KEY: KEY },
        timeoutMs: 20,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      }),
    ).rejects.toBeInstanceOf(RiskServiceError);

    const malformed = parseScoreResponse(responseBody({ score: "50", risk_level: "Watch" }), request);
    expect(malformed).toBeNull();
    const mismatched = parseScoreResponse(responseBody({ score: 50, risk_level: "High" }), request);
    expect(mismatched).toBeNull();
    const renamed = parseScoreResponse(responseBody({ learner_code: "LNR-9999" }), request);
    expect(renamed).toBeNull();
  });

  it("accepts a center threshold and rejects a weight change in the response", () => {
    const custom = { ...request, thresholds: { watch: 55, high: 90 } };
    const agreed = parseScoreResponse(
      responseBody({
        score: 50,
        risk_level: null,
        applied: {
          calculation_version: "day14-v1",
          weight_absence: 0.5,
          weight_missing: 0.3,
          weight_grade: 0.2,
          watch: 55,
          high: 90,
        },
      }),
      custom,
    );
    expect(agreed?.riskLevel).toBeNull();
    expect(agreed?.watch).toBe(55);
    const retuned = parseScoreResponse(
      responseBody({
        applied: {
          calculation_version: "day14-v1",
          weight_absence: 1,
          weight_missing: 0,
          weight_grade: 0,
          watch: 40,
          high: 70,
        },
      }),
      request,
    );
    expect(retuned).toBeNull();
  });
});
