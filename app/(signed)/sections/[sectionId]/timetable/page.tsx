import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TimetableWeek } from "@/components/timetable-week";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { readWeeklyTimetable } from "@/lib/data/timetable";

export const instant = false;

export default function TimetablePage({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading the timetable…</p>}>
      <Timetable params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Timetable({
  params,
  searchParams,
}: {
  params: Promise<{ sectionId: string }>;
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const { sectionId } = await params;
  const query = await searchParams;
  const weekValue = Array.isArray(query.week) ? query.week[0] : query.week;
  const actor = await getActor();
  if (!actor) redirect("/");
  const result = await readWeeklyTimetable(actor, sectionId, weekValue ?? null);
  if (result.kind === "hidden") redirect(homeForRole(actor.role));
  if (result.kind === "invalid-timezone") {
    return (
      <Shell title="Weekly timetable">
        <p className="text-lg">The center clock setting needs a fix before the timetable can be shown.</p>
      </Shell>
    );
  }
  const timetable = result.timetable;
  return (
    <Shell
      wide
      title={`${timetable.sectionName} timetable`}
      lede={`${timetable.courseTitle}. Times follow the learning center clock.`}
    >
      <p className="text-lg">
        <Link className="underline" href={homeForRole(actor.role)}>
          Back
        </Link>
        {timetable.canManage ? (
          <>
            {" · "}
            <Link className="underline" href={`/courses/${timetable.courseId}`}>
              Course materials
            </Link>
          </>
        ) : null}
      </p>
      <TimetableWeek timetable={timetable} />
    </Shell>
  );
}
