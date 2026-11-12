"use client";

import { useActionState, useState } from "react";
import {
  dismissRiskFlagAction,
  markCheckInDoneAction,
  runRiskAssessmentAction,
  updateRiskThresholdsAction,
  type RiskFormState,
} from "@/app/actions/risk";
import type { SuggestionCard } from "@/lib/data/risk";
import { DISMISS_REASONS, DISMISS_WARNING, NOTE_WARNING } from "@/lib/risk/rules";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

const initial: RiskFormState = {};

export function RiskCheckIns({
  watch,
  high,
  belowWatch,
  suggestions,
  earlier,
}: {
  watch: number;
  high: number;
  belowWatch: number;
  suggestions: SuggestionCard[];
  earlier: SuggestionCard[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <RiskRunForm />
      <ThresholdForm watch={watch} high={high} />
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Suggestions</h2>
        <p className="text-lg">
          This is an early-support tool. It uses attendance, assignment, and grade records to suggest when a person
          may want to check in. It does not predict that a learner will leave, and it is not a diagnosis. A person
          decides what to do. Nothing happens automatically.
        </p>
        {belowWatch > 0 ? (
          <p className="text-lg">
            {belowWatch} {belowWatch === 1 ? "learner was" : "learners were"} scored below Watch.{" "}
            {belowWatch === 1 ? "That learner is" : "Those learners are"} not listed as a Watch or High suggestion.
          </p>
        ) : null}
        {suggestions.length === 0 ? <p className="text-lg">No check-in suggestions yet.</p> : null}
        <ul className="flex flex-col gap-6">
          {suggestions.map((card) => (
            <li key={card.id} className="flex flex-col gap-3 border-2 border-zinc-950 p-4">
              <SuggestionBody card={card} />
              {card.actionable ? <SuggestionActions flagId={card.id} /> : null}
            </li>
          ))}
        </ul>
      </section>
      {earlier.length > 0 ? (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-xl font-semibold">Earlier results</summary>
          <p className="text-lg">
            Older scores stay here when a new assessment is run. They are not replaced, and a finished check-in is not
            cleared.
          </p>
          <ul className="flex flex-col gap-4">
            {earlier.map((card) => (
              <li key={card.id} className="border-2 border-zinc-950 p-4">
                <SuggestionBody card={card} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SuggestionBody({ card }: { card: SuggestionCard }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-2xl font-semibold">{card.nickname}</h3>
      <p className="text-lg">
        {card.levelLabel}
        {card.level === "INSUFFICIENT_DATA" ? "" : ` · Score ${card.scoreLabel}`}
      </p>
      <p className="text-lg">{card.statusLabel}</p>
      {card.checkInSuggested ? (
        <p className="text-lg">
          A supportive check-in is suggested because an absence was marked family circumstances. That mark does not
          raise the score.
        </p>
      ) : null}
      {card.level === "INSUFFICIENT_DATA" ? (
        <p className="text-lg">There is not enough information for a score. This is not a Watch or High result.</p>
      ) : null}
      <p className="text-lg">Scored {card.scoringDate}</p>
      {card.dismissLabel ? <p className="text-lg">Reason: {card.dismissLabel}</p> : null}
      {card.note ? <p className="text-lg">Operational note: {card.note}</p> : null}
      {card.reasons.length > 0 ? (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-lg">
          {card.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RiskRunForm() {
  // One key per click. A second tap while the request is running reuses it,
  // so a weak connection cannot save two copies. A finished run gets a new key.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(async (prev: RiskFormState, formData: FormData) => {
    const result = await runRiskAssessmentAction(prev, formData);
    if (result.complete) setKey(crypto.randomUUID());
    return result;
  }, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Run risk assessment</h2>
      <p className="text-lg">
        This reads attendance, assignment, and grade records for your center and asks the scoring service for a
        supportive check-in score. It does not run by itself.
      </p>
      <input type="hidden" name="idempotencyKey" value={key} />
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Running the risk assessment…" : "Run risk assessment"}
      </button>
      <FormStatus state={state} />
    </form>
  );
}

function ThresholdForm({ watch, high }: { watch: number; high: number }) {
  const [state, action, pending] = useActionState(updateRiskThresholdsAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Watch and High levels</h2>
      <p className="text-lg">
        These levels decide the label after the score is calculated. They do not change how attendance, missing work,
        or grade trend are counted. The starting levels are Watch 40 and High 70.
      </p>
      <label className={labelClass}>
        Watch
        <input className={inputClass} name="watch" type="number" min={0} max={100} required defaultValue={watch} />
      </label>
      <label className={labelClass}>
        High
        <input className={inputClass} name="high" type="number" min={0} max={100} required defaultValue={high} />
      </label>
      <button className={secondaryButtonClass} type="submit" disabled={pending}>
        {pending ? "Saving levels…" : "Save levels"}
      </button>
      <FormStatus state={state} />
    </form>
  );
}

function SuggestionActions({ flagId }: { flagId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <CheckInForm flagId={flagId} />
      <DismissForm flagId={flagId} />
    </div>
  );
}

function CheckInForm({ flagId }: { flagId: string }) {
  const [state, action, pending] = useActionState(markCheckInDoneAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="flagId" value={flagId} />
      <label className={labelClass}>
        Operational note
        <input className={inputClass} name="note" maxLength={160} />
      </label>
      <p className="text-base">{NOTE_WARNING}</p>
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Check-in done"}
      </button>
      <FormStatus state={state} />
    </form>
  );
}

function DismissForm({ flagId }: { flagId: string }) {
  const [state, action, pending] = useActionState(dismissRiskFlagAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="flagId" value={flagId} />
      <label className={labelClass}>
        Dismiss reason
        <select className={inputClass} name="reason" required defaultValue="">
          <option value="" disabled>
            Choose a reason
          </option>
          {DISMISS_REASONS.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-base">{DISMISS_WARNING}</p>
      <button className={secondaryButtonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Dismiss"}
      </button>
      <FormStatus state={state} />
    </form>
  );
}

function FormStatus({ state }: { state: RiskFormState }) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="text-lg font-medium">{state.message}</p> : null}
    </>
  );
}
