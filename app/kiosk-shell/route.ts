import { kioskShellResponse } from "@/lib/device/kiosk-shell-html";

// A finished HTML document, not a React page. Next.js does not hydrate it,
// so the same document can later be shown at a class address.
export function GET() {
  return kioskShellResponse();
}
