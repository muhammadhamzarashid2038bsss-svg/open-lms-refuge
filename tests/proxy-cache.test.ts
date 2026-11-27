import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../lib/auth/constants";
import { proxy } from "../proxy";

function callProxy(path: string, options: { signedIn?: boolean; action?: boolean } = {}) {
  const headers = new Headers();
  if (options.signedIn) headers.set("cookie", `${SESSION_COOKIE}=synthetic-session-value`);
  if (options.action) headers.set("next-action", "synthetic-action");
  return proxy(new NextRequest(new URL(path, "http://127.0.0.1:3000"), { headers }));
}

describe("private page cache protection", () => {
  it("tells caches not to store export, audit, and handoff pages", () => {
    for (const path of [
      "/export",
      "/export/later",
      "/audit",
      "/audit/later",
      "/handoff",
      "/handoff/report-1",
      "/handoff/report-1/print",
    ]) {
      const response = callProxy(path, { signedIn: true });
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("keeps the existing no-store rule for other signed-in pages", () => {
    const response = callProxy("/director/check-ins", { signedIn: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
  });

  it("sends a signed-out visitor away from those pages", () => {
    for (const path of ["/export", "/audit", "/handoff/report-1/print"]) {
      const response = callProxy(path);
      expect(new URL(response.headers.get("location") ?? "", "http://127.0.0.1:3000").pathname, path).toBe("/");
    }
  });

  it("does not apply that rule to the public offline shell or the sign-in page", () => {
    for (const path of ["/", "/kiosk-shell", "/sign-in"]) {
      const response = callProxy(path);
      expect(response.headers.get("cache-control"), path).toBeNull();
    }
  });

  it("leaves a server action on its existing path", () => {
    const response = callProxy("/export", { signedIn: true, action: true });
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });
});
