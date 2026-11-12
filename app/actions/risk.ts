"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/actor";
import { dismissRiskFlag, markCheckInDone, runCenterRiskScoring, updateRiskThresholds } from "@/lib/data/risk";

export type RiskFormState = {
  error?: string;
  message?: string;
  complete?: boolean;
  stamp?: string;
};

const SIGN_IN = "Sign in again before changing check-in suggestions.";

export async function runRiskAssessmentAction(_prev: RiskFormState, formData: FormData): Promise<RiskFormState> {
  const actor = await getActor();
  if (!actor) return { error: SIGN_IN };
  const result = await runCenterRiskScoring(actor, {
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  });
  revalidatePath("/director/check-ins");
  if (!result.ok) return { error: result.message, complete: false };
  return { message: result.message, complete: result.complete, stamp: crypto.randomUUID() };
}

export async function markCheckInDoneAction(_prev: RiskFormState, formData: FormData): Promise<RiskFormState> {
  const actor = await getActor();
  if (!actor) return { error: SIGN_IN };
  const result = await markCheckInDone(actor, String(formData.get("flagId") ?? ""), String(formData.get("note") ?? ""));
  if (!result.ok) return { error: result.message };
  revalidatePath("/director/check-ins");
  return { message: "Check-in saved." };
}

export async function dismissRiskFlagAction(_prev: RiskFormState, formData: FormData): Promise<RiskFormState> {
  const actor = await getActor();
  if (!actor) return { error: SIGN_IN };
  const result = await dismissRiskFlag(actor, String(formData.get("flagId") ?? ""), String(formData.get("reason") ?? ""));
  if (!result.ok) return { error: result.message };
  revalidatePath("/director/check-ins");
  return { message: "Suggestion dismissed." };
}

export async function updateRiskThresholdsAction(_prev: RiskFormState, formData: FormData): Promise<RiskFormState> {
  const actor = await getActor();
  if (!actor) return { error: SIGN_IN };
  const result = await updateRiskThresholds(
    actor,
    String(formData.get("watch") ?? ""),
    String(formData.get("high") ?? ""),
  );
  if (!result.ok) return { error: result.message };
  revalidatePath("/director/check-ins");
  return { message: `Watch is ${result.watch} and High is ${result.high}. Earlier results are unchanged.` };
}
