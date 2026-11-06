import { describe, expect, it } from "vitest";
import {
  canListAccounts,
  canManageCourse,
  canManageResource,
  canManageTimetable,
  canReadContact,
  canReadLearner,
  canReadResource,
  canReadSection,
  canResetPassword,
  canResetPin,
  canSetActive,
  homeForRole,
  pageGuard,
  type Actor,
  type LearnerScope,
  type ResourceScope,
} from "../lib/auth/permissions";
import { sessionVerdict, shouldDropSessionCookie } from "../lib/auth/session-policy";
import { FAILED_ATTEMPTS_BEFORE_LOCK, LOCKOUT_MS, SESSION_IDLE_MS } from "../lib/auth/constants";

const centerA = "center-a";
const centerB = "center-b";

function actor(overrides: Partial<Actor> & Pick<Actor, "role">): Actor {
  return {
    id: overrides.id ?? `${overrides.role}-1`,
    role: overrides.role,
    centerId: overrides.centerId ?? centerA,
    active: overrides.active ?? true,
    displayName: "Test",
    learnerId: overrides.learnerId ?? null,
    assignedSectionIds: overrides.assignedSectionIds ?? [],
    enrolledSectionIds: overrides.enrolledSectionIds ?? [],
  };
}

const learner: LearnerScope = {
  id: "learner-1",
  userId: "user-learner-1",
  centerId: centerA,
  sectionIds: ["morning"],
};

const morning = { id: "morning", centerId: centerA };
const afternoon = { id: "afternoon", centerId: centerA };
const courseWide: ResourceScope = {
  id: "pdf",
  centerId: centerA,
  sectionId: null,
  courseSectionIds: ["morning", "afternoon"],
};
const morningFile: ResourceScope = {
  id: "audio",
  centerId: centerA,
  sectionId: "morning",
  courseSectionIds: ["morning", "afternoon"],
};

