"use client";

import { useActionState } from "react";
import { signInLearner, type SignInState } from "@/app/actions/auth";
import { buttonClass, inputClass, labelClass } from "./ui";

const initial: SignInState = {};

export function LearnerSignInForm() {
  const [state, action, pending] = useActionState(signInLearner, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        Center code
        <input className={inputClass} name="centerCode" defaultValue="DEMO" autoComplete="off" required />
      </label>
      <label className={labelClass}>
        Learner code
        <input className={inputClass} name="learnerCode" autoComplete="username" placeholder="LNR-0001" required />
      </label>
      <label className={labelClass}>
        PIN
        <input
          className={inputClass}
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          minLength={4}
          maxLength={4}
          pattern="[0-9]{4}"
          required
        />
      </label>
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
