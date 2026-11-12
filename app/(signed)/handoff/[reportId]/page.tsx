import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HandoffReportView } from "@/components/handoff-report";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { readHandoffReport } from "@/lib/data/handoff";

export const instant = false;

export default function HandoffPage({ params }: { params: Promise<{ reportId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading the handoff report…</p>}>
      <Handoff params={params} />
    </Suspense>
  );
}

async function Handoff({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const actor = await getActor();
  if (!actor) redirect("/");
  let report = null;
  try {
    report = await readHandoffReport(actor, reportId, "view");
  } catch {
    redirect(`${homeForRole(actor.role)}?notice=${encodeURIComponent("The handoff view could not be recorded.")}`);
  }
  if (!report) redirect(homeForRole(actor.role));
  return (
    <Shell wide title="Student transition profiles" lede="These numbers were saved when the handoff was prepared. Later grade or note edits do not change this pack.">
      <HandoffReportView report={report} printHref={`/handoff/${report.id}/print`} backHref="/handoff" />
    </Shell>
  );
}
