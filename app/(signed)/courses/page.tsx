import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CourseList } from "@/components/course-list";
import { CreateCourseForm } from "@/components/course-forms";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { listCourses } from "@/lib/data/courses";

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
      <CourseList courses={courses} />
      <CreateCourseForm defaultYear={year} />
    </Shell>
  );
}
