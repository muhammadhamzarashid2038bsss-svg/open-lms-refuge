"use client";

import { useActionState } from "react";
import { signInStaff, type SignInState } from "@/app/actions/auth";
import { Notice } from "./notice";
import { buttonClass, inputClass, labelClass } from "./ui";

const initial: SignInState = {};

export function StaffSignInForm() {
  const [state, action, pending] = useActionState(signInStaff, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        Email
        <input className={inputClass} name="email" type="email" autoComplete="username" required />
      </label>
      <label className={labelClass}>
        Password
        <input className={inputClass} name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
