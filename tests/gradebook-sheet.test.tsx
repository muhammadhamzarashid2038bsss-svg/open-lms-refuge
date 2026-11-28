import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SectionGradebook } from "../components/section-gradebook";
import type { GradebookView } from "../lib/data/assignments";
import type { LocalRecordMutation } from "../lib/device/local-records";
import type { PendingGrade } from "../lib/lms/gradebook";

const centerId = "00000000-0000-4000-8000-0000000000c1";
const userId = "00000000-0000-4000-8000-0000000000a1";
const deviceId = "00000000-0000-4000-8000-0000000000d1";
const learnerA = "00000000-0000-4000-8000-000000000022";
const learnerB = "00000000-0000-4000-8000-000000000023";
const paperId = "00000000-0000-4000-8000-000000000011";
const examId = "00000000-0000-4000-8000-000000000012";

function book(): GradebookView {
  return {
    sectionId: "00000000-0000-4000-8000-0000000000b1",
    sectionName: "Morning group",
    courseTitle: "Literacy",
    learners: [
      { id: learnerA, learnerCode: "LNR-0001", displayName: "Demo Learner 01" },
      { id: learnerB, learnerCode: "LNR-0002", displayName: "Demo Learner 02" },
    ],
    assignments: [
      { id: paperId, title: "Paper sheet", kind: "PAPER", maxPoints: "20.00" },
      { id: examId, title: "Class exam", kind: "IN_CLASS_EXAM", maxPoints: "10.00" },
    ],
    grades: [
      {
        id: "00000000-0000-4000-8000-000000000088",
        assignmentId: paperId,
        learnerId: learnerA,
        points: "4.00",
        academicNote: null,
        versionVector: {},
        provisional: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000089",
        assignmentId: examId,
        learnerId: learnerB,
        points: "5.00",
        academicNote: null,
        versionVector: {},
        provisional: true,
      },
    ],
    files: [],
  };
}

function buttonOpen(html: string, label: string): string {
  const end = html.indexOf(`>${label}<`);
  const start = html.lastIndexOf("<button", end);
  return html.slice(start, end);
}

