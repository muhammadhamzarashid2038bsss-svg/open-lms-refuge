// One shared Prisma client. Next.js reloads code often in development, so the
// client is kept on globalThis. Otherwise a laptop would open a new database
// connection on every reload.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.example to .env and set your PostgreSQL URL.",
  );
}

function pgPoolConfig(url: string): string | { connectionString: string; max: number } {
  const raw = process.env.DATABASE_POOL_MAX?.trim();
  if (!raw) return url;
  const max = Number.parseInt(raw, 10);
  if (!Number.isFinite(max) || max < 1) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer when set.");
  }
  return { connectionString: url, max };
}

const adapter = new PrismaPg(pgPoolConfig(connectionString));

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
