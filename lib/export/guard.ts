// The export reads EXPORT_SECRET and uses Node's crypto. A browser page must
// not load it. If the secret reached a phone, anyone with that phone could
// rebuild pseudonyms from guessed learner codes. `server-only` makes a client
// component fail to compile if it imports this folder. The window check is a
// second stop if that package is bypassed.

import "server-only";
import "node:crypto";
import { ExportError } from "./types";

export function assertExportServer(): void {
  if (typeof globalThis.window !== "undefined") {
    throw new ExportError("The grant export runs on the server only.");
  }
}
