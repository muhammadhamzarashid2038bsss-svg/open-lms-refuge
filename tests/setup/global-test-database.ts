// Runs once, before Vitest starts a worker. A wrong URL stops the suite
// before any test file can open the development database.
export async function setup(): Promise<void> {
  const { applyTestDatabaseEnv, loadTestDatabaseEnv } = await import("../../lib/test-db/load");
  const { assertConnectedTestDatabase } = await import("../../lib/test-db/connect");
  const env = applyTestDatabaseEnv(loadTestDatabaseEnv());
  await assertConnectedTestDatabase(env.url);
}
