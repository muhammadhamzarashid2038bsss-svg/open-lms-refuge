import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";
import { kioskShellHtml } from "../lib/device/kiosk-shell-html";
import { closeWorkingDatabase, localRequest, openWorkingDatabase, runLocalTransaction } from "../lib/device/local-db";
import {
  PRECACHE_ICON_192,
  PRECACHE_ICON_512,
  PRECACHE_MANIFEST,
  PRECACHE_OFFLINE,
  PRECACHE_SHELL,
  PRECACHE_SHELL_SCRIPT,
  isPrecacheUrlAllowed,
} from "../lib/device/precache-allowlist";
import { readPersistenceOnce, persistenceLines } from "../lib/device/persistence-status";
import { registerKioskServiceWorker, shouldRegisterServiceWorker } from "../lib/device/register-service-worker";
import {
  deleteObsoleteCaches,
  isAttendanceDocumentNavigation,
  isUnrelatedDocumentNavigation,
  networkOrFallback,
} from "../lib/device/sw-navigation";

const root = process.cwd();

function headers(values: Record<string, string> = {}) {
  const lower = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function navigation(pathname: string, extra?: { method?: string; mode?: string; headers?: Record<string, string> }) {
  return {
    method: extra?.method ?? "GET",
    mode: extra?.mode ?? "navigate",
    pathname,
    headers: headers(extra?.headers),
  };
}

function pngSize(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), type: bytes.subarray(12, 16).toString("ascii") };
}

function precacheUrls(source: string) {
  const block = source.slice(0, source.indexOf("];"));
  return [...block.matchAll(/url:"([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("installable shell", () => {
  it("describes an installable app without private records", () => {
    const web = manifest();
    expect(web.name).toBe("Open LMS Refugee");
    expect(web.short_name).toBe("Open LMS");
    expect(web.description).toBeTruthy();
    expect(web.start_url).toBe("/kiosk-shell");
    expect(web.scope).toBe("/");
    expect(web.display).toBe("standalone");
    expect(web.background_color).toBe("#ffffff");
    expect(web.theme_color).toBe("#09090b");
    const icons = web.icons ?? [];
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }),
      ]),
    );
    const text = JSON.stringify(web);
    expect(text).not.toContain("Demo Learner");
    expect(text).not.toContain("LNR-");
    expect(text).not.toContain("demo-password");
    expect(pngSize(join(root, "public/icons/icon-192.png"))).toMatchObject({ width: 192, height: 192, type: "IHDR" });
    expect(pngSize(join(root, "public/icons/icon-512.png"))).toMatchObject({ width: 512, height: 512, type: "IHDR" });
  });

  it("registers the worker only for a production build", async () => {
    const calls: string[] = [];
    const container = {
      serviceWorker: {
        register: async (url: string) => {
          calls.push(url);
        },
      },
    };
    expect(shouldRegisterServiceWorker("development")).toBe(false);
    expect(shouldRegisterServiceWorker("test")).toBe(false);
    expect(shouldRegisterServiceWorker("production")).toBe(true);
    await expect(registerKioskServiceWorker("development", container)).resolves.toBe("skipped");
    expect(calls).toEqual([]);
    expect(kioskShellHtml("var ready = true;")).not.toContain("/kiosk/register.js");
    expect(kioskShellHtml("var ready = true;", { registerServiceWorker: true })).toContain('src="/kiosk/register.js"');
    const dev = readFileSync(join(root, "package.json"), "utf8");
    expect(dev).toContain('"dev": "next dev"');
    expect(dev).not.toContain("serwist build --watch");
  });

  it("keeps the online app usable when registration fails", async () => {
    const result = await registerKioskServiceWorker("production", {
      serviceWorker: {
        register: async () => {
          throw new Error("blocked");
        },
      },
    });
    expect(result).toBe("failed");
    await expect(registerKioskServiceWorker("production", {})).resolves.toBe("unsupported");
  });

  it("asks the browser to keep data at most once", async () => {
    let persistCalls = 0;
    const kept = await readPersistenceOnce({
      persisted: async () => true,
      persist: async () => {
        persistCalls += 1;
        return true;
      },
      estimate: async () => ({ usage: 10, quota: 100 }),
    });
    expect(persistCalls).toBe(0);
    expect(kept.request).toBe("already-kept");
    expect(persistenceLines(kept).join(" ")).toContain("Storage used: 10 bytes");
    const refused = await readPersistenceOnce({
      persisted: async () => false,
      persist: async () => {
        persistCalls += 1;
        return false;
      },
      estimate: async () => ({ usage: 4, quota: 8 }),
    });
    expect(persistCalls).toBe(1);
    expect(refused.request).toBe("denied");
    expect(persistenceLines(refused).join(" ")).toContain("Local attendance saving is unavailable.");
  });
});

