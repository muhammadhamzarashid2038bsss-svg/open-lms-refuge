import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccountList } from "@/components/account-list";
import { PasswordResetForm } from "@/components/password-reset-form";
import { PhoneTools } from "@/components/phone-tools";
import { PinResetForm } from "@/components/pin-reset-form";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listAccounts, readCenterSummary } from "@/lib/data/records";

export const instant = false;

export default function DirectorPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading your page…</p>}>
      <DirectorHome />
    </Suspense>
  );
}

async function DirectorHome() {
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  const summary = actor ? await readCenterSummary(actor) : null;
  const accounts = actor ? await listAccounts(actor) : null;
  return (
    <Shell title={summary?.name ?? "Center home"} lede="You see this center only.">
      {summary ? (
        <p className="text-lg">
          {summary.learnerCount} learners · {summary.sectionCount} sections · code {summary.code}
        </p>
      ) : null}
      <p className="text-lg">
        <Link className="underline" href="/courses">
          Courses and syllabus materials
        </Link>
      </p>
      <PinResetForm showCenterCode={false} />
      <PasswordResetForm />
      {accounts ? <AccountList accounts={accounts} /> : null}
      {actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
    </Shell>
  );
}
