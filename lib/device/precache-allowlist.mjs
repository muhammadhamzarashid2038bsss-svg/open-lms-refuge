// Cache Storage can be opened by anyone with this browser. Only the empty
// class shell, its script, the install icons, and hashed static files qualify.
// Learner names, attendance, cookies, and signed-in pages never qualify.

export const PRECACHE_SHELL = "/kiosk-shell";
export const PRECACHE_SHELL_SCRIPT = "/kiosk/shell.js";
export const PRECACHE_MANIFEST = "/manifest.webmanifest";
export const PRECACHE_OFFLINE = "/offline.html";
export const PRECACHE_ICON_192 = "/icons/icon-192.png";
export const PRECACHE_ICON_512 = "/icons/icon-512.png";

const EXACT_PRECACHE_URLS = new Set([
  PRECACHE_SHELL,
  PRECACHE_SHELL_SCRIPT,
  PRECACHE_MANIFEST,
  PRECACHE_OFFLINE,
  PRECACHE_ICON_192,
  PRECACHE_ICON_512,
]);

const STATIC_EXTENSIONS = [".js", ".css", ".woff", ".woff2"];

export function isPrecacheUrlAllowed(url) {
  const path = url.split("?")[0] ?? url;
  if (EXACT_PRECACHE_URLS.has(path)) return true;
  if (!path.startsWith("/_next/static/")) return false;
  return STATIC_EXTENSIONS.some((extension) => path.endsWith(extension));
}
