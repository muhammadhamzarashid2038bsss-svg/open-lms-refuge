import type { HistoryLine } from "@/lib/lms/attendance";

export function AttendanceHistory({ lines }: { lines: HistoryLine[] }) {
  return (
    <section aria-labelledby="attendance-history-heading" className="flex flex-col gap-3">
      <h2 id="attendance-history-heading" className="text-2xl font-semibold">
        Session history
      </h2>
      <p className="text-lg leading-7">
        Every save stays here. A correction is a later line. The earlier line is not removed.
      </p>
      {lines.length === 0 ? <p className="text-lg">No attendance has been saved for this class yet.</p> : null}
      <ol className="flex flex-col gap-3">
        {lines.map((line) => (
          <li key={line.id} className="rounded-lg border-2 border-zinc-950 p-3">
            <p className="text-lg font-semibold">
              {line.learnerName} · {line.learnerCode}
            </p>
            <p className="text-lg">{line.summary}</p>
            <p className="text-lg">Received {line.receivedLabel}.</p>
            <p className="text-lg">Recorded by {line.recordedByName}.</p>
            {line.isCurrent ? <p className="text-lg font-semibold">Shown on the sheet now.</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
