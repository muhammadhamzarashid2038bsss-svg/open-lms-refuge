import { describe, expect, it } from "vitest";
import { managedSections } from "../lib/lms/section-management";
import { sectionAssignmentLabel, teacherChoiceLabel, type TeacherLabelSource } from "../lib/lms/teacher-label";

const ada: TeacherLabelSource = { id: "11111111-1111-4111-8111-111111111111", displayName: "Ada", email: "ada@demo.invalid", centerCode: "DEMO" };
const lockA: TeacherLabelSource = { id: "22222222-2222-4222-8222-222222222222", displayName: "Lock Test", email: "lock.a@demo.invalid", centerCode: "DEMO" };
const lockB: TeacherLabelSource = { id: "33333333-3333-4333-8333-333333333333", displayName: "Lock Test", email: "lock.b@demo.invalid", centerCode: "NORTH" };
const nameless: TeacherLabelSource = { id: "44444444-4444-4444-8444-444444444444", displayName: "Lock Test", email: null, centerCode: "DEMO" };

describe("teacher choice labels", () => {
  it("leaves a unique display name as it is", () => {
    expect(teacherChoiceLabel(ada, [ada, lockA], false)).toBe("Ada");
  });

  it("adds the email when display names match", () => {
    expect(teacherChoiceLabel(lockA, [lockA, lockB], false)).toBe("Lock Test · lock.a@demo.invalid");
  });

  it("uses a short account id when a shared name has no email", () => {
    expect(teacherChoiceLabel(nameless, [lockA, nameless], false)).toBe("Lock Test · account 44444444");
  });

  it("keeps the centre code for an administrator, including a unique name", () => {
    expect(teacherChoiceLabel(ada, [ada], true)).toBe("Ada · DEMO");
    expect(teacherChoiceLabel(lockB, [lockA, lockB], true)).toBe("Lock Test · lock.b@demo.invalid · NORTH");
  });

  it("describes staffed and unstaffed sections in one line", () => {
    expect(sectionAssignmentLabel("Demo English and Number Sense", "Morning Group", 1)).toBe(
      "Demo English and Number Sense · Morning Group — 1 current teacher",
    );
    expect(sectionAssignmentLabel("Demo English and Number Sense", "Afternoon Group", 0)).toBe(
      "Demo English and Number Sense · Afternoon Group — Unstaffed",
    );
    expect(sectionAssignmentLabel("Demo English and Number Sense", "Evening Group", 2, "DEMO")).toBe(
      "Demo English and Number Sense · Evening Group · DEMO — 2 current teachers",
    );
  });

  it("puts staffed and unstaffed sections in the same list and hides the centre code from a director", () => {
    const rows = managedSections(
      [{
        id: "staffed",
        courseTitle: "Demo English and Number Sense",
        sectionName: "Morning Group",
        centerId: "centre",
        centerCode: "DEMO",
        teachers: [{ id: "ada", name: "Ada" }, { id: "bo", name: "Bo" }],
      }],
      [{
        id: "empty",
        courseTitle: "Demo English and Number Sense",
        sectionName: "Afternoon Group",
        centerId: "centre",
        centerCode: "DEMO",
      }],
      false,
    );
    expect(rows.map((row) => sectionAssignmentLabel(row.courseTitle, row.sectionName, row.currentTeachers.length))).toEqual([
      "Demo English and Number Sense · Afternoon Group — Unstaffed",
      "Demo English and Number Sense · Morning Group — 2 current teachers",
    ]);
    expect(rows.every((row) => row.centerCode === undefined)).toBe(true);
  });
});
