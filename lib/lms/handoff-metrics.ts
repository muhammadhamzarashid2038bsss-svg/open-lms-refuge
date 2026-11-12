// Pure handoff decisions. The attendance and grade numbers come from the Day 11
// rules in dashboard-metrics.ts. This file only decides who receives the pack,
// which note version was current, and how lesson rows are labeled.

import type { TrajectoryLabel } from "./dashboard-metrics";

export const ATTENDANCE_RULE = "day11-attendance-v1";
export const GRADE_RULE = "day11-trajectory-v1";

export const ATTENDANCE_LOOKBACK =
  "Attendance uses every eligible session from enrollment through the handoff. A session counts when it is Scheduled or Held and has already started. Cancelled sessions and future sessions are left out. Unmarked sessions are not absences. The confirmed rate is present and late divided by eligible sessions. When no session is eligible, or none has a recorded status, no rate is stored.";

export type RecipientPerson = {
  id: string;
  active: boolean;
  role: string;
  centerId: string;
};

export type RecipientChoice =
  | {
      ok: true;
      incomingTeacherId: string | null;
      assignedToId: string;
      assignedToRole: "TEACHER" | "CENTER_DIRECTOR";
    }
  | { ok: false; message: string };

const NO_DIRECTOR = "This center needs one active director before a handoff can be assigned.";
const BAD_INCOMING = "The selected teacher cannot take this section.";

/// Picks the incoming teacher only when the choice is explicit or there is exactly one.
/// Several remaining teachers go to the director. A deactivated teacher is never chosen.
export function chooseHandoffRecipient(input: {
  outgoingTeacherId: string;
  sectionCenterId: string;
  explicitIncoming: RecipientPerson | null;
  otherCurrentTeacherIds: readonly string[];
  directorIds: readonly string[];
}): RecipientChoice {
  if (input.explicitIncoming) {
    const teacher = input.explicitIncoming;
    const eligible =
      teacher.id !== input.outgoingTeacherId &&
      teacher.active &&
      teacher.role === "TEACHER" &&
      teacher.centerId === input.sectionCenterId;
    if (!eligible) return { ok: false, message: BAD_INCOMING };
    return {
      ok: true,
      incomingTeacherId: teacher.id,
      assignedToId: teacher.id,
      assignedToRole: "TEACHER",
    };
  }

  const others = [...new Set(input.otherCurrentTeacherIds)].filter((id) => id !== input.outgoingTeacherId);
  if (others.length === 1) {
    const id = others[0];
    if (!id) return { ok: false, message: NO_DIRECTOR };
    return { ok: true, incomingTeacherId: id, assignedToId: id, assignedToRole: "TEACHER" };
  }
  if (input.directorIds.length !== 1) return { ok: false, message: NO_DIRECTOR };
  const directorId = input.directorIds[0];
  if (!directorId) return { ok: false, message: NO_DIRECTOR };
  return {
    ok: true,
    incomingTeacherId: null,
    assignedToId: directorId,
    assignedToRole: "CENTER_DIRECTOR",
  };
}

export function latestNoteVersion<T extends { id: string; syncedAt: Date; createdAt: Date }>(versions: readonly T[]): T | null {
  let best: T | null = null;
  for (const version of versions) {
    if (!best) {
      best = version;
      continue;
    }
    const synced = version.syncedAt.getTime() - best.syncedAt.getTime();
    if (synced > 0) best = version;
    else if (synced === 0) {
      const created = version.createdAt.getTime() - best.createdAt.getTime();
      if (created > 0) best = version;
      else if (created === 0 && version.id.localeCompare(best.id) > 0) best = version;
    }
  }
  return best;
}

export type LessonSnapshot = {
  tracked: boolean;
  completed: number;
  total: number;
  label: string;
};

/// Lesson rows are optional. No row means the checklist was not used.
/// A stored Not started row means tracking exists and nothing was completed.
export function lessonSnapshot(
  rows: readonly { status: string; startsAt: Date }[],
  now: Date,
): LessonSnapshot {
  const started = rows.filter((row) => row.startsAt.getTime() <= now.getTime());
  if (started.length === 0) {
    return { tracked: false, completed: 0, total: 0, label: "Not tracked" };
  }
  const completed = started.filter((row) => row.status === "COMPLETED").length;
  if (completed === 0) {
    return {
      tracked: true,
      completed: 0,
      total: started.length,
      label: "No lessons completed",
    };
  }
  return {
    tracked: true,
    completed,
    total: started.length,
    label: `${completed} of ${started.length} tracked lessons completed`,
  };
}

export function trendEnum(label: TrajectoryLabel): "IMPROVING" | "STEADY" | "DECLINING" | "INSUFFICIENT" {
  if (label === "Improving") return "IMPROVING";
  if (label === "Steady") return "STEADY";
  if (label === "Declining") return "DECLINING";
  return "INSUFFICIENT";
}

export function roundPercent(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}
