import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RiskCheckIns } from "@/components/risk-check-ins";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listRiskSuggestions } from "@/lib/data/risk";

export const instant = false;

export default function CheckInsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading check-in suggestions…</p>}>
      <CheckIns />
    </Suspense>
  );
}

async function CheckIns() {
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  const page = actor ? await listRiskSuggestions(actor) : null;
  if (!page) redirect("/director");
  return (
    <Shell wide title="Check-in suggestions" lede="Suggestions for your center only. A person decides what to do.">
      <p className="text-lg">
        <Link className="underline" href="/director">
          Back to the center home
        </Link>
      </p>
      <RiskCheckIns
        watch={page.watch}
        high={page.high}
        belowWatch={page.belowWatch}
        suggestions={page.suggestions}
        earlier={page.earlier}
      />
    </Shell>
  );
}