describe("service worker boundaries", () => {
  const attendance = "/sections/section-1/sessions/session-1/attendance";

  it("matches only a full attendance page load", () => {
    expect(isAttendanceDocumentNavigation(navigation(attendance))).toBe(true);
    expect(isAttendanceDocumentNavigation(navigation(`${attendance}/`))).toBe(true);
    expect(isAttendanceDocumentNavigation(navigation("/kiosk-harness/sections/section-1/sessions/session-1/attendance"))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation("/sections/section-1/sessions/session-1/attendance/edit"))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation("/api/attendance"))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { mode: "cors" }))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { method: "POST" }))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { headers: { RSC: "1" } }))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { headers: { "Next-Router-Prefetch": "1" } }))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { headers: { "Next-Router-Segment-Prefetch": "1" } }))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { headers: { "Next-Router-State-Tree": "tree" } }))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { headers: { "Next-Action": "abc" } }))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { headers: { Accept: "text/x-component" } }))).toBe(false);
    expect(isAttendanceDocumentNavigation(navigation(attendance, { headers: { Purpose: "prefetch" } }))).toBe(false);
  });

  it("leaves client, prefetch, and server-action requests off the offline document path", () => {
    expect(isUnrelatedDocumentNavigation(navigation("/teacher", { mode: "cors", headers: { RSC: "1" } }))).toBe(false);
    expect(isUnrelatedDocumentNavigation(navigation("/teacher", { headers: { "Next-Router-Prefetch": "1" } }))).toBe(false);
    expect(isUnrelatedDocumentNavigation(navigation("/teacher", { method: "POST", headers: { "Next-Action": "abc" } }))).toBe(false);
    expect(isUnrelatedDocumentNavigation(navigation("/api/session"))).toBe(true);
    expect(isAttendanceDocumentNavigation(navigation("/api/session"))).toBe(false);
  });

  it("returns an online attendance page without storing it", async () => {
    let fallbacks = 0;
    const response = await networkOrFallback(new Request(`https://center.test${attendance}`), {
      fetch: async () => new Response("signed-in attendance", { status: 200 }),
      fallback: async () => {
        fallbacks += 1;
        return new Response("shell");
      },
    });
    expect(await response.text()).toBe("signed-in attendance");
    expect(fallbacks).toBe(0);
    const source = readFileSync(join(root, "lib/device/sw-navigation.ts"), "utf8");
    expect(source).not.toContain("cache.put");
    expect(source).not.toContain("caches.open");
  });

  it("returns the standalone shell when the attendance page cannot be reached", async () => {
    const shell = new Response("empty shell");
    const response = await networkOrFallback(new Request(`https://center.test${attendance}`), {
      fetch: async () => {
        throw new TypeError("offline");
      },
      fallback: async () => shell,
    });
    expect(response).toBe(shell);
  });

  it("returns the offline page for an unrelated address", async () => {
    expect(isUnrelatedDocumentNavigation(navigation("/teacher"))).toBe(true);
    expect(isAttendanceDocumentNavigation(navigation("/teacher"))).toBe(false);
    const offline = new Response("offline page");
    const response = await networkOrFallback(new Request("https://center.test/teacher"), {
      fetch: async () => {
        throw new TypeError("offline");
      },
      fallback: async () => offline,
    });
    expect(response).toBe(offline);
    const page = readFileSync(join(root, "public/offline.html"), "utf8");
    expect(page).toContain('href="/kiosk-shell"');
    expect(page).not.toContain("Demo Learner");
  });

  it("does not precache signed-in or prerendered pages", () => {
    expect(isPrecacheUrlAllowed(PRECACHE_SHELL)).toBe(true);
    expect(isPrecacheUrlAllowed(PRECACHE_SHELL_SCRIPT)).toBe(true);
    expect(isPrecacheUrlAllowed(PRECACHE_MANIFEST)).toBe(true);
    expect(isPrecacheUrlAllowed(PRECACHE_OFFLINE)).toBe(true);
    expect(isPrecacheUrlAllowed(PRECACHE_ICON_192)).toBe(true);
    expect(isPrecacheUrlAllowed(PRECACHE_ICON_512)).toBe(true);
    expect(isPrecacheUrlAllowed("/_next/static/chunks/app-abc123.js")).toBe(true);
    expect(isPrecacheUrlAllowed("/_next/static/chunks/app-abc123.css")).toBe(true);
    expect(isPrecacheUrlAllowed("/_next/static/media/type.woff2")).toBe(true);
    for (const blocked of [
      "/",
      "/opening",
      "/teacher",
      "/sections/section-1/sessions/session-1/attendance",
      "/api/attendance",
      "/kiosk-harness/sections/section-1/sessions/session-1/attendance",
      "/_next/static/chunks/app.js.map",
      "/_next/data/build/opening.json",
      "/vercel.svg",
    ]) {
      expect(isPrecacheUrlAllowed(blocked)).toBe(false);
    }
    const workerSource = readFileSync(join(root, "app/sw.ts"), "utf8");
    expect(workerSource).toContain("runtimeCaching: []");
    expect(workerSource).toContain("skipWaiting: false");
    expect(workerSource).toContain("clientsClaim: false");
    expect(workerSource).toContain("navigationPreload: false");
    expect(workerSource).not.toContain("defaultCache");
    expect(workerSource).not.toContain("NetworkFirst");
    expect(workerSource).not.toContain("indexedDB");
    expect(workerSource).not.toContain("deleteDatabase");
    const config = readFileSync(join(root, "serwist.config.mjs"), "utf8");
    expect(config).toContain("precachePrerendered: false");
  });

  it("keeps a pending attendance record while old caches are removed", async () => {
    const factory = new IDBFactory();
    const opened = await openWorkingDatabase(factory);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const event = {
      clientEventId: "event-kept",
      centerId: "center-a",
      userId: "user-a",
      sequence: 1,
    };
    try {
      await runLocalTransaction(opened.db, ["events"], "readwrite", (tx) => localRequest(tx.objectStore("events").add(event)));
      const deleted = await deleteObsoleteCaches(
        {
          keys: async () => [
            "olr-shell-precache-v2-https://center.test/",
            "https://center.test/-precache-old",
            "olr-local",
          ],
          delete: async (name) => name.includes("-precache-") && name.includes("https://center.test/"),
        },
        "olr-shell-precache-v2-https://center.test/",
        "https://center.test/",
      );
      expect(deleted).toEqual(["https://center.test/-precache-old"]);
      const stored = await runLocalTransaction(opened.db, ["events"], "readonly", (tx) =>
        localRequest(tx.objectStore("events").get("event-kept")),
      );
      expect(stored).toMatchObject(event);
    } finally {
      closeWorkingDatabase(opened.db);
    }
  });

  it("lists only approved files in the generated worker", () => {
    const source = readFileSync(join(root, "public/sw.js"), "utf8");
    const headers = readFileSync(join(root, "next.config.ts"), "utf8");
    expect(headers).toContain('value: "application/javascript; charset=utf-8"');
    expect(headers).toContain('value: "no-cache, no-store, must-revalidate"');
    expect(source.length).toBeGreaterThan(1000);
    const urls = precacheUrls(source);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls).toEqual(
      expect.arrayContaining([PRECACHE_SHELL, PRECACHE_SHELL_SCRIPT, PRECACHE_MANIFEST, PRECACHE_OFFLINE, PRECACHE_ICON_192, PRECACHE_ICON_512]),
    );
    expect(urls.some((url) => url.startsWith("/_next/static/") && url.endsWith(".js"))).toBe(true);
    for (const url of urls) expect(isPrecacheUrlAllowed(url)).toBe(true);
    const joined = urls.join("\n");
    expect(joined).not.toContain("/sections/");
    expect(joined).not.toContain("/api/");
    expect(joined).not.toContain("/opening");
    expect(joined).not.toContain("Demo Learner");
  });
});
