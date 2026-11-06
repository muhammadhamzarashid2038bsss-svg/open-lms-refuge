"use client";

import { useActionState, useState } from "react";
import { createTimetableAction, updateTimetableAction } from "@/app/actions/timetable";
import type { FormState } from "@/app/actions/courses";
import { DELIVERY_MODES, WEEKDAYS, deliveryLabel, weekdayLabel } from "@/lib/lms/timetable";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

const initial: FormState = {};

type ResourceOption = { id: string; title: string };

function SessionFields({
  title,
  weekday,
  startTime,
  endTime,
  deliveryMode,
  meetingUrl,
  linkedResourceId,
  resources,
  onMode,
}: {
  title?: string;
  weekday?: string;
  startTime?: string;
  endTime?: string;
  deliveryMode: string;
  meetingUrl?: string;
  linkedResourceId?: string;
  resources: ResourceOption[];
  onMode: (mode: string) => void;
}) {
  return (
    <>
      <label className={labelClass}>
        Class name
        <input className={inputClass} name="title" required minLength={2} maxLength={80} defaultValue={title} />
      </label>
      <label className={labelClass}>
        Day
        <select className={inputClass} name="weekday" defaultValue={weekday ?? "MONDAY"} required>
          {WEEKDAYS.map((day) => (
            <option key={day} value={day}>
              {weekdayLabel(day)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Start time
        <input className={inputClass} name="startTime" type="time" required defaultValue={startTime ?? "09:00"} />
      </label>
      <label className={labelClass}>
        End time
        <input className={inputClass} name="endTime" type="time" required defaultValue={endTime ?? "10:00"} />
      </label>
      <label className={labelClass}>
        Class type
        <select
          className={inputClass}
          name="deliveryMode"
          value={deliveryMode}
          onChange={(event) => onMode(event.target.value)}
        >
          {DELIVERY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {deliveryLabel(mode)}
            </option>
          ))}
        </select>
      </label>
      {deliveryMode === "LIVE_ONLINE" ? (
        <label className={labelClass}>
          Meeting link
          <input
            className={inputClass}
            name="meetingUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
            placeholder="https://meet.google.com/…"
            defaultValue={meetingUrl}
          />
        </label>
      ) : null}
      <label className={labelClass}>
        Lesson or audio
        <select
          className={inputClass}
          name="linkedResourceId"
          defaultValue={linkedResourceId ?? ""}
          required={deliveryMode === "PRE_RECORDED"}
        >
          <option value="">None</option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.title}
            </option>
          ))}
        </select>
      </label>
      <p className="text-base leading-6 text-zinc-700">
        Pre-recorded classes need a lesson or audio that is already on this course. Live classes need a Google Meet,
        Zoom, or Jitsi link.
      </p>
    </>
  );
}

export function AddSessionForm({
  sectionId,
  weekOf,
  resources,
}: {
  sectionId: string;
  weekOf: string;
  resources: ResourceOption[];
}) {
  const [state, action, pending] = useActionState(createTimetableAction, initial);
  const [deliveryMode, setDeliveryMode] = useState("IN_PERSON");
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">Add a class</h2>
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="weekOf" value={weekOf} />
      <SessionFields deliveryMode={deliveryMode} resources={resources} onMode={setDeliveryMode} />
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add class"}
      </button>
    </form>
  );
}

export function EditSessionForm({
  sectionId,
  weekOf,
  resources,
  session,
}: {
  sectionId: string;
  weekOf: string;
  resources: ResourceOption[];
  session: {
    id: string;
    title: string;
    weekday: string;
    startTime: string;
    endTime: string;
    deliveryMode: string;
    status: string;
    meetingUrl: string;
    linkedResourceId: string;
    canDelete: boolean;
  };
}) {
  const [state, action, pending] = useActionState(updateTimetableAction, initial);
  const [deliveryMode, setDeliveryMode] = useState(session.deliveryMode);
  return (
    <details className="mt-3">
      <summary className="min-h-12 cursor-pointer text-lg font-medium underline">Change this class</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="sectionId" value={sectionId} />
        <input type="hidden" name="sessionId" value={session.id} />
        <input type="hidden" name="weekOf" value={weekOf} />
        <SessionFields
          title={session.title}
          weekday={session.weekday}
          startTime={session.startTime}
          endTime={session.endTime}
          deliveryMode={deliveryMode}
          meetingUrl={session.meetingUrl}
          linkedResourceId={session.linkedResourceId}
          resources={resources}
          onMode={setDeliveryMode}
        />
        {state.error ? (
          <p role="alert" className="text-lg font-medium">
            {state.error}
          </p>
        ) : null}
        <button className={buttonClass} type="submit" name="intent" value="save" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        {session.status === "CANCELLED" ? (
          <button className={secondaryButtonClass} type="submit" name="intent" value="restore" disabled={pending}>
            Put this class back
          </button>
        ) : (
          <button className={secondaryButtonClass} type="submit" name="intent" value="cancel" disabled={pending}>
            Cancel this class
          </button>
        )}
        {session.canDelete ? (
          <button className={secondaryButtonClass} type="submit" name="intent" value="delete" disabled={pending}>
            Remove this class
          </button>
        ) : (
          <p className="text-base leading-6 text-zinc-700">
            This class already has attendance, so it stays on record. You can cancel it.
          </p>
        )}
      </form>
    </details>
  );
}
