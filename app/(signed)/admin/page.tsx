import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccountList } from "@/components/account-list";
import { PasswordResetForm } from "@/components/password-reset-form";
import { PhoneTools } from "@/components/phone-tools";
import { PinResetForm } from "@/components/pin-reset-form";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listAccounts } from "@/lib/data/records";

export const instant = false;

export default function AdminPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading your page…</p>}>
      <AdminHome />
    </Suspense>
  );
}

async function AdminHome() {
  const actor = await getActor();
  const guard = pageGuard(actor, "ADMIN");
  if (!guard.ok) redirect(guard.redirectTo);
  const accounts = actor ? await listAccounts(actor) : null;
  return (
    <Shell
      title="Account management"
      lede="Admins manage accounts. Grades, notes, and files stay with teachers and the director."
    >
      <PinResetForm showCenterCode />
      <PasswordResetForm />
      {accounts ? <AccountList accounts={accounts} /> : null}
      {actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
    </Shell>
  );
}
