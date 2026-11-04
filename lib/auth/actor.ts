import { cache } from "react";
import { headers } from "next/headers";
import { loadActor } from "./load-actor";
import type { Actor } from "./permissions";
import { readSessionUserId } from "./session";

export const getActor = cache(async (): Promise<Actor | null> => {
  const userId = await readSessionUserId();
  if (!userId) return null;
  return loadActor(userId);
});

export async function clientIp(): Promise<string> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headerStore.get("x-real-ip") ?? "local";
}