function hasDisabledAttribute(tag: string): boolean {
  return /(?:\s)disabled(?:=(?:"[^"]*"|'[^']*'))?(?=[\s>/]|$)/.test(tag);
}

function waiting(points: string, syncState: LocalRecordMutation["syncState"] = "pending"): LocalRecordMutation {
  return {
    clientMutationId: "00000000-0000-4000-8000-0000000000e1",
    centerId,
    userId,
    localDeviceId: deviceId,
    entityType: "GRADE_ENTRY",
    recordId: "00000000-0000-4000-8000-000000000099",
    versionVector: { [deviceId]: 1 },
    deviceRecordedAt: "2026-11-28T01:00:00.000Z",
    createdOffline: true,
    syncState,
    content: { assignmentId: paperId, learnerId: learnerA, points, academicNote: "steady" },
  };
}

describe("gradebook sheet", () => {
  it("lists every learner and assignment without a sideways table", () => {
    const html = renderToStaticMarkup(
      <SectionGradebook centerId={centerId} userId={userId} book={book()} initialPhone={{ deviceId, mutations: [] }} />,
    );
    expect(html).toContain("Demo Learner 01");
    expect(html).toContain("Demo Learner 02");
    expect(html).toContain("LNR-0001");
    expect(html).toContain("LNR-0002");
    expect(html).toContain("Paper sheet");
    expect(html).toContain("Class exam");
    expect(html).toContain("Maximum 20.00");
    expect(html).toContain("Maximum 10.00");
    expect(html).toContain('value="4.00"');
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("md:grid-cols-2");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Swipe sideways");
    expect(html).toContain('href="/teacher/records"');
    expect(html).toContain("Academic notes and progress notes");
    const saveButton = html.indexOf(">Save marks on this phone<");
    const sendButton = html.indexOf(">Send saved edits<");
    expect(saveButton).toBeGreaterThan(-1);
    expect(sendButton).toBeGreaterThan(saveButton);
    expect(html).toContain("Waiting for a conflict choice.");
    expect(html).toContain('href="/teacher/conflicts"');
    expect(html).toContain("focus-visible:outline");
    const labels = html.match(/<label/g) ?? [];
    const inputs = html.match(/<input/g) ?? [];
    // Two learners and two assignments, minus the conflict cell, which has no box.
    expect(labels.length).toBe(3);
    expect(inputs.length).toBe(3);
    const inputTags = html.match(/<input\b[^>]*>/g) ?? [];
    expect(inputTags.every((tag) => !hasDisabledAttribute(tag))).toBe(true);
    expect(hasDisabledAttribute(buttonOpen(html, "Save marks on this phone"))).toBe(false);
    expect(hasDisabledAttribute(buttonOpen(html, "Send saved edits"))).toBe(false);
  });

  it("keeps grade boxes and Save off while the phone grades are still loading", () => {
    const html = renderToStaticMarkup(<SectionGradebook centerId={centerId} userId={userId} book={book()} />);
    const inputTags = html.match(/<input\b[^>]*>/g) ?? [];
    expect(inputTags.length).toBe(3);
    expect(inputTags.every((tag) => hasDisabledAttribute(tag))).toBe(true);
    expect(hasDisabledAttribute(buttonOpen(html, "Save marks on this phone"))).toBe(true);
    expect(hasDisabledAttribute(buttonOpen(html, "Send saved edits"))).toBe(false);
    expect(html).toContain('value="4.00"');
    expect(html).toContain("Checking marks saved on this phone");
    expect(html).not.toContain("On this phone");
  });

  it("never opens editing when the phone database is missing or the read fails", () => {
    for (const localRead of ["unavailable", "failed"] as const) {
      const html = renderToStaticMarkup(
        <SectionGradebook
          centerId={centerId}
          userId={userId}
          book={book()}
          localRead={localRead}
          initialPhone={{ deviceId, mutations: [waiting("12.00")] }}
        />,
      );
      const inputTags = html.match(/<input\b[^>]*>/g) ?? [];
      expect(inputTags.length).toBeGreaterThan(0);
      expect(inputTags.every((tag) => hasDisabledAttribute(tag))).toBe(true);
      expect(hasDisabledAttribute(buttonOpen(html, "Save marks on this phone"))).toBe(true);
      expect(html).toContain("Grade editing is unavailable because the marks saved on this phone could not be safely read.");
      expect(html).toContain('value="4.00"');
      expect(html).not.toContain('value="12.00"');
      expect(html).not.toContain("On this phone");
    }
  });

  it("does not let a pending phone mark be edited from the older server number before the read finishes", () => {
    const html = renderToStaticMarkup(
      <SectionGradebook
        centerId={centerId}
        userId={userId}
        book={book()}
        localRead="loading"
        initialPhone={{ deviceId, mutations: [waiting("12.00")] }}
      />,
    );
    expect(html).toContain('value="4.00"');
    expect(html).not.toContain('value="12.00"');
    expect(hasDisabledAttribute(buttonOpen(html, "Save marks on this phone"))).toBe(true);
    const source = readFileSync(join(process.cwd(), "components", "section-gradebook.tsx"), "utf8");
    const guard = source.indexOf("if (!gradeEditingAllowed(phoneRead))");
    const saveCall = source.indexOf("saveGradebookMarks(factory, owner, planned.drafts)");
    expect(guard).toBeGreaterThan(-1);
    expect(saveCall).toBeGreaterThan(guard);
  });

  it("shows a waiting phone mark instead of the older server mark", () => {
    const html = renderToStaticMarkup(
      <SectionGradebook
        centerId={centerId}
        userId={userId}
        book={book()}
        initialPhone={{ deviceId, mutations: [waiting("12.00")] }}
      />,
    );
    expect(html).toContain('value="12.00"');
    expect(html).not.toContain('value="4.00"');
    expect(html).toContain("On this phone");
    expect(hasDisabledAttribute(buttonOpen(html, "Save marks on this phone"))).toBe(false);
    expect(html).toContain("Waiting for a conflict choice.");
    expect(html).toContain(">5.00<");
  });

  it("shows a mark accepted during this visit instead of the older server mark", () => {
    const accepted = waiting("12.00", "acknowledged");
    const confirmed: Record<string, PendingGrade> = {
      [`${paperId}-${learnerA}`]: {
        points: "12.00",
        academicNote: "steady",
        recordId: accepted.recordId,
        versionVector: accepted.versionVector,
      },
    };
    const html = renderToStaticMarkup(
      <SectionGradebook
        centerId={centerId}
        userId={userId}
        book={book()}
        initialPhone={{ deviceId, mutations: [accepted] }}
        initialConfirmed={confirmed}
      />,
    );
    expect(html).toContain('value="12.00"');
    expect(html).not.toContain('value="4.00"');
    expect(html).toContain("On the server");
    expect(html).not.toContain("On this phone");
    expect(hasDisabledAttribute(buttonOpen(html, "Save marks on this phone"))).toBe(false);
  });

  it("does not keep an older acknowledged mark after a fresh page load", () => {
    const html = renderToStaticMarkup(
      <SectionGradebook
        centerId={centerId}
        userId={userId}
        book={book()}
        initialPhone={{ deviceId, mutations: [waiting("12.00", "acknowledged")] }}
      />,
    );
    expect(html).toContain('value="4.00"');
    expect(html).not.toContain('value="12.00"');
    expect(html).not.toContain("On the server");
    expect(html).not.toContain("On this phone");
  });

  it("does not read the phone by saving or sending", () => {
    const source = readFileSync(join(process.cwd(), "components", "section-gradebook.tsx"), "utf8");
    const effectStart = source.indexOf("Reading the phone must not save or send");
    const effectEnd = source.indexOf("function browserFactory");
    const effect = source.slice(effectStart, effectEnd);
    expect(effect).toContain("listLocalRecords");
    expect(effect).not.toContain("saveGradebookMarks");
    expect(effect).not.toContain("syncLocalRecords");
    expect(source).toContain("acknowledgedAfterSend");
    expect(source).not.toContain("saveAttendanceAction");
  });
});
