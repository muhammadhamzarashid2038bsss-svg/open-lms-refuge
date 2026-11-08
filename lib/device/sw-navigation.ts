// The service worker may replace only a full page load of one class address.
// Client navigations, prefetch, and server actions stay on the network so a
// signed-in page is never stored for the next person who uses this phone.

import { PRECACHE_OFFLINE, PRECACHE_SHELL } from "./precache-allowlist";

const ATTENDANCE_PATH = /^\/sections\/[^/]+\/sessions\/[^/]+\/attendance\/?$/;

export const NEXT_DATA_HEADERS = [
  "rsc",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-router-state-tree",
  "next-url",
  "next-action",
] as const;

export type HeaderLookup = { get(name: string): string | null };

export type NavigationRequest = {
  method: string;
  mode: string;
  pathname: string;
  headers: HeaderLookup;
};

export function isExactAttendancePath(pathname: string): boolean {
  return ATTENDANCE_PATH.test(pathname);
}

export function hasNextDataHeader(headers: HeaderLookup): boolean {
  for (const name of NEXT_DATA_HEADERS) {
    if (headers.get(name)) return true;
  }
  const accept = headers.get("accept") ?? "";
  if (accept.includes("text/x-component")) return true;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`.toLowerCase();
  return purpose.includes("prefetch");
}

function isPlainDocumentNavigation(input: NavigationRequest): boolean {
  return input.method === "GET" && input.mode === "navigate" && !hasNextDataHeader(input.headers);
}

export function isAttendanceDocumentNavigation(input: NavigationRequest): boolean {
  return isPlainDocumentNavigation(input) && isExactAttendancePath(input.pathname);
}

export function isUnrelatedDocumentNavigation(input: NavigationRequest): boolean {
  return isPlainDocumentNavigation(input) && !isExactAttendancePath(input.pathname);
}

export function offlineTextResponse(message: string): Response {
  return new Response(message, {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// The network response is returned as the browser gave it. Nothing here writes
// to Cache Storage, so a signed-in attendance page cannot be kept.
export async function networkOrFallback(
  request: Request,
  deps: {
    fetch: (input: Request) => Promise<Response>;
    fallback: () => Promise<Response>;
  },
): Promise<Response> {
  try {
    return await deps.fetch(request);
  } catch {
    return deps.fallback();
  }
}

export const SHELL_FALLBACK_URL = PRECACHE_SHELL;
export const OFFLINE_FALLBACK_URL = PRECACHE_OFFLINE;

// An old precache bucket may be removed only after the new worker activates,
// which waits until the open class page has closed. The name must belong to
// this site's precache. IndexedDB is never a cache name and is never deleted.
export function obsoletePrecacheNames(names: readonly string[], activeName: string, scope: string): string[] {
  return names.filter((name) => name.includes("-precache-") && name.includes(scope) && name !== activeName);
}

export async function deleteObsoleteCaches(
  caches: { keys: () => Promise<string[]>; delete: (name: string) => Promise<boolean> },
  activeName: string,
  scope: string,
): Promise<string[]> {
  const names = obsoletePrecacheNames(await caches.keys(), activeName, scope);
  for (const name of names) await caches.delete(name);
  return names;
}
