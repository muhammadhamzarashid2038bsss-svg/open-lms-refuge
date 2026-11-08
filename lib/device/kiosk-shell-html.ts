// The shell document is the same at every address. Learner names are not written
// here. They are read from the phone after the snapshot and lock checks.
// A Next.js page is not used: that page expects to wake up at its own address,
// and this document has to keep working at a class address.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function kioskShellHtml(script: string): string {
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Attendance</title>
<style>
  body { margin: 0; padding: 16px; font-family: sans-serif; color: #09090b; background: #fff; }
  h1, h2 { line-height: 1.2; }
  p, a, button { font-size: 1.125rem; line-height: 1.4; }
  a { color: #09090b; }
  button { min-height: 4rem; margin: 0.25rem 0.25rem 0 0; padding: 0.5rem 0.75rem; border: 2px solid #09090b; background: #fff; color: #09090b; font-weight: 600; }
  article { margin: 1rem 0; padding: 0.75rem; border: 2px solid #09090b; }
  .count, .message { font-weight: 700; }
</style>
</head>
<body>
<p id="kiosk-lock">A locked phone hides saved classes. That lock is not encryption. Anyone who can open this browser's storage can still read the saved data.</p>
<p id="kiosk-status">Checking this phone…</p>
<div id="kiosk-root"></div>
<script>${safeScript}</script>
</body>
</html>
`;
}

export function kioskShellResponse(): Response {
  const script = readFileSync(join(process.cwd(), "public", "kiosk", "shell.js"), "utf8");
  return new Response(kioskShellHtml(script), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
