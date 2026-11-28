import { describe, expect, it } from "vitest";
import { pageGuard, type Actor } from "@/lib/auth/permissions";
import { listAssignedSections } from "@/lib/data/records";

function actor(role: Actor["role"], assignedSectionIds: string[] = []): Actor {
  return {
    id: `${role}-1`,
    role,
    centerId: "center-a",
    active: true,
    displayName: "Test",
    learnerId: null,
    assignedSectionIds,
    enrolledSectionIds: [],
  };
}

describe("teacher landing access", () => {
  it("refuses anyone who is not the signed-in teacher", () => {
    expect(pageGuard(null, "TEACHER")).toEqual({ ok: false, redirectTo: "/" });
    expect(pageGuard(actor("STUDENT"), "TEACHER").ok).toBe(false);
    expect(pageGuard(actor("CENTER_DIRECTOR"), "TEACHER").ok).toBe(false);
    expect(pageGuard(actor("ADMIN"), "TEACHER").ok).toBe(false);
    expect(pageGuard(actor("TEACHER"), "TEACHER").ok).toBe(true);
  });

  it("does not list sections for another role", async () => {
    let calls = 0;
    const db = {
      section: {
        findMany: async () => {
          calls += 1;
          return [{ id: "other", name: "Other", course: { title: "Other course" } }];
        },
      },
    };
    const sections = await listAssignedSections(actor("STUDENT", ["section-morning"]), db as never);
    expect(sections).toEqual([]);
    expect(calls).toBe(0);
  });

  it("asks only for the signed-in teacher's assigned sections", async () => {
    let where: unknown;
    const db = {
      section: {
        findMany: async (args: { where: unknown }) => {
          where = args.where;
          return [{ id: "section-morning", name: "Morning Group", course: { title: "Demo English" } }];
        },
      },
    };
    const sections = await listAssignedSections(actor("TEACHER", ["section-morning"]), db as never);
    expect(sections.map((section) => section.id)).toEqual(["section-morning"]);
    expect(where).toEqual({
      id: { in: ["section-morning"] },
      course: { centerId: "center-a" },
    });
  });
});
