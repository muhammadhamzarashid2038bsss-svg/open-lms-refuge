import Link from "next/link";
import { secondaryButtonClass } from "./ui";

// A teacher on a shared phone needs a page that starts the job they named.
// Attendance and the gradebook used to scroll the home page, so the tap
// looked frozen. These cards only link to the timetable and gradebook that
// already exist.

export type TeacherSectionCard = {
  id: string;
  name: string;
  course: { title: string };
};

export const NO_ASSIGNED_SECTIONS = "You don't have any sections assigned yet. Contact your centre director.";

export function TeacherSectionList({
  sections,
  mode,
}: {
  sections: TeacherSectionCard[];
  mode: "sections" | "attendance" | "gradebook";
}) {
  if (sections.length === 0) {
    return <p className="text-lg">{NO_ASSIGNED_SECTIONS}</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {sections.map((section) => (
        <li key={section.id} className="flex flex-col gap-3 rounded-lg border-2 border-zinc-950 p-4">
          <h2 className="text-xl font-semibold">{section.name}</h2>
          <p className="text-lg">{section.course.title}</p>
          {mode === "attendance" ? (
            <Link className={secondaryButtonClass} href={`/sections/${section.id}/timetable`}>
              Open timetable
            </Link>
          ) : null}
          {mode === "gradebook" ? (
            <Link className={secondaryButtonClass} href={`/teacher/sections/${section.id}/gradebook`}>
              Open gradebook
            </Link>
          ) : null}
          {mode === "sections" ? (
            <div className="flex flex-col gap-2">
              <Link className={secondaryButtonClass} href={`/sections/${section.id}/timetable`}>
                Timetable
              </Link>
              <Link className={secondaryButtonClass} href={`/teacher/sections/${section.id}/gradebook`}>
                Gradebook
              </Link>
              <Link className={secondaryButtonClass} href={`/teacher/sections/${section.id}/performance`}>
                Performance
              </Link>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
