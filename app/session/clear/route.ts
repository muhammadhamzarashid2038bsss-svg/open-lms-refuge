import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { revokeCurrentSession } from "@/lib/auth/session";

// A dead sign-in cookie cannot be deleted from a page. Next.js only allows
// cookie changes in a route handler or a server action. This route drops the
// cookie and sends the phone to the sign-in doors. It does not touch records
// saved on the phone.
export async function GET(request: Request) {
  try {
    await revokeCurrentSession();
  } catch {
    // The cookie could not be opened. The response below still expires it.
  }
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}
