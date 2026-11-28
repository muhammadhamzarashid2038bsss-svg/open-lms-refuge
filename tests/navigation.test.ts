import { describe, expect, it } from "vitest";
import { ROLES, type RoleName } from "@/lib/auth/permissions";
import { pendingHomeworkCount } from "@/lib/device/homework-pending";
import {
  currentDestinationId,
  hrefPath,
  navigationFor,
  navigationHrefs,
  linkKind,
  navigationUsesOnlyAllowedPaths,
  roleLabel,
  visibleHref,
} from "@/lib/navigation";

const FORBIDDEN: Record<RoleName, string[]> = {
  STUDENT: [
    "/courses",
    "/teacher",
    "/teacher/sections",
    "/teacher/attendance",
    "/teacher/gradebook",
    "/teacher/records",
    "/director",
    "/director/check-ins",
    "/admin",
    "/audit",
    "/export",
    "/handoff",
  ],
  TEACHER: ["/student", "/student/homework", "/director", "/director/check-ins", "/admin", "/audit", "/export"],
  CENTER_DIRECTOR: [
    "/student",
    "/student/homework",
    "/teacher/sections",
    "/teacher/attendance",
    "/teacher/gradebook",
    "/teacher/records",
    "/teacher/conflicts",
    "/admin",
  ],
  ADMIN: [
    "/student",
    "/student/homework",
    "/teacher",
    "/teacher/sections",
    "/teacher/attendance",
    "/teacher/gradebook",
    "/teacher/records",
    "/director",
    "/director/check-ins",
    "/courses",
    "/handoff",
  ],
};

