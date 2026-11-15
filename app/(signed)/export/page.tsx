import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Shell, buttonClass, inputClass, labelClass } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { resolveExportCenter } from "@/lib/export/center";
import { learnerLevelOffer, listActiveExportRequirements, listExportCenters } from "@/lib/export/offer";

export const instant = false;

export default function ExportPage({ searchParams }: { searchParams: Promise<{ center?: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading the export page…</p>}>
      <ExportScreen searchParams={searchParams} />
    </Suspense>
  );
}

async function ExportScreen({ searchParams }: { searchParams: Promise<{ center?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/");
  const requested = (await searchParams).center ?? null;
  const decision = await resolveExportCenter({ userId: actor.id, postedCenterId: requested });
  if (!decision.ok) {
    if (decision.role !== "ADMIN") redirect(homeForRole(actor.role));
    const centers = await listExportCenters();
    return (
      <Shell title="Grant export" lede="Choose a center. The download is checked again on the server.">
        <p className="text-lg">
          <Link className="underline" href={homeForRole(actor.role)}>
            Back
          </Link>
        </p>
        <CenterPicker centers={centers} />
      </Shell>
    );
  }

  const requirements = await listActiveExportRequirements(decision.centerId);
  const offer = learnerLevelOffer(requirements.length);
  const centers = decision.role === "ADMIN" ? await listExportCenters() : [];
  const center = centers.find((item) => item.id === decision.centerId) ?? null;
  return (
    <Shell title="Grant export" lede="Aggregate totals are the usual report. A learner-level file is offered only when this center already has an active funder requirement.">
      <p className="text-lg">
        <Link className="underline" href={homeForRole(actor.role)}>
          Back
        </Link>
      </p>
      {decision.role === "ADMIN" ? <CenterPicker centers={centers} selectedId={decision.centerId} /> : null}
      <p className="text-lg">
        Adding or changing a funder requirement is not available on this page.
      </p>
      <form className="flex flex-col gap-4" method="post" action="/api/export">
        {decision.role === "ADMIN" ? <input type="hidden" name="centerId" value={decision.centerId} /> : null}
        {center ? <p className="text-lg">{center.name}</p> : null}
        <label className={labelClass}>
          From
          <input className={inputClass} type="date" name="periodStart" required />
        </label>
        <label className={labelClass}>
          To
          <input className={inputClass} type="date" name="periodEnd" required />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-medium">Format</legend>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="format" value="csv" defaultChecked />
            CSV
          </label>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="format" value="pdf" />
            PDF
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-medium">Report</legend>
          <label className="flex min-h-12 items-center gap-3 text-lg">
            <input type="radio" name="mode" value="aggregate" defaultChecked />
            Aggregate report
          </label>
          {offer.offered ? (
            <label className="flex min-h-12 items-center gap-3 text-lg">
              <input type="radio" name="mode" value="pseudonymized" />
              Pseudonymized learner-level file
            </label>
          ) : null}
        </fieldset>
        {offer.warning ? (
          <p className="text-lg" role="note">
            {offer.warning}
          </p>
        ) : null}
        {offer.offered ? (
          <label className={labelClass}>
            Funder requirement
            <select className={inputClass} name="requirementId" defaultValue={requirements[0]?.id ?? ""}>
              {requirements.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.funderName} · {requirement.requirementReference}
                  {requirement.crossReportLinkage ? " · same pseudonym across reports" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button className={buttonClass} type="submit">
          Download report
        </button>
      </form>
    </Shell>
  );
}

function CenterPicker({
  centers,
  selectedId,
}: {
  centers: Array<{ id: string; name: string; code: string }>;
  selectedId?: string;
}) {
  return (
    <form className="flex flex-col gap-3" method="get">
      <label className={labelClass}>
        Center
        <select className={inputClass} name="center" defaultValue={selectedId ?? ""} required>
          <option value="" disabled>
            Choose a center
          </option>
          {centers.map((center) => (
            <option key={center.id} value={center.id}>
              {center.name} ({center.code})
            </option>
          ))}
        </select>
      </label>
      <button className={buttonClass} type="submit">
        Show this center
      </button>
    </form>
  );
}
