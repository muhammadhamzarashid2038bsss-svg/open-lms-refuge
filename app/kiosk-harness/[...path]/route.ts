import { kioskShellResponse } from "@/lib/device/kiosk-shell-html";

// The same shell document, served under an attendance-shaped address.
// This proves the document does not need the signed-in page or its server payload.
// It is not a service worker and it does not replace the real class page.
export function GET() {
  return kioskShellResponse();
}
