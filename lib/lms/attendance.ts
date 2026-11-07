// Kiosk attendance rules for LMS-3 Phase 1.
// A mark is an event. A correction is another event. Nothing here rewrites an
// earlier event. The sheet shows the event the server received last for that
// learner and class. A learner with no event stays unmarked: blank is not
// absent, and it is not present.
//
// Reasons are the closed FEAT-3 list, and only for Absent or Excused. The
// reason is optional. There is no free-text family story.

import { clockOfInstant, formatShortDate, localDateOfInstant } from "./timetable";

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

export type AttendanceStatusName = (typeof ATTENDANCE_STATUSES)[number];

export const ABSENCE_REASONS = [
  "ILLNESS",
  "FAMILY_CARE",
  "TRANSPORT_OR_COST",
  "FAMILY_CIRCUMSTANCES_NOT_RECORDED",
  "UNKNOWN",
] as const;

export type AbsenceReasonName = (typeof ABSENCE_REASONS)[number];

/// Label on the existing Device row used when a teacher saves from this page.
/// Day 6 is online. The attendance table still requires a device, and this
/// label is that row. It is not the Day 7 offline queue.
export const WEB_KIOSK_DEVICE_LABEL = "Web attendance kiosk";

const STATUS_LABELS: Record<AttendanceStatusName, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  EXCUSED: "Excused",
};

const REASON_LABELS: Record<AbsenceReasonName, string> = {
  ILLNESS: "Illness",
  FAMILY_CARE: "Family care",
  TRANSPORT_OR_COST: "Transport or cost",
  FAMILY_CIRCUMSTANCES_NOT_RECORDED: "Family circumstances (details not recorded)",
  UNKNOWN: "Unknown",
};

const CLIENT_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;

const MAX_MARKS = 80;

export function statusLabel(status: AttendanceStatusName): string {
  return STATUS_LABELS[status];
}

export function reasonLabel(reason: AbsenceReasonName): string {
  return REASON_LABELS[reason];
}

export function reasonAllowedFor(status: AttendanceStatusName): boolean {
  return status === "ABSENT" || status === "EXCUSED";
}

