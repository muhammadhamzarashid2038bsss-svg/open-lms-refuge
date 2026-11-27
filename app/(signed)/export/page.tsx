import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ExportDownloadForm } from "@/components/export-download-form";
import { FunderRequirements } from "@/components/funder-requirements";
import { Shell, buttonClass, inputClass, labelClass } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { resolveExportCenter } from "@/lib/export/center";
import { CONFIRMATION_MISSING, learnerLevelOffer, listActiveExportRequirements, listExportCenters } from "@/lib/export/offer";
import { listFunderRequirements } from "@/lib/export/requirements";

export const instant = false;

type ExportQuery = {
  center?: string;
  notice?: string;
  error?: string;
  from?: string;
  to?: string;
  format?: string;
  mode?: string;
  requirement?: string;
};

export default function ExportPage({ searchParams }: { searchParams: Promise<ExportQuery> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading the export page…</p>}>
      <ExportScreen searchParams={searchParams} />
    </Suspense>
  );
}

async function ExportScreen({ searchParams }: { searchParams: Promise<ExportQuery> }) {
  const actor = await getActor();
  if (!actor) redirect("/");
  const params = await searchParams;
  const notice = params.notice;
  const requested = params.center ?? null;
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
  const history = await listFunderRequirements(actor, decision.centerId);
  const offer = learnerLevelOffer(requirements.length);
  const centers = decision.role === "ADMIN" ? await listExportCenters() : [];
  const center = centers.find((item) => item.id === decision.centerId) ?? null;
  const format = params.format === "pdf" ? "pdf" : "csv";
  const mode = params.mode === "pseudonymized" && offer.offered ? "pseudonymized" : "aggregate";
  const pageError = exportPageError(params.error);
  const confirmationError = mode === "pseudonymized" ? pageError.confirmation : null;
  const formError = pageError.form ?? (pageError.confirmation && !confirmationError ? pageError.confirmation : null);
  const requirementId = requirements.some((item) => item.id === params.requirement)
    ? (params.requirement ?? "")
    : (requirements[0]?.id ?? "");
  return (
    <Shell title="Grant export" lede="Download an aggregate report. Learner-level reporting is a separate choice, and only when a funder requires it.">
      <p className="text-lg">
        <Link className="underline" href={homeForRole(actor.role)}>
          Back
        </Link>
      </p>
      {notice ? <p className="text-lg" role="status">{notice}</p> : null}
      {decision.role === "ADMIN" ? <CenterPicker centers={centers} selectedId={decision.centerId} /> : null}
      <ExportDownloadForm
        centerId={decision.role === "ADMIN" ? decision.centerId : null}
        centerName={center?.name ?? null}
        from={dayQuery(params.from)}
        to={dayQuery(params.to)}
        format={format}
        mode={mode}
        formError={formError}
        offered={offer.offered}
        warning={offer.warning}
        confirmationLabel={offer.confirmationLabel}
        confirmationError={confirmationError}
        requirements={requirements.map((item) => ({
          id: item.id,
          requirementReference: item.requirementReference,
          crossReportLinkage: item.crossReportLinkage,
        }))}
        initialRequirementId={requirementId}
      />
      {history ? (
        <FunderRequirements centerId={decision.centerId} showCenterField={decision.role === "ADMIN"} requirements={history} />
      ) : null}
    </Shell>
  );
}

function dayQuery(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function exportPageError(code: string | undefined): { confirmation: string | null; form: string | null } {
  if (code === "confirmation") return { confirmation: CONFIRMATION_MISSING, form: null };
  if (code === "requirement") {
    return { confirmation: null, form: "A learner-level export needs an active funder requirement approved for this center." };
  }
  if (code === "dates") return { confirmation: null, form: "The export dates could not be read." };
  if (code === "format") return { confirmation: null, form: "The export format could not be read." };
  if (code === "denied") return { confirmation: null, form: "You cannot export this center's report." };
  if (code === "failed") return { confirmation: null, form: "The export could not be created. Nothing was downloaded." };
  return { confirmation: null, form: null };
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
