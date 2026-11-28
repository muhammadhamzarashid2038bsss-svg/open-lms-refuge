// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminDashboard } from "@/components/admin-dashboard";

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

function renderDashboard(notice: ReactNode = null) {
  act(() => {
    root.render(
      <AdminDashboard
        notice={notice}
        sections={
          <>
            <h2>Manage section assignments</h2>
            <p>The app does not guess a teacher.</p>
          </>
        }
        accounts={
          <>
            <h2>Set a new learner PIN</h2>
            <label>
              Center code
              <input name="centerCode" />
            </label>
            <h2>Set a new staff password</h2>
            <h2>Accounts</h2>
            <button type="button">Switch off</button>
          </>
        }
        phone={<section id="this-phone">Saved on this phone, waiting to send: 0.</section>}
      />,
    );
  });
}

describe("administrator dashboard", () => {
  it("shows sections, then accounts, then this phone", () => {
    renderDashboard(<p>The print request could not be recorded.</p>);
    const text = container.textContent ?? "";
    const notice = text.indexOf("The print request could not be recorded.");
    const sections = text.indexOf("Sections");
    const assignments = text.indexOf("Manage section assignments");
    const pin = text.indexOf("Set a new learner PIN");
    const centerCode = text.indexOf("Center code");
    const password = text.indexOf("Set a new staff password");
    const accountList = text.lastIndexOf("Accounts");
    const phone = text.indexOf("waiting to send");
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(notice).toBeLessThan(sections);
    expect(sections).toBeLessThan(assignments);
    expect(assignments).toBeLessThan(pin);
    expect(pin).toBeLessThan(centerCode);
    expect(centerCode).toBeLessThan(password);
    expect(password).toBeLessThan(accountList);
    expect(accountList).toBeLessThan(phone);
    expect(container.querySelector("#sections")).toBeTruthy();
    expect(container.querySelector("#accounts")).toBeTruthy();
    expect(container.querySelector("#this-phone")).toBeTruthy();
    expect(text.indexOf("The app does not guess a teacher.")).toBeLessThan(pin);
    expect(container.querySelector("#accounts")?.textContent).toContain("Center code");
    expect(container.querySelector("#sections")?.querySelector("a")).toBeNull();
  });

  it("does not repeat the audit or export links", () => {
    renderDashboard();
    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/audit");
    expect(hrefs).not.toContain("/export");
    expect(container.textContent).not.toContain("The print request could not be recorded.");
  });
});
