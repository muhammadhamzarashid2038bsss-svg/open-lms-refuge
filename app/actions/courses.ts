"use server";

import { redirect } from "next/navigation";
import type { Semester } from "@/generated/prisma/client";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { createCourse, createResource, createSection, deleteResource } from "@/lib/data/courses";
import type { ResourceTypeName } from "@/lib/lms/resources";

export type FormState = { error?: string; message?: string };

function staffOrRedirect() {
  return getActor().then((actor) => {
    if (!actor) redirect("/");
    if (actor.role !== "TEACHER" && actor.role !== "CENTER_DIRECTOR") {
      redirect(homeForRole(actor.role));
    }
    return actor;
  });
}

export async function createCourseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await staffOrRedirect();
  const result = await createCourse(actor, {
    title: String(formData.get("title") ?? ""),
    code: String(formData.get("code") ?? ""),
    academicYear: Number(formData.get("academicYear") ?? new Date().getFullYear()),
    semester: String(formData.get("semester") ?? "SEMESTER_1") as Semester,
    summary: String(formData.get("summary") ?? "") || null,
    firstSectionName: String(formData.get("firstSectionName") ?? "") || null,
  });
  if (!result.ok) return { error: result.message };
  redirect(`/courses/${result.courseId}`);
}

export async function createSectionAction(formData: FormData): Promise<void> {
  const actor = await staffOrRedirect();
  const courseId = String(formData.get("courseId") ?? "");
  const result = await createSection(actor, courseId, String(formData.get("name") ?? ""));
  if (!result.ok) redirect(`/courses/${courseId}?error=${encodeURIComponent(result.message)}`);
  redirect(`/courses/${courseId}`);
}

export async function createResourceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await staffOrRedirect();
  const courseId = String(formData.get("courseId") ?? "");
  const sectionRaw = String(formData.get("sectionId") ?? "").trim();
  const resourceType = String(formData.get("resourceType") ?? "") as ResourceTypeName;
  const result = await createResource(actor, {
    courseId,
    sectionId: sectionRaw || null,
    title: String(formData.get("title") ?? ""),
    resourceType,
    externalUrl: String(formData.get("externalUrl") ?? "") || null,
    bodyText: String(formData.get("bodyText") ?? "") || null,
    storageKey: String(formData.get("storageKey") ?? "") || null,
    mimeType: String(formData.get("mimeType") ?? "") || null,
    byteSize: formData.get("byteSize") ? Number(formData.get("byteSize")) : null,
    checksumSha256: String(formData.get("checksumSha256") ?? "") || null,
  });
  if (!result.ok) return { error: result.message };
  redirect(`/courses/${courseId}`);
}

export async function deleteResourceAction(formData: FormData): Promise<void> {
  const actor = await staffOrRedirect();
  const courseId = String(formData.get("courseId") ?? "");
  const resourceId = String(formData.get("resourceId") ?? "");
  await deleteResource(actor, resourceId);
  redirect(`/courses/${courseId}`);
}
