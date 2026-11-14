// Windows-safe launcher. It reads .env.test, checks the test database, then
// starts Prisma or Vitest with that URL already set.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertConnectedTestDatabase } from "../lib/test-db/connect";
import { applyTestDatabaseEnv, loadTestDatabaseEnv } from "../lib/test-db/load";

const root = process.cwd();

function run(scriptPath: string, args: string[], env: NodeJS.ProcessEnv): never {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const loaded = applyTestDatabaseEnv(loadTestDatabaseEnv(root));
  await assertConnectedTestDatabase(loaded.url);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TEST_DATABASE_URL: loaded.url,
    TEST_DATABASE_POOL_MAX: loaded.poolMax,
    DATABASE_URL: loaded.url,
    DATABASE_POOL_MAX: loaded.poolMax,
  };
  delete env.SHADOW_DATABASE_URL;

  if (mode === "verify") {
    process.exit(0);
  }
  if (mode === "migrate") {
    run(resolve(root, "node_modules/prisma/build/index.js"), ["migrate", "deploy", "--config", "prisma7.test.config.ts"], env);
  }
  if (mode === "seed") {
    run(resolve(root, "node_modules/tsx/dist/cli.mjs"), ["prisma/seed.ts"], env);
  }
  if (mode === "vitest") {
    const extra = process.argv.slice(3);
    run(resolve(root, "node_modules/vitest/vitest.mjs"), ["run", ...extra], env);
  }
  throw new Error("Use verify, migrate, seed, or vitest.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "The test database command failed.";
  console.error(message);
  process.exit(1);
});
