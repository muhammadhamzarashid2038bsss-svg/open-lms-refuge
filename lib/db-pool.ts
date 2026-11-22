// Each Vercel copy of the site is its own process. The PostgreSQL driver
// otherwise opens 10 connections in every copy. A small Neon database can run
// out of connections, and the centre's site stops answering. Production
// therefore uses 1 when DATABASE_POOL_MAX is unset. The hosted app should
// still set DATABASE_POOL_MAX=1 and use Neon's pooled URL. The direct URL is
// only for the manual `npm run db:migrate:deploy` command.
//
// Local `npx prisma dev` still needs DATABASE_POOL_MAX=1 in .env. That proxy
// allows one connection. When the variable is unset outside production, the
// size stays 10, which is the driver default a normal local Postgres already had.

export const PRODUCTION_POOL_MAX = 1;
export const DRIVER_DEFAULT_POOL_MAX = 10;

const POSITIVE_INTEGER = /^[1-9]\d*$/;

export function parseDatabasePoolMax(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return undefined;
  // parseInt("1.5") and parseInt("4abc") would silently keep the leading
  // digits. Only a plain positive whole number is accepted.
  if (!POSITIVE_INTEGER.test(trimmed)) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer when set.");
  }
  const max = Number(trimmed);
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer when set.");
  }
  return max;
}

export function resolveDatabasePoolMax(
  env: { DATABASE_POOL_MAX?: string; NODE_ENV?: string } = process.env,
): number {
  const explicit = parseDatabasePoolMax(env.DATABASE_POOL_MAX);
  if (explicit !== undefined) return explicit;
  return env.NODE_ENV === "production" ? PRODUCTION_POOL_MAX : DRIVER_DEFAULT_POOL_MAX;
}

export function pgPoolConfig(
  url: string,
  env: { DATABASE_POOL_MAX?: string; NODE_ENV?: string } = process.env,
): { connectionString: string; max: number } {
  return { connectionString: url, max: resolveDatabasePoolMax(env) };
}
