// The example in .env.example is public, and it is already longer than 32
// characters. iron-session would seal cookies with that password, so anyone
// who read the repository could forge a sign-in cookie.
//
// This check runs when a request opens a session. Importing this file does
// not read the environment, so a production build can still prerender pages
// that never touch the cookie.

const PUBLISHED_SESSION_SECRET = "replace-with-a-long-random-secret";

export function assertSessionSecret(password: string | undefined): string {
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters. Set it in .env.");
  }
  if (password === PUBLISHED_SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET is still the published example. Generate a new value and set it in .env.",
    );
  }
  return password;
}

/// Sign-in hides unexpected failures. A configuration error names the variable
/// and does not include the secret, so the person setting up the centre can
/// see what to replace.
export function sessionConfigurationMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.startsWith("SESSION_SECRET ")) {
    return error.message;
  }
  return null;
}
