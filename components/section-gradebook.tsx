"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import type { GradebookView } from "@/lib/data/assignments";
import { listLocalRecords } from "@/lib/device/local-records";
import { saveGradebookMarks } from "@/lib/device/gradebook-save";
import {
  assignmentKindLabel,
  assignmentKindNote,
  fileStatusLabel,
  gradebookCell,
  planGradebookSaves,
  showsFileStatus,
  type GradebookCellInput,
} from "@/lib/lms/gradebook";
import { syncLocalRecords } from "@/lib/sync/record-sync";
import { buttonClass, secondaryButtonClass } from "./ui";

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

function cellKey(assignmentId: string, learnerId: string): string {
  return `${assignmentId}-${learnerId}`;
}

export function SectionGradebook({
  centerId,
  userId,
  book,
}: {
  centerId: string;
  userId: string;
  book: GradebookView;
}) {
  const owner = useMemo(() => ({ centerId, userId }), [centerId, userId]);
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sendNotice, setSendNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const sendNoticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    noticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);
  useEffect(() => {
    sendNoticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [sendNotice]);

  function browserFactory(): IDBFactory | null {
    return globalThis.indexedDB ?? null;
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

  function valueFor(assignmentId: string, learnerId: string, current: string | null): string {
    const key = cellKey(assignmentId, learnerId);
    return key in entered ? entered[key] : (current ?? "");
  }

  function cells(): GradebookCellInput[] {
    const rows: GradebookCellInput[] = [];
    for (const learner of book.learners) {
      for (const assignment of book.assignments) {
        const grade = gradebookCell(book.grades, assignment.id, learner.id);
        if (grade?.provisional) continue;
        rows.push({
          assignmentId: assignment.id,
          learnerId: learner.id,
          kind: assignment.kind,
          maxPoints: assignment.maxPoints,
          entered: valueFor(assignment.id, learner.id, grade?.points ?? null),
          currentPoints: grade?.points ?? null,
          academicNote: grade?.academicNote ?? null,
          recordId: grade?.id ?? null,
          baseVector: grade?.versionVector,
        });
      }
    }
    return rows;
  }

  return (
    <div className="flex flex-col gap-6">
      {book.assignments.length === 0 ? (
        <p className="text-lg">This section has no assignment yet. Add one below.</p>
      ) : null}
      {book.learners.length === 0 ? <p className="text-lg">No learner is enrolled in this section.</p> : null}
      {book.assignments.length > 0 && book.learners.length > 0 ? (
        <>
          <p className="text-base leading-6 text-zinc-700">
            Swipe sideways to see every assignment. An empty box means no mark yet. Save keeps the marks on this
            phone. Send saved edits uses the same send as other grades, up to ten at a time.
          </p>
          <div className="overflow-x-auto">
            <table className="border-collapse text-left">
              <caption className="sr-only">
                Gradebook for {book.sectionName}. One row per learner.
              </caption>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-40 bg-white p-2 align-bottom text-base">Learner</th>
                  {book.assignments.map((assignment) => (
                    <th key={assignment.id} className="min-w-44 border-b-2 border-zinc-950 p-2 align-bottom text-base">
                      <span className="block font-semibold">{assignment.title}</span>
                      <span className="block">{assignmentKindLabel(assignment.kind)}</span>
                      <span className="block font-normal">Maximum {assignment.maxPoints}</span>
                      <span className="block font-normal text-zinc-700">{assignmentKindNote(assignment.kind)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {book.learners.map((learner) => (
                  <tr key={learner.id} className="border-b border-zinc-300">
                    <th className="sticky left-0 z-10 bg-white p-2 text-left align-top text-base font-medium">
                      <span className="block">{learner.displayName}</span>
                      <span className="block font-normal text-zinc-700">{learner.learnerCode}</span>
                    </th>
                    {book.assignments.map((assignment) => {
                      const grade = gradebookCell(book.grades, assignment.id, learner.id);
                      const label = `${learner.displayName}, ${learner.learnerCode}, ${assignment.title}`;
                      if (grade?.provisional) {
                        return (
                          <td key={assignment.id} className="p-2 align-top">
                            <p className="text-lg">{grade.points}</p>
                            <p className="text-base text-zinc-700">Waiting for a conflict choice.</p>
                            <Link className="underline" href="/teacher/conflicts">
                              Review conflicts
                            </Link>
                            {fileLine(assignment.id, learner.id, assignment.kind)}
                          </td>
                        );
                      }
                      const current = grade?.points ?? null;
                      return (
                        <td key={assignment.id} className="p-2 align-top">
                          <label className="sr-only" htmlFor={cellKey(assignment.id, learner.id)}>
                            {label}
                            {current ? `, current mark ${current}` : ", no mark yet"}
                          </label>
                          <input
                            id={cellKey(assignment.id, learner.id)}
                            className="min-h-12 w-28 rounded-lg border-2 border-zinc-950 bg-white px-2 text-lg"
                            inputMode="decimal"
                            value={valueFor(assignment.id, learner.id, current)}
                            placeholder="No mark"
                            onChange={(event) =>
                              setEntered((previous) => ({
                                ...previous,
                                [cellKey(assignment.id, learner.id)]: event.target.value,
                              }))
                            }
                          />
                          {fileLine(assignment.id, learner.id, assignment.kind)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className={buttonClass}
            type="button"
            disabled={busy}
            onClick={() => {
              const factory = browserFactory();
              if (!factory) {
                setNotice({ tone: "error", text: NO_FACTORY });
                return;
              }
              const planned = planGradebookSaves(cells());
              if (!planned.ok) {
                setNotice({ tone: "error", text: planned.message });
                return;
              }
              setBusy(true);
              setNotice(null);
              void saveGradebookMarks(factory, owner, planned.drafts)
                .then((result) => {
                  setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
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
        </>
      ) : null}
    </div>
  );
}
