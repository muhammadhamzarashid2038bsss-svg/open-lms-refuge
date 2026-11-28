// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeacherHome } from "@/components/teacher-home";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

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

function renderHome() {
  act(() => {
    root.render(
      <TeacherHome
        pin={<h2>Set a new learner PIN</h2>}
        phone={<section id="this-phone">This phone</section>}
      />,
    );
  });
}

describe("teacher home", () => {
  it("shows the three existing jobs as cards, then the PIN form, then this phone", () => {
    renderHome();
    const links = [...container.querySelectorAll("a")].map((link) => ({
      text: link.textContent,
      href: link.getAttribute("href"),
    }));
    expect(links).toEqual([
      { text: "Save a grade or note on this phone", href: "/teacher/records" },
      { text: "Review grade and note conflicts", href: "/teacher/conflicts" },
      { text: "Handoff reports", href: "/handoff" },
    ]);
    expect(container.textContent).toContain("A save stays on this phone first.");
    expect(container.textContent).toContain("Both copies are kept.");
    expect(container.textContent).toContain("when a teacher is switched off");

    const text = container.textContent ?? "";
    const work = text.indexOf("Your work");
    const pin = text.indexOf("Set a new learner PIN");
    const phone = text.indexOf("This phone");
    expect(work).toBeGreaterThanOrEqual(0);
    expect(work).toBeLessThan(pin);
    expect(pin).toBeLessThan(phone);
    expect(container.querySelector("#this-phone")).toBeTruthy();
    expect(container.querySelector("section.bg-zinc-50")?.textContent).toContain("Set a new learner PIN");
  });

  it("does not repeat the menu jobs or invent a count", () => {
    renderHome();
    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/courses");
    expect(hrefs).not.toContain("/teacher/sections");
    expect(hrefs).not.toContain("/teacher/attendance");
    expect(hrefs).not.toContain("/teacher/gradebook");
    expect(container.textContent).not.toContain("Manage courses");
    expect(container.textContent).not.toContain("waiting");
  });
});
