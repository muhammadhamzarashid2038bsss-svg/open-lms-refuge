"use server";

import { redirect } from "next/navigation";
import { clientIp } from "@/lib/auth/actor";
import { LOGIN_MESSAGES } from "@/lib/auth/constants";
import { authenticateLearner, authenticateStaff } from "@/lib/auth/login";
import { isFourDigitPin } from "@/lib/auth/password";
import { findLearnerByCode, findStaffByEmail } from "@/lib/auth/lookup";
import { prismaThrottleStore } from "@/lib/auth/prisma-store";
import { sessionConfigurationMessage } from "@/lib/auth/session-secret";
import { openSession, revokeCurrentSession } from "@/lib/auth/session";
import { releaseSharedDevice } from "@/lib/auth/handover";

export type SignInState = { error?: string };

export async function signInStaff(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const result = await authenticateStaff({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    now: new Date(),
    ip: await clientIp(),
    store: prismaThrottleStore(),
    findStaff: findStaffByEmail,
  });
  if (!result.ok) return { error: LOGIN_MESSAGES[result.error] };
  try {
    await openSession(result.userId);
  } catch (error) {
    return {
      error: sessionConfigurationMessage(error) ?? "Sign-in is not available right now. Try again.",
    };
  }
  redirect("/opening");
}

export async function signInLearner(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const pin = String(formData.get("pin") ?? "");
  const result = await authenticateLearner({
    centerCode: String(formData.get("centerCode") ?? ""),
    learnerCode: String(formData.get("learnerCode") ?? ""),
    pin,
    now: new Date(),
    ip: await clientIp(),
    store: prismaThrottleStore(),
    findLearner: findLearnerByCode,
  });
  // The HTML form is not the check. A PIN that is not four digits never opens
  // a session. The reply stays the same generic message unless the lock has
  // already been reached, so the form cannot be used to discover a learner code.
  if (!isFourDigitPin(pin)) {
    return { error: !result.ok && result.error === "locked" ? LOGIN_MESSAGES.locked : LOGIN_MESSAGES.mismatch };
  }
  if (!result.ok) return { error: LOGIN_MESSAGES[result.error] };
  try {
    await openSession(result.userId);
  } catch (error) {
    return {
      error: sessionConfigurationMessage(error) ?? "Sign-in is not available right now. Try again.",
    };
  }
  redirect("/opening");
}

export async function logout(): Promise<void> {
  await revokeCurrentSession();
  redirect("/");
}

export async function endSession(): Promise<void> {
  await revokeCurrentSession();
}

export type ReleaseState = { ok?: boolean; error?: string; at?: string };

export async function releaseDevice(_prev: ReleaseState, formData: FormData): Promise<ReleaseState> {
  const itemCount = Number(formData.get("itemCount"));
  return releaseSharedDevice({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    fromUserId: String(formData.get("fromUserId") ?? ""),
    centerId: String(formData.get("centerId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    deviceLabel: String(formData.get("deviceLabel") ?? ""),
    itemCount: Number.isFinite(itemCount) ? itemCount : -1,
    ip: await clientIp(),
  });
}
