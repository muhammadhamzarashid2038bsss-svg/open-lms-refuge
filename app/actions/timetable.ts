"use server";

import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { createTimetableSession, deleteTimetableSession, updateTimetableSession } from "@/lib/data/timetable";
import type { FormState } from "./courses";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function weekPath(sectionId: string, weekOf: string): string {
  return `/sections/${sectionId}/timetable?week=${encodeURIComponent(weekOf)}`;
}

async function actorOrRedirect() {
  const actor = await getActor();
  if (!actor) redirect("/");
  if (actor.role !== "TEACHER" && actor.role !== "CENTER_DIRECTOR") {
    redirect(homeForRole(actor.role));
  }
  return actor;
}

function inputFromForm(formData: FormData) {
  return {
    title: text(formData, "title"),
    weekday: text(formData, "weekday"),
    startTime: text(formData, "startTime"),
    endTime: text(formData, "endTime"),
    weekOf: text(formData, "weekOf"),
    deliveryMode: text(formData, "deliveryMode"),
    meetingUrl: text(formData, "meetingUrl") || null,
    linkedResourceId: text(formData, "linkedResourceId") || null,
  };
}

export async function createTimetableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await actorOrRedirect();
  const input = inputFromForm(formData);
  const sectionId = text(formData, "sectionId");
  const result = await createTimetableSession(actor, sectionId, input);
  if (!result.ok) return { error: result.message };
  redirect(weekPath(sectionId, input.weekOf));
}

export async function updateTimetableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await actorOrRedirect();
  const input = inputFromForm(formData);
  const sectionId = text(formData, "sectionId");
  const sessionId = text(formData, "sessionId");
  const intent = text(formData, "intent");
  if (intent === "delete") {
    const removed = await deleteTimetableSession(actor, sectionId, sessionId);
    if (!removed.ok) return { error: removed.message };
    redirect(weekPath(sectionId, input.weekOf));
  }
  const status = intent === "cancel" ? "CANCELLED" : intent === "restore" ? "SCHEDULED" : null;
  const result = await updateTimetableSession(actor, sectionId, sessionId, { ...input, status });
  if (!result.ok) return { error: result.message };
  redirect(weekPath(sectionId, input.weekOf));
}
