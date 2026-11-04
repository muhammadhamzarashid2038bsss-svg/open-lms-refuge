"use client";

import { useActionState } from "react";
import { resetPasswordAction, type FormState } from "@/app/actions/accounts";
import { buttonClass, inputClass, labelClass } from "./ui";

const initial: FormState = {};

export function PasswordResetForm() {
  const [state, action, pending] = useActionState(resetPasswordAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Set a new staff password</h2>
      <p className="text-lg leading-7">
        Directors can set a password for staff at their center. Admins can set one for any staff account. The person is
        signed out everywhere. Tell them the new password in person.
      </p>
      <label className={labelClass}>
        Email
        <input className={inputClass} name="email" type="email" required />
      </label>
      <label className={labelClass}>
        New password
        <input className={inputClass} name="password" type="password" minLength={8} required />
      </label>
      <label className={labelClass}>
        New password again
        <input className={inputClass} name="confirm" type="password" minLength={8} required />
      </label>
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="text-lg font-medium">{state.message}</p> : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save the new password"}
      </button>
    </form>
  );
}
