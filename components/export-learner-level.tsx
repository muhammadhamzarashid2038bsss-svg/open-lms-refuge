// Shown only when this centre already has an active funder requirement.
// The checkbox is the confirmation step. The download route still refuses a
// learner-level file if that confirmation is missing.

export function LearnerLevelNotice({
  warning,
  confirmationLabel,
  describedBy,
}: {
  warning: string;
  confirmationLabel: string;
  describedBy?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border-4 border-zinc-950 p-3">
      <p className="text-lg font-medium" role="alert">
        {warning}
      </p>
      <label className="flex min-h-12 items-start gap-3 text-lg">
        <input
          className="mt-1 size-6 shrink-0"
          type="checkbox"
          name="learnerLevelConfirmed"
          value="yes"
          aria-invalid={describedBy ? true : undefined}
          aria-describedby={describedBy}
        />
        <span>{confirmationLabel}</span>
      </label>
    </div>
  );
}
