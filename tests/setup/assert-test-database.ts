// Each test file is its own process. Check the live server before that file
// imports the Prisma client and before any cleanup runs.
import { assertConnectedTestDatabase } from "../../lib/test-db/connect";

await assertConnectedTestDatabase();
