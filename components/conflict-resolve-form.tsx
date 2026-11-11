"use client";

import { useActionState, useEffect, useState } from "react";
import { resolveConflictAction, type ConflictFormState } from "@/app/actions/conflicts";
import { readOrCreateLocalDeviceId } from "@/lib/device/local-records";
import { SKILL_TAG_GUIDANCE } from "@/lib/lms/skill-tags";
import { SKILL_GAPS } from "@/lib/sync/record-batch";
import { buttonClass, inputClass, labelClass } from "./ui";

const initial: ConflictFormState = {};

const skillLabel: Record<(typeof SKILL_GAPS)[number], string> = {
  READING: "Reading",
  WRITING: "Writing",
  SPEAKING: "Speaking",
  NUMBER_SENSE: "Number sense",
  CUSTOM: "A center skill tag",
};

export function ConflictResolveForm({
  conflictId,
  kind,
  shownPoints,
  shownNote,
  shownBody,
  shownGaps,
  shownTagId,
  skillTags,
  maxPoints,
}: {
  conflictId: string;
  kind: "Grade" | "Progress note";
  shownPoints: string;
  shownNote: string;
  shownBody: string;
  shownGaps: string[];
  shownTagId: string;
  skillTags: { id: string; name: string }[];
  maxPoints: string | null;
}) {
  const [state, action, pending] = useActionState(resolveConflictAction, initial);
  const [choice, setChoice] = useState<"shown" | "other" | "merge">("shown");
  const [deviceId, setDeviceId] = useState("");
  const [deviceNote, setDeviceNote] = useState("");

  useEffect(() => {
    const factory = globalThis.indexedDB;
    if (!factory) {
      // The missing store is known only in the browser. Defer the message so
      // the first render can match the server HTML.
      queueMicrotask(() => {
        setDeviceNote("This browser has no local store. The resolution will use the server's edit count.");
      });
      return;
    }
    void readOrCreateLocalDeviceId(factory).then((result) => {
      if (result.ok) {
        setDeviceId(result.deviceId);
        return;
      }
      setDeviceNote("This phone could not store its own name. The resolution will use the server's edit count.");
    });
  }, []);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="conflictId" value={conflictId} />
      <input type="hidden" name="localDeviceId" value={deviceId} />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-medium">What should be kept?</legend>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="radio" name="choice" value="shown" checked={choice === "shown"} onChange={() => setChoice("shown")} />
          Keep the copy shown for now
        </label>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="radio" name="choice" value="other" checked={choice === "other"} onChange={() => setChoice("other")} />
          Keep the other copy
        </label>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input type="radio" name="choice" value="merge" checked={choice === "merge"} onChange={() => setChoice("merge")} />
          Write a merged result
        </label>
      </fieldset>
      {choice === "merge" && kind === "Grade" ? (
        <>
          <label className={labelClass}>
            Points{maxPoints ? ` (maximum ${maxPoints})` : ""}
            <input className={inputClass} name="points" defaultValue={shownPoints} inputMode="decimal" required />
          </label>
          <label className={labelClass}>
            Academic note
            <input className={inputClass} name="academicNote" defaultValue={shownNote} maxLength={500} />
          </label>
        </>
      ) : null}
      {choice === "merge" && kind === "Progress note" ? (
        <>
          <label className={labelClass}>
            Note
            <textarea className={inputClass} name="body" defaultValue={shownBody} maxLength={2000} required rows={4} />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-base font-medium">Skill gaps</legend>
            {SKILL_GAPS.map((gap) => (
              <label key={gap} className="flex min-h-12 items-center gap-3 text-lg">
                <input type="checkbox" name="skillGaps" value={gap} defaultChecked={shownGaps.includes(gap)} />
                {skillLabel[gap]}
              </label>
            ))}
          </fieldset>
          <label className={labelClass}>
            Center skill tag
            <select className={inputClass} name="customSkillTagId" defaultValue={shownTagId}>
              <option value="">No custom tag</option>
              {skillTags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-base">{SKILL_TAG_GUIDANCE}</p>
        </>
      ) : null}
      {deviceNote ? <p className="text-lg">{deviceNote}</p> : null}
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="text-lg font-medium">{state.message}</p> : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Confirm resolution"}
      </button>
    </form>
  );
}
