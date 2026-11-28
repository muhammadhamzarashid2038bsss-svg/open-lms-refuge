// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectorDashboard } from "@/components/director-dashboard";

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

function renderDashboard(notice: ReactNode = null, sections = [
  { id: "section-morning", name: "Morning Group", courseTitle: "Demo English and Number Sense" },
]) {
  act(() => {
    root.render(
      <DirectorDashboard
        summary={{ name: "Demo Centre", learnerCount: 8, sectionCount: 2, code: "DEMO" }}
        notice={notice}
        sections={sections}
        people={
          <>
            <h2>Manage section assignments</h2>
            <p>The app does not guess a teacher.</p>
            <h2>Set a new learner PIN</h2>
            <h2>Set a new staff password</h2>
            <h2>Accounts</h2>
            <button type="button">Switch off</button>
          </>
        }
        phone={<section id="this-phone">This phone</section>}
      />,
    );
  });
}

describe("director dashboard", () => {
  it("shows the three centre figures without repeating the centre name", () => {
    renderDashboard();
    const summary = container.querySelector("[aria-labelledby='center-summary-heading']");
    expect(summary?.querySelector("h2")?.textContent).toBe("Centre summary");
    expect(summary?.querySelector("h2")?.className).toContain("sr-only");
    expect(summary?.textContent).toContain("Learners");
    expect(summary?.textContent).toContain("8");
    expect(summary?.textContent).toContain("Sections");
    expect(summary?.textContent).toContain("2");
    expect(summary?.textContent).toContain("Centre code");
    expect(summary?.textContent).toContain("DEMO");
    expect(summary?.textContent).not.toContain("Demo Centre");
  });

  it("shows the centre summary, then timetables, then people, then this phone", () => {
    renderDashboard(<p>The print request could not be recorded.</p>);
    const text = container.textContent ?? "";
    expect(text).toContain("Learners");
    expect(text).toContain("8");
    expect(text).toContain("Sections");
    expect(text).toContain("2");
    expect(text).toContain("Centre code");
    expect(text).toContain("DEMO");
    expect(container.querySelector("#timetables a")?.getAttribute("href")).toBe("/sections/section-morning/timetable");
    expect(container.querySelector("#timetables")?.textContent).toContain("Morning Group");
    expect(container.querySelector("#timetables")?.textContent).toContain("Demo English and Number Sense");

    const summary = text.indexOf("Centre summary");
    const notice = text.indexOf("The print request could not be recorded.");
    const timetables = text.indexOf("Weekly timetables");
    const assignments = text.indexOf("Manage section assignments");
    const pin = text.indexOf("Set a new learner PIN");
    const password = text.indexOf("Set a new staff password");
    const accounts = text.indexOf("Accounts");
    const phone = text.indexOf("This phone");
    expect(summary).toBeLessThan(notice);
    expect(notice).toBeLessThan(timetables);
    expect(timetables).toBeLessThan(assignments);
    expect(assignments).toBeLessThan(pin);
    expect(pin).toBeLessThan(password);
    expect(password).toBeLessThan(accounts);
    expect(accounts).toBeLessThan(phone);
    expect(container.querySelector("#people")).toBeTruthy();
    expect(container.querySelector("#this-phone")).toBeTruthy();
    expect(text.indexOf("The app does not guess a teacher.")).toBeLessThan(accounts);
  });

  it("keeps the timetable target when there is no section and does not repeat the menu", () => {
    renderDashboard(null, []);
    expect(container.querySelector("#timetables")?.textContent).toContain("No sections yet.");
    expect(container.textContent).not.toContain("The print request could not be recorded.");
    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/director/check-ins");
    expect(hrefs).not.toContain("/director/performance");
    expect(hrefs).not.toContain("/director/notes");
    expect(hrefs).not.toContain("/handoff");
    expect(hrefs).not.toContain("/audit");
    expect(hrefs).not.toContain("/export");
    expect(hrefs).not.toContain("/director/skill-tags");
    expect(hrefs).not.toContain("/courses");
  });
});
