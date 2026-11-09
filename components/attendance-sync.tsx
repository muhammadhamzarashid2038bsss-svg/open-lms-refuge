"use client";

import { useEffect, useRef, useState } from "react";
import { explainSyncCode, runAttendanceSync, type SyncReport } from "@/lib/sync/run";
import { ATTENDANCE_SYNC_EVENT, bindAttendanceSync } from "@/lib/sync/trigger";
import { buttonClass } from "./ui";

function formatWhen(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AttendanceSyncPanel({
  report,
  syncing,
  onSync,
}: {
  report: SyncReport | null;
  syncing: boolean;
  onSync: () => void;
}) {
  const lastSent = formatWhen(report?.lastSuccessAt ?? null);
  const codes = new Map<string, number>();
  for (const rejection of report?.rejections ?? []) {
    codes.set(rejection.code, (codes.get(rejection.code) ?? 0) + 1);
  }
  const waiting = report?.waiting ?? null;
  const rejected = report?.rejected ?? 0;
  return (
    <section aria-busy={syncing} className="flex flex-col gap-3 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">Attendance sync</h2>
      <p aria-live="polite" className="text-lg leading-7">
        {syncing ? "Checking the server and sending attendance." : (report?.message ?? "Checking attendance saved on this phone.")}
      </p>
      <p className="text-lg leading-7">
        {waiting === null ? "Attendance waiting to send: checking." : `Attendance waiting to send: ${waiting}.`}
      </p>
      {rejected > 0 ? <p className="text-lg leading-7">Attendance refused by the server: {rejected}.</p> : null}
      {report && report.retrying > 0 ? <p className="text-lg leading-7">Attendance waiting to try again: {report.retrying}.</p> : null}
      {lastSent ? <p className="text-lg leading-7">Last attendance confirmed by the server: {lastSent}.</p> : null}
      {codes.size > 0 ? (
        <ul className="flex flex-col gap-2 text-lg leading-7">
          {[...codes.entries()].map(([code, count]) => (
            <li key={code}>
              {count} refused ({code}). {explainSyncCode(code)}
            </li>
          ))}
        </ul>
      ) : null}
      <button className={buttonClass} type="button" onClick={onSync} disabled={syncing}>
        Sync now
      </button>
    </section>
  );
}

export function AttendanceSync({ userId, centerId }: { userId: string; centerId: string }) {
  const [report, setReport] = useState<SyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const manual = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    const account = { userId, centerId };
    const controls = bindAttendanceSync({
      subscribeOnline: (listener) => {
        window.addEventListener("online", listener);
        return () => window.removeEventListener("online", listener);
      },
      schedule: (delayMs, fire) => {
        const id = window.setTimeout(fire, delayMs);
        return () => window.clearTimeout(id);
      },
      run: async (mode) => {
        if (active) setSyncing(true);
        const next = await runAttendanceSync({ factory: indexedDB, account, mode });
        if (active) {
          setReport(next);
          setSyncing(false);
          window.dispatchEvent(new Event(ATTENDANCE_SYNC_EVENT));
        }
        return next;
      },
    });
    manual.current = controls.manual;
    controls.load();
    return () => {
      active = false;
      manual.current = null;
      controls.stop();
    };
  }, [centerId, userId]);

  return <AttendanceSyncPanel report={report} syncing={syncing} onSync={() => manual.current?.()} />;
}
