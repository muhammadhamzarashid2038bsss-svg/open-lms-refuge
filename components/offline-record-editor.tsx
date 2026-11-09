"use client";

import { useMemo, useState } from "react";
import type { RecordCatalog } from "@/lib/data/record-catalog";
import { listLocalRecords, saveLocalGrade, saveLocalNote } from "@/lib/device/local-records";
import { SKILL_GAPS } from "@/lib/sync/record-batch";
import { syncLocalRecords } from "@/lib/sync/record-sync";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

const skillLabel: Record<(typeof SKILL_GAPS)[number], string> = {
  READING: "Reading",
  WRITING: "Writing",
  SPEAKING: "Speaking",
  NUMBER_SENSE: "Number sense",
  CUSTOM: "A short custom label",
};

export function OfflineRecordEditor({
  centerId,
  userId,
  catalog,
}: {
  centerId: string;
  userId: string;
  catalog: RecordCatalog;
}) {
  const [sectionId, setSectionId] = useState(catalog.sections[0]?.id ?? "");
  const section = catalog.sections.find((item) => item.id === sectionId) ?? catalog.sections[0];
  const [assignmentId, setAssignmentId] = useState(section?.assignments[0]?.id ?? "");
  const [learnerId, setLearnerId] = useState(section?.learners[0]?.id ?? "");
  const [points, setPoints] = useState("");
  const [academicNote, setAcademicNote] = useState("");
  const [body, setBody] = useState("");
  const [gaps, setGaps] = useState<string[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [noteId, setNoteId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const owner = useMemo(() => ({ centerId, userId }), [centerId, userId]);

  const grade = catalog.grades.find((item) => item.assignmentId === assignmentId && item.learnerId === learnerId);
  const note = catalog.notes.find((item) => item.id === noteId);

  function factoryOrError(): IDBFactory | null {
    const factory = globalThis.indexedDB;
    if (!factory) {
      setError("This phone cannot safely keep an offline edit. This edit was not saved.");
      setMessage("");
      return null;
    }
    return factory;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Save a grade on this phone</h2>
        <label className={labelClass}>
          Section
          <select
            className={inputClass}
            value={section?.id ?? ""}
            onChange={(event) => {
              const next = catalog.sections.find((item) => item.id === event.target.value);
              setSectionId(event.target.value);
              setAssignmentId(next?.assignments[0]?.id ?? "");
              setLearnerId(next?.learners[0]?.id ?? "");
            }}
          >
            {catalog.sections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Assignment
          <select className={inputClass} value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>
            {(section?.assignments ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} (maximum {item.maxPoints})
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Learner
          <select className={inputClass} value={learnerId} onChange={(event) => setLearnerId(event.target.value)}>
            {(section?.learners ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.learnerCode} · {item.displayName}
              </option>
            ))}
          </select>
        </label>
        {grade?.provisional ? (
          <p className="text-lg font-medium">The grade on the server is provisional until the open conflict is resolved.</p>
        ) : null}
        {grade ? <p className="text-lg">Current mark on the server: {grade.points}</p> : <p className="text-lg">No mark is on the server yet.</p>}
        <label className={labelClass}>
          Points
          <input className={inputClass} value={points} onChange={(event) => setPoints(event.target.value)} inputMode="decimal" />
        </label>
        <label className={labelClass}>
          Academic note
          <input className={inputClass} value={academicNote} onChange={(event) => setAcademicNote(event.target.value)} maxLength={500} />
        </label>
        <button
          className={buttonClass}
          type="button"
          onClick={() => {
            const factory = factoryOrError();
            if (!factory || !section) return;
            void saveLocalGrade(
              factory,
              owner,
              {
                assignmentId,
                learnerId,
                points,
                academicNote: academicNote.length > 0 ? academicNote : null,
                recordId: grade?.id ?? null,
                baseVector: grade?.versionVector ?? {},
              },
            ).then((result) => {
              if (result.ok) {
                setMessage(result.message);
                setError("");
              } else {
                setError(result.message);
                setMessage("");
              }
            });
          }}
        >
          Save grade on this phone
        </button>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Save a progress note on this phone</h2>
        <label className={labelClass}>
          Existing note
          <select className={inputClass} value={noteId} onChange={(event) => setNoteId(event.target.value)}>
            <option value="">New note</option>
            {catalog.notes
              .filter((item) => item.sectionId === section?.id && item.learnerId === learnerId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.body.slice(0, 60)}
                </option>
              ))}
          </select>
        </label>
        {note?.provisional ? (
          <p className="text-lg font-medium">This note is provisional until the open conflict is resolved.</p>
        ) : null}
        <label className={labelClass}>
          Note
          <textarea className={inputClass} value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={4} />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-medium">Skill gaps</legend>
          {SKILL_GAPS.map((gap) => (
            <label key={gap} className="flex min-h-12 items-center gap-3 text-lg">
              <input
                type="checkbox"
                checked={gaps.includes(gap)}
                onChange={(event) => {
                  setGaps((current) => (event.target.checked ? [...current, gap] : current.filter((item) => item !== gap)));
                }}
              />
              {skillLabel[gap]}
            </label>
          ))}
        </fieldset>
        <label className={labelClass}>
          Custom label
          <input className={inputClass} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} maxLength={80} />
        </label>
        <button
          className={buttonClass}
          type="button"
          onClick={() => {
            const factory = factoryOrError();
            if (!factory || !section) return;
            void saveLocalNote(factory, owner, {
              sectionId: section.id,
              learnerId,
              body,
              skillGaps: gaps,
              customSkillLabel: customLabel.length > 0 ? customLabel : null,
              recordId: note?.id ?? null,
              baseVector: note?.versionVector ?? {},
            }).then((result) => {
              if (result.ok) {
                setMessage(result.message);
                setError("");
              } else {
                setError(result.message);
                setMessage("");
              }
            });
          }}
        >
          Save note on this phone
        </button>
      </section>

      {error ? (
        <p role="alert" className="text-lg font-medium">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-lg font-medium">{message}</p> : null}
      <button
        className={secondaryButtonClass}
        type="button"
        onClick={() => {
          const factory = factoryOrError();
          if (!factory) return;
          void syncLocalRecords({ factory, account: owner }).then(async (result) => {
            if (result.ok) {
              setMessage(result.message);
              setError("");
            } else {
              setError(result.message);
              setMessage("");
            }
            const listed = await listLocalRecords(factory, owner);
            if (listed.ok) {
              const waiting = listed.mutations.filter((item) => item.syncState === "pending").length;
              if (waiting > 0) setError((current) => current || `${waiting} edit${waiting === 1 ? " is" : "s are"} still waiting on this phone.`);
            }
          });
        }}
      >
        Send saved edits
      </button>
    </div>
  );
}
