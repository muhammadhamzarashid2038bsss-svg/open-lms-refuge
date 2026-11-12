"use server";

import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { resetPasswordByEmail, resetPinByCode, setAccountActive } from "@/lib/auth/accounts";

export type FormState = { error?: string; message?: string };

async function actorOrRedirect() {
  const actor = await getActor();
  if (!actor) redirect("/");
  return actor;
}

export async function resetPinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await actorOrRedirect();
  const pin = String(formData.get("pin") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (pin !== confirm) return { error: "The two PINs do not match." };
  const result = await resetPinByCode(
    actor,
    String(formData.get("centerCode") ?? "DEMO"),
    String(formData.get("learnerCode") ?? ""),
    pin,
  );
  if (result.status === "hidden") {
    return { error: "That learner code is not one you can change." };
  }
  if (result.status === "invalid") return { error: result.message };
  return {
    message: "The new PIN is saved. Tell the learner in person. Leave this page when you have done that.",
  };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await actorOrRedirect();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) return { error: "The two passwords do not match." };
  const result = await resetPasswordByEmail(actor, String(formData.get("email") ?? ""), password);
  if (result.status === "hidden") return { error: "That email is not one you can change." };
  if (result.status === "invalid") return { error: result.message };
  return { message: "The new password is saved. Their other phones are signed out." };
}

export async function setActiveAction(formData: FormData): Promise<void> {
  const actor = await actorOrRedirect();
  const home = actor.role === "ADMIN" ? "/admin" : "/director";
  const active = String(formData.get("active") ?? "") === "true";
  const result = await setAccountActive(actor, String(formData.get("userId") ?? ""), active);
  if (result.status === "invalid") redirect(`${home}?notice=${encodeURIComponent(result.message)}`);
  if (result.status === "saved" && !active) {
    redirect(`${home}?notice=${encodeURIComponent("The account is switched off. A teacher handoff is prepared once for each section they still taught.")}`);
  }
  redirect(home);
}
