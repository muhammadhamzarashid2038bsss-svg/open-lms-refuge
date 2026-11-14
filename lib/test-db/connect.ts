// Confirms the server we reached is the isolated test database. Error text
// from the driver can include the URL, so those messages are not rethrown.
import { Client } from "pg";
import { assertTestDatabaseUrl } from "./url";

const TEST_DATABASE_NAME = "open_lms_refuge_test";
const TEST_ROLE = "open_lms_refuge_test";
const TEST_MARKER = "yes";

let verifiedUrl: string | null = null;

function safeErrorName(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)) return error.name;
  return "Error";
}

export async function assertConnectedTestDatabase(connectionString?: string): Promise<void> {
  const url = (connectionString ?? process.env.DATABASE_URL ?? "").trim();
  assertTestDatabaseUrl(url);
  if (verifiedUrl === url) return;

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const result = await client.query<{
      database_name: string;
      login_role: string;
      marker: string | null;
    }>(
      "SELECT current_database() AS database_name, current_user AS login_role, current_setting('app.is_test_database', true) AS marker",
    );
    const row = result.rows[0];
    if (
      !row ||
      row.database_name !== TEST_DATABASE_NAME ||
      row.login_role !== TEST_ROLE ||
      row.marker !== TEST_MARKER
    ) {
      throw new Error("Refusing to continue: the connected server is not the isolated test database.");
    }
    verifiedUrl = url;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing to continue:")) throw error;
    throw new Error(`The test database connection was refused (${safeErrorName(error)}).`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
