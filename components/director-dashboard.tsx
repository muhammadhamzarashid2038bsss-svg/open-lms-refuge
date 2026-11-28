import Link from "next/link";
import type { ReactNode } from "react";
import { secondaryButtonClass } from "@/components/ui";

// The page heading is the centre name, so this card does not repeat it.
// It labels the three figures already loaded for this centre. Check-ins,
// performance, notes, and reports stay in the menu.

export type DirectorSummaryView = {
  name: string;
  learnerCount: number;
  sectionCount: number;
  code: string;
};

export type DirectorTimetableCard = {
  id: string;
  name: string;
  courseTitle: string;
};

export function DirectorDashboard({
  summary,
  notice,
  sections,
  people,
  phone,
}: {
  summary: DirectorSummaryView | null;
  notice: ReactNode;
  sections: DirectorTimetableCard[];
  people: ReactNode;
  phone: ReactNode;
}) {
  return (
    <>
      {summary ? (
        <section aria-labelledby="center-summary-heading" className="rounded-lg border-2 border-zinc-950 bg-zinc-50 p-4">
          <h2 id="center-summary-heading" className="sr-only">
            Centre summary
          </h2>
          <dl className="grid grid-cols-2 gap-4 text-lg">
            <div>
              <dt className="font-medium">Learners</dt>
              <dd>{summary.learnerCount}</dd>
            </div>
            <div>
              <dt className="font-medium">Sections</dt>
              <dd>{summary.sectionCount}</dd>
            </div>
            <div className="col-span-2">
              <dt className="font-medium">Centre code</dt>
              <dd>{summary.code}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      {notice}
      <section id="timetables" data-nav-target="" aria-labelledby="timetables-heading" className="flex flex-col gap-3">
        <h2 id="timetables-heading" className="text-xl font-semibold">
          Weekly timetables
        </h2>
        <p className="text-lg leading-7">Choose Take attendance on a class to mark who came.</p>
        {sections.length === 0 ? <p className="text-lg">No sections yet.</p> : null}
        <ul className="flex flex-col gap-3">
          {sections.map((section) => (
            <li key={section.id} className="flex flex-col gap-2 rounded-lg border-2 border-zinc-950 bg-white p-4">
              <h3 className="text-xl font-semibold">{section.name}</h3>
              <p className="text-lg">{section.courseTitle}</p>
              <Link className={secondaryButtonClass} href={`/sections/${section.id}/timetable`}>
                Open timetable
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section id="people" data-nav-target="" aria-labelledby="people-heading" className="flex flex-col gap-6">
        <h2 id="people-heading" className="text-xl font-semibold">
          People
        </h2>
        {people}
      </section>
      {phone}
    </>
  );
}
