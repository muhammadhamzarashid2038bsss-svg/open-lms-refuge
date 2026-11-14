// Runs before the shared Prisma client is imported. That client loads .env,
// but it will not replace DATABASE_URL once this file has set the test URL.
import { applyTestDatabaseEnv } from "../../lib/test-db/load";

applyTestDatabaseEnv();
