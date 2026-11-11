"use client";

import { useActionState } from "react";
import { createSkillTagAction, setSkillTagActiveAction, type SkillTagFormState } from "@/app/actions/skill-tags";
import { SKILL_TAG_GUIDANCE } from "@/lib/lms/skill-tags";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

const initial: SkillTagFormState = {};

function TagSwitch({ tagId, active }: { tagId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setSkillTagActiveAction, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="tagId" value={tagId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <button className={secondaryButtonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : active ? "Turn off for new notes" : "Turn on for new notes"}
      </button>
      {state.error ? <p role="alert" className="text-lg font-medium">{state.error}</p> : null}
      {state.message ? <p className="text-lg font-medium">{state.message}</p> : null}
    </form>
  );
}

export function SkillTagManager({ tags }: { tags: { id: string; name: string; active: boolean }[] }) {
  const [state, action, pending] = useActionState(createSkillTagAction, initial);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg">{SKILL_TAG_GUIDANCE}</p>
      <form action={action} className="flex flex-col gap-3">
        <label className={labelClass}>
          New skill tag
          <input className={inputClass} name="name" maxLength={40} required />
        </label>
        <button className={buttonClass} type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add skill tag"}
        </button>
        {state.error ? <p role="alert" className="text-lg font-medium">{state.error}</p> : null}
        {state.message ? <p className="text-lg font-medium">{state.message}</p> : null}
      </form>
      <ul className="flex flex-col gap-4">
        {tags.map((tag) => (
          <li key={tag.id} className="flex flex-col gap-2 rounded-lg border-2 border-zinc-950 p-4">
            <p className="text-lg font-medium">
              {tag.name}
              {tag.active ? "" : " · off for new notes"}
            </p>
            <TagSwitch tagId={tag.id} active={tag.active} />
          </li>
        ))}
        {tags.length === 0 ? <li className="text-lg">No custom skill tags yet.</li> : null}
      </ul>
    </div>
  );
}
