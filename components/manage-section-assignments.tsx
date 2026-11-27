"use client";

import { useState } from "react";
import { assignUnstaffedSectionAction, reassignSectionAction } from "@/app/actions/handoff";
import type { ManagedSection } from "@/lib/lms/section-management";
import { sectionAssignmentLabel } from "@/lib/lms/teacher-label";
import { buttonClass, labelClass } from "./ui";

export function ManageSectionAssignments({
  sections,
  teachers,
  blankHint,
  blankOptionLabel,
}: {
  sections: ManagedSection[];
  teachers: { id: string; name: string; centerId: string }[];
  blankHint: string;
  blankOptionLabel: string;
}) {
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const selected = sections.find((section) => section.id === sectionId) ?? sections[0];
  const [outgoingId, setOutgoingId] = useState(selected?.currentTeachers[0]?.id ?? "");
  const currentOutgoing = selected?.currentTeachers.some((teacher) => teacher.id === outgoingId)
    ? outgoingId
    : selected?.currentTeachers[0]?.id ?? "";
  const incoming = teachers.filter((teacher) => teacher.centerId === selected?.centerId && teacher.id !== currentOutgoing);

  function chooseSection(nextId: string) {
    const next = sections.find((section) => section.id === nextId);
    setSectionId(nextId);
    setOutgoingId(next?.currentTeachers[0]?.id ?? "");
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Manage section assignments</h2>
      <p className="text-lg leading-7">
        Choose a section. If it has no teacher, assigning someone starts today and does not create a handoff report.
        Older assignments and reports stay as they are. If it has a teacher, ending that assignment prepares one
        handoff. {blankHint} If the assignment started today, the outgoing teacher keeps the section until that UTC
        day is over. A teacher who was switched off from this section today cannot take it again until the next UTC day.
      </p>
      {sections.length === 0 ? <p className="text-lg">No sections yet.</p> : null}
      {selected ? (
        <>
          <label className={labelClass}>
            Section
            <select
              className="min-h-12 w-full rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg"
              value={selected.id}
              onChange={(event) => chooseSection(event.target.value)}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {sectionAssignmentLabel(
                    section.courseTitle,
                    section.sectionName,
                    section.currentTeachers.length,
                    section.centerCode,
                  )}
                </option>
              ))}
            </select>
          </label>
          {selected.currentTeachers.length === 0 ? (
            <form key={selected.id} action={assignUnstaffedSectionAction} className="flex flex-col gap-3">
              <p className="text-lg">No current teacher</p>
              {incoming.length === 0 ? (
                <p className="text-lg">This centre has no active teacher to assign.</p>
              ) : (
                <>
                  <label className={labelClass}>
                    Incoming teacher
                    <select className="min-h-12 w-full rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg" name="assignment" required>
                      {incoming.map((teacher) => (
                        <option key={teacher.id} value={`${selected.id}|${teacher.id}`}>
                          {teacher.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className={buttonClass} type="submit">
                    Assign teacher
                  </button>
                </>
              )}
            </form>
          ) : (
            <form key={`${selected.id}:${currentOutgoing}`} action={reassignSectionAction} className="flex flex-col gap-3">
              <div>
                <p className="text-lg font-medium">Current teachers</p>
                <ul className="mt-1 flex flex-col gap-1 text-lg">
                  {selected.currentTeachers.map((teacher) => (
                    <li key={teacher.id} className="break-words">{teacher.name}</li>
                  ))}
                </ul>
              </div>
              {selected.currentTeachers.length > 1 ? (
                <label className={labelClass}>
                  Outgoing teacher
                  <select
                    className="min-h-12 w-full rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg"
                    value={currentOutgoing}
                    onChange={(event) => setOutgoingId(event.target.value)}
                  >
                    {selected.currentTeachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-base font-normal leading-6">The handoff covers only the selected assignment.</span>
                </label>
              ) : (
                <p className="break-words text-lg">This transfers the assignment for {selected.currentTeachers[0]?.name}.</p>
              )}
              <input type="hidden" name="assignment" value={`${selected.id}|${currentOutgoing}`} />
              <label className={labelClass}>
                Incoming teacher
                <select className="min-h-12 w-full rounded-lg border-2 border-zinc-950 bg-white px-3 text-lg" name="incomingTeacherId" defaultValue="">
                  <option value="">{blankOptionLabel}</option>
                  {incoming.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className={buttonClass} type="submit">
                Reassign section
              </button>
            </form>
          )}
        </>
      ) : null}
    </section>
  );
}
