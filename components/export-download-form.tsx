// The ordinary download. It does not ask why a funder wants learner-level
// rows. That question lives in the section below, and only after the director
// chooses to record a requirement. Aggregate stays selected so a report can be
// downloaded without opening that section.

import { ExportReportChoice } from "./export-report-choice";
import { buttonClass, inputClass, labelClass } from "./ui";

export function ExportDownloadForm({
  centerId,
  centerName,
  from,
  to,
  format,
  mode,
  formError,
  offered,
  warning,
  confirmationLabel,
  confirmationError,
  requirements,
  initialRequirementId,
}: {
  centerId: string | null;
  centerName: string | null;
  from: string;
  to: string;
  format: "csv" | "pdf";
  mode: "aggregate" | "pseudonymized";
  formError: string | null;
  offered: boolean;
  warning: string | null;
  confirmationLabel: string | null;
  confirmationError: string | null;
  requirements: Array<{ id: string; requirementReference: string; crossReportLinkage: boolean }>;
  initialRequirementId: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">Generate a report</h2>
      <p className="text-lg leading-7">An aggregate report is ready to download. It does not need a funder requirement.</p>
      {formError ? (
        <p className="text-lg font-medium" role="alert">
          {formError}
        </p>
      ) : null}
      <form className="flex flex-col gap-4" method="post" action="/api/export">
        <input type="hidden" name="returnTo" value="page" />
        {centerId ? <input type="hidden" name="centerId" value={centerId} /> : null}
        {centerName ? <p className="text-lg">{centerName}</p> : null}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-medium">Reporting period</legend>
          <label className={labelClass}>
            From
            <input className={inputClass} type="date" name="periodStart" required defaultValue={from} />
          </label>
          <label className={labelClass}>
            To
            <input className={inputClass} type="date" name="periodEnd" required defaultValue={to} />
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-medium">Format</legend>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="format" value="csv" defaultChecked={format !== "pdf"} />
            CSV
          </label>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="format" value="pdf" defaultChecked={format === "pdf"} />
            PDF
          </label>
        </fieldset>
        <ExportReportChoice
          offered={offered}
          warning={warning}
          confirmationLabel={confirmationLabel}
          initialMode={mode}
          confirmationError={confirmationError}
          requirements={requirements}
          initialRequirementId={initialRequirementId}
        />
        <button className={buttonClass} type="submit">
          Download report
        </button>
      </form>
    </section>
  );
}