describe("role permission matrix", () => {
  const student = actor({ role: "STUDENT", id: "user-learner-1", learnerId: "learner-1", enrolledSectionIds: ["morning"] });
  const otherStudent = actor({ role: "STUDENT", id: "user-learner-2", learnerId: "learner-2", enrolledSectionIds: ["morning"] });
  const morningTeacher = actor({ role: "TEACHER", assignedSectionIds: ["morning"] });
  const afternoonTeacher = actor({ role: "TEACHER", assignedSectionIds: ["afternoon"] });
  const director = actor({ role: "CENTER_DIRECTOR" });
  const otherDirector = actor({ role: "CENTER_DIRECTOR", centerId: centerB });
  const admin = actor({ role: "ADMIN" });
  const switchedOff = actor({ role: "TEACHER", active: false, assignedSectionIds: ["morning"] });

  it("sends each role to its own home and blocks a direct URL for the wrong role", () => {
    expect(homeForRole("STUDENT")).toBe("/student");
    expect(homeForRole("TEACHER")).toBe("/teacher");
    expect(homeForRole("CENTER_DIRECTOR")).toBe("/director");
    expect(homeForRole("ADMIN")).toBe("/admin");
    expect(pageGuard(null, "TEACHER")).toEqual({ ok: false, redirectTo: "/" });
    expect(pageGuard(student, "TEACHER")).toEqual({ ok: false, redirectTo: "/student" });
    expect(pageGuard(morningTeacher, "TEACHER")).toEqual({ ok: true });
  });

  it("lets a learner see only their own records and their section resources", () => {
    expect(canReadLearner(student, learner)).toBe(true);
    expect(canReadLearner(otherStudent, learner)).toBe(false);
    expect(canReadSection(student, morning)).toBe(true);
    expect(canReadSection(student, afternoon)).toBe(false);
    expect(canReadResource(student, morningFile)).toBe(true);
    expect(canReadResource(student, { ...morningFile, sectionId: "afternoon", id: "web" })).toBe(false);
    expect(canReadResource(student, courseWide)).toBe(true);
    expect(canReadContact(student, learner)).toBe(false);
    expect(canListAccounts(student, centerA)).toBe(false);
  });

  it("lets a teacher see only assigned sections", () => {
    expect(canReadLearner(morningTeacher, learner)).toBe(true);
    expect(canReadLearner(afternoonTeacher, learner)).toBe(false);
    expect(canReadSection(morningTeacher, morning)).toBe(true);
    expect(canReadSection(morningTeacher, afternoon)).toBe(false);
    expect(canReadResource(morningTeacher, morningFile)).toBe(true);
    expect(canReadResource(afternoonTeacher, morningFile)).toBe(false);
    expect(canReadResource(morningTeacher, courseWide)).toBe(true);
    expect(canResetPin(morningTeacher, learner)).toBe(true);
    expect(canResetPin(afternoonTeacher, learner)).toBe(false);
    expect(canResetPassword(morningTeacher, { id: "t2", role: "TEACHER", centerId: centerA })).toBe(false);
    expect(canReadContact(morningTeacher, learner)).toBe(false);
  });

  it("lets a director see their center, including contact, and not another center", () => {
    expect(canReadLearner(director, learner)).toBe(true);
    expect(canReadLearner(otherDirector, learner)).toBe(false);
    expect(canReadSection(director, afternoon)).toBe(true);
    expect(canReadResource(director, morningFile)).toBe(true);
    expect(canReadContact(director, learner)).toBe(true);
    expect(canReadContact(otherDirector, learner)).toBe(false);
    expect(canListAccounts(director, centerA)).toBe(true);
    expect(canListAccounts(director, centerB)).toBe(false);
    expect(canResetPassword(director, { id: "t2", role: "TEACHER", centerId: centerA })).toBe(true);
    expect(canResetPassword(director, { id: "admin", role: "ADMIN", centerId: centerA })).toBe(false);
    expect(canSetActive(director, { id: director.id, role: "CENTER_DIRECTOR", centerId: centerA })).toBe(false);
  });

  it("lets staff manage courses and section materials without opening admin back doors", () => {
    expect(canManageCourse(morningTeacher, centerA)).toBe(true);
    expect(canManageCourse(student, centerA)).toBe(false);
    expect(canManageResource(morningTeacher, morningFile)).toBe(true);
    expect(canManageResource(afternoonTeacher, morningFile)).toBe(false);
    expect(canManageResource(student, courseWide)).toBe(false);
    expect(canManageResource(director, morningFile)).toBe(true);
    expect(canManageTimetable(morningTeacher, morning)).toBe(true);
    expect(canManageTimetable(morningTeacher, afternoon)).toBe(false);
    expect(canManageTimetable(student, morning)).toBe(false);
    expect(canManageTimetable(director, afternoon)).toBe(true);
    expect(canManageTimetable(otherDirector, afternoon)).toBe(false);
    expect(canManageTimetable(admin, morning)).toBe(false);
  });

  it("lets an admin manage accounts and not read learner records", () => {
    expect(canReadLearner(admin, learner)).toBe(false);
    expect(canReadSection(admin, morning)).toBe(false);
    expect(canReadResource(admin, courseWide)).toBe(false);
    expect(canReadContact(admin, learner)).toBe(false);
    expect(canListAccounts(admin, centerB)).toBe(true);
    expect(canResetPin(admin, { ...learner, centerId: centerB })).toBe(true);
    expect(canResetPin(admin, learner)).toBe(true);
    expect(canResetPassword(admin, { id: "d", role: "CENTER_DIRECTOR", centerId: centerB })).toBe(true);
    expect(canSetActive(admin, { id: "someone", role: "TEACHER", centerId: centerB })).toBe(true);
    expect(canSetActive(admin, { id: admin.id, role: "ADMIN", centerId: centerA })).toBe(false);
  });

  it("blocks a switched-off account even when the section matches", () => {
    expect(canReadLearner(switchedOff, learner)).toBe(false);
    expect(canReadSection(switchedOff, morning)).toBe(false);
    expect(canResetPin(switchedOff, learner)).toBe(false);
  });
});

describe("session expiry", () => {
  const start = new Date("2026-11-05T08:00:00.000Z");

  it("ends a session after 30 idle minutes or 8 hours, whichever comes first", () => {
    const row = {
      revokedAt: null,
      lastSeenAt: start,
      expiresAt: new Date(start.getTime() + 8 * 60 * 60 * 1000),
    };
    expect(sessionVerdict(row, new Date(start.getTime() + SESSION_IDLE_MS - 1))).toBe("ok");
    expect(sessionVerdict(row, new Date(start.getTime() + SESSION_IDLE_MS))).toBe("idle");
    const fresh = { ...row, lastSeenAt: new Date(row.expiresAt.getTime() - 1000) };
    expect(sessionVerdict(fresh, row.expiresAt)).toBe("absolute");
    expect(sessionVerdict({ ...row, revokedAt: start }, start)).toBe("revoked");
  });

  it("drops a cookie that no longer proves sign-in", () => {
    expect(shouldDropSessionCookie("ok")).toBe(false);
    expect(shouldDropSessionCookie("idle")).toBe(true);
    expect(shouldDropSessionCookie("absolute")).toBe(true);
    expect(shouldDropSessionCookie("revoked")).toBe(true);
    expect(shouldDropSessionCookie("missing")).toBe(true);
    expect(shouldDropSessionCookie("unreadable")).toBe(true);
  });

  it("locks after 5 failures for 15 minutes", () => {
    expect(FAILED_ATTEMPTS_BEFORE_LOCK).toBe(5);
    expect(LOCKOUT_MS).toBe(15 * 60 * 1000);
  });
});
