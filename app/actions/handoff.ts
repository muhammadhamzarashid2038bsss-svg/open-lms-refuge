"use server";

import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { reassignSectionTeacher } from "@/lib/data/handoff";

export async function reassignSectionAction(formData: FormData): Promise<void> {
  const actor = await getActor();
  if (!actor) redirect("/");
  const home = actor.role === "ADMIN" ? "/admin" : "/director";
  const raw = String(formData.get("assignment") ?? "");
  const [sectionId, outgoingTeacherId] = raw.split("|");
  const incomingRaw = String(formData.get("incomingTeacherId") ?? "").trim();
  const result = await reassignSectionTeacher(actor, {
    sectionId: sectionId ?? "",
    outgoingTeacherId: outgoingTeacherId ?? "",
    incomingTeacherId: incomingRaw.length > 0 ? incomingRaw : null,
  });
  if (result.status === "saved") {
    const notice = result.sameDayAccess
      ? "The handoff report is ready. This assignment started today, so the outgoing teacher still has the section through the end of this UTC day."
      : "The handoff report is ready for the recipient.";
    redirect(`${home}?notice=${encodeURIComponent(notice)}`);
  }
  if (result.status === "unchanged") {
    redirect(`${home}?notice=${encodeURIComponent("No handoff was created because that assignment did not change.")}`);
  }
  if (result.status === "invalid") redirect(`${home}?notice=${encodeURIComponent(result.message)}`);
  redirect(home);
}
