import Link from "next/link";
import { semesterLabel } from "@/lib/lms/resources";
import { secondaryButtonClass } from "./ui";

export type CourseLinkItem = {
  id: string;
  title: string;
  code: string;
  academicYear: number;
  semester: string;
  sectionCount: number;
};

/// Each course is one full-width control. A small text link is hard to tap
/// on a shared phone. The destination and the words stay the ones already loaded.
export function CourseList({ courses }: { courses: CourseLinkItem[] }) {
  return (
    <ul className="flex flex-col gap-3 text-lg">
      {courses.map((course) => (
        <li key={course.id}>
          <Link className={secondaryButtonClass} href={`/courses/${course.id}`}>
            {course.title} · {course.code} · {course.academicYear} · {semesterLabel(course.semester)} ·{" "}
            {course.sectionCount} section{course.sectionCount === 1 ? "" : "s"}
          </Link>
        </li>
      ))}
      {courses.length === 0 ? <li>No course is visible to you yet. Create one below.</li> : null}
    </ul>
  );
}
