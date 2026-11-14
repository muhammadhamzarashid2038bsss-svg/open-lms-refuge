// Pure checks for the isolated test database URL. This file never opens a
// connection and never reads .env, so a unit test can reject a development
// URL without touching either database.

const TEST_DATABASE_NAME = "open_lms_refuge_test";
const TEST_ROLE = "open_lms_refuge_test";
const TEST_PORT = "5433";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

const PLACEHOLDER_PASSWORDS = new Set([
  "password",
  "secret",
  "changeme",
  "replace-with",
  "replace-with-a-long-random-secret",
  "<url_encoded_password>",
  "url_encoded_password",
  "your-password",
]);

export function assertTestDatabaseUrl(connectionString: string): void {
  const value = connectionString.trim();
  if (!value) {
    throw new Error("TEST_DATABASE_URL is missing.");
  }
  if (/\s/.test(value)) {
    throw new Error("TEST_DATABASE_URL must not contain spaces.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a PostgreSQL URL.");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("TEST_DATABASE_URL must use the postgresql protocol.");
  }

  const user = parsed.username;
  if (user !== TEST_ROLE) {
    throw new Error("TEST_DATABASE_URL must use the open_lms_refuge_test login role.");
  }

  // The URL class stores < and > as percent-encoding. Decode once so the
  // placeholder in .env.test.example is rejected, while a real password that
  // already contains a percent sign is left unchanged when it is not encoded.
  let password = parsed.password;
  try {
    password = decodeURIComponent(password);
  } catch {
    // Keep the raw password. A literal percent sign is not a placeholder.
  }
  const foldedPassword = password.toLowerCase();
  if (
    !password ||
    PLACEHOLDER_PASSWORDS.has(foldedPassword) ||
    foldedPassword.includes("url_encoded_password") ||
    /[<>]/.test(password)
  ) {
    throw new Error("TEST_DATABASE_URL is missing a real password.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("TEST_DATABASE_URL must use the local test database host.");
  }
  if (parsed.port !== TEST_PORT) {
    throw new Error("TEST_DATABASE_URL must use port 5433.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error("TEST_DATABASE_URL must use the open_lms_refuge_test database.");
  }

  const schema = parsed.searchParams.get("schema");
  if (schema !== null && schema !== "public") {
    throw new Error("TEST_DATABASE_URL must use the public schema.");
  }
  const allowedKeys = new Set(["schema"]);
  for (const key of parsed.searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new Error("TEST_DATABASE_URL has an unexpected parameter.");
    }
  }
}
