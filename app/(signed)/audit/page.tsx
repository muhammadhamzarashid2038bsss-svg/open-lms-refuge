import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuditLogView } from "@/components/audit-log";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { canViewAuditLog, homeForRole } from "@/lib/auth/permissions";
import { listAuditLog } from "@/lib/data/handoff";

export const instant = false;

export default function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; actorId?: string; from?: string; to?: string }>;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading the audit log…</p>}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; actorId?: string; from?: string; to?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/");
  if (!canViewAuditLog(actor)) redirect(homeForRole(actor.role));
  const query = await searchParams;
  const page = await listAuditLog(actor, query);
  if (!page) redirect(homeForRole(actor.role));
  return (
    <Shell wide title="Audit log" lede="Who viewed or changed a record, and when. The log does not show note text, passwords, or file contents. Rows cannot be edited or deleted here.">
      <p className="text-lg">
        <Link className="underline" href={homeForRole(actor.role)}>
          Back
        </Link>
      </p>
      <AuditLogView rows={page.rows} actors={page.actors} truncated={page.truncated} query={query} />
    </Shell>
  );
}
