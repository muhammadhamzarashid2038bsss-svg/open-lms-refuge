"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CatalogNote, RecordCatalog } from "@/lib/data/record-catalog";
import { draftForNoteChoice, noteSaveInput, type NoteDraft } from "@/lib/device/note-draft";
import { listLocalRecords, saveLocalGrade, saveLocalNote } from "@/lib/device/local-records";
import { SKILL_GAPS } from "@/lib/sync/record-batch";
import { syncLocalRecords } from "@/lib/sync/record-sync";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

type Notice = { tone: "ok" | "error"; text: string };

const NOT_SAVED = "This edit was not saved on this phone.";
const NO_FACTORY = "This phone cannot safely keep an offline edit. This edit was not saved.";

function ResultLine({ notice, noticeRef }: { notice: Notice | null; noticeRef: RefObject<HTMLParagraphElement | null> }) {
  if (!notice) return null;
  return (
    <p ref={noticeRef} role={notice.tone === "error" ? "alert" : "status"} className="text-lg font-medium">
      {notice.text}
    </p>
  );
}

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
  const [gradeNotice, setGradeNotice] = useState<Notice | null>(null);
  const [noteNotice, setNoteNotice] = useState<Notice | null>(null);
  const [sendNotice, setSendNotice] = useState<Notice | null>(null);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const gradeNoticeRef = useRef<HTMLParagraphElement>(null);
  const noteNoticeRef = useRef<HTMLParagraphElement>(null);
  const sendNoticeRef = useRef<HTMLParagraphElement>(null);
  const owner = useMemo(() => ({ centerId, userId }), [centerId, userId]);

  // The result used to render after the other form. On a phone that leaves
  // it below the visible screen, so a tap looked like a frozen button.
  useEffect(() => {
    gradeNoticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [gradeNotice]);
  useEffect(() => {
    noteNoticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [noteNotice]);
  useEffect(() => {
    sendNoticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [sendNotice]);

  const grade = catalog.grades.find((item) => item.assignmentId === assignmentId && item.learnerId === learnerId);
  const note = catalog.notes.find((item) => item.id === noteId);

  function notesFor(nextSectionId: string, nextLearnerId: string): CatalogNote[] {
    return catalog.notes.filter((item) => item.sectionId === nextSectionId && item.learnerId === nextLearnerId);
  }

  function showNote(draft: NoteDraft) {
    setNoteId(draft.noteId);
    setBody(draft.body);
    setGaps(draft.skillGaps);
    setCustomLabel(draft.customSkillLabel);
  }

  function keepOrClearNote(nextSectionId: string, nextLearnerId: string) {
    const visible = notesFor(nextSectionId, nextLearnerId);
    if (visible.some((item) => item.id === noteId)) return;
    showNote(draftForNoteChoice("", visible));
  }

  function browserFactory(): IDBFactory | null {
    return globalThis.indexedDB ?? null;
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
              const nextLearnerId = next?.learners[0]?.id ?? "";
              setSectionId(event.target.value);
              setAssignmentId(next?.assignments[0]?.id ?? "");
              setLearnerId(nextLearnerId);
              keepOrClearNote(event.target.value, nextLearnerId);
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
          <select
            className={inputClass}
            value={learnerId}
            onChange={(event) => {
              setLearnerId(event.target.value);
              keepOrClearNote(section?.id ?? "", event.target.value);
            }}
          >
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
          disabled={gradeBusy}
          onClick={() => {
            const factory = browserFactory();
            if (!factory || !section) {
              setGradeNotice({ tone: "error", text: factory ? NOT_SAVED : NO_FACTORY });
              return;
            }
            setGradeBusy(true);
            setGradeNotice(null);
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
            )
              .then((result) => {
                setGradeNotice({ tone: result.ok ? "ok" : "error", text: result.message });
              })
              .catch(() => {
                setGradeNotice({ tone: "error", text: NOT_SAVED });
              })
              .finally(() => {
                setGradeBusy(false);
              });
          }}
        >
          {gradeBusy ? "Saving…" : "Save grade on this phone"}
        </button>
        <ResultLine notice={gradeNotice} noticeRef={gradeNoticeRef} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Save a progress note on this phone</h2>
        <label className={labelClass}>
          Existing note
          <select
            className={inputClass}
            value={noteId}
            onChange={(event) => showNote(draftForNoteChoice(event.target.value, notesFor(section?.id ?? "", learnerId)))}
          >
            <option value="">New note</option>
            {notesFor(section?.id ?? "", learnerId).map((item) => (
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
          disabled={noteBusy}
          onClick={() => {
            const factory = browserFactory();
            if (!factory || !section) {
              setNoteNotice({ tone: "error", text: factory ? NOT_SAVED : NO_FACTORY });
              return;
            }
            setNoteBusy(true);
            setNoteNotice(null);
            void saveLocalNote(
              factory,
              owner,
              noteSaveInput(
                { noteId, body, skillGaps: gaps, customSkillLabel: customLabel },
                section.id,
                learnerId,
                note?.versionVector,
              ),
            )
              .then((result) => {
                setNoteNotice({ tone: result.ok ? "ok" : "error", text: result.message });
              })
              .catch(() => {
                setNoteNotice({ tone: "error", text: NOT_SAVED });
              })
              .finally(() => {
                setNoteBusy(false);
              });
          }}
        >
          {noteBusy ? "Saving…" : "Save note on this phone"}
        </button>
        <ResultLine notice={noteNotice} noticeRef={noteNoticeRef} />
      </section>

      <button
        className={secondaryButtonClass}
        type="button"
        disabled={sendBusy}
        onClick={() => {
          const factory = browserFactory();
          if (!factory) {
            setSendNotice({ tone: "error", text: NO_FACTORY });
            return;
          }
          setSendBusy(true);
          setSendNotice(null);
          void syncLocalRecords({ factory, account: owner })
            .then(async (result) => {
              let text = result.message;
              const listed = await listLocalRecords(factory, owner);
              if (listed.ok) {
                const waiting = listed.mutations.filter((item) => item.syncState === "pending").length;
                if (waiting > 0 && result.ok) {
                  text = `${result.message} ${waiting} edit${waiting === 1 ? " is" : "s are"} still waiting on this phone.`;
                }
                if (waiting > 0 && !result.ok) {
                  text = result.message || `${waiting} edit${waiting === 1 ? " is" : "s are"} still waiting on this phone.`;
                }
              }
              setSendNotice({ tone: result.ok ? "ok" : "error", text });
            })
            .catch(() => {
              setSendNotice({ tone: "error", text: "The saved edits were not sent." });
            })
            .finally(() => {
              setSendBusy(false);
            });
        }}
      >
        {sendBusy ? "Sending…" : "Send saved edits"}
      </button>
      <ResultLine notice={sendNotice} noticeRef={sendNoticeRef} />
    </div>
  );
}
