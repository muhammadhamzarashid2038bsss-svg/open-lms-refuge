"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CatalogNote, RecordCatalog } from "@/lib/data/record-catalog";
import { listLocalNoteViews, queueNoteViews } from "@/lib/device/note-views";
import { draftForNoteChoice, noteSaveInput, type NoteDraft } from "@/lib/device/note-draft";
import {
  decideNoteOpen,
  openedNoteFromResponse,
  viewStatusText,
  type RememberedNote,
} from "@/lib/device/note-open";
import { listLocalRecords, saveLocalGrade, saveLocalNote } from "@/lib/device/local-records";
import { SKILL_TAG_GUIDANCE } from "@/lib/lms/skill-tags";
import { SKILL_GAPS } from "@/lib/sync/record-batch";
import { syncLocalNoteViews } from "@/lib/sync/note-view-sync";
import { syncLocalRecords } from "@/lib/sync/record-sync";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

type Notice = { tone: "ok" | "error"; text: string };

const NOT_SAVED = "This edit was not saved on this phone.";
const NO_FACTORY = "This phone cannot safely keep an offline edit. This edit was not saved.";
const NOT_KEPT = "This phone could not record that the note was opened. Nothing already stored was deleted.";

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
  CUSTOM: "A center skill tag",
};

function noteOptionLabel(item: CatalogNote, index: number): string {
  const names = item.skillGaps.map((gap) => (gap in skillLabel ? skillLabel[gap as (typeof SKILL_GAPS)[number]] : "Skill"));
  const tag = item.customSkillTagName ? ` · ${item.customSkillTagName}` : "";
  const text = names.length > 0 ? `${names.join(", ")}${tag}` : "Saved note";
  return `${text} (${index + 1})`;
}

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
  const [customSkillTagId, setCustomSkillTagId] = useState("");
  const [legacyCustomLabel, setLegacyCustomLabel] = useState("");
  const [noteId, setNoteId] = useState("");
  const [gradeNotice, setGradeNotice] = useState<Notice | null>(null);
  const [noteNotice, setNoteNotice] = useState<Notice | null>(null);
  const [sendNotice, setSendNotice] = useState<Notice | null>(null);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [viewStatus, setViewStatus] = useState<"pending" | "acknowledged" | "rejected" | null>(null);
  const gradeNoticeRef = useRef<HTMLParagraphElement>(null);
  const noteNoticeRef = useRef<HTMLParagraphElement>(null);
  const sendNoticeRef = useRef<HTMLParagraphElement>(null);
  // Text from notes opened during this visit. A reload clears it. It is not
  // written to the phone database. A re-render does not open a note again.
  const openedNotes = useRef(new Map<string, RememberedNote>());
  const openTicket = useRef(0);
  const viewEventRef = useRef("");
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

  function showDraft(draft: NoteDraft) {
    setNoteId(draft.noteId);
    setBody(draft.body);
    setGaps(draft.skillGaps);
    setCustomSkillTagId(draft.customSkillTagId);
    setLegacyCustomLabel(draft.legacyCustomLabel);
  }

  function applyOpened(note: RememberedNote) {
    setBody(note.body);
    setGaps([...note.skillGaps]);
    setCustomSkillTagId(note.customSkillTagId);
    setLegacyCustomLabel(note.legacyCustomLabel);
  }

  // Runs from the dropdown change, not from rendering. One change asks for
  // one note. A later change is a separate opening and may use a new event id.
  async function openSelected(choiceId: string) {
    const ticket = ++openTicket.current;
    viewEventRef.current = "";
    setViewStatus(null);
    if (!choiceId) {
      showDraft(draftForNoteChoice("", []));
      setNoteNotice(null);
      return;
    }
    const listed = notesFor(section?.id ?? "", learnerId).find((item) => item.id === choiceId);
    const listedDraft = draftForNoteChoice(choiceId, listed ? [listed] : []);
    setNoteId(choiceId);
    setBody("");
    setLegacyCustomLabel("");
    setGaps(listedDraft.skillGaps);
    setCustomSkillTagId(listedDraft.customSkillTagId);
    setNoteNotice(null);

    let reachedServer = true;
    let httpStatus: number | null = null;
    let opened: RememberedNote | null = null;
    try {
      const response = await fetch(`/api/notes/${choiceId}`, { headers: { accept: "application/json" } });
      httpStatus = response.status;
      if (response.ok) opened = openedNoteFromResponse(await response.json(), listedDraft.customSkillTagId);
    } catch {
      reachedServer = false;
    }
    if (ticket !== openTicket.current) return;

    const decision = decideNoteOpen({
      reachedServer,
      httpStatus,
      opened,
      remembered: openedNotes.current.get(choiceId) ?? null,
    });
    if (decision.kind === "unavailable" && decision.forget) openedNotes.current.delete(choiceId);
    if (decision.kind === "online") {
      openedNotes.current.set(choiceId, decision.note);
      applyOpened(decision.note);
      return;
    }
    if (decision.kind === "unavailable") {
      setBody("");
      setLegacyCustomLabel("");
      setNoteNotice({ tone: "error", text: decision.message });
      return;
    }

    const factory = browserFactory();
    if (!factory) {
      setBody("");
      setLegacyCustomLabel("");
      setNoteNotice({ tone: "error", text: NOT_KEPT });
      return;
    }
    const queued = await queueNoteViews(factory, owner, [choiceId]);
    if (ticket !== openTicket.current) return;
    if (!queued.ok || !queued.events[0]) {
      setBody("");
      setLegacyCustomLabel("");
      setNoteNotice({ tone: "error", text: queued.ok ? NOT_KEPT : queued.message });
      return;
    }
    viewEventRef.current = queued.events[0].clientEventId;
    applyOpened(decision.note);
    setViewStatus("pending");
    setNoteNotice({ tone: "ok", text: queued.message });
  }

  function keepOrClearNote(nextSectionId: string, nextLearnerId: string) {
    const visible = notesFor(nextSectionId, nextLearnerId);
    if (visible.some((item) => item.id === noteId)) return;
    void openSelected("");
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
            onChange={(event) => {
              void openSelected(event.target.value);
            }}
          >
            <option value="">New note</option>
            {notesFor(section?.id ?? "", learnerId).map((item, index) => (
              <option key={item.id} value={item.id}>
                {noteOptionLabel(item, index)}
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
        {gaps.includes("CUSTOM") ? (
          <label className={labelClass}>
            Center skill tag
            <select className={inputClass} value={customSkillTagId} onChange={(event) => setCustomSkillTagId(event.target.value)}>
              <option value="">Choose a skill tag</option>
              {catalog.skillTags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {legacyCustomLabel ? <p className="text-lg">Earlier custom label on this note: {legacyCustomLabel}</p> : null}
        <p className="text-base">{SKILL_TAG_GUIDANCE}</p>
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
                { noteId, body, skillGaps: gaps, customSkillTagId, legacyCustomLabel },
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
        {viewStatus ? (
          <p data-view-status={viewStatus} className="text-lg font-medium">
            {viewStatusText(viewStatus)}
          </p>
        ) : null}
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
              const views = await syncLocalNoteViews({ factory, account: owner });
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
              const currentEvent = viewEventRef.current;
              if (currentEvent) {
                const listedViews = await listLocalNoteViews(factory, owner);
                const match = listedViews.ok ? listedViews.events.find((event) => event.clientEventId === currentEvent) : undefined;
                if (match) setViewStatus(match.syncState);
              }
              if (!views.ok || currentEvent) text = `${text} ${views.message}`;
              setSendNotice({ tone: result.ok && views.ok ? "ok" : "error", text });
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
