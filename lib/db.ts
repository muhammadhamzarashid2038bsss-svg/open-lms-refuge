// One shared Prisma client. Next.js reloads code often in development, so the
// client is kept on globalThis. Otherwise a laptop would open a new database
// connection on every reload.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { pgPoolConfig } from "./db-pool";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.example to .env and set your PostgreSQL URL.",
  );
}

// Always an object with max, so the driver cannot fall back to 10 on its own.
// PrismaPg stores this object and passes it to pg.Pool when a query connects.
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
