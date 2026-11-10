"use server";

import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { createAssignment } from "@/lib/data/assignments";

export type FormState = { error?: string };

export async function createAssignmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await getActor();
  if (!actor) redirect("/");
  if (actor.role !== "TEACHER") redirect(homeForRole(actor.role));
  const sectionId = String(formData.get("sectionId") ?? "");
  const result = await createAssignment(actor, {
    sectionId,
    title: String(formData.get("title") ?? ""),
    kind: String(formData.get("kind") ?? ""),
    maxPoints: String(formData.get("maxPoints") ?? ""),
  });
  if (!result.ok) return { error: result.message };
  redirect(`/teacher/sections/${sectionId}/gradebook`);
}
