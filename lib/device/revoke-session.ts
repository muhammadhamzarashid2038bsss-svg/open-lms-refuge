// The page asks the server to end the sign-in. The cookie stays in the browser's
// own request. This function does not read the cookie, and the service worker
// is not given the session id.

export async function revokeServerSession(): Promise<boolean> {
  try {
    const response = await fetch("/session/revoke", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
