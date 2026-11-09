import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listOpenConflicts } from "@/lib/data/conflicts";

export const instant = false;

export default function ConflictsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading conflicts…</p>}>
      <ConflictList />
    </Suspense>
  );
}

async function ConflictList() {
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  const conflicts = actor ? await listOpenConflicts(actor) : [];
  return (
    <Shell
      title="Open conflicts"
      lede="These grades and notes were edited on two phones before either edit was sent. Both copies are kept. The one shown for now is the one the server received later."
    >
      <ul className="flex flex-col gap-3 text-lg">
        {conflicts.map((conflict) => (
          <li key={conflict.id}>
            <Link className="underline" href={`/teacher/conflicts/${conflict.id}`}>
              {conflict.kind}: {conflict.learnerCode} · {conflict.context}
            </Link>
          </li>
        ))}
        {conflicts.length === 0 ? <li>No open conflict is waiting for you.</li> : null}
      </ul>
    </Shell>
  );
}
