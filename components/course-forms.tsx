"use client";

import { useActionState, useState } from "react";
import {
  createCourseAction,
  createResourceAction,
  createSectionAction,
  deleteResourceAction,
  type FormState,
} from "@/app/actions/courses";
import { RESOURCE_TYPES, resourceTypeLabel } from "@/lib/lms/resources";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

const initial: FormState = {};

export function CreateCourseForm({ defaultYear }: { defaultYear: number }) {
  const [state, action, pending] = useActionState(createCourseAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">New course</h2>
      <label className={labelClass}>
        Course name
        <input className={inputClass} name="title" required minLength={3} />
      </label>
      <label className={labelClass}>
        Short code
        <input className={inputClass} name="code" required minLength={2} maxLength={12} placeholder="ENG-101" />
      </label>
      <label className={labelClass}>
        Academic year
        <input className={inputClass} name="academicYear" type="number" required defaultValue={defaultYear} />
      </label>
      <label className={labelClass}>
        Semester
        <select className={inputClass} name="semester" defaultValue="SEMESTER_1">
          <option value="SEMESTER_1">Semester 1</option>
          <option value="SEMESTER_2">Semester 2</option>
        </select>
      </label>
      <label className={labelClass}>
        Short summary (optional)
        <input className={inputClass} name="summary" maxLength={500} />
      </label>
      <label className={labelClass}>
        First section name
        <input className={inputClass} name="firstSectionName" placeholder="Morning Group" />
      </label>
      <p className="text-base leading-6 text-zinc-700">
        If you are a teacher, add at least one section so you stay assigned to the course you create.
      </p>
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Create course"}
      </button>
    </form>
  );
}

export function AddSectionForm({ courseId }: { courseId: string }) {
  return (
    <form action={createSectionAction} className="flex flex-col gap-3 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">Add section</h2>
      <input type="hidden" name="courseId" value={courseId} />
      <label className={labelClass}>
        Section name
        <input className={inputClass} name="name" required minLength={2} />
      </label>
      <button className={secondaryButtonClass} type="submit">
        Add section
      </button>
    </form>
  );
}

export function AddResourceForm({
  courseId,
  sections,
}: {
  courseId: string;
  sections: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createResourceAction, initial);
  const [resourceType, setResourceType] = useState<string>("WEB_LINK");
  const linkType = resourceType !== "TEXT";
  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">Add material</h2>
      <input type="hidden" name="courseId" value={courseId} />
      <label className={labelClass}>
        Title
        <input className={inputClass} name="title" required minLength={3} />
      </label>
      <label className={labelClass}>
        Type
        <select
          className={inputClass}
          name="resourceType"
          value={resourceType}
          onChange={(event) => setResourceType(event.target.value)}
        >
          {RESOURCE_TYPES.filter((type) => type !== "PDF" && type !== "AUDIO").map((type) => (
            <option key={type} value={type}>
              {resourceTypeLabel(type)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Section (leave blank for whole course)
        <select className={inputClass} name="sectionId" defaultValue="">
          <option value="">Whole course</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
      </label>
      {linkType ? (
        <label className={labelClass}>
          Link (https)
          <input className={inputClass} name="externalUrl" type="url" placeholder="https://example.com/lesson" />
        </label>
      ) : (
        <label className={labelClass}>
          Reading-list text
          <textarea className={`${inputClass} min-h-28 py-2`} name="bodyText" rows={4} required minLength={8} />
        </label>
      )}
      <p className="text-base leading-6 text-zinc-700">
        PDF and audio files are registered after the office laptop upload step. The demo seed already includes sample
        files.
      </p>
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add material"}
      </button>
    </form>
  );
}

export function RemoveResourceForm({ courseId, resourceId }: { courseId: string; resourceId: string }) {
  return (
    <form action={deleteResourceAction}>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <button className="min-h-12 w-full rounded-lg border-2 border-zinc-400 px-4 text-lg text-zinc-800" type="submit">
        Remove
      </button>
    </form>
  );
}
