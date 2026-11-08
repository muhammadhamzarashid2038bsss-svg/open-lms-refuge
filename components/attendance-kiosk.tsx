"use client";

import { useEffect, useRef, useState } from "react";
import { AttendanceSheetView } from "@/components/attendance-sheet";
import {
  applyLocalEvents,
  eventsInSequence,
  newLocalEventId,
  readLocalAttendance,
  saveLocalAttendance,
  storeAuthorizedClass,
  type AuthorizedClock,
  type LocalAttendanceEvent,
} from "@/lib/device/local-attendance";
import type { AccountRef } from "@/lib/device/offline-decisions";
import {
  chooseReason,
  chooseStatus,
  draftFromLearner,
  pendingMarks,
  reasonLabel,
  statusLabel,
  type AbsenceReasonName,
  type AttendanceLearnerRow,
  type AttendanceStatusName,
  type LearnerDraft,
} from "@/lib/lms/attendance";

const UNAVAILABLE = "Local attendance saving is unavailable on this phone. The marks were not stored.";

export function AttendanceKiosk({
  sectionId,
  sessionId,
  cancelled,
  learners,
  owner,
  clock,
}: {
  sectionId: string;
  sessionId: string;
  cancelled: boolean;
  learners: AttendanceLearnerRow[];
  owner: AccountRef;
  clock: AuthorizedClock | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [history, setHistory] = useState<LocalAttendanceEvent[]>([]);
  const [drafts, setDrafts] = useState<LearnerDraft[]>(() => learners.map(draftFromLearner));
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      const factory = globalThis.indexedDB;
      if (!factory) {
        if (!stop) {
          setMessage(UNAVAILABLE);
          setWaiting(null);
          setReady(true);
        }
        return;
      }
      if (clock) {
        const stored = await storeAuthorizedClass({
          factory,
          owner,
          sectionId,
          classSessionId: sessionId,
          clock,
          learners: learners.map((learner) => ({
            learnerId: learner.id,
            displayName: learner.displayName,
            learnerCode: learner.learnerCode,
          })),
          phoneNow: new Date(),
        });
        if (stop) return;
        if (!stored.ok) setMessage(stored.message);
      } else if (!stop) {
        setMessage("This sign-in cannot be kept on this phone. Local attendance saving is unavailable.");
      }
      const view = await readLocalAttendance(factory, owner, { sectionId, classSessionId: sessionId });
      if (stop) return;
      if (!view.ok) {
        setMessage(view.message);
        setWaiting(null);
        setReady(true);
        return;
      }
      if (!touched.current) setDrafts(applyLocalEvents(learners, view.sessionEvents));
      setHistory(eventsInSequence(view.sessionEvents));
      setWaiting(view.pendingCount);
      setReady(true);
    }
    void load();
    return () => {
      stop = true;
    };
  }, [clock, learners, owner, sectionId, sessionId]);

  function update(learnerId: string, next: (draft: LearnerDraft) => LearnerDraft) {
    touched.current = true;
    setMessage(null);
    setDrafts((current) => current.map((draft) => (draft.learnerId === learnerId ? next(draft) : draft)));
  }

  async function onSave() {
    const marks = pendingMarks(drafts);
    if (marks.length === 0) {
      setMessage("Choose a status for at least one learner. Learners left unmarked are not saved.");
      return;
    }
    const factory = globalThis.indexedDB;
    if (!factory) {
      setMessage(UNAVAILABLE);
      setWaiting(null);
      return;
    }
    setSaving(true);
    try {
      // The server save stays in the project for a later stage. This button
      // does not call it. A failed write on the phone is not sent instead.
      const serverIds = new Map(learners.map((learner) => [learner.id, learner.saved?.eventId ?? null]));
      const result = await saveLocalAttendance({
        factory,
        owner,
        sectionId,
        classSessionId: sessionId,
        phoneNow: new Date(),
        marks: marks.map((mark) => ({ ...mark, serverEventId: serverIds.get(mark.learnerId) ?? null })),
      });
      if (!result.ok) {
        setMessage(result.message);
        if (result.unreadable) setWaiting(null);
        return;
      }
      setMessage(result.message);
      setWaiting(result.count);
      setHistory(eventsInSequence(result.events));
      setDrafts(applyLocalEvents(learners, result.events));
      touched.current = false;
    } finally {
      setSaving(false);
    }
  }

  const names = new Map(learners.map((learner) => [learner.id, learner.displayName]));

  return (
    <div className="flex flex-col gap-6">
      {ready ? (
        <AttendanceSheetView
          learners={drafts}
          cancelled={cancelled}
          saving={saving}
          message={message}
          waitingCount={waiting}
          onStatus={(learnerId: string, status: AttendanceStatusName) => update(learnerId, (draft) => chooseStatus(draft, status, newLocalEventId))}
          onReason={(learnerId: string, reason: AbsenceReasonName) => update(learnerId, (draft) => chooseReason(draft, reason, newLocalEventId))}
          onSave={() => {
            void onSave();
          }}
        />
      ) : (
        <p className="text-lg">Checking marks saved on this phone…</p>
      )}
      {history.length > 0 ? (
        <section aria-labelledby="phone-attendance-heading" className="flex flex-col gap-3">
          <h2 id="phone-attendance-heading" className="text-2xl font-semibold">
            On this phone
          </h2>
          <p className="text-lg leading-7">These marks are waiting here until they can be sent. A correction is a new line. The earlier line stays.</p>
          <ol className="flex flex-col gap-3">
            {history.map((event) => (
              <li key={event.clientEventId} className="rounded-lg border-2 border-zinc-950 p-3">
                <p className="text-lg font-semibold">{names.get(event.learnerId) ?? "Learner"}</p>
                <p className="text-lg">
                  {statusLabel(event.status)}
                  {event.reasonCode ? ` · ${reasonLabel(event.reasonCode)}` : ""}
                </p>
                {event.correctsClientEventId || event.correctsServerEventId ? (
                  <p className="text-lg">Corrects an earlier mark. The earlier mark is kept.</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