describe("role navigation", () => {
  it("names each role in plain language", () => {
    expect(roleLabel("STUDENT")).toBe("Learner");
    expect(roleLabel("TEACHER")).toBe("Teacher");
    expect(roleLabel("CENTER_DIRECTOR")).toBe("Centre director");
    expect(roleLabel("ADMIN")).toBe("Administrator");
  });

  it("shows the learner destinations", () => {
    expect(navigationFor("STUDENT").items.map((item) => [item.label, item.href])).toEqual([
      ["Home", "/student"],
      ["Today's classes", "/student#today"],
      ["My sections", "/student#sections"],
      ["Homework", "/student/homework"],
      ["This phone", "/student#this-phone"],
    ]);
    expect(navigationFor("STUDENT").menuLabel).toBeNull();
  });

  it("sends a teacher to the section list for attendance and the gradebook", () => {
    const labels = navigationFor("TEACHER").items.map((item) => item.label);
    expect(labels).toEqual([
      "Home",
      "My sections",
      "Attendance",
      "Gradebook",
      "Materials",
      "Save a grade or note",
      "Conflicts",
      "Handoff reports",
      "This phone",
    ]);
    const byLabel = Object.fromEntries(navigationFor("TEACHER").items.map((item) => [item.label, item.href]));
    expect(byLabel["My sections"]).toBe("/teacher/sections");
    expect(byLabel.Attendance).toBe("/teacher/attendance");
    expect(byLabel.Gradebook).toBe("/teacher/gradebook");
    expect(new Set([byLabel.Home, byLabel["My sections"], byLabel.Attendance, byLabel.Gradebook]).size).toBe(4);
    expect(byLabel.Materials).toBe("/courses");
    expect(navigationFor("TEACHER").menuLabel).toBe("More");
  });

  it("keeps director reports and admin tools on existing pages", () => {
    expect(navigationFor("CENTER_DIRECTOR").menuLabel).toBe("Reports");
    expect(navigationFor("CENTER_DIRECTOR").items.map((item) => item.label)).toEqual([
      "Home",
      "Sections",
      "People",
      "Check-ins",
      "Center performance",
      "Progress notes",
      "Handoff reports",
      "Audit log",
      "Grant export",
      "Skill tags",
      "Courses",
    ]);
    expect(navigationFor("ADMIN").items.map((item) => [item.label, item.href])).toEqual([
      ["Home", "/admin"],
      ["Accounts", "/admin#accounts"],
      ["Sections", "/admin#sections"],
      ["Audit", "/audit"],
      ["Export", "/export"],
    ]);
    expect(navigationFor("ADMIN").menuLabel).toBeNull();
  });

  it("does not link a role to a page that role cannot open", () => {
    for (const role of ROLES) {
      expect(navigationUsesOnlyAllowedPaths(role)).toBe(true);
      const paths = navigationHrefs(role).map(hrefPath);
      for (const blocked of FORBIDDEN[role]) {
        expect(paths).not.toContain(blocked);
      }
    }
  });

  it("marks the current destination on an inner page", () => {
    expect(currentDestinationId("TEACHER", "/teacher/sections/section-1/gradebook", "")).toBe("gradebook");
    expect(currentDestinationId("TEACHER", "/sections/section-1/sessions/session-1/attendance", "")).toBe("attendance");
    expect(currentDestinationId("TEACHER", "/teacher/records", "")).toBe("records");
    expect(currentDestinationId("STUDENT", "/student/homework", "")).toBe("homework");
    expect(currentDestinationId("STUDENT", "/student", "#today")).toBe("today");
    expect(currentDestinationId("CENTER_DIRECTOR", "/director/check-ins", "")).toBe("check-ins");
    expect(currentDestinationId("CENTER_DIRECTOR", "/handoff/report-1", "")).toBe("handoff");
    expect(currentDestinationId("ADMIN", "/export", "")).toBe("export");
    expect(currentDestinationId("ADMIN", "/audit", "")).toBe("audit");
  });

  it("matches the hash exactly and ignores a hash on another page", () => {
    expect(currentDestinationId("TEACHER", "/teacher/sections", "")).toBe("sections");
    expect(currentDestinationId("TEACHER", "/teacher/attendance", "")).toBe("attendance");
    expect(currentDestinationId("TEACHER", "/teacher/gradebook", "")).toBe("gradebook");
    expect(currentDestinationId("TEACHER", "/teacher", "#this-phone")).toBe("phone");
    expect(currentDestinationId("TEACHER", "/teacher", "")).toBe("home");
    expect(currentDestinationId("TEACHER", "/teacher", "#attendance")).toBe("home");
    expect(currentDestinationId("TEACHER", "/teacher/records", "#sections")).toBe("records");
    expect(currentDestinationId("TEACHER", "/teacher/sections/section-1/gradebook", "#sections")).toBe("gradebook");
    expect(currentDestinationId("STUDENT", "/student", "#today")).toBe("today");
    expect(currentDestinationId("STUDENT", "/student", "#sections")).toBe("sections");
    expect(currentDestinationId("STUDENT", "/student", "#this-phone")).toBe("phone");
    expect(currentDestinationId("STUDENT", "/student/homework", "#today")).toBe("homework");
    expect(currentDestinationId("STUDENT", "/student", "#missing")).toBe("home");
    expect(currentDestinationId("CENTER_DIRECTOR", "/director", "#timetables")).toBe("sections");
    expect(currentDestinationId("CENTER_DIRECTOR", "/director", "#people")).toBe("people");
    expect(currentDestinationId("CENTER_DIRECTOR", "/director", "")).toBe("home");
    expect(currentDestinationId("ADMIN", "/admin", "#accounts")).toBe("accounts");
    expect(currentDestinationId("ADMIN", "/admin", "#sections")).toBe("sections");
    expect(currentDestinationId("ADMIN", "/admin", "")).toBe("home");
  });

  it("uses a hash link only when that section is on the current page", () => {
    expect(visibleHref("/student#today", "/student")).toBe("#today");
    expect(visibleHref("/student#today", "/student/homework")).toBe("/student#today");
    expect(visibleHref("/student", "/student")).toBe("/student");
    expect(visibleHref("/teacher/attendance", "/teacher")).toBe("/teacher/attendance");
    expect(linkKind("/teacher/attendance", "/teacher")).toBe("route");
    expect(linkKind("/teacher/gradebook", "/teacher/gradebook")).toBe("same");
    expect(linkKind("/teacher/sections", "/teacher")).toBe("route");
    expect(visibleHref("/courses", "/teacher")).toBe("/courses");
    expect(linkKind("/student/homework", "/student")).toBe("route");
    expect(linkKind("/student", "/student")).toBe("same");
    expect(linkKind("/student#today", "/student")).toBe("hash");
    expect(linkKind("/teacher/records", "/teacher")).toBe("route");
    expect(linkKind("/courses", "/teacher")).toBe("route");
  });
});

describe("homework waiting count", () => {
  it("counts files that are still on the phone", () => {
    expect(pendingHomeworkCount([{ status: "queued" }, { status: "submitted" }, { status: "failed" }])).toBe(2);
    expect(pendingHomeworkCount([{ status: "submitted" }])).toBe(0);
  });
});
