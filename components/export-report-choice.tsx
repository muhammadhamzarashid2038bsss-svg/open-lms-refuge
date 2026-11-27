"use client";

// The warning stays hidden until learner-level is chosen. A director on a
// small screen should see the usual aggregate choice first, and only then the
// confirmation. Switching back to aggregate removes the checkbox, so it cannot
// stay ticked by accident.

import { useState } from "react";
import { LearnerLevelNotice } from "./export-learner-level";
import { inputClass, labelClass } from "./ui";

export function ExportReportChoice({
  offered,
  warning,
  confirmationLabel,
  initialMode,
  confirmationError,
  requirements,
  initialRequirementId,
}: {
  offered: boolean;
  warning: string | null;
  confirmationLabel: string | null;
  initialMode: "aggregate" | "pseudonymized";
  confirmationError: string | null;
  requirements: Array<{ id: string; requirementReference: string; crossReportLinkage: boolean }>;
  initialRequirementId: string;
}) {
  const [mode, setMode] = useState<"aggregate" | "pseudonymized">(
    offered && initialMode === "pseudonymized" ? "pseudonymized" : "aggregate",
  );
  const learnerLevel = offered && mode === "pseudonymized" && warning && confirmationLabel;
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-medium">Report type</legend>
        <label className="flex min-h-12 items-center gap-3 text-lg">
          <input
            type="radio"
            name="mode"
            value="aggregate"
            checked={mode === "aggregate"}
            onChange={() => setMode("aggregate")}
          />
          Aggregate report
        </label>
        {offered ? (
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input
              type="radio"
              name="mode"
              value="pseudonymized"
              checked={mode === "pseudonymized"}
              onChange={() => setMode("pseudonymized")}
            />
            Learner-level report
          </label>
        ) : (
          <p className="text-lg leading-7">
            Learner-level reporting is unavailable unless a funder explicitly requires it.
          </p>
        )}
      </fieldset>
      {learnerLevel ? (
        <>
          {confirmationError ? (
            <p className="text-lg font-medium" id="learner-level-error" role="alert">
              {confirmationError}
            </p>
          ) : null}
          <LearnerLevelNotice
            warning={warning}
            confirmationLabel={confirmationLabel}
            describedBy={confirmationError ? "learner-level-error" : undefined}
          />
          {requirements.length === 1 ? (
            <input type="hidden" name="requirementId" value={requirements[0]?.id ?? ""} />
          ) : (
            <label className={labelClass}>
              Which requirement covers this download
              <select className={inputClass} name="requirementId" defaultValue={initialRequirementId}>
                {requirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirement.requirementReference}
                    {requirement.crossReportLinkage ? " · same pseudonym across reports" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : null}
    </>
  );
}
