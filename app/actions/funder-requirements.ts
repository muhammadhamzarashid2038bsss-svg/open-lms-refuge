"use server";

import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { resolveExportCenter } from "@/lib/export/center";
import { deactivateFunderRequirement, recordLearnerLevelRequirement } from "@/lib/export/requirements";

function exportPath(role: "ADMIN" | "CENTER_DIRECTOR", centerId: string, notice: string): string {
  const query = new URLSearchParams();
  if (role === "ADMIN") query.set("center", centerId);
  query.set("notice", notice);
  return `/export?${query.toString()}`;
}

function posted(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export async function recordFunderRequirementAction(formData: FormData): Promise<void> {
  const actor = await getActor();
  if (!actor) redirect("/");
  const decision = await resolveExportCenter({
    userId: actor.id,
    postedCenterId: posted(formData.get("centerId")),
  });
  if (!decision.ok) redirect(homeForRole(actor.role));
  const result = await recordLearnerLevelRequirement({
    actor,
    centerId: decision.centerId,
    learnerLevelReason: posted(formData.get("learnerLevelReason")),
    requirementReference: posted(formData.get("requirementReference")),
    crossReportLinkage: formData.get("crossReportLinkage") === "yes",
  });
  const notice = result.ok
    ? "The learner-level requirement is recorded. Aggregate reports remain the usual download."
    : result.message;
  redirect(exportPath(decision.role, decision.centerId, notice));
}

export async function deactivateFunderRequirementAction(formData: FormData): Promise<void> {
  const actor = await getActor();
  if (!actor) redirect("/");
  const decision = await resolveExportCenter({
    userId: actor.id,
    postedCenterId: posted(formData.get("centerId")),
  });
  if (!decision.ok) redirect(homeForRole(actor.role));
  const result = await deactivateFunderRequirement({
    actor,
    centerId: decision.centerId,
    requirementId: posted(formData.get("requirementId")),
  });
  const notice = result.ok
    ? "That requirement is turned off. New learner-level downloads are blocked."
    : result.message;
  redirect(exportPath(decision.role, decision.centerId, notice));
}
