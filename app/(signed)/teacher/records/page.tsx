import { Suspense } from "react";
import { redirect } from "next/navigation";
import { OfflineRecordEditor } from "@/components/offline-record-editor";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { loadRecordCatalog } from "@/lib/data/record-catalog";

export const instant = false;

export default function RecordsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading records…</p>}>
      <RecordsEditor />
    </Suspense>
  );
}

async function RecordsEditor() {
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  const catalog = actor ? await loadRecordCatalog(actor) : null;
  if (!actor || !catalog) redirect("/teacher");
  return (
    <Shell
      wide
      title="Grades and notes"
      lede="A save stays on this phone first. It is sent when you ask. Reloading this page needs a connection. The phone does not keep a copy of the page. The phone clock is stored so a person can read it. It does not decide which edit is newer."
    >
      <OfflineRecordEditor centerId={actor.centerId} userId={actor.id} catalog={catalog} />
    </Shell>
  );
}
