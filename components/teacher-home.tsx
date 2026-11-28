import Link from "next/link";
import type { ReactNode } from "react";
import { secondaryButtonClass } from "@/components/ui";

// These three jobs stay under More on a phone, so the home shows the same
// links as cards. Attendance, the gradebook, assigned sections, and materials
// stay in the menu. There is no teacher "today" list to put here.

const tasks = [
  {
    title: "Save a grade or note",
    explanation: "A save stays on this phone first. It is sent when you ask.",
    action: "Save a grade or note on this phone",
    href: "/teacher/records",
  },
  {
    title: "Review conflicts",
    explanation:
      "These grades and notes were edited on two phones before either edit was sent. Both copies are kept.",
    action: "Review grade and note conflicts",
    href: "/teacher/conflicts",
  },
  {
    title: "Handoff reports",
    explanation: "A report is prepared when a teacher is switched off or a section assignment ends.",
    action: "Handoff reports",
    href: "/handoff",
  },
] as const;

export function TeacherHome({ pin, phone }: { pin: ReactNode; phone: ReactNode }) {
  return (
    <>
      <section aria-labelledby="work-heading" className="flex flex-col gap-3">
        <h2 id="work-heading" className="text-xl font-semibold">
          Your work
        </h2>
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => (
            <li key={task.href} className="flex flex-col gap-2 rounded-lg border-2 border-zinc-950 bg-white p-4">
              <h3 className="text-xl font-semibold">{task.title}</h3>
              <p className="text-lg leading-7">{task.explanation}</p>
              <Link className={secondaryButtonClass} href={task.href}>
                {task.action}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {/* The PIN form is the control that changes a learner's sign-in. A quiet
          card keeps it separate from the task links on a shared phone. */}
      <section className="rounded-lg border-2 border-zinc-950 bg-zinc-50 p-4">{pin}</section>
      {phone}
    </>
  );
}
