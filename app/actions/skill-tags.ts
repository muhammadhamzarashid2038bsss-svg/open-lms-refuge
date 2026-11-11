"use server";

import { getActor } from "@/lib/auth/actor";
import { createCenterSkillTag, setCenterSkillTagActive } from "@/lib/data/skill-tags";

export type SkillTagFormState = { error?: string; message?: string };

export async function createSkillTagAction(_prev: SkillTagFormState, formData: FormData): Promise<SkillTagFormState> {
  const actor = await getActor();
  if (!actor) return { error: "Sign in again before changing skill tags." };
  const result = await createCenterSkillTag(actor, String(formData.get("name") ?? ""));
  if (!result.ok) return { error: result.message };
  return { message: "The skill tag is saved." };
}

export async function setSkillTagActiveAction(_prev: SkillTagFormState, formData: FormData): Promise<SkillTagFormState> {
  const actor = await getActor();
  if (!actor) return { error: "Sign in again before changing skill tags." };
  const active = String(formData.get("active") ?? "") === "true";
  const result = await setCenterSkillTagActive(actor, String(formData.get("tagId") ?? ""), active);
  if (!result.ok) return { error: result.message };
  return { message: active ? "The skill tag is available again." : "The skill tag is turned off for new notes." };
}
