// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_ASSIGNED_SECTIONS, TeacherSectionList } from "@/components/teacher-section-list";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const morning = { id: "section-morning", name: "Morning Group", course: { title: "Demo English and Number Sense" } };

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

function renderList(mode: "sections" | "attendance" | "gradebook", sections = [morning]) {
  act(() => {
    root.render(<TeacherSectionList sections={sections} mode={mode} />);
  });
}

describe("teacher section destinations", () => {
  it("shows the assigned section and its existing tools", () => {
    renderList("sections");
    expect(container.textContent).toContain("Morning Group");
    expect(container.textContent).toContain("Demo English and Number Sense");
    expect(container.querySelector("a[href='/sections/section-morning/timetable']")?.textContent).toBe("Timetable");
    expect(container.querySelector("a[href='/teacher/sections/section-morning/gradebook']")?.textContent).toBe("Gradebook");
    expect(container.querySelector("a[href='/teacher/sections/section-morning/performance']")?.textContent).toBe(
      "Performance",
    );
  });

  it("links attendance to the existing timetable", () => {
    renderList("attendance");
    const links = [...container.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([["Open timetable", "/sections/section-morning/timetable"]]);
  });

  it("links a gradebook card to the existing gradebook", () => {
    renderList("gradebook");
    const links = [...container.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([["Open gradebook", "/teacher/sections/section-morning/gradebook"]]);
  });

  it("tells a teacher with no sections, and shows no actions", () => {
    renderList("attendance", []);
    expect(container.textContent).toContain(NO_ASSIGNED_SECTIONS);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
