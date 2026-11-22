import { describe, expect, it } from "vitest";
import { measureHandoffLearner, type PerformanceInput } from "../lib/lms/dashboard-metrics";
import { chooseHandoffRecipient, latestNoteVersion, lessonSnapshot } from "../lib/lms/handoff-metrics";
import { auditMetadata } from "../lib/data/audit";

const now = new Date("2026-11-12T12:00:00.000Z");

function baseInput(extra: Partial<PerformanceInput>): PerformanceInput {
  return {
    now,
    timeZone: "UTC",
    sectionId: "section",
    sectionName: "Group",
    courseTitle: "Course",
    learners: [],
    assignments: [],
    grades: [],
    submissions: [],
    sessions: [],
    attendance: [],
    ...extra,
  };
}

const learner = {
  id: "learner",
  learnerCode: "LNR-TEST",
  displayName: "Day13 Learner",
  enrolledOn: new Date("2026-01-01T00:00:00.000Z"),
  withdrawnOn: null,
};

describe("handoff profile calculations", () => {
  it("leaves out cancelled and future sessions and does not treat unmarked as absent", () => {
    const measured = measureHandoffLearner(baseInput({
      learners: [learner],
      sessions: [
        { id: "past", title: "Past", startsAt: new Date("2026-10-01T08:00:00.000Z"), status: "HELD" },
        { id: "blank", title: "Blank", startsAt: new Date("2026-10-02T08:00:00.000Z"), status: "HELD" },
        { id: "away", title: "Away", startsAt: new Date("2026-10-03T08:00:00.000Z"), status: "HELD" },
        { id: "family", title: "Family", startsAt: new Date("2026-10-04T08:00:00.000Z"), status: "SCHEDULED" },
        { id: "cancelled", title: "Cancelled", startsAt: new Date("2026-10-05T08:00:00.000Z"), status: "CANCELLED" },
        { id: "future", title: "Future", startsAt: new Date("2026-12-01T08:00:00.000Z"), status: "SCHEDULED" },
      ],
      attendance: [
        { id: "a1", sessionId: "past", learnerId: "learner", status: "PRESENT", syncedAt: now, createdAt: now },
        { id: "a2", sessionId: "away", learnerId: "learner", status: "ABSENT", reasonCode: "UNKNOWN", syncedAt: now, createdAt: now },
        { id: "a3", sessionId: "family", learnerId: "learner", status: "ABSENT", reasonCode: "FAMILY_CIRCUMSTANCES_NOT_RECORDED", syncedAt: now, createdAt: now },
      ],
    }), learner);
    expect(measured.attendance?.rates.eligibleSessions).toBe(4);
    expect(measured.attendance?.rates.present).toBe(1);
    expect(measured.attendance?.rates.unmarked).toBe(1);
    expect(measured.attendance?.rates.absent).toBe(2);
    expect(measured.attendance?.unexcusedAbsences).toBe(1);
    expect(measured.attendance?.cancelledLeftOut).toBe(1);
    expect(measured.attendance?.futureLeftOut).toBe(1);
    expect(measured.attendance?.rates.confirmedLabel).toBe("33.3%");
    expect(measured.attendance?.rates.coverageLabel).toBe("75.0%");
  });

  it("does not turn a missing grade into zero and does not invent a trend", () => {
    const assignments = [
      { id: "scored", title: "Scored", kind: "PAPER" as const, maxPoints: "10.00", dueAt: new Date("2026-10-01T00:00:00.000Z"), createdAt: new Date("2026-09-01T00:00:00.000Z") },
      { id: "missing", title: "Missing", kind: "PAPER" as const, maxPoints: "10.00", dueAt: new Date("2026-10-02T00:00:00.000Z"), createdAt: new Date("2026-09-02T00:00:00.000Z") },
    ];
    const measured = measureHandoffLearner(baseInput({
      learners: [learner],
      assignments,
      grades: [{ id: "g1", assignmentId: "scored", learnerId: "learner", points: "0.00", openConflict: false }],
    }), learner);
    expect(measured.settled).toEqual([{ percent: 0, assignmentId: "scored" }]);
    expect(measured.trajectory.label).toBe("Insufficient data");
    expect(measured.settled.some((mark) => mark.assignmentId === "missing")).toBe(false);
  });

  it("uses the dashboard trajectory when four settled marks are enough", () => {
    const assignments = [50, 55, 70, 78].map((points, index) => ({
      id: `mark-${index}`,
      title: `Mark ${index}`,
      kind: "PAPER" as const,
      maxPoints: "100.00",
      dueAt: new Date(Date.UTC(2026, 8, index + 1)),
      createdAt: new Date(Date.UTC(2026, 7, index + 1)),
    }));
    const measured = measureHandoffLearner(baseInput({
      learners: [learner],
      assignments,
      grades: assignments.map((assignment, index) => ({
        id: `grade-${index}`,
        assignmentId: assignment.id,
        learnerId: "learner",
        points: [50, 55, 70, 78][index].toFixed(2),
        openConflict: false,
      })),
    }), learner);
    expect(measured.trajectory.label).toBe("Improving");
    expect(measured.settled).toHaveLength(4);
  });

  it("labels lesson completion only from rows that already started", () => {
    expect(lessonSnapshot([], now).label).toBe("Not tracked");
    expect(lessonSnapshot([{ status: "NOT_STARTED", startsAt: new Date("2026-12-01T00:00:00.000Z") }], now).label).toBe("Not tracked");
    expect(lessonSnapshot([{ status: "NOT_STARTED", startsAt: new Date("2026-10-01T00:00:00.000Z") }], now)).toMatchObject({
      tracked: true,
      completed: 0,
      label: "No lessons completed",
    });
    expect(lessonSnapshot([
      { status: "COMPLETED", startsAt: new Date("2026-10-01T00:00:00.000Z") },
      { status: "NOT_STARTED", startsAt: new Date("2026-10-02T00:00:00.000Z") },
    ], now).label).toBe("1 of 2 tracked lessons completed");
  });

  it("keeps the note version that was current, not an older copy", () => {
    const older = { id: "older", syncedAt: new Date("2026-10-01T00:00:00.000Z"), createdAt: new Date("2026-10-01T00:00:00.000Z") };
    const newer = { id: "newer", syncedAt: new Date("2026-10-02T00:00:00.000Z"), createdAt: new Date("2026-10-02T00:00:00.000Z") };
    expect(latestNoteVersion([older, newer])?.id).toBe("newer");
  });

  it("assigns a named teacher, the acting director, or the only director for an administrator", () => {
    const admin = { id: "admin", active: true, role: "ADMIN", centerId: "center" };
    const acting = { id: "second", active: true, role: "CENTER_DIRECTOR", centerId: "center" };
    expect(chooseHandoffRecipient({
      outgoingTeacherId: "out",
      sectionCenterId: "center",
      explicitIncoming: null,
      actingUser: acting,
      directorIds: ["first", "second"],
    })).toEqual({ ok: true, incomingTeacherId: null, assignedToId: "second", assignedToRole: "CENTER_DIRECTOR" });
    expect(chooseHandoffRecipient({
      outgoingTeacherId: "out",
      sectionCenterId: "center",
      explicitIncoming: null,
      actingUser: admin,
      directorIds: ["director"],
    })).toEqual({ ok: true, incomingTeacherId: null, assignedToId: "director", assignedToRole: "CENTER_DIRECTOR" });
    expect(chooseHandoffRecipient({
      outgoingTeacherId: "out",
      sectionCenterId: "center",
      explicitIncoming: null,
      actingUser: admin,
      directorIds: ["one", "two"],
    }).ok).toBe(false);
    expect(chooseHandoffRecipient({
      outgoingTeacherId: "out",
      sectionCenterId: "center",
      explicitIncoming: null,
      actingUser: admin,
      directorIds: [],
    }).ok).toBe(false);
    expect(chooseHandoffRecipient({
      outgoingTeacherId: "out",
      sectionCenterId: "center",
      explicitIncoming: null,
      actingUser: { id: "other-director", active: true, role: "CENTER_DIRECTOR", centerId: "other-centre" },
      directorIds: ["one", "two"],
    }).ok).toBe(false);
    expect(chooseHandoffRecipient({
      outgoingTeacherId: "out",
      sectionCenterId: "center",
      explicitIncoming: { id: "picked", active: true, role: "TEACHER", centerId: "center" },
      actingUser: null,
      directorIds: [],
    })).toMatchObject({ ok: true, incomingTeacherId: "picked", assignedToId: "picked" });
    expect(chooseHandoffRecipient({
      outgoingTeacherId: "out",
      sectionCenterId: "center",
      explicitIncoming: { id: "elsewhere", active: true, role: "TEACHER", centerId: "other-centre" },
      actingUser: acting,
      directorIds: ["second"],
    }).ok).toBe(false);
    expect(chooseHandoffRecipient({
      outgoingTeacherId: "out",
      sectionCenterId: "center",
      explicitIncoming: { id: "out", active: false, role: "TEACHER", centerId: "center" },
      actingUser: acting,
      directorIds: ["second"],
    }).ok).toBe(false);
  });

  it("drops note text, secrets, and file contents from audit metadata", () => {
    const safe = auditMetadata({
      source: "handoff",
      profileCount: 2,
      incomingNamed: true,
      body: "Day13 private note",
      password: "demo-password",
      token: "session-token",
      content: "full file bytes",
      learnerCode: "LNR-0001",
    });
    expect(safe).toEqual({ source: "handoff", profileCount: 2, incomingNamed: true });
    expect(JSON.stringify(safe)).not.toContain("private note");
    expect(JSON.stringify(safe)).not.toContain("demo-password");
    expect(JSON.stringify(safe)).not.toContain("session-token");
    expect(JSON.stringify(safe)).not.toContain("full file");
  });
});
