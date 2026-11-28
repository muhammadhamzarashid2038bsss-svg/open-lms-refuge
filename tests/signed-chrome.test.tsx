// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice } from "@/components/notice";
import { PhoneTools } from "@/components/phone-tools";
import { PhoneSessionProvider } from "@/components/phone-session";
import { HASH_SECTION_WAIT_MS } from "@/components/role-nav";
import { SignedChrome } from "@/components/signed-chrome";

const { performPhoneSignOut, pathname } = vi.hoisted(() => ({
  performPhoneSignOut: vi.fn((input: unknown) => input),
  pathname: { current: "/student/homework" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("@/lib/device/phone-access", () => ({
  performPhoneSignOut: (input: unknown) => performPhoneSignOut(input),
  PHONE_PRIVACY_EVENT: "olr-phone-privacy",
  waitingForAccount: vi.fn(async () => ({ ok: true, count: 1 })),
  addVerifiedPractice: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/device/browser", () => ({
  readDeviceBackup: () => null,
}));

vi.mock("@/lib/device/revoke-session", () => ({
  revokeServerSession: vi.fn(async () => true),
}));

vi.mock("@/lib/device/file-queue", () => ({
  listQueuedFiles: vi.fn(async () => ({
    ok: true,
    deviceId: "device-1",
    files: [{ status: "queued" }, { status: "submitted" }],
  })),
}));

vi.mock("@/lib/sync/trigger", () => ({
  ATTENDANCE_SYNC_EVENT: "olr-attendance-sync",
  bindAttendanceSync: () => ({
    load: () => undefined,
    manual: () => undefined,
    stop: () => undefined,
  }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  performPhoneSignOut.mockClear();
  pathname.current = "/student/homework";
  vi.stubGlobal("indexedDB", {});
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderSigned(role: "STUDENT" | "TEACHER" | "CENTER_DIRECTOR" | "ADMIN", learnerId: string | null) {
  act(() => {
    root.render(
      <PhoneSessionProvider value={{ userId: "user-1", centerId: "center-1", authSessionId: "session-1" }}>
        <SignedChrome role={role} userId="user-1" centerId="center-1" learnerId={learnerId} />
        <main id="main-content">
          <h1>Inner page</h1>
        </main>
      </PhoneSessionProvider>,
    );
  });
}

describe("signed-in chrome", () => {
  it("keeps Sign out on an inner page and uses the existing phone lock", async () => {
    pathname.current = "/teacher/sections/section-1/gradebook";
    renderSigned("TEACHER", null);
    expect(container.querySelector("main")?.textContent).toContain("Inner page");
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Sign out");
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });
    expect(performPhoneSignOut).toHaveBeenCalledTimes(1);
    const call = performPhoneSignOut.mock.calls[0]?.[0] as { authSessionId: string; account: { userId: string } } | undefined;
    if (!call) throw new Error("Sign out was not called");
    expect(call.authSessionId).toBe("session-1");
    expect(call.account.userId).toBe("user-1");
  });

  it("shows homework waiting to a learner and hides attendance sync", async () => {
    renderSigned("STUDENT", "learner-1");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Homework waiting to send: 1");
    expect(container.textContent).not.toContain("Attendance sync");
    expect(container.textContent).not.toContain("Sync now");
    const homework = container.querySelector("a[href='/student/homework']");
    expect(homework?.getAttribute("aria-current")).toBe("page");
  });

  it("shows attendance sync to a teacher and a director, and not to an administrator", () => {
    pathname.current = "/teacher";
    renderSigned("TEACHER", null);
    expect(container.textContent).toContain("Attendance sync");
    expect(container.textContent).toContain("Sync now");

    pathname.current = "/director";
    renderSigned("CENTER_DIRECTOR", null);
    expect(container.textContent).toContain("Attendance sync");

    pathname.current = "/admin";
    renderSigned("ADMIN", null);
    expect(container.textContent).not.toContain("Attendance sync");
    expect(container.textContent).not.toContain("Sync now");
    expect(container.textContent).toContain("Administrator");
  });

  it("does not put a second Sign out button on the phone tools", async () => {
    await act(async () => {
      root.render(
        <PhoneSessionProvider value={{ userId: "user-1", centerId: "center-1", authSessionId: "session-1" }}>
          <PhoneTools userId="user-1" centerId="center-1" />
        </PhoneSessionProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const buttons = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).not.toContain("Sign out");
    expect(buttons).toContain("Save a practice record on this phone");
    expect(container.textContent).toContain("Saved on this phone, waiting to send: 1.");
  });
});

describe("navigation interaction", () => {
  function currentLabels() {
    return [...document.body.querySelectorAll("[aria-current='page']")].map((item) =>
      item.textContent?.replace(/\s+/g, " ").trim(),
    );
  }

  it("highlights the section that was chosen", async () => {
    pathname.current = "/student";
    window.history.replaceState(null, "", "/student");
    renderSigned("STUDENT", "learner-1");
    await act(async () => {
      await Promise.resolve();
    });
    expect(currentLabels()).toEqual(["Home, current page"]);
    const today = [...document.body.querySelectorAll("a")].find((item) => item.getAttribute("href") === "#today");
    expect(today).toBeTruthy();
    await act(async () => {
      today?.click();
    });
    expect(window.location.hash).toBe("#today");
    expect(currentLabels()).toEqual(["Today's classes, current page"]);
  });

  it("keeps attendance and the gradebook as different destinations", () => {
    pathname.current = "/teacher";
    renderSigned("TEACHER", null);
    const hrefs = [...container.querySelectorAll("nav a")].map((item) => item.getAttribute("href"));
    expect(hrefs).toEqual(["/teacher", "/teacher/sections", "/teacher/attendance", "/teacher/gradebook", "/courses"]);
  });

  it("opens More in place and marks only the open page", async () => {
    pathname.current = "/teacher/records";
    renderSigned("TEACHER", null);
    await act(async () => {
      await Promise.resolve();
    });
    const more = [...document.body.querySelectorAll("button")].find((item) => item.textContent?.startsWith("More"));
    expect(more?.getAttribute("type")).toBe("button");
    expect(more?.getAttribute("aria-expanded")).toBe("false");
    expect(more?.getAttribute("aria-current")).toBe("page");
    const before = window.location.href;
    await act(async () => {
      more?.click();
    });
    expect(window.location.href).toBe(before);
    expect(more?.getAttribute("aria-expanded")).toBe("true");
    expect(more?.getAttribute("aria-current")).toBeNull();
    const records = [...document.body.querySelectorAll("a")].find((item) =>
      item.textContent?.startsWith("Save a grade or note"),
    );
    expect(records?.getAttribute("href")).toBe("/teacher/records");
    expect(records?.getAttribute("aria-current")).toBe("page");
    expect(currentLabels()).toEqual(["Save a grade or note, current page"]);
  });

  it("scrolls when the hash section appears after the previous page is still on screen", async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
    pathname.current = "/teacher/attendance";
    window.history.replaceState(null, "", "/teacher/attendance");
    const renderAt = () => {
      root.render(
        <PhoneSessionProvider value={{ userId: "user-1", centerId: "center-1", authSessionId: "session-1" }}>
          <SignedChrome role="TEACHER" userId="user-1" centerId="center-1" learnerId={null} />
          <main id="main-content">
            <h1>Attendance</h1>
          </main>
        </PhoneSessionProvider>,
      );
    };
    act(() => {
      renderAt();
    });
    scrollIntoView.mockClear();
    pathname.current = "/teacher";
    window.history.replaceState(null, "", "/teacher#this-phone");
    act(() => {
      renderAt();
    });
    expect(document.getElementById("main-content")).toBeTruthy();
    expect(document.getElementById("this-phone")).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();

    const section = document.createElement("section");
    section.id = "this-phone";
    await act(async () => {
      document.body.appendChild(section);
    });
    expect(scrollIntoView).toHaveBeenCalled();
    section.remove();
    scrollIntoView.mockRestore();
  });

  it("stops watching when the hash section is not on the destination page", async () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
    try {
      pathname.current = "/teacher";
      window.history.replaceState(null, "", "/teacher#missing");
      act(() => {
        root.render(
          <PhoneSessionProvider value={{ userId: "user-1", centerId: "center-1", authSessionId: "session-1" }}>
            <SignedChrome role="TEACHER" userId="user-1" centerId="center-1" learnerId={null} />
            <main id="main-content">
              <h1>Hello</h1>
            </main>
          </PhoneSessionProvider>,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HASH_SECTION_WAIT_MS);
      });
      const section = document.createElement("section");
      section.id = "missing";
      await act(async () => {
        document.body.appendChild(section);
      });
      expect(scrollIntoView).not.toHaveBeenCalled();
      section.remove();
    } finally {
      scrollIntoView.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("notices", () => {
  it("renders an error and a success with text, not colour alone", () => {
    act(() => {
      root.render(
        <div>
          <Notice tone="error">The email or password is not right.</Notice>
          <Notice tone="success">The new PIN is saved.</Notice>
        </div>,
      );
    });
    const alert = container.querySelector("[role='alert']");
    const status = container.querySelector("[role='status']");
    expect(alert?.textContent).toContain("Error.");
    expect(alert?.textContent).toContain("The email or password is not right.");
    expect(status?.textContent).toContain("Saved.");
    expect(status?.textContent).toContain("The new PIN is saved.");
  });
});
