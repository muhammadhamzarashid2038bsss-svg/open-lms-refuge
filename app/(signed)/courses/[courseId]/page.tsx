import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AddResourceForm, AddSectionForm } from "@/components/course-forms";
import { ResourceList } from "@/components/resource-list";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { readCourse } from "@/lib/data/courses";
import { semesterLabel } from "@/lib/lms/resources";

export const instant = false;

export default function CourseDetailPage({ params }: { params: Promise<{ courseId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading course…</p>}>
      <CourseDetail params={params} />
    </Suspense>
  );
}

async function CourseDetail({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const actor = await getActor();
  if (!actor) redirect("/");
  if (actor.role !== "TEACHER" && actor.role !== "CENTER_DIRECTOR") {
    redirect(homeForRole(actor.role));
  }
  const course = await readCourse(actor, courseId);
  if (!course) redirect("/courses");

  return (
    <Shell
      title={course.title}
      lede={`${course.code} · ${course.academicYear} · ${semesterLabel(course.semester)}`}
    >
      {course.summary ? <p className="text-lg leading-7">{course.summary}</p> : null}
      <p className="text-lg">
        <Link className="underline" href="/courses">
          All courses
        </Link>
      </p>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Sections</h2>
        <ul className="flex flex-col gap-1 text-lg">
          {course.sections.map((section) => (
            <li key={section.id}>{section.name}</li>
          ))}
          {course.sections.length === 0 ? <li>No sections yet.</li> : null}
        </ul>
      </section>
      <ResourceList resources={course.resources} downloadableCount={course.downloadableCount} manage courseId={course.id} />
      <AddSectionForm courseId={course.id} />
      <AddResourceForm courseId={course.id} sections={course.sections} />
    </Shell>
  );
}
