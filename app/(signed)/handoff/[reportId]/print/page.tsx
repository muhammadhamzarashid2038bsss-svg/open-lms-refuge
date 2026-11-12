import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HandoffReportView } from "@/components/handoff-report";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { readHandoffReport } from "@/lib/data/handoff";

export const instant = false;

export default function HandoffPrintPage({ params }: { params: Promise<{ reportId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading the printable report…</p>}>
      <Printable params={params} />
    </Suspense>
  );
}

async function Printable({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const actor = await getActor();
  if (!actor) redirect("/");
  let report = null;
  try {
    report = await readHandoffReport(actor, reportId, "print");
  } catch {
    redirect(`${homeForRole(actor.role)}?notice=${encodeURIComponent("The print request could not be recorded.")}`);
  }
  if (!report) redirect(homeForRole(actor.role));
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 bg-white px-4 py-6 text-zinc-950">
      <p className="text-base leading-6 print:hidden">
        This page records a print request. The browser dialog can print the page or save a PDF. This app cannot tell
        whether that file was saved.
      </p>
      <h1 className="text-3xl font-semibold">Student transition profiles</h1>
      <HandoffReportView report={report} backHref={`/handoff/${report.id}`} />
    </main>
  );
}
