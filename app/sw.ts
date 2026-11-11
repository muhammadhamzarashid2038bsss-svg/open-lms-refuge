/// <reference lib="esnext" />
/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import {
  OFFLINE_FALLBACK_URL,
  SHELL_FALLBACK_URL,
  deleteObsoleteCaches,
  isAttendanceDocumentNavigation,
  isUnrelatedDocumentNavigation,
  networkOrFallback,
  offlineTextResponse,
} from "../lib/device/sw-navigation";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// A waiting worker stays waiting while a class is open. It is not told to
// skipWaiting or to claim the open page, so an update cannot reload the sheet
// the teacher is using. The next ordinary load, after that page is closed,
// activates the update. IndexedDB is not part of this update.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: false,
  // The teacher records page is not cached. A reload without a connection
  // cannot show that page or the notes on it.
  runtimeCaching: [],
  disableDevLogs: true,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    cleanURLs: false,
    directoryIndex: null,
    cacheName: "olr-shell-precache",
  },
});

function precached(url: string, message: string): () => Promise<Response> {
  return async () => (await serwist.matchPrecache(url)) ?? offlineTextResponse(message);
}

serwist.registerCapture(
  ({ request, url }) =>
    isAttendanceDocumentNavigation({
      method: request.method,
      mode: request.mode,
      pathname: url.pathname,
      headers: request.headers,
    }),
  ({ request }) =>
    networkOrFallback(request, {
      fetch: (input) => fetch(input),
      fallback: precached(SHELL_FALLBACK_URL, "Open this class once while connected."),
    }),
  "GET",
);

serwist.registerCapture(
  ({ request, url }) =>
    isUnrelatedDocumentNavigation({
      method: request.method,
      mode: request.mode,
      pathname: url.pathname,
      headers: request.headers,
    }),
  ({ request }) =>
    networkOrFallback(request, {
      fetch: (input) => fetch(input),
      fallback: precached(OFFLINE_FALLBACK_URL, "This page is not available offline."),
    }),
  "GET",
);

serwist.addEventListeners();

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteObsoleteCaches(self.caches, serwist.precacheStrategy.cacheName, self.registration.scope));
});
