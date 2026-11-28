import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PhoneTools } from "@/components/phone-tools";
import { PinResetForm } from "@/components/pin-reset-form";
import { TeacherHome } from "@/components/teacher-home";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";

export const instant = false;

export default function TeacherPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading your page…</p>}>
      <TeacherPageContent />
    </Suspense>
  );
}

async function TeacherPageContent() {
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  return (
    <Shell
      title={actor ? `Hello, ${actor.displayName}` : "Teacher home"}
      lede="You only see sections assigned to you."
    >
      <TeacherHome
        pin={<PinResetForm showCenterCode={false} />}
        phone={actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
      />
    </Shell>
  );
}
