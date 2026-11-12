import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AccountList } from "@/components/account-list";
import { PasswordResetForm } from "@/components/password-reset-form";
import { PhoneTools } from "@/components/phone-tools";
import { PinResetForm } from "@/components/pin-reset-form";
import { ReassignSectionForm } from "@/components/reassign-section-form";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listReassignmentChoices } from "@/lib/data/handoff";
import { listAccounts } from "@/lib/data/records";

export const instant = false;

export default function AdminPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading your page…</p>}>
      <AdminHome searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminHome({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const notice = (await searchParams).notice;
  const actor = await getActor();
  const guard = pageGuard(actor, "ADMIN");
  if (!guard.ok) redirect(guard.redirectTo);
  const accounts = actor ? await listAccounts(actor) : null;
  const staffing = actor ? await listReassignmentChoices(actor) : null;
  return (
    <Shell
      title="Account management"
      lede="Admins manage accounts. Grades, notes, and handoff packs stay with teachers and the director."
    >
      {notice ? <p className="text-lg" role="status">{notice}</p> : null}
      <p className="text-lg">
        <Link className="underline" href="/audit">
          Audit log
        </Link>
      </p>
      {staffing ? <ReassignSectionForm sections={staffing.sections} teachers={staffing.teachers} /> : null}
      <PinResetForm showCenterCode />
      <PasswordResetForm />
      {accounts ? <AccountList accounts={accounts} /> : null}
      {actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
    </Shell>
  );
}
