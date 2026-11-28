import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PhoneTools } from "@/components/phone-tools";
import { PinResetForm } from "@/components/pin-reset-form";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";

export const instant = false;

export default function TeacherPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading your page…</p>}>
      <TeacherHome />
    </Suspense>
  );
}

async function TeacherHome() {
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  return (
    <Shell
      title={actor ? `Hello, ${actor.displayName}` : "Teacher home"}
      lede="You only see sections assigned to you."
    >
      <p className="text-lg">
        <Link className="underline" href="/courses">
          Manage courses and materials
        </Link>
      </p>
      <p className="text-lg">
        <Link className="underline" href="/teacher/records">
          Save a grade or note on this phone
        </Link>
      </p>
      <p className="text-lg">
        <Link className="underline" href="/handoff">
          Handoff reports
        </Link>
      </p>
      <p className="text-lg">
        <Link className="underline" href="/teacher/conflicts">
          Review grade and note conflicts
        </Link>
      </p>
      <PinResetForm showCenterCode={false} />
      {actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
    </Shell>
  );
}
