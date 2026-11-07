import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AttendanceHistory } from "@/components/attendance-history";
import { AttendanceKiosk } from "@/components/attendance-kiosk";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { readAttendanceSheet } from "@/lib/data/attendance";

export const instant = false;

export default function AttendancePage({
  params,
}: {
  params: Promise<{ sectionId: string; sessionId: string }>;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading attendance…</p>}>
      <Attendance params={params} />
    </Suspense>
  );
}

async function Attendance({ params }: { params: Promise<{ sectionId: string; sessionId: string }> }) {
  const { sectionId, sessionId } = await params;
  const actor = await getActor();
  if (!actor) redirect("/");
  const result = await readAttendanceSheet(actor, sectionId, sessionId);
  if (result.kind === "hidden") redirect(homeForRole(actor.role));
  const sheet = result.sheet;
  const back = sheet.weekOf
    ? `/sections/${sheet.sectionId}/timetable?week=${encodeURIComponent(sheet.weekOf)}`
    : `/sections/${sheet.sectionId}/timetable`;
  return (
    <Shell
      wide
      title={`${sheet.title} attendance`}
      lede={`${sheet.sectionName}. ${sheet.whenLabel}. Tap a status for each learner you want to mark, then save.`}
    >
      <p className="text-lg">
        <Link className="underline" href={back}>
          Back to the timetable
        </Link>
      </p>
      <AttendanceKiosk
        sectionId={sheet.sectionId}
        sessionId={sheet.sessionId}
        cancelled={sheet.cancelled}
        learners={sheet.learners}
      />
      <AttendanceHistory lines={sheet.history} />
    </Shell>
  );
}
