"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import type { GradebookView } from "@/lib/data/assignments";
import { listLocalRecords, type LocalRecordMutation } from "@/lib/device/local-records";
import { saveGradebookMarks } from "@/lib/device/gradebook-save";
import {
  assignmentKindLabel,
  assignmentKindNote,
  fileStatusLabel,
  acknowledgedAfterSend,
  gradebookCell,
  gradeCellBaseline,
  gradeEditingAllowed,
  gradeEntryState,
  pendingGradeForCell,
  planGradebookSaves,
  showsFileStatus,
  type GradebookCellInput,
  type GradePhoneRead,
  type GradePhoneScope,
  type PendingGrade,
} from "@/lib/lms/gradebook";
import { canonicalPoints } from "@/lib/sync/record-batch";
import { syncLocalRecords } from "@/lib/sync/record-sync";
import { buttonClass, secondaryButtonClass } from "./ui";

type Notice = { tone: "ok" | "error"; text: string };
type PhoneSnapshot = { deviceId: string | null; mutations: LocalRecordMutation[] };

const NOT_SAVED = "This edit was not saved on this phone.";
const NO_FACTORY = "This phone cannot safely keep an offline edit. This edit was not saved.";
const EDITING_LOADING = "Checking marks saved on this phone. Editing stays off until that check finishes.";
const EDITING_UNSAFE = "Grade editing is unavailable because the marks saved on this phone could not be safely read.";
const inputClass =
  "min-h-12 w-full max-w-xs rounded-lg border-2 border-zinc-950 bg-white px-2 text-lg focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-zinc-950";

function ResultLine({ notice, noticeRef }: { notice: Notice | null; noticeRef: RefObject<HTMLParagraphElement | null> }) {
  if (!notice) return null;
  return (
    <p ref={noticeRef} role={notice.tone === "error" ? "alert" : "status"} className="text-lg font-medium">
      {notice.text}
    </p>
  );
}

function cellKey(assignmentId: string, learnerId: string): string {
  return `${assignmentId}-${learnerId}`;
}

function statusWords(status: "phone" | "unsaved" | "acknowledged" | "server"): string | null {
  if (status === "phone") return "On this phone";
  if (status === "unsaved") return "Not saved yet";
  if (status === "acknowledged") return "On the server";
  return null;
}

