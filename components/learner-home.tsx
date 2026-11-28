import Link from "next/link";
import { TodayClasses } from "@/components/today-classes";
import { secondaryButtonClass } from "@/components/ui";
import type { TodayResult } from "@/lib/data/timetable";
import { semesterLabel } from "@/lib/lms/resources";

// A learner on a shared phone opens this page to find today's class first.
// The menu scrolls to #today. That target has to stay when the center clock
// cannot be read, or the menu item looks frozen.

export type LearnerSectionSummary = {
  id: string;
  name: string;
  courseTitle: string;
  academicYear: number;
  semester: string;
  downloadableCount: number;
};

export function LearnerHome({
  learnerCode,
  attendanceCount,
  gradeCount,
  sections,
  today,
}: {
  learnerCode: string;
  attendanceCount: number;
  gradeCount: number;
  sections: LearnerSectionSummary[];
  today: TodayResult;
}) {
  return (
    <>
      {today.ok ? (
        <TodayClasses classes={today.classes} />
      ) : (
        <section id="today" data-nav-target="" aria-labelledby="today-heading" className="flex flex-col gap-3">
          <h2 id="today-heading" className="text-xl font-semibold">
            Today&apos;s classes
          </h2>
          <p className="text-lg">{today.message}</p>
        </section>
      )}
      <section id="sections" data-nav-target="" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Your sections</h2>
        {sections.length === 0 ? <p className="text-lg">No section yet.</p> : null}
        <ul className="flex flex-col gap-3">
          {sections.map((section) => {
            const hasFiles = section.downloadableCount > 0;
            return (
              <li
                key={section.id}
                className={`flex flex-col gap-2 rounded-lg border-2 p-4 ${
                  hasFiles ? "border-sky-900 bg-sky-50" : "border-zinc-950 bg-white"
                }`}
              >
                <h3 className="text-xl font-semibold">{section.name}</h3>
                <p className="text-lg">{section.courseTitle}</p>
                <p className="text-lg">
                  {section.academicYear} · {semesterLabel(section.semester)}
                </p>
                <p className={`text-lg ${hasFiles ? "font-semibold" : ""}`}>
                  {hasFiles
                    ? `${section.downloadableCount} downloadable file${section.downloadableCount === 1 ? "" : "s"}.`
                    : "No downloadable files for you here."}
                </p>
                <Link className={secondaryButtonClass} href={`/student/sections/${section.id}`}>
                  Open this section
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="record-heading" className="flex flex-col gap-3 rounded-lg border-2 border-zinc-950 bg-zinc-50 p-4">
        <h2 id="record-heading" className="text-xl font-semibold">
          Your record
        </h2>
        <p className="text-lg leading-7">These numbers count records. They are not a progress score.</p>
        <dl className="flex flex-col gap-3 text-lg">
          <div>
            <dt className="font-medium">Learner code</dt>
            <dd>{learnerCode}</dd>
          </div>
          <div>
            <dt className="font-medium">Attendance marks recorded</dt>
            <dd>{attendanceCount}</dd>
          </div>
          <div>
            <dt className="font-medium">Grades recorded</dt>
            <dd>{gradeCount}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="homework-heading" className="flex flex-col gap-3">
        <h2 id="homework-heading" className="text-xl font-semibold">
          Homework
        </h2>
        <Link className={secondaryButtonClass} href="/student/homework">
          Homework files
        </Link>
      </section>
    </>
  );
}
