import { describe, expect, it } from "vitest";
import {
  attendanceFromCounts,
  buildSectionPerformance,
  formatPercent,
  median,
  trajectoryFromPercents,
  type PerformanceInput,
  type PerformanceLearner,
} from "../lib/lms/dashboard-metrics";

const now = new Date("2026-11-11T12:00:00.000Z");

function learner(id = "learner-1", enrolledOn = "2026-09-01T12:00:00.000Z"): PerformanceLearner {
  return {
    id,
    learnerCode: id,
    displayName: id,
    enrolledOn: new Date(enrolledOn),
    withdrawnOn: null,
  };
}

function blank(overrides: Partial<PerformanceInput> = {}): PerformanceInput {
  return {
    now,
    timeZone: "UTC",
    sectionId: "section-1",
    sectionName: "Morning Group",
    courseTitle: "Demo course",
    learners: [learner()],
    assignments: [],
    grades: [],
    submissions: [],
    sessions: [],
    attendance: [],
    ...overrides,
  };
}

function datedAssignment(index: number, percent: number, options?: { dueAt?: Date | null; createdAt?: Date; kind?: "PAPER" | "DIGITAL" | "BOTH" | "IN_CLASS_EXAM"; maxPoints?: string }) {
  const maxPoints = options?.maxPoints ?? "100.00";
  const points = ((percent / 100) * Number(maxPoints)).toFixed(2);
  const id = `assignment-${index}`;
  return {
    assignment: {
      id,
      title: `Work ${index}`,
      kind: options?.kind ?? "PAPER",
      maxPoints,
      dueAt: options && "dueAt" in options ? options.dueAt ?? null : new Date(Date.UTC(2026, 0, index, 9)),
      createdAt: options?.createdAt ?? new Date(Date.UTC(2026, 0, index, 8)),
    },
    grade: {
      id: `grade-${index}`,
      assignmentId: id,
      learnerId: "learner-1",
      points,
      openConflict: false,
    },
  };
}

