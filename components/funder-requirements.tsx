import { deactivateFunderRequirementAction, recordFunderRequirementAction } from "@/app/actions/funder-requirements";
import type { FunderRequirementView } from "@/lib/export/requirements";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

// Closed until the director asks for it. The usual task is downloading an
// aggregate report, so the recording form should not sit above that download
// on a small phone screen.

export function FunderRequirements({
  centerId,
  showCenterField,
  requirements,
}: {
  centerId: string;
  showCenterField: boolean;
  requirements: FunderRequirementView[];
}) {
  const active = requirements.filter((requirement) => requirement.active);
  const inactive = requirements.filter((requirement) => !requirement.active);
  return (
    <section className="flex flex-col gap-3 border-t-4 border-zinc-950 pt-4">
      <h2 className="text-xl font-semibold">Manage learner-level reporting access</h2>
      <p className="text-lg leading-7">
        {active.length > 0
          ? "Learner-level reporting is available because a funder requirement is active. Aggregate reports remain the usual download."
          : "Aggregate reports do not need a funder requirement. Record one only when a funder explicitly requires learner-level reporting."}
      </p>
      {active.map((requirement) => (
        <div key={requirement.id} className="flex flex-col gap-2 rounded-lg border-2 border-zinc-950 p-3">
          <p className="break-words text-lg font-medium">{requirement.requirementReference} · Active</p>
          <p className="text-lg">Recorded {requirement.recordedLabel}</p>
          <p className="break-words text-lg">{requirement.learnerLevelReason}</p>
          {requirement.crossReportLinkage ? <p className="text-lg">Same pseudonym across reports</p> : null}
          <form action={deactivateFunderRequirementAction}>
            {showCenterField ? <input type="hidden" name="centerId" value={centerId} /> : null}
            <input type="hidden" name="requirementId" value={requirement.id} />
            <button className={secondaryButtonClass} type="submit">
              Turn off requirement
            </button>
          </form>
        </div>
      ))}
      <details className="rounded-lg border-2 border-zinc-950 p-3">
        <summary className="flex min-h-12 cursor-pointer items-center text-lg font-medium">
          {active.length === 0 ? "Record funder requirement" : "Record another requirement"}
        </summary>
        <form action={recordFunderRequirementAction} className="mt-3 flex flex-col gap-3">
          {showCenterField ? <input type="hidden" name="centerId" value={centerId} /> : null}
          <label className={labelClass}>
            Why learner-level reporting is required
            <textarea className={inputClass} name="learnerLevelReason" required minLength={10} maxLength={200} />
          </label>
          <label className={labelClass}>
            Short reference, if you have one
            <input className={inputClass} name="requirementReference" maxLength={80} placeholder="GRANT-2026" />
          </label>
          <p className="text-lg leading-7">
            Leave this off to give each download a new pseudonym. Tick it only when a funder asked to match the same learner across later reports. The file is still not anonymous.
          </p>
          <label className="flex min-h-12 items-start gap-3 text-lg">
            <input className="mt-1 size-6 shrink-0" type="checkbox" name="crossReportLinkage" value="yes" />
            <span>Reuse the same pseudonym in later reports</span>
          </label>
          <button className={buttonClass} type="submit">
            Record requirement
          </button>
        </form>
      </details>
      {inactive.length > 0 ? (
        <details className="rounded-lg border-2 border-zinc-950 p-3">
          <summary className="flex min-h-12 cursor-pointer items-center text-lg font-medium">Earlier requirements</summary>
          <ul className="mt-3 flex flex-col gap-3">
            {inactive.map((requirement) => (
              <li key={requirement.id}>
                <p className="break-words text-lg font-medium">{requirement.requirementReference} · Turned off</p>
                <p className="text-lg">Recorded {requirement.recordedLabel}</p>
                {requirement.deactivatedLabel ? <p className="text-lg">Turned off {requirement.deactivatedLabel}</p> : null}
                <p className="break-words text-lg">{requirement.learnerLevelReason}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
