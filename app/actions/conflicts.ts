"use server";

import { getActor } from "@/lib/auth/actor";
import { resolveConflict, type ResolveInput } from "@/lib/data/conflicts";

export type ConflictFormState = { error?: string; message?: string };

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

export async function resolveConflictAction(_prev: ConflictFormState, formData: FormData): Promise<ConflictFormState> {
  const actor = await getActor();
  if (!actor) return { error: "Sign in again before resolving this conflict." };
  const choice = text(formData, "choice");
  if (choice !== "shown" && choice !== "other" && choice !== "merge") {
    return { error: "Choose which copy to keep." };
  }
  const gaps = formData.getAll("skillGaps").filter((value): value is string => typeof value === "string");
  const device = text(formData, "localDeviceId").trim();
  const input: ResolveInput = {
    conflictId: text(formData, "conflictId"),
    localDeviceId: device.length > 0 ? device : null,
    choice,
    points: text(formData, "points"),
    academicNote: text(formData, "academicNote"),
    body: text(formData, "body"),
    skillGaps: gaps,
    customSkillTagId: text(formData, "customSkillTagId"),
  };
  const result = await resolveConflict(actor, input);
  if (!result.ok) return { error: result.message };
  return { message: result.message };
}