describe("dashboard measurement rules", () => {
  it("uses the middle value for an odd count and the mean of the two middle values for an even count", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([10, 40, 20, 30])).toBe(25);
    expect(median([60, 70, 80, 100])).toBe(75);
  });

  it("labels the worked trajectory examples", () => {
    expect(trajectoryFromPercents(percents([50, 55, 70, 78])).label).toBe("Improving");
    expect(trajectoryFromPercents(percents([80, 82, 84, 40])).label).toBe("Steady");
    expect(trajectoryFromPercents(percents([80, 78, 60, 55])).label).toBe("Declining");
    expect(trajectoryFromPercents(percents([70, 80, 75])).label).toBe("Insufficient data");
  });

  it("counts an exact 10 point rise only when two later marks agree", () => {
    expect(trajectoryFromPercents(percents([50, 50, 60, 60])).label).toBe("Improving");
    const spike = trajectoryFromPercents(percents([50, 50, 80, 52]));
    expect(spike.label).toBe("Steady");
    expect(spike.difference).toBeCloseTo(16, 5);
  });

  it("uses the middle mark of a three-mark half and the mean of a four-mark half", () => {
    const oddHalf = trajectoryFromPercents(percents([10, 40, 20, 80, 50, 90]));
    expect(oddHalf.earlierMedian).toBe(20);
    expect(oddHalf.laterMedian).toBe(80);
    expect(oddHalf.label).toBe("Improving");

    const evenHalf = trajectoryFromPercents(percents([10, 20, 30, 40, 50, 60, 70, 80]));
    expect(evenHalf.earlierMedian).toBe(25);
    expect(evenHalf.laterMedian).toBe(65);
    expect(evenHalf.label).toBe("Improving");
  });

  it("keeps the lookback to the latest eight settled marks", () => {
    const result = trajectoryFromPercents(percents([10, 10, 50, 50, 50, 50, 50, 50, 50]));
    expect(result.windowCount).toBe(8);
    expect(result.earlierMedian).toBe(50);
    expect(result.label).toBe("Steady");
  });

  it("orders marks by the due date, then by the server created date when the due date is empty", () => {
    const byDue = [1, 2, 3, 4].map((index) =>
      datedAssignment(index, index < 3 ? 90 : 40, {
        dueAt: new Date(Date.UTC(2026, index, 1)),
        createdAt: new Date(Date.UTC(2026, index < 3 ? 6 : 0, 1)),
      }),
    );
    const dueOrdered = buildSectionPerformance(
      blank({
        assignments: byDue.map((item) => item.assignment),
        grades: byDue.map((item) => item.grade),
      }),
    );
    expect(dueOrdered.learners[0]?.trajectory.label).toBe("Declining");

    const noDue = [1, 2, 3, 4].map((index) =>
      datedAssignment(index, index < 3 ? 40 : 90, {
        dueAt: index < 3 ? new Date(Date.UTC(2026, index, 1)) : null,
        createdAt: new Date(Date.UTC(2026, index, 1)),
      }),
    );
    const createdOrdered = buildSectionPerformance(
      blank({
        assignments: noDue.map((item) => item.assignment),
        grades: noDue.map((item) => item.grade),
      }),
    );
    expect(createdOrdered.learners[0]?.trajectory.label).toBe("Improving");
  });

  it("leaves missing marks, ungraded files, and open conflicts out of the trajectory", () => {
    const rows = [1, 2, 3, 4].map((index) => datedAssignment(index, index === 4 ? 10 : 80));
    rows[3]!.grade.openConflict = true;
    const conflict = buildSectionPerformance(
      blank({
        assignments: rows.map((item) => item.assignment),
        grades: rows.map((item) => item.grade),
      }),
    );
    expect(conflict.learners[0]?.trajectory.label).toBe("Insufficient data");
    expect(conflict.learners[0]?.gradeAverageLabel).toBe("80.0%");
    expect(conflict.learners[0]?.needsReview).toBe(1);

    const missing = [1, 2, 3].map((index) => datedAssignment(index, 80, { kind: "DIGITAL" }));
    const ungraded = datedAssignment(4, 0, { kind: "DIGITAL" });
    const thin = buildSectionPerformance(
      blank({
        assignments: [...missing.map((item) => item.assignment), ungraded.assignment],
        grades: missing.map((item) => item.grade),
        submissions: [
          {
            id: "file-4",
            assignmentId: ungraded.assignment.id,
            learnerId: "learner-1",
            uploadState: "STORED",
            updatedAt: now,
            receivedAt: now,
          },
        ],
      }),
    );
    expect(thin.learners[0]?.trajectory.label).toBe("Insufficient data");
    expect(thin.learners[0]?.rows[3]?.gradeStatus).toBe("Awaiting grade");
    expect(thin.learners[0]?.rows[3]?.fileStatusLabel).toBe("Submitted");
    expect(thin.learners[0]?.gradeAverageLabel).toBe("80.0%");
  });

  it("keeps paper grades separate from digital file submissions", () => {
    const paper = datedAssignment(1, 70, { kind: "PAPER", maxPoints: "20.00" });
    const exam = datedAssignment(2, 80, { kind: "IN_CLASS_EXAM", maxPoints: "50.00" });
    const digital = datedAssignment(3, 0, { kind: "DIGITAL", dueAt: new Date("2026-10-01T09:00:00.000Z") });
    const both = datedAssignment(4, 90, { kind: "BOTH", dueAt: null });
    const undated = datedAssignment(5, 0, { kind: "DIGITAL", dueAt: null });
    const model = buildSectionPerformance(
      blank({
        assignments: [paper, exam, digital, both, undated].map((item) => item.assignment),
        grades: [paper.grade, exam.grade, both.grade],
        submissions: [
          { id: "old", assignmentId: digital.assignment.id, learnerId: "learner-1", uploadState: "STORED", updatedAt: new Date("2026-10-01T00:00:00.000Z"), receivedAt: null },
          { id: "new", assignmentId: digital.assignment.id, learnerId: "learner-1", uploadState: "FAILED", updatedAt: new Date("2026-10-02T00:00:00.000Z"), receivedAt: null },
          { id: "both-file", assignmentId: both.assignment.id, learnerId: "learner-1", uploadState: "QUEUED", updatedAt: now, receivedAt: null },
        ],
      }),
    );
    const rows = model.learners[0]?.rows ?? [];
    expect(rows.find((row) => row.kindLabel === "Paper")).toMatchObject({
      gradeStatus: "Graded",
      fileStatusLabel: "Not a file submission",
      percentLabel: "70.0%",
    });
    expect(rows.find((row) => row.kindLabel === "In-class exam")?.fileStatusLabel).toBe("Not a file submission");
    expect(rows.find((row) => row.assignmentId === digital.assignment.id)).toMatchObject({
      gradeStatus: "Awaiting grade",
      fileStatusLabel: "Upload failed. Overdue.",
      submittedFile: false,
    });
    expect(rows.find((row) => row.assignmentId === both.assignment.id)).toMatchObject({
      gradeStatus: "Graded",
      fileStatusLabel: "Waiting to upload",
      submittedFile: false,
      overdue: false,
    });
    expect(model.learners[0]?.files).toMatchObject({
      expected: 3,
      submitted: 0,
      overdue: 1,
      overdueLabel: "1 of 1",
    });
    expect(model.receipts.rows.map((row) => row.title)).toEqual(["Work 3", "Work 4", "Work 5"]);
    expect(model.learners[0]?.receipts.rows.find((row) => row.title === "Work 3")?.result).toBe("Not received");
  });

  it("says when no digital assignment has a due date", () => {
    const digital = datedAssignment(1, 0, { kind: "DIGITAL", dueAt: null });
    const model = buildSectionPerformance(
      blank({ assignments: [digital.assignment], grades: [], submissions: [] }),
    );
    expect(model.learners[0]?.files.overdueLabel).toBe("No due dates set");
    expect(model.learners[0]?.rows[0]?.gradeStatus).toBe("Awaiting grade");
  });

  it("uses every eligible session as the attendance denominator", () => {
    const sessions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((day) => ({
      id: `session-${day}`,
      title: `Class ${day}`,
      startsAt: new Date(Date.UTC(2026, 9, day, 9)),
      status: "HELD" as const,
    }));
    const attendance = [
      ...[1, 2, 3, 4, 5, 6].map((day) => event(`session-${day}`, "PRESENT", day)),
      event("session-7", "LATE", 7),
      event("session-8", "ABSENT", 8),
      event("session-9", "EXCUSED", 9),
    ];
    const model = buildSectionPerformance(
      blank({
        sessions: [
          ...sessions,
          { id: "cancelled", title: "Closed", startsAt: new Date("2026-10-15T09:00:00.000Z"), status: "CANCELLED" },
          { id: "future", title: "Later", startsAt: new Date("2026-12-01T09:00:00.000Z"), status: "SCHEDULED" },
        ],
        attendance,
      }),
    );
    expect(model.learners[0]?.attendance).toMatchObject({
      eligibleSessions: 10,
      present: 6,
      late: 1,
      absent: 1,
      excused: 1,
      unmarked: 1,
      confirmedLabel: "70.0%",
      coverageLabel: "90.0%",
    });
    expect(model.learners[0]?.sessions.map((session) => session.statusLabel)).toContain("Unmarked");
    expect(model.learners[0]?.sessions.map((session) => session.statusLabel)).not.toContain("Cancelled");
    expect(model.cancelledSessions).toBe(1);
    expect(model.futureSessions).toBe(1);
  });

  it("does not turn a blank attendance sheet into a zero rate", () => {
    const model = buildSectionPerformance(
      blank({
        sessions: [{ id: "session-1", title: "Class", startsAt: new Date("2026-10-01T09:00:00.000Z"), status: "HELD" }],
      }),
    );
    expect(model.learners[0]?.attendance.confirmedLabel).toBe("No attendance recorded yet");
    expect(model.learners[0]?.attendance.coverageLabel).toBe("No attendance recorded yet");
    expect(model.learners[0]?.attendance.unmarked).toBe(1);
    expect(model.learners[0]?.attendance.absent).toBe(0);
  });

  it("keeps a recorded absence as zero confirmed attendance", () => {
    const model = buildSectionPerformance(
      blank({
        sessions: [{ id: "session-1", title: "Class", startsAt: new Date("2026-10-01T09:00:00.000Z"), status: "HELD" }],
        attendance: [event("session-1", "ABSENT", 1)],
      }),
    );
    expect(model.learners[0]?.attendance.confirmedLabel).toBe("0.0%");
    expect(model.learners[0]?.attendance.coverageLabel).toBe("100.0%");
  });

  it("uses the later server receipt when a mark is corrected", () => {
    const model = buildSectionPerformance(
      blank({
        sessions: [{ id: "session-1", title: "Class", startsAt: new Date("2026-10-01T09:00:00.000Z"), status: "HELD" }],
        attendance: [
          { ...event("session-1", "ABSENT", 1), id: "first", syncedAt: new Date("2026-10-01T10:00:00.000Z") },
          { ...event("session-1", "PRESENT", 2), id: "second", syncedAt: new Date("2026-10-01T12:00:00.000Z") },
        ],
      }),
    );
    expect(model.learners[0]?.attendance.present).toBe(1);
    expect(model.learners[0]?.attendance.absent).toBe(0);
    expect(model.learners[0]?.sessions[0]?.statusLabel).toBe("Present");
  });

  it("leaves out sessions before enrollment and after withdrawal", () => {
    const person = learner();
    person.withdrawnOn = new Date("2026-10-05T12:00:00.000Z");
    const model = buildSectionPerformance(
      blank({
        learners: [person],
        sessions: [
          { id: "before", title: "Before", startsAt: new Date("2026-08-01T09:00:00.000Z"), status: "HELD" },
          { id: "during", title: "During", startsAt: new Date("2026-10-02T09:00:00.000Z"), status: "SCHEDULED" },
          { id: "after", title: "After", startsAt: new Date("2026-10-20T09:00:00.000Z"), status: "HELD" },
        ],
        attendance: [event("during", "PRESENT", 2), event("after", "ABSENT", 20), event("before", "ABSENT", 1)],
      }),
    );
    expect(model.learners[0]?.attendance.eligibleSessions).toBe(1);
    expect(model.learners[0]?.attendance.present).toBe(1);
    expect(model.learners[0]?.attendance.confirmedLabel).toBe("100.0%");
  });

  it("weights each learner's grade average equally", () => {
    const high = datedAssignment(1, 100);
    const lowA = datedAssignment(2, 0);
    const lowB = datedAssignment(3, 0);
    const second = learner("learner-2");
    const model = buildSectionPerformance(
      blank({
        learners: [learner(), second, learner("learner-3")],
        assignments: [high.assignment, lowA.assignment, lowB.assignment],
        grades: [
          high.grade,
          { ...lowA.grade, learnerId: "learner-2" },
          { ...lowB.grade, learnerId: "learner-2" },
        ],
      }),
    );
    expect(model.learners[0]?.gradeAverageLabel).toBe("100.0%");
    expect(model.learners[1]?.gradeAverageLabel).toBe("0.0%");
    expect(model.learners[2]?.gradeAverageLabel).toBe("No graded work");
    expect(model.gradeAverageLabel).toBe("50.0%");
    expect(model.learnersInAverage).toBe(2);
  });

  it("does not invent attendance when the center clock cannot be read", () => {
    const model = buildSectionPerformance(
      blank({
        timeZone: "Not/AZone",
        sessions: [{ id: "session-1", title: "Class", startsAt: new Date("2026-10-01T09:00:00.000Z"), status: "HELD" }],
        attendance: [event("session-1", "PRESENT", 1)],
      }),
    );
    expect(model.clockLabel).toBe("The center clock could not be read.");
    expect(model.attendance.confirmedLabel).toBe("The center clock could not be read.");
    expect(model.learners[0]?.attendance.eligibleSessions).toBe(0);
    expect(model.receipts.receivedByNowLabel).toBe("The center clock could not be read.");
    expect(model.receipts.rows).toEqual([]);
    expect(model.learners[0]?.receipts.rows).toEqual([]);
  });

  it("counts a stored file as received by now, including a late arrival, and leaves paper out", () => {
    const early = learner("early");
    const lateEnrollee = learner("late", "2026-10-10T12:00:00.000Z");
    const first = datedAssignment(1, 0, { kind: "DIGITAL", dueAt: new Date("2026-10-01T09:00:00.000Z") });
    const second = datedAssignment(2, 0, { kind: "DIGITAL", dueAt: new Date("2026-10-15T09:00:00.000Z") });
    const future = datedAssignment(3, 0, { kind: "BOTH", dueAt: new Date("2026-12-01T09:00:00.000Z") });
    const undated = datedAssignment(4, 0, { kind: "DIGITAL", dueAt: null });
    const paper = datedAssignment(5, 80, { kind: "PAPER", dueAt: new Date("2026-09-01T09:00:00.000Z") });
    const model = buildSectionPerformance(
      blank({
        timeZone: "Asia/Tokyo",
        learners: [early, lateEnrollee],
        assignments: [second.assignment, paper.assignment, undated.assignment, first.assignment, future.assignment],
        grades: [paper.grade],
        submissions: [
          receipt("late-file", first.assignment.id, "early", "2026-10-05T18:30:00.000Z"),
          receipt("earliest", second.assignment.id, "early", "2026-10-20T01:00:00.000Z"),
          receipt("later-attempt", second.assignment.id, "early", "2026-10-21T01:00:00.000Z"),
          receipt("after-enrollment", first.assignment.id, "late", "2026-10-21T01:00:00.000Z"),
          receipt("early-future", future.assignment.id, "early", "2026-11-01T00:30:00.000Z"),
          { id: "stored-without-time", assignmentId: undated.assignment.id, learnerId: "early", uploadState: "STORED", updatedAt: now, receivedAt: null },
        ],
      }),
    );
    expect(model.receipts.rows.map((row) => row.title)).toEqual(["Work 1", "Work 2", "Work 3", "Work 4"]);
    expect(model.receipts.rows[0]).toMatchObject({
      dueLabel: "1 Oct 2026",
      expectedLabel: "1",
      receivedLabel: "1",
      rateLabel: "1 of 1, 100.0%",
    });
    expect(model.receipts.rows[1]).toMatchObject({
      dueLabel: "15 Oct 2026",
      expectedLabel: "2",
      receivedLabel: "1",
      rateLabel: "1 of 2, 50.0%",
    });
    expect(model.receipts.rows[2]?.rateLabel).toBe("Not due yet");
    expect(model.receipts.rows[3]?.rateLabel).toBe("No due date");
    expect(model.receipts.receivedByNowLabel).toBe("2 of 3, 66.7%");
    expect(model.receipts.comparisonNote).toBe("The rows are in due-date order. Compare earlier due dates with later ones.");
    expect(model.receipts.scopeNote).toContain("not an on-time rate");

    const earlyRows = model.learners[0]?.receipts;
    expect(earlyRows?.rows[0]).toMatchObject({
      result: "Received",
      receivedOnLabel: "6 Oct 2026, 03:30",
    });
    expect(earlyRows?.rows[1]?.receivedOnLabel).toBe("20 Oct 2026, 10:00");
    expect(earlyRows?.rows[2]).toMatchObject({ result: "Received", dueLabel: "1 Dec 2026" });
    expect(earlyRows?.rows[3]?.result).toBe("No due date");
    expect(earlyRows?.receivedByNowLabel).toBe("2 of 2, 100.0%");
    expect(model.learners[1]?.receipts.rows[0]?.result).toBe("Enrolled after the due date");
    expect(model.learners[1]?.receipts.rows[0]?.receivedOnLabel).toBe("21 Oct 2026, 10:00");
    expect(model.learners[1]?.receipts.receivedByNowLabel).toBe("0 of 1, 0.0%");
    expect(model.learners[1]?.receipts.comparisonNote).toBe("One dated file assignment is not enough to compare earlier and later work.");
  });

  it("expects a learner who enrolled on the due date and skips a section where everyone enrolled later", () => {
    const sameDay = learner("same-day", "2026-10-01T23:00:00.000Z");
    const due = datedAssignment(1, 0, { kind: "DIGITAL", dueAt: new Date("2026-10-01T01:00:00.000Z") });
    const onTime = buildSectionPerformance(
      blank({
        learners: [sameDay],
        assignments: [due.assignment],
        submissions: [receipt("same", due.assignment.id, "same-day", "2026-10-02T08:00:00.000Z")],
      }),
    );
    expect(onTime.learners[0]?.receipts.rows[0]).toMatchObject({
      result: "Received",
      receivedOnLabel: "2 Oct 2026, 08:00",
    });
    expect(onTime.receipts.receivedByNowLabel).toBe("1 of 1, 100.0%");

    const tooLate = learner("too-late", "2026-10-02T12:00:00.000Z");
    const missed = buildSectionPerformance(
      blank({ learners: [tooLate], assignments: [due.assignment], submissions: [] }),
    );
    expect(missed.receipts.rows[0]?.rateLabel).toBe("Not expected");
    expect(missed.receipts.receivedByNowLabel).toBe("No due file assignments yet");
    expect(missed.receipts.comparisonNote).toBe("No learner was enrolled on or before a due date, so there is nothing to compare yet.");
  });

  it("rounds a seven-of-eleven attendance rate to one decimal", () => {
    expect(formatPercent((7 / 11) * 100)).toBe("63.6%");
    expect(attendanceFromCounts({ eligibleSessions: 0, present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 }).confirmedLabel).toBe(
      "No eligible sessions yet",
    );
  });
});

function receipt(id: string, assignmentId: string, learnerId: string, receivedAt: string) {
  return {
    id,
    assignmentId,
    learnerId,
    uploadState: "STORED" as const,
    updatedAt: new Date(receivedAt),
    receivedAt: new Date(receivedAt),
  };
}

function percents(values: number[]) {
  return values.map((percent) => ({ percent }));
}

function event(sessionId: string, status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED", day: number) {
  return {
    id: `${sessionId}-${status}`,
    sessionId,
    learnerId: "learner-1",
    status,
    syncedAt: new Date(Date.UTC(2026, 9, day, 10)),
    createdAt: new Date(Date.UTC(2026, 9, day, 10)),
  };
}
