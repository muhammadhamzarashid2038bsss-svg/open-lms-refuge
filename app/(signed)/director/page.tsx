import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccountList } from "@/components/account-list";
import { ManageSectionAssignments } from "@/components/manage-section-assignments";
import { PasswordResetForm } from "@/components/password-reset-form";
import { PhoneTools } from "@/components/phone-tools";
import { PinResetForm } from "@/components/pin-reset-form";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listTimetableSections } from "@/lib/data/timetable";
import { listReassignmentChoices, listUnstaffedSections } from "@/lib/data/handoff";
import { managedSections } from "@/lib/lms/section-management";
import { listAccounts, readCenterSummary } from "@/lib/data/records";

export const instant = false;

export default function DirectorPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading your page…</p>}>
      <DirectorHome searchParams={searchParams} />
    </Suspense>
  );
}

async function DirectorHome({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const notice = (await searchParams).notice;
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  const summary = actor ? await readCenterSummary(actor) : null;
  const accounts = actor ? await listAccounts(actor) : null;
  const staffing = actor ? await listReassignmentChoices(actor) : null;
  const unstaffed = actor ? await listUnstaffedSections(actor) : null;
  const sections = actor ? await listTimetableSections(actor) : [];
  return (
    <Shell title={summary?.name ?? "Center home"} lede="You see this center only.">
      {notice ? <p className="text-lg" role="status">{notice}</p> : null}
      {summary ? (
        <p className="text-lg">
          {summary.learnerCount} learners · {summary.sectionCount} sections · code {summary.code}
        </p>
      ) : null}
      <p className="text-lg">
        <Link className="underline" href="/director/check-ins">
          Check-in suggestions
        </Link>
      </p>
      <p className="text-lg">
        <Link className="underline" href="/director/performance">
          Center performance
        </Link>
      </p>
      <p className="text-lg">
        <Link className="underline" href="/director/notes">
          Read progress notes
        </Link>
      </p>
      <p className="text-lg">
        <Link className="underline" href="/handoff">
          Handoff reports
        </Link>
        {" · "}
        <Link className="underline" href="/audit">
          Audit log
        </Link>
        {" · "}
        <Link className="underline" href="/export">
          Grant export
        </Link>
      </p>
      <p className="text-lg">
        <Link className="underline" href="/director/skill-tags">
          Skill tags
        </Link>
      </p>
      <p className="text-lg">
        <Link className="underline" href="/courses">
          Courses and syllabus materials
        </Link>
      </p>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Weekly timetables</h2>
        <p className="text-lg">Choose Take attendance on a class to mark who came.</p>
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
      {staffing && unstaffed ? (
        <ManageSectionAssignments
          sections={managedSections(staffing.sections, unstaffed.sections, false)}
          teachers={staffing.teachers}
          blankHint="Choose the teacher who is taking over. If you leave that blank, you receive the report. The app does not guess a teacher."
          blankOptionLabel="No incoming teacher — send the report to me"
        />
      ) : null}
      <PinResetForm showCenterCode={false} />
      <PasswordResetForm />
      {accounts ? (
        <AccountList
          accounts={accounts}
          incomingTeachers={staffing?.teachers ?? []}
          blankIncomingLabel="No incoming teacher — send the reports to me"
          fallbackText="If you do not choose anyone, you receive the reports. The app does not guess."
          emptyTeacherText="No other active teacher is at this centre yet. Leave the choice blank and you will receive the reports."
        />
      ) : null}
      {actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
    </Shell>
  );
}
