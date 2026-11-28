import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccountList } from "@/components/account-list";
import { DirectorDashboard } from "@/components/director-dashboard";
import { ManageSectionAssignments } from "@/components/manage-section-assignments";
import { PasswordResetForm } from "@/components/password-reset-form";
import { PhoneTools } from "@/components/phone-tools";
import { PinResetForm } from "@/components/pin-reset-form";
import { Notice } from "@/components/notice";
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
      <DirectorDashboard
        summary={
          summary
            ? {
                name: summary.name,
                learnerCount: summary.learnerCount,
                sectionCount: summary.sectionCount,
                code: summary.code,
              }
            : null
        }
        notice={notice ? <Notice tone="info">{notice}</Notice> : null}
        sections={sections.map((section) => ({
          id: section.id,
          name: section.name,
          courseTitle: section.course.title,
        }))}
        people={
          <>
            {staffing && unstaffed ? (
              <div className="rounded-lg border-2 border-zinc-950 bg-white p-4">
                <ManageSectionAssignments
                  sections={managedSections(staffing.sections, unstaffed.sections, false)}
                  teachers={staffing.teachers}
                  blankHint="Choose the teacher who is taking over. If you leave that blank, you receive the report. The app does not guess a teacher."
                  blankOptionLabel="No incoming teacher — send the report to me"
                />
              </div>
            ) : null}
            <div className="rounded-lg border-2 border-zinc-950 bg-zinc-50 p-4">
              <PinResetForm showCenterCode={false} />
            </div>
            <div className="rounded-lg border-2 border-zinc-950 bg-zinc-50 p-4">
              <PasswordResetForm />
            </div>
            {accounts ? (
              <AccountList
                accounts={accounts}
                incomingTeachers={staffing?.teachers ?? []}
                blankIncomingLabel="No incoming teacher — send the reports to me"
                fallbackText="If you do not choose anyone, you receive the reports. The app does not guess."
                emptyTeacherText="No other active teacher is at this centre yet. Leave the choice blank and you will receive the reports."
              />
            ) : null}
          </>
        }
        phone={actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
      />
    </Shell>
  );
}
