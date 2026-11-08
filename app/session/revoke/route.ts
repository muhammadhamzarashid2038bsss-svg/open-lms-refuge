import { NextResponse } from "next/server";
import { revokeCurrentSession } from "@/lib/auth/session";

// Ends the server sign-in and returns a result the page can show. It does not
// redirect, and it does not delete records stored on the phone. The phone
// calls this only after the local lock has been stored.
export async function POST() {
  try {
    await revokeCurrentSession();
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
