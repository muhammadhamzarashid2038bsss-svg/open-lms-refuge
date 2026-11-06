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
import { listTimetableSections } from "@/lib/data/timetable";
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
  const sections = actor ? await listTimetableSections(actor) : [];
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
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Weekly timetables</h2>
        <ul className="flex flex-col gap-2 text-lg">
          {sections.map((section) => (
            <li key={section.id}>
              <Link className="underline" href={`/sections/${section.id}/timetable`}>
                {section.name} · {section.course.title}
              </Link>
            </li>
          ))}
          {sections.length === 0 ? <li>No sections yet.</li> : null}
        </ul>
      </section>
      <PinResetForm showCenterCode={false} />
      <PasswordResetForm />
      {accounts ? <AccountList accounts={accounts} /> : null}
      {actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
    </Shell>
  );
}