export function SectionGradebook({
  centerId,
  userId,
  book,
  initialPhone,
  localRead,
  initialConfirmed,
}: {
  centerId: string;
  userId: string;
  book: GradebookView;
  /// Already-read phone rows. The page does not pass this. Tests do, so a
  /// reload can be shown without opening a database during render.
  initialPhone?: PhoneSnapshot;
  /// Forces one read outcome. The page does not pass this.
  localRead?: GradePhoneRead;
  /// Grades this visit already sent and the server accepted. A reload does not pass this.
  initialConfirmed?: Record<string, PendingGrade>;
}) {
  const owner = useMemo(() => ({ centerId, userId }), [centerId, userId]);
  const [entered, setEntered] = useState<Record<string, string>>({});
  // Accepted during this visit only. A reload leaves this empty so the server copy leads.
  const [confirmed, setConfirmed] = useState<Record<string, PendingGrade>>(initialConfirmed ?? {});
  const [phone, setPhone] = useState<PhoneSnapshot | null>(initialPhone ?? null);
  const [phoneRead, setPhoneRead] = useState<GradePhoneRead>(localRead ?? (initialPhone ? "ready" : "loading"));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sendNotice, setSendNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const sendNoticeRef = useRef<HTMLParagraphElement>(null);

  const assignmentIds = useMemo(
    () => new Set(book.assignments.map((assignment) => assignment.id.toLowerCase())),
    [book.assignments],
  );
  const learnerIds = useMemo(() => new Set(book.learners.map((learner) => learner.id.toLowerCase())), [book.learners]);

  function scopeFor(deviceId: string | null): GradePhoneScope {
    return { centerId, userId, deviceId, assignmentIds, learnerIds };
  }

  useEffect(() => {
    noticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);
  useEffect(() => {
    sendNoticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [sendNotice]);

  useEffect(() => {
    // Reading the phone must not save or send. A missing or failed read is not
    // an empty list. Editing stays off so a hidden waiting mark is not replaced.
    if (localRead || initialPhone) return;
    let stop = false;
    const factory = globalThis.indexedDB;
    if (!factory) {
      // The first render stays "loading" on the server and the phone. The
      // missing-database result is applied after that render so the two match.
      void Promise.resolve().then(() => {
        if (!stop) setPhoneRead("unavailable");
      });
      return () => {
        stop = true;
      };
    }
    void listLocalRecords(factory, owner).then((listed) => {
      if (stop) return;
      if (!listed.ok) {
        setPhoneRead("failed");
        return;
      }
      setPhone({ deviceId: listed.deviceId, mutations: listed.mutations });
      setPhoneRead("ready");
    });
    return () => {
      stop = true;
    };
  }, [initialPhone, localRead, owner]);

  function browserFactory(): IDBFactory | null {
    return globalThis.indexedDB ?? null;
  }

  const editing = gradeEditingAllowed(phoneRead);
  const shownPhone = editing ? phone : null;

  function pendingFor(assignmentId: string, learnerId: string, snapshot: PhoneSnapshot | null) {
    return pendingGradeForCell(scopeFor(snapshot?.deviceId ?? null), assignmentId, learnerId, snapshot?.mutations ?? []);
  }

  function storedBaseline(assignmentId: string, learnerId: string, snapshot: PhoneSnapshot | null, marks: Record<string, PendingGrade>) {
    const grade = gradebookCell(book.grades, assignmentId, learnerId);
    const pending = grade?.provisional ? null : pendingFor(assignmentId, learnerId, snapshot);
    return gradeCellBaseline({
      pending,
      acknowledged: grade?.provisional ? null : (marks[cellKey(assignmentId, learnerId)] ?? null),
      server: grade && !grade.provisional ? grade : null,
    });
  }

  function rememberPhone(snapshot: PhoneSnapshot, marks: Record<string, PendingGrade>) {
    setPhone(snapshot);
    setConfirmed(marks);
    setEntered((previous) => {
      const next: Record<string, string> = {};
      for (const learner of book.learners) {
        for (const assignment of book.assignments) {
          const key = cellKey(assignment.id, learner.id);
          if (!(key in previous)) continue;
          const baseline = storedBaseline(assignment.id, learner.id, snapshot, marks);
          const typed = canonicalPoints(previous[key].trim());
          const stored = baseline.currentPoints ? canonicalPoints(baseline.currentPoints) : null;
          if (typed && typed === stored) continue;
          if (!previous[key].trim() && !baseline.currentPoints) continue;
          next[key] = previous[key];
        }
      }
      return next;
    });
  }

  async function openDownload(submissionId: string) {
    const response = await fetch(`/api/submissions/${submissionId}/download`, { method: "POST", cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { downloadUrl?: unknown; error?: unknown } | null;
    const url = typeof body?.downloadUrl === "string" ? body.downloadUrl : "";
    if (!response.ok || !url) {
      setNotice({ tone: "error", text: typeof body?.error === "string" ? body.error : "This file could not be opened." });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function fileLine(assignmentId: string, learnerId: string, kind: string) {
    if (!showsFileStatus(kind)) return null;
    const file = book.files.find((item) => item.assignmentId === assignmentId && item.learnerId === learnerId);
    if (!file) return null;
    return (
      <div className="mt-2">
        <p className="text-base">{fileStatusLabel(file.status)}</p>
        {file.status === "submitted" && file.submissionId ? (
          <button className="underline" type="button" onClick={() => void openDownload(file.submissionId ?? "")}>
            Open file
          </button>
        ) : null}
      </div>
    );
  }

  function dirtyCells(): GradebookCellInput[] {
    const rows: GradebookCellInput[] = [];
    for (const learner of book.learners) {
      for (const assignment of book.assignments) {
        const key = cellKey(assignment.id, learner.id);
        // A waiting mark is shown after reload. It is not a new edit unless
        // the teacher changes the box during this visit.
        if (!(key in entered)) continue;
        const grade = gradebookCell(book.grades, assignment.id, learner.id);
        if (grade?.provisional) continue;
        const baseline = storedBaseline(assignment.id, learner.id, shownPhone, confirmed);
        rows.push({
          assignmentId: assignment.id,
          learnerId: learner.id,
          kind: assignment.kind,
          maxPoints: assignment.maxPoints,
          entered: entered[key] ?? "",
          currentPoints: baseline.currentPoints,
          academicNote: baseline.academicNote,
          recordId: baseline.recordId,
          baseVector: baseline.baseVector,
        });
      }
    }
    return rows;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg">
        <Link className="underline" href="/teacher/records">
          Academic notes and progress notes
        </Link>
      </p>
      {phoneRead === "loading" ? <p className="text-lg">{EDITING_LOADING}</p> : null}
      {phoneRead === "unavailable" || phoneRead === "failed" ? <p className="text-lg">{EDITING_UNSAFE}</p> : null}
      {book.assignments.length === 0 ? (
        <p className="text-lg">This section has no assignment yet. Add one below.</p>
      ) : null}
      {book.learners.length === 0 ? <p className="text-lg">No learner is enrolled in this section.</p> : null}
      {book.assignments.length > 0 && book.learners.length > 0 ? (
        <>
          <p className="text-base leading-6 text-zinc-700">
            An empty box means no mark yet. Save keeps the marks on this phone. Send saved edits uses the same send as
            other grades, up to ten at a time.
          </p>
          <div className="flex flex-col gap-4" data-gradebook-layout="learners">
            {book.learners.map((learner) => (
              <section key={learner.id} aria-labelledby={`learner-${learner.id}`} className="rounded-lg border-2 border-zinc-950 bg-white p-3">
                <h2 id={`learner-${learner.id}`} className="text-2xl font-semibold leading-tight">
                  {learner.displayName}
                </h2>
                <p className="text-lg">{learner.learnerCode}</p>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {book.assignments.map((assignment) => {
                    const grade = gradebookCell(book.grades, assignment.id, learner.id);
                    const key = cellKey(assignment.id, learner.id);
                    const inputId = `mark-${key}`;
                    if (grade?.provisional) {
                      return (
                        <div key={assignment.id}>
                          <p className="text-base font-semibold">{assignment.title}</p>
                          <p className="text-base">{assignmentKindLabel(assignment.kind)}</p>
                          <p className="text-lg">{grade.points}</p>
                          <p className="text-base text-zinc-700">Waiting for a conflict choice.</p>
                          <Link className="underline" href="/teacher/conflicts">
                            Review conflicts
                          </Link>
                          {fileLine(assignment.id, learner.id, assignment.kind)}
                        </div>
                      );
                    }
                    const pending = pendingFor(assignment.id, learner.id, shownPhone);
                    const acknowledged = pending ? null : (confirmed[key] ?? null);
                    const view = gradeEntryState({
                      typed: editing && key in entered ? (entered[key] ?? "") : null,
                      pendingPoints: pending?.points ?? null,
                      acknowledgedPoints: acknowledged?.points ?? null,
                      fallbackPoints: grade?.points ?? null,
                    });
                    const words = statusWords(view.status);
                    const statusId = words ? `status-${key}` : undefined;
                    return (
                      <div key={assignment.id}>
                        <label className="flex flex-col gap-1 text-base" htmlFor={inputId}>
                          <span className="sr-only">
                            {learner.displayName}, {learner.learnerCode}.{" "}
                          </span>
                          <span className="font-semibold">{assignment.title}</span>
                          <span>
                            {assignmentKindLabel(assignment.kind)}. Maximum {assignment.maxPoints}.
                          </span>
                          <span className="text-zinc-700">{assignmentKindNote(assignment.kind)}</span>
                          <input
                            id={inputId}
                            className={inputClass}
                            inputMode="decimal"
                            value={view.display}
                            placeholder="No mark"
                            aria-describedby={statusId}
                            disabled={!editing}
                            onChange={(event) => {
                              setEntered((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }));
                            }}
                          />
                        </label>
                        {words ? (
                          <p id={statusId} className="mt-1 text-base font-semibold">
                            {words}
                          </p>
                        ) : null}
                        {fileLine(assignment.id, learner.id, assignment.kind)}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <button
            className={buttonClass}
            type="button"
            disabled={!editing || busy}
            onClick={() => {
              if (!gradeEditingAllowed(phoneRead)) {
                setNotice({ tone: "error", text: EDITING_UNSAFE });
                return;
              }
              const factory = browserFactory();
              if (!factory) {
                setNotice({ tone: "error", text: NO_FACTORY });
                return;
              }
              const planned = planGradebookSaves(dirtyCells());
              if (!planned.ok) {
                setNotice({ tone: "error", text: planned.message });
                return;
              }
              setBusy(true);
              setNotice(null);
              void saveGradebookMarks(factory, owner, planned.drafts)
                .then(async (result) => {
                  setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
                  const listed = await listLocalRecords(factory, owner);
                  if (listed.ok) rememberPhone({ deviceId: listed.deviceId, mutations: listed.mutations }, confirmed);
                })
                .catch(() => {
                  setNotice({ tone: "error", text: NOT_SAVED });
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {busy ? "Saving…" : "Save marks on this phone"}
          </button>
          <ResultLine notice={notice} noticeRef={noticeRef} />
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
              // Send reads the phone store itself. It does not use the numbers in
              // the boxes, so a teacher can send while this page is still checking.
              // The list taken first is only so an accepted mark stays visible.
              void (async () => {
                let beforeRows: LocalRecordMutation[] | null = phoneRead === "ready" && phone ? phone.mutations : null;
                if (beforeRows === null) {
                  const opened = await listLocalRecords(factory, owner);
                  if (opened.ok) beforeRows = opened.mutations;
                }
                const result = await syncLocalRecords({ factory, account: owner });
                const listed = await listLocalRecords(factory, owner);
                let text = result.message;
                if (listed.ok && beforeRows !== null) {
                  const snapshot = { deviceId: listed.deviceId, mutations: listed.mutations };
                  const marks = { ...confirmed };
                  const scope = scopeFor(snapshot.deviceId);
                  for (const learner of book.learners) {
                    for (const assignment of book.assignments) {
                      const accepted = acknowledgedAfterSend(scope, assignment.id, learner.id, beforeRows, snapshot.mutations);
                      if (accepted) marks[cellKey(assignment.id, learner.id)] = accepted;
                    }
                  }
                  rememberPhone(snapshot, marks);
                  setPhoneRead("ready");
                  const waiting = snapshot.mutations.filter((item) => item.syncState === "pending").length;
                  if (waiting > 0 && result.ok) {
                    text = `${result.message} ${waiting} edit${waiting === 1 ? " is" : "s are"} still waiting on this phone.`;
                  }
                  if (waiting > 0 && !result.ok) {
                    text = result.message || `${waiting} edit${waiting === 1 ? " is" : "s are"} still waiting on this phone.`;
                  }
                }
                setSendNotice({ tone: result.ok ? "ok" : "error", text });
              })()
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
        </>
      ) : null}
    </div>
  );
}
