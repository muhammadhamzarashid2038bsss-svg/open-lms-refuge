import { describe, expect, it } from "vitest";
import { buildScoreRequest, scoreRequestFields, type RiskEnrollmentWindow } from "../lib/risk/payload";

const NICKNAME = "SunnyDay15Secret";
const NOTE = "SYNTHETIC-FAMILY-STORY-DAY15";
const PHONE = "+15555550199";
const LEARNER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";
const SCORING = "2026-04-30";
const NOW = new Date("2026-04-30T18:00:00.000Z");

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function at(iso: string): Date {
  return new Date(`${iso}T09:00:00.000Z`);
}

function build(extra: Partial<RiskEnrollmentWindow> = {}) {
  const enrollment: RiskEnrollmentWindow = {
    enrolledOn: day("2026-04-01"),
    withdrawnOn: null,
    sessions: [
      { id: SESSION_ID, startsAt: at("2026-04-06"), status: "HELD" },
      { id: "session-cancelled", startsAt: at("2026-04-08"), status: "CANCELLED" },
      { id: "session-blank", startsAt: at("2026-04-10"), status: "HELD" },
      { id: "session-corrected", startsAt: at("2026-04-13"), status: "HELD" },
      { id: "session-family", startsAt: at("2026-04-15"), status: "HELD" },
      { id: "session-before", startsAt: at("2026-03-20"), status: "HELD" },
      { id: "session-future", startsAt: at("2026-05-02"), status: "SCHEDULED" },
    ],
    attendance: [
      {
        id: "event-1",
        sessionId: SESSION_ID,
        status: "ABSENT",
        reasonCode: "ILLNESS",
        syncedAt: at("2026-04-06"),
        createdAt: at("2026-04-06"),
      },
      {
        id: "event-old",
        sessionId: "session-corrected",
        status: "PRESENT",
        reasonCode: null,
        syncedAt: at("2026-04-13"),
        createdAt: at("2026-04-13"),
      },
      {
        id: "event-new",
        sessionId: "session-corrected",
        status: "ABSENT",
        reasonCode: null,
        syncedAt: at("2026-04-14"),
        createdAt: at("2026-04-14"),
      },
      {
        id: "event-family",
        sessionId: "session-family",
        status: "ABSENT",
        reasonCode: "FAMILY_CIRCUMSTANCES_NOT_RECORDED",
        syncedAt: at("2026-04-15"),
        createdAt: at("2026-04-15"),
      },
    ],
    assignments: [
      { id: ASSIGNMENT_ID, kind: "PAPER", dueAt: at("2026-04-02"), maxPoints: "10.00" },
      { id: "digital-due", kind: "DIGITAL", dueAt: at("2026-04-09"), maxPoints: "10.00" },
      { id: "digital-future", kind: "DIGITAL", dueAt: at("2026-05-04"), maxPoints: "10.00" },
      { id: "paper-before", kind: "PAPER", dueAt: at("2026-03-15"), maxPoints: "10.00" },
      { id: "paper-blank", kind: "PAPER", dueAt: at("2026-04-20"), maxPoints: "10.00" },
      { id: "paper-conflict", kind: "PAPER", dueAt: at("2026-04-12"), maxPoints: "10.00" },
    ],
    grades: [
      { id: "grade-zero", assignmentId: ASSIGNMENT_ID, points: "0.00", openConflict: false },
      { id: "grade-conflict", assignmentId: "paper-conflict", points: "8.00", openConflict: true },
    ],
    submissions: [],
    ...extra,
  };
  return buildScoreRequest({
    learnerCode: "LNR-0007",
    enrollments: [enrollment],
    scoringDate: SCORING,
    timeZone: "UTC",
    now: NOW,
    thresholds: { watch: 40, high: 70 },
    displayName: NICKNAME,
    progressNote: NOTE,
    phone: PHONE,
    learnerId: LEARNER_ID,
  } as never);
}

describe("risk request mapping", () => {
  it("sends only the approved fields and no personal text or database ids", () => {
    const result = build();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = scoreRequestFields(result.request);
    expect(Object.keys(body).sort()).toEqual([
      "as_of",
      "assignments",
      "attendance",
      "grades",
      "learner_code",
      "thresholds",
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(NICKNAME);
    expect(text).not.toContain(NOTE);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(LEARNER_ID);
    expect(text).not.toContain(SESSION_ID);
    expect(text).not.toContain(ASSIGNMENT_ID);
    expect(text).not.toContain("ILLNESS");
    expect(text).not.toContain("displayName");
    expect(result.request.learner_code).toBe("LNR-0007");
    expect(result.request.thresholds).toEqual({ watch: 40, high: 70 });
  });

  it("keeps one current attendance mark and does not treat blanks or cancellations as absences", () => {
    const result = build();
    if (!result.ok) throw new Error("request");
    expect(result.request.attendance).toEqual([
      { session_id: "ses-0001", session_date: "2026-04-06", status: "absent", family_circumstances: false },
      { session_id: "ses-0002", session_date: "2026-04-08", status: "cancelled", family_circumstances: false },
      { session_id: "ses-0003", session_date: "2026-04-10", status: "unmarked", family_circumstances: false },
      { session_id: "ses-0004", session_date: "2026-04-13", status: "absent", family_circumstances: false },
      { session_id: "ses-0005", session_date: "2026-04-15", status: "absent", family_circumstances: true },
    ]);
  });

  it("counts due work without turning a blank grade or a future task into a missing assignment", () => {
    const result = build();
    if (!result.ok) throw new Error("request");
    expect(result.request.assignments).toEqual({ expected: 2, missing: 1 });
    expect(result.request.grades).toEqual([
      { assessment_id: "grd-0001", assessment_date: "2026-04-02", points: 0, maximum: 10, resolved: true },
      { assessment_id: "grd-0002", assessment_date: "2026-04-12", points: null, maximum: null, resolved: false },
    ]);
  });

  it("does not send a learner code the scoring service would treat as a name", () => {
    const result = buildScoreRequest({
      learnerCode: "SUNNY",
      enrollments: [],
      scoringDate: SCORING,
      timeZone: "UTC",
      now: NOW,
      thresholds: { watch: 40, high: 70 },
    });
    expect(result).toEqual({ ok: false, reason: "code" });
  });

  it("leaves a learner who withdrew before a class out of that class", () => {
    const result = build({ withdrawnOn: day("2026-04-07") });
    if (!result.ok) throw new Error("request");
    expect(result.request.attendance.map((row) => row.session_date)).toEqual(["2026-04-06"]);
    expect(result.request.assignments).toEqual({ expected: 1, missing: 0 });
  });
});
