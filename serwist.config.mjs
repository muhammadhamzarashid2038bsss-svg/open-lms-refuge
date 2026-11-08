// The service worker is built after `next build`, so this file can see the
// finished static files and then refuse anything outside the allowlist.
// prerendered pages stay out: precachePrerendered is false.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serwist } from "@serwist/next/config";
import { isPrecacheUrlAllowed, PRECACHE_MANIFEST, PRECACHE_OFFLINE, PRECACHE_SHELL } from "./lib/device/precache-allowlist.mjs";

function revisionOf(paths) {
  const hash = createHash("sha256");
  for (const path of paths) hash.update(readFileSync(path));
  return hash.digest("hex").slice(0, 20);
}

const config = await serwist(
  {
    swSrc: "app/sw.ts",
    swDest: "public/sw.js",
    precachePrerendered: false,
    globPatterns: [
      ".next/static/**/*.js",
      ".next/static/**/*.css",
      ".next/static/**/*.woff",
      ".next/static/**/*.woff2",
      "public/kiosk/shell.js",
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
    ],
    globIgnores: ["**/*.map"],
    additionalPrecacheEntries: [
      { url: PRECACHE_SHELL, revision: revisionOf(["public/kiosk/shell.js", "lib/device/kiosk-shell-html.ts"]) },
      { url: PRECACHE_MANIFEST, revision: revisionOf(["app/manifest.ts"]) },
      // An .html file under public/ is rewritten into a route address by the
      // build. Listing the offline page here keeps its real address.
      { url: PRECACHE_OFFLINE, revision: revisionOf(["public/offline.html"]) },
    ],
  },
  undefined,
  { isDev: false },
);

config.manifestTransforms = [
  ...(config.manifestTransforms ?? []),
  (entries) => {
    const manifest = [];
    const warnings = [];
    for (const entry of entries) {
      if (isPrecacheUrlAllowed(entry.url)) manifest.push(entry);
      else warnings.push(`Refused to precache ${entry.url}`);
    }
    return { manifest, warnings };
  },
];

export default config;
