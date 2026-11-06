import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/auth/constants";

const PROTECTED = ["/opening", "/student", "/teacher", "/director", "/admin", "/courses", "/sections"];

// The cookie check only sends people to the right screen. It is not the
// permission check. Pages, API routes, and database queries check the session
// again. Proxy runs before the page, including on a shared phone that still
// has an old cookie name sitting in the browser.
export function proxy(request: NextRequest) {
  // A server action posts back to the page, including sign-out. Redirecting
  // that post makes the browser report an unexpected response and can leave
  // the previous account on screen.
  if (request.headers.has("next-action")) {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;
  const signedIn = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isProtected = PROTECTED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const isPublicAuth = path === "/" || path.startsWith("/sign-in") || path === "/device-release";

  if (isProtected && !signedIn) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (isPublicAuth && signedIn && path !== "/device-release") {
    return NextResponse.redirect(new URL("/opening", request.url));
  }

  const response = NextResponse.next();
  if (isProtected) response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
