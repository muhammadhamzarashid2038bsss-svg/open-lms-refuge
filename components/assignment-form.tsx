"use client";

import { useActionState } from "react";
import { createAssignmentAction, type FormState } from "@/app/actions/assignments";
import { CREATABLE_ASSIGNMENT_KINDS, assignmentKindLabel, assignmentKindNote } from "@/lib/lms/gradebook";
import { buttonClass, inputClass, labelClass } from "./ui";

const initial: FormState = {};

export function CreateAssignmentForm({ sectionId }: { sectionId: string }) {
  const [state, action, pending] = useActionState(createAssignmentAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">New assignment</h2>
      <input type="hidden" name="sectionId" value={sectionId} />
      <label className={labelClass}>
        Name
        <input className={inputClass} name="title" required minLength={2} maxLength={80} />
      </label>
      <label className={labelClass}>
        Kind
        <select className={inputClass} name="kind" defaultValue="PAPER" required>
          {CREATABLE_ASSIGNMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {assignmentKindLabel(kind)}
            </option>
          ))}
        </select>
      </label>
      <ul className="flex flex-col gap-1 text-base leading-6 text-zinc-700">
        {CREATABLE_ASSIGNMENT_KINDS.map((kind) => (
          <li key={kind}>
            <span className="font-medium text-zinc-950">{assignmentKindLabel(kind)}. </span>
            {assignmentKindNote(kind)}
          </li>
        ))}
      </ul>
      <label className={labelClass}>
        Maximum mark
        <input className={inputClass} name="maxPoints" inputMode="decimal" required placeholder="20" />
      </label>
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add assignment"}
      </button>
    </form>
  );
}
