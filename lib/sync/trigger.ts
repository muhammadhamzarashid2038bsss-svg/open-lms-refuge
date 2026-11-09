// Foreground timers for attendance sync. The signed-in page starts one
// attempt, listens for the browser online signal, and may schedule one
// wait. It does not poll forever and it does not run after the page is gone.

import { RETRY_BASE_MS, RETRY_MAX_DELAY_MS, type SyncPass } from "@/lib/sync/retry";
import type { SyncReport } from "@/lib/sync/run";

export const ATTENDANCE_SYNC_EVENT = "olr-attendance-sync";

/// No timer after a dead session or a refused account. A wait past five
/// minutes is treated as due, matching the stored retry rule.
export function nextAutomaticDelayMs(report: SyncReport, now: Date): number | null {
  if (report.status === "session_expired" || report.status === "access_denied" || report.status === "problem") return null;
  // A run sends at most four batches. Marks still waiting, and not already
  // on a backoff timer, get another pass after the short base delay.
  if (report.status === "sent" && report.waiting > report.retrying) return RETRY_BASE_MS;
  if (!report.nextAttemptAt) return null;
  const due = new Date(report.nextAttemptAt).getTime();
  if (Number.isNaN(due) || Number.isNaN(now.getTime())) return null;
  const delay = due - now.getTime();
  if (delay > RETRY_MAX_DELAY_MS) return 0;
  if (delay <= 0) return 0;
  return delay;
}

export function bindAttendanceSync(input: {
  subscribeOnline: (listener: () => void) => () => void;
  run: (mode: SyncPass) => Promise<SyncReport>;
  now?: () => Date;
  schedule: (delayMs: number, fire: () => void) => () => void;
}): { load: () => void; manual: () => void; stop: () => void } {
  let stopped = false;
  let cancelTimer: (() => void) | null = null;
  const now = input.now ?? (() => new Date());

  const arm = (report: SyncReport) => {
    if (cancelTimer) cancelTimer();
    cancelTimer = null;
    if (stopped) return;
    const delay = nextAutomaticDelayMs(report, now());
    if (delay === null) return;
    cancelTimer = input.schedule(delay, () => {
      cancelTimer = null;
      kick("automatic");
    });
  };

  const kick = (mode: SyncPass) => {
    if (stopped) return;
    void input.run(mode).then((report) => {
      if (stopped) return;
      arm(report);
    });
  };

  const unsubscribe = input.subscribeOnline(() => kick("automatic"));

  return {
    load: () => kick("automatic"),
    manual: () => kick("manual"),
    stop: () => {
      stopped = true;
      if (cancelTimer) cancelTimer();
      cancelTimer = null;
      unsubscribe();
    },
  };
}
