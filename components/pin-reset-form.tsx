"use client";

import { useActionState } from "react";
import { resetPinAction, type FormState } from "@/app/actions/accounts";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

const initial: FormState = {};

export function PinResetForm({ showCenterCode }: { showCenterCode: boolean }) {
  const [state, action, pending] = useActionState(resetPinAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Set a new learner PIN</h2>
      <p className="text-lg leading-7">
        A teacher can do this for a learner in their section. A director can do it for their center. An admin can do it
        for any center. Tell the learner the new PIN in person. It is not sent in a message, and it is not saved in a
        readable form.
      </p>
      {showCenterCode ? (
        <label className={labelClass}>
          Center code
          <input className={inputClass} name="centerCode" defaultValue="DEMO" required />
        </label>
      ) : (
        <input type="hidden" name="centerCode" value="DEMO" />
      )}
      <label className={labelClass}>
        Learner code
        <input className={inputClass} name="learnerCode" required />
      </label>
      <label className={labelClass}>
        New PIN
        <input className={inputClass} name="pin" inputMode="numeric" minLength={4} maxLength={4} required />
      </label>
      <label className={labelClass}>
        New PIN again
        <input className={inputClass} name="confirm" inputMode="numeric" minLength={4} maxLength={4} required />
      </label>
      <button
        className={secondaryButtonClass}
        type="button"
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (!form) return;
          const pin = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 10000).padStart(4, "0");
          const first = form.elements.namedItem("pin");
          const second = form.elements.namedItem("confirm");
          if (first instanceof HTMLInputElement) first.value = pin;
          if (second instanceof HTMLInputElement) second.value = pin;
        }}
      >
        Fill in a random PIN
      </button>
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="text-lg font-medium">{state.message}</p> : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save the new PIN"}
      </button>
    </form>
  );
}