export function isAttendanceStatus(value: string): value is AttendanceStatusName {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

export function isAbsenceReason(value: string): value is AbsenceReasonName {
  return (ABSENCE_REASONS as readonly string[]).includes(value);
}

export type SavedMark = {
  eventId: string;
  status: AttendanceStatusName;
  reasonCode: AbsenceReasonName | null;
};

export type LearnerDraft = {
  learnerId: string;
  displayName: string;
  learnerCode: string;
  saved: SavedMark | null;
  status: AttendanceStatusName | null;
  reasonCode: AbsenceReasonName | null;
  clientEventId: string | null;
  recordedAt: string | null;
};

export type AttendanceLearnerRow = {
  id: string;
  displayName: string;
  learnerCode: string;
  saved: SavedMark | null;
};

export type IdFactory = () => { clientEventId: string; recordedAt: string };

export function draftFromLearner(learner: AttendanceLearnerRow): LearnerDraft {
  return {
    learnerId: learner.id,
    displayName: learner.displayName,
    learnerCode: learner.learnerCode,
    saved: learner.saved,
    status: learner.saved?.status ?? null,
    reasonCode: learner.saved?.reasonCode ?? null,
    clientEventId: null,
    recordedAt: null,
  };
}

function matchesSaved(
  saved: SavedMark | null,
  status: AttendanceStatusName | null,
  reasonCode: AbsenceReasonName | null,
): boolean {
  return (saved?.status ?? null) === status && (saved?.reasonCode ?? null) === reasonCode;
}

function withChoice(
  draft: LearnerDraft,
  status: AttendanceStatusName | null,
  reasonCode: AbsenceReasonName | null,
  factory: IdFactory,
): LearnerDraft {
  const reason = status && reasonAllowedFor(status) ? reasonCode : null;
  if (matchesSaved(draft.saved, status, reason)) {
    return { ...draft, status, reasonCode: reason, clientEventId: null, recordedAt: null };
  }
  if (draft.clientEventId && draft.recordedAt) {
    return { ...draft, status, reasonCode: reason };
  }
  const fresh = factory();
  return {
    ...draft,
    status,
    reasonCode: reason,
    clientEventId: fresh.clientEventId,
    recordedAt: fresh.recordedAt,
  };
}

export function chooseStatus(draft: LearnerDraft, status: AttendanceStatusName, factory: IdFactory): LearnerDraft {
  const keepReason = reasonAllowedFor(status) ? draft.reasonCode : null;
  return withChoice(draft, status, keepReason, factory);
}

/// Tap the selected reason again to clear it. Clearing stores no reason,
/// which the requirements allow. It does not add a sixth reason.
export function chooseReason(draft: LearnerDraft, reason: AbsenceReasonName, factory: IdFactory): LearnerDraft {
  if (!draft.status || !reasonAllowedFor(draft.status)) return draft;
  const next = draft.reasonCode === reason ? null : reason;
  return withChoice(draft, draft.status, next, factory);
}

export type PendingMark = {
  learnerId: string;
  status: AttendanceStatusName;
  reasonCode: AbsenceReasonName | null;
  clientEventId: string;
  recordedAt: string;
};

export function pendingMarks(drafts: LearnerDraft[]): PendingMark[] {
  const marks: PendingMark[] = [];
  for (const draft of drafts) {
    if (!draft.status || !draft.clientEventId || !draft.recordedAt) continue;
    if (matchesSaved(draft.saved, draft.status, draft.reasonCode)) continue;
    marks.push({
      learnerId: draft.learnerId,
      status: draft.status,
      reasonCode: draft.reasonCode,
      clientEventId: draft.clientEventId,
      recordedAt: draft.recordedAt,
    });
  }
  return marks;
}

export function sheetCounts(drafts: LearnerDraft[]): {
  marked: number;
  unmarked: number;
  pending: number;
  unmarkedNames: string[];
} {
  const unmarkedNames = drafts.filter((draft) => draft.status === null).map((draft) => draft.displayName);
  return {
    marked: drafts.length - unmarkedNames.length,
    unmarked: unmarkedNames.length,
    pending: pendingMarks(drafts).length,
    unmarkedNames,
  };
}

export type MarkDraftInput = {
  learnerId: string;
  status: string;
  reasonCode: string | null;
  clientEventId: string;
  recordedAt: string | null;
};

export type NormalizedMark = {
  learnerId: string;
  status: AttendanceStatusName;
  reasonCode: AbsenceReasonName | null;
  clientEventId: string;
  recordedAt: string | null;
};

function reasonMessage(): string {
  return "That reason is not allowed. Use Illness, Family care, Transport or cost, Family circumstances (details not recorded), or Unknown. Leave it blank if you do not know.";
}

export function normalizeAttendanceBatch(
  marks: MarkDraftInput[],
): { ok: true; marks: NormalizedMark[] } | { ok: false; message: string } {
  if (marks.length === 0) {
    return {
      ok: false,
      message: "Choose a status for at least one learner. Learners left unmarked are not saved.",
    };
  }
  if (marks.length > MAX_MARKS) {
    return { ok: false, message: "Too many marks in one save." };
  }

  const seenLearners = new Set<string>();
  const seenIds = new Set<string>();
  const normalized: NormalizedMark[] = [];

  for (const mark of marks) {
    if (!mark.learnerId || seenLearners.has(mark.learnerId)) {
      return { ok: false, message: "Each learner can have only one mark in a save." };
    }
    seenLearners.add(mark.learnerId);

    const clientEventId = mark.clientEventId.trim();
    if (!CLIENT_EVENT_ID.test(clientEventId) || seenIds.has(clientEventId)) {
      return {
        ok: false,
        message: seenIds.has(clientEventId)
          ? "Each mark needs its own save id."
          : "A mark is missing its save id.",
      };
    }
    seenIds.add(clientEventId);

    if (!isAttendanceStatus(mark.status)) {
      return { ok: false, message: "Choose Present, Absent, Late, or Excused." };
    }

    let reasonCode: AbsenceReasonName | null = null;
    if (mark.reasonCode !== null && mark.reasonCode.trim() !== "") {
      if (!isAbsenceReason(mark.reasonCode)) {
        return { ok: false, message: reasonMessage() };
      }
      reasonCode = mark.reasonCode;
    }
    if (reasonCode && !reasonAllowedFor(mark.status)) {
      const who = mark.status === "PRESENT" ? "Present" : "Late";
      return { ok: false, message: `${who} does not take a reason.` };
    }

    normalized.push({
      learnerId: mark.learnerId,
      status: mark.status,
      reasonCode,
      clientEventId,
      recordedAt: mark.recordedAt,
    });
  }

  return { ok: true, marks: normalized };
}

export type AttendanceEventFact = {
  id: string;
  clientEventId: string;
  learnerId: string;
  learnerName: string;
  learnerCode: string;
  status: AttendanceStatusName;
  reasonCode: AbsenceReasonName | null;
  recordedByName: string;
  syncedAt: Date;
  recordedAt: Date;
  createdAt: Date;
  createdOffline: boolean;
};

export type HistoryLine = {
  id: string;
  learnerId: string;
  learnerName: string;
  learnerCode: string;
  statusLabel: string;
  reasonLabel: string | null;
  recordedByName: string;
  receivedLabel: string;
  kind: "first" | "correction";
  summary: string;
  supersedesEventId: string | null;
  isCurrent: boolean;
};

function sortEvents(events: AttendanceEventFact[]): AttendanceEventFact[] {
  return [...events].sort((a, b) => {
    const synced = a.syncedAt.getTime() - b.syncedAt.getTime();
    if (synced !== 0) return synced;
    const created = a.createdAt.getTime() - b.createdAt.getTime();
    if (created !== 0) return created;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/// Latest server receipt wins. The phone clock is ignored on purpose:
/// classroom phones are often set wrong.
export function latestEventByLearner(events: AttendanceEventFact[]): Map<string, AttendanceEventFact> {
  const latest = new Map<string, AttendanceEventFact>();
  for (const event of sortEvents(events)) latest.set(event.learnerId, event);
  return latest;
}

function receivedLabel(syncedAt: Date, timeZone: string): string {
  const local = localDateOfInstant(syncedAt, timeZone);
  const clock = clockOfInstant(syncedAt, timeZone);
  if (!local || !clock) return syncedAt.toISOString();
  return `${formatShortDate(local)}, ${clock}`;
}

export function buildSessionHistory(events: AttendanceEventFact[], timeZone: string): HistoryLine[] {
  const ordered = sortEvents(events);
  const previous = new Map<string, AttendanceEventFact>();
  const currentIds = new Set<string>();
  for (const event of latestEventByLearner(ordered).values()) currentIds.add(event.id);

  return ordered.map((event) => {
    const earlier = previous.get(event.learnerId) ?? null;
    previous.set(event.learnerId, event);
    const statusText = statusLabel(event.status);
    const reasonText = event.reasonCode ? reasonLabel(event.reasonCode) : null;
    const reasonSentence = reasonText ? ` Reason: ${reasonText}.` : "";
    const summary = earlier
      ? `Corrects the earlier ${statusLabel(earlier.status)} mark. The sheet now shows ${statusText}. The earlier mark is kept.${reasonSentence}`
      : `First mark: ${statusText}.${reasonSentence}`;
    return {
      id: event.id,
      learnerId: event.learnerId,
      learnerName: event.learnerName,
      learnerCode: event.learnerCode,
      statusLabel: statusText,
      reasonLabel: reasonText,
      recordedByName: event.recordedByName,
      receivedLabel: receivedLabel(event.syncedAt, timeZone),
      kind: earlier ? "correction" : "first",
      summary,
      supersedesEventId: earlier?.id ?? null,
      isCurrent: currentIds.has(event.id),
    };
  });
}
