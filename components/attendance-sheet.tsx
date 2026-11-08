import {
  ABSENCE_REASONS,
  ATTENDANCE_STATUSES,
  reasonLabel,
  sheetCounts,
  statusLabel,
  type AbsenceReasonName,
  type AttendanceStatusName,
  type LearnerDraft,
} from "@/lib/lms/attendance";

const tapClass =
  "inline-flex min-h-16 w-full items-center justify-center rounded-lg border-2 border-zinc-950 px-2 text-center text-lg font-semibold focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-zinc-950";

function statusLine(learner: LearnerDraft): string {
  if (!learner.status) return "Not marked yet";
  const label = statusLabel(learner.status);
  if (learner.clientEventId) return `${label} — not saved yet`;
  return `Saved: ${label}`;
}

function statusClass(selected: boolean): string {
  // Color is set once here. Putting both text colors on the same button lets
  // the stylesheet pick one, and a selected tap can become black on black.
  return selected ? `${tapClass} bg-zinc-950 text-white` : `${tapClass} bg-white text-zinc-950`;
}

export function AttendanceSheetView({
  learners,
  cancelled,
  saving,
  message,
  waitingCount = null,
  onStatus,
  onReason,
  onSave,
}: {
  learners: LearnerDraft[];
  cancelled: boolean;
  saving: boolean;
  message: string | null;
  // Null means the phone has not confirmed a count. Zero is a confirmed empty queue.
  waitingCount?: number | null;
  onStatus: (learnerId: string, status: AttendanceStatusName) => void;
  onReason: (learnerId: string, reason: AbsenceReasonName) => void;
  onSave: () => void;
}) {
  const counts = sheetCounts(learners);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg leading-7">
        Unmarked learners stay unmarked. They are not saved as absent or present.
      </p>
      {cancelled ? <p className="text-lg font-semibold">This class is cancelled.</p> : null}
      <div className="flex flex-col gap-4">
        {learners.map((learner) => {
          const unmarked = learner.status === null;
          const pending = Boolean(learner.clientEventId);
          return (
            <article
              key={learner.learnerId}
              id={`learner-${learner.learnerId}`}
              aria-labelledby={`learner-name-${learner.learnerId}`}
              className={
                unmarked
                  ? "rounded-lg border-4 border-dashed border-zinc-950 bg-white p-3"
                  : pending
                    ? "rounded-lg border-4 border-solid border-zinc-950 bg-white p-3"
                    : "rounded-lg border-2 border-solid border-zinc-950 bg-white p-3"
              }
            >
              <h2 id={`learner-name-${learner.learnerId}`} className="text-2xl font-semibold leading-tight">
                {learner.displayName}
              </h2>
              <p className="text-lg">{learner.learnerCode}</p>
              <p className="mt-2 text-lg font-semibold">{statusLine(learner)}</p>
              {learner.reasonCode ? <p className="text-lg">Reason: {reasonLabel(learner.reasonCode)}</p> : null}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={`Status for ${learner.displayName}`}>
                {ATTENDANCE_STATUSES.map((status) => {
                  const selected = learner.status === status;
                  return (
                    <button
                      key={status}
                      className={statusClass(selected)}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onStatus(learner.learnerId, status)}
                    >
                      {statusLabel(status)}
                    </button>
                  );
                })}
              </div>
              {learner.status === "ABSENT" || learner.status === "EXCUSED" ? (
                <div className="mt-3" role="group" aria-label={`Optional reason for ${learner.displayName}`}>
                  <p className="text-lg font-semibold">Reason, optional. Tap again to clear it.</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ABSENCE_REASONS.map((reason) => {
                      const selected = learner.reasonCode === reason;
                      return (
                        <button
                          key={reason}
                          className={statusClass(selected)}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onReason(learner.learnerId, reason)}
                        >
                          {reasonLabel(reason)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 border-t-4 border-zinc-950 bg-white py-4">
        <p aria-live="polite" className="text-lg font-semibold">
          Marked {counts.marked}. Not marked yet {counts.unmarked}. Ready to save {counts.pending}.
        </p>
        {typeof waitingCount === "number" ? (
          <p aria-live="polite" className="text-lg font-semibold">
            Waiting to send: {waitingCount}
          </p>
        ) : null}
        {counts.unmarkedNames.length > 0 ? (
          <div>
            <p className="text-lg">Still unmarked, and not included in the save:</p>
            <ul className="list-disc pl-6 text-lg">
              {learners
                .filter((learner) => learner.status === null)
                .map((learner) => (
                  <li key={learner.learnerId}>{learner.displayName}</li>
                ))}
            </ul>
          </div>
        ) : (
          <p className="text-lg">Everyone on this list has a status. Only changes are saved.</p>
        )}
        <button
          className="inline-flex min-h-16 w-full items-center justify-center rounded-lg bg-zinc-950 px-4 text-xl font-semibold text-white disabled:opacity-60"
          type="button"
          onClick={onSave}
          disabled={saving || counts.pending === 0}
        >
          {saving ? "Saving…" : "Save attendance"}
        </button>
        {message ? (
          <p role="alert" className="text-lg font-medium">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
