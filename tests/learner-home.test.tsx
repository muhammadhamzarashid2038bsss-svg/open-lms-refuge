// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearnerHome, type LearnerSectionSummary } from "@/components/learner-home";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const withFiles: LearnerSectionSummary = {
  id: "section-morning",
  name: "Morning Group",
  courseTitle: "Demo English and Number Sense",
  academicYear: 2026,
  semester: "SEMESTER_1",
  downloadableCount: 2,
};

const withoutFiles: LearnerSectionSummary = {
  id: "section-afternoon",
  name: "Afternoon Group",
  courseTitle: "Demo English and Number Sense",
  academicYear: 2026,
  semester: "SEMESTER_1",
  downloadableCount: 0,
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderHome(
  today: { ok: true; classes: [] } | { ok: false; message: string } = { ok: true, classes: [] },
  sections: LearnerSectionSummary[] = [withFiles, withoutFiles],
) {
  act(() => {
    root.render(
      <LearnerHome
        learnerCode="LNR-0001"
        attendanceCount={4}
        gradeCount={1}
        sections={sections}
        today={today}
      />,
    );
  });
}

describe("learner home", () => {
  it("keeps a today target when the center clock cannot be read", () => {
    renderHome({ ok: false, message: "The center clock setting needs a fix before today's classes can be shown." });
    const today = container.querySelector("#today");
    expect(today?.textContent).toContain("Today's classes");
    expect(today?.textContent).toContain("The center clock setting needs a fix");
    expect(container.querySelector("#sections")).toBeTruthy();
  });

  it("keeps a today target when there is no class", () => {
    renderHome();
    expect(container.querySelector("#today")?.textContent).toContain("No class today.");
  });

  it("shows a file count on a section that has files, and a clear empty line otherwise", () => {
    renderHome();
    const cards = [...container.querySelectorAll("#sections li")];
    expect(cards[0]?.textContent).toContain("Morning Group");
    expect(cards[0]?.textContent).toContain("2 downloadable files.");
    expect(cards[0]?.className).toContain("bg-sky-50");
    expect(cards[1]?.textContent).toContain("No downloadable files for you here.");
    expect(cards[1]?.className).not.toContain("bg-sky-50");
    expect(cards[0]?.querySelector("a")?.getAttribute("href")).toBe("/student/sections/section-morning");
  });

  it("puts homework outside the section list and shows record counts", () => {
    renderHome();
    const homework = container.querySelector("a[href='/student/homework']");
    expect(homework?.textContent).toBe("Homework files");
    expect(container.querySelector("#sections")?.contains(homework ?? null)).toBe(false);
    expect(container.textContent).toContain("LNR-0001");
    expect(container.textContent).toContain("Attendance marks recorded");
    expect(container.textContent).toContain("4");
    expect(container.textContent).toContain("Grades recorded");
    expect(container.textContent).not.toContain("waiting to send");
    expect(container.textContent).not.toContain("Improving");
  });
});
