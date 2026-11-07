"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveAttendanceAction } from "@/app/actions/attendance";
import { AttendanceSheetView } from "@/components/attendance-sheet";
import {
  chooseReason,
  chooseStatus,
  draftFromLearner,
  pendingMarks,
  type AbsenceReasonName,
  type AttendanceLearnerRow,
  type AttendanceStatusName,
  type LearnerDraft,
} from "@/lib/lms/attendance";

function newSaveId(): { clientEventId: string; recordedAt: string } {
  return { clientEventId: crypto.randomUUID(), recordedAt: new Date().toISOString() };
}

function KioskForm({
  sectionId,
  sessionId,
  cancelled,
  learners,
  message,
  setMessage,
}: {
  sectionId: string;
  sessionId: string;
  cancelled: boolean;
  learners: AttendanceLearnerRow[];
  message: string | null;
  setMessage: (message: string | null) => void;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<LearnerDraft[]>(() => learners.map(draftFromLearner));
  const [saving, setSaving] = useState(false);

  function update(learnerId: string, next: (draft: LearnerDraft) => LearnerDraft) {
    setMessage(null);
    setDrafts((current) => current.map((draft) => (draft.learnerId === learnerId ? next(draft) : draft)));
  }

  async function onSave() {
    const marks = pendingMarks(drafts);
    if (marks.length === 0) {
      setMessage("Choose a status for at least one learner. Learners left unmarked are not saved.");
      return;
    }
    setSaving(true);
    try {
      // A weak connection can drop the reply after the server has saved.
      // The same save ids are sent again, and the server keeps one row.
      const result = await saveAttendanceAction(sectionId, sessionId, marks);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const savedAgain = result.created === 0;
      setMessage(savedAgain ? "Those marks were already saved." : "Saved. Earlier marks are still kept.");
      router.refresh();
    } catch {
      setMessage("The save did not finish. Your choices are still here. Save again to retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AttendanceSheetView
      learners={drafts}
      cancelled={cancelled}
      saving={saving}
      message={message}
      onStatus={(learnerId: string, status: AttendanceStatusName) => update(learnerId, (draft) => chooseStatus(draft, status, newSaveId))}
      onReason={(learnerId: string, reason: AbsenceReasonName) => update(learnerId, (draft) => chooseReason(draft, reason, newSaveId))}
      onSave={() => {
        void onSave();
      }}
    />
  );
}

export function AttendanceKiosk({
  sectionId,
  sessionId,
  cancelled,
  learners,
}: {
  sectionId: string;
  sessionId: string;
  cancelled: boolean;
  learners: AttendanceLearnerRow[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  // Remount after a refresh so the sheet shows the saved marks, including a
  // correction, without keeping the unsaved tap that was just stored.
  const savedKey = learners.map((learner) => `${learner.id}:${learner.saved?.eventId ?? "none"}`).join("|");
  return (
    <KioskForm
      key={savedKey}
      sectionId={sectionId}
      sessionId={sessionId}
      cancelled={cancelled}
      learners={learners}
      message={message}
      setMessage={setMessage}
    />
  );
}
