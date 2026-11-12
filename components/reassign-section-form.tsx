import { reassignSectionAction } from "@/app/actions/handoff";
import { buttonClass, labelClass } from "./ui";

export function ReassignSectionForm({
  sections,
  teachers,
}: {
  sections: { id: string; label: string; teachers: { id: string; name: string }[] }[];
  teachers: { id: string; name: string }[];
}) {
  const options = sections.flatMap((section) =>
    section.teachers.map((teacher) => ({
      value: `${section.id}|${teacher.id}`,
      label: `${section.label} · ${teacher.name}`,
    })),
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Reassign a section</h2>
      <p className="text-lg leading-7">
        Ending a current assignment prepares one handoff for that section. The same assignment is not packed twice.
        Leave the incoming teacher blank when you want the only other current teacher, or the director if there is not
        exactly one. If the assignment started today, it ends on that same UTC day, and the outgoing teacher keeps the
        section until that UTC day is over.
      </p>
      {options.length === 0 ? <p className="text-lg">No section has a current teacher.</p> : null}
      {options.length > 0 ? (
        <form action={reassignSectionAction} className="flex flex-col gap-3">
          <label className={labelClass}>
            Current assignment
            <select className="min-h-12 w-full rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg" name="assignment" required>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Incoming teacher
            <select className="min-h-12 w-full rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg" name="incomingTeacherId" defaultValue="">
              <option value="">No named incoming teacher</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </label>
          <button className={buttonClass} type="submit">
            End assignment and prepare handoff
          </button>
        </form>
      ) : null}
    </section>
  );
}
