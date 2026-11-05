import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CreateCourseForm } from "@/components/course-forms";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { listCourses } from "@/lib/data/courses";
import { semesterLabel } from "@/lib/lms/resources";

export const instant = false;

export default function CoursesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading courses…</p>}>
      <CoursesHome />
    </Suspense>
  );
}

async function CoursesHome() {
  const actor = await getActor();
  if (!actor) redirect("/");
  if (actor.role !== "TEACHER" && actor.role !== "CENTER_DIRECTOR") {
    redirect(homeForRole(actor.role));
  }
  const courses = (await listCourses(actor)) ?? [];
  const year = new Date().getFullYear();
  return (
    <Shell title="Courses" lede="Organize classes by year, semester, and section. Materials stay light for weak phones.">
      <ul className="flex flex-col gap-2 text-lg">
        {courses.map((course) => (
          <li key={course.id}>
            <Link className="underline" href={`/courses/${course.id}`}>
              {course.title} · {course.code} · {course.academicYear} · {semesterLabel(course.semester)} ·{" "}
              {course.sectionCount} section{course.sectionCount === 1 ? "" : "s"}
            </Link>
          </li>
        ))}
        {courses.length === 0 ? <li>No course is visible to you yet. Create one below.</li> : null}
      </ul>
      <CreateCourseForm defaultYear={year} />
    </Shell>
  );
}
