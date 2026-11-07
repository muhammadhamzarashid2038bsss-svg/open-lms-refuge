"use server";

import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { recordAttendance } from "@/lib/data/attendance";
import type { MarkDraftInput } from "@/lib/lms/attendance";

export type SaveAttendanceState =
  | { ok: true; created: number; alreadyStored: number }
  | { ok: false; message: string };

export async function saveAttendanceAction(
  sectionId: string,
  sessionId: string,
  marks: MarkDraftInput[],
): Promise<SaveAttendanceState> {
  const actor = await getActor();
  if (!actor) redirect("/");
  const result = await recordAttendance(actor, sectionId, sessionId, marks);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, created: result.created, alreadyStored: result.alreadyStored };
}
