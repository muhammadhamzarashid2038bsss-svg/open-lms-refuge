import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { listHandoffReports } from "@/lib/data/handoff";

export const instant = false;

export default function HandoffListPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading handoff reports…</p>}>
      <HandoffList />
    </Suspense>
  );
}

async function HandoffList() {
  const actor = await getActor();
  if (!actor) redirect("/");
  const reports = await listHandoffReports(actor);
  if (!reports) redirect(homeForRole(actor.role));
  return (
    <Shell title="Handoff reports" lede="A report is prepared when a teacher is switched off or a section assignment ends.">
      <p className="text-lg">
        <Link className="underline" href={homeForRole(actor.role)}>
          Back
        </Link>
      </p>
      {reports.length === 0 ? <p className="text-lg">No handoff report is available.</p> : null}
      <ul className="flex flex-col gap-3">
        {reports.map((report) => (
          <li key={report.id} className="rounded-lg border-2 border-zinc-950 p-3">
            <p className="text-lg font-medium">
              {report.courseTitle} · {report.sectionName}
            </p>
            <p className="text-base">
              {report.reasonLabel} · {report.generatedAtLabel}
            </p>
            <p className="text-base">Recipient: {report.recipientName}</p>
            <p className="text-lg">
              <Link className="underline" href={`/handoff/${report.id}`}>
                Open report
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
