// @vitest-environment happy-dom

import { act } from "react";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddResourceForm } from "@/components/course-forms";
import { ResourceList } from "@/components/resource-list";
import { RESOURCE_IN_USE_MESSAGE } from "@/lib/data/courses";

const { deleteResourceAction, linkedMessage, refresh } = vi.hoisted(() => {
  const linkedMessage =
    "This material is currently linked to one or more timetable sessions. Remove or replace those timetable links before deleting it.";
  return {
    linkedMessage,
    refresh: vi.fn(),
    deleteResourceAction: vi.fn(async () => ({ error: linkedMessage })),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh }),
}));

vi.mock("@/app/actions/courses", () => ({
  createCourseAction: vi.fn(),
  createSectionAction: vi.fn(),
  createResourceAction: vi.fn(),
  deleteResourceAction,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("course material form", () => {
  it("shows the PDF and MP3 limits and does not ask for a storage key", async () => {
    await act(async () => {
      root.render(<AddResourceForm courseId="00000000-0000-4000-8000-0000000000a9" sections={[{ id: "00000000-0000-4000-8000-0000000000b1", name: "Morning Group" }]} />);
    });
    const text = container.textContent ?? "";
    expect(text).toContain("25 MB");
    expect(text).toContain("20 MB");
    expect(text).toContain("Only MP3 audio is accepted");
    expect(container.querySelector("input[name='storageKey']")).toBeNull();

    const select = container.querySelector("select[name='resourceType']");
    if (!(select instanceof HTMLSelectElement)) throw new Error("missing type list");
    await act(async () => {
      select.value = "PDF";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("PDF file, up to 25 MB");
    expect(container.querySelector("input[name='courseFile']")).not.toBeNull();

    await act(async () => {
      select.value = "AUDIO";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("MP3 file, up to 20 MB");

    await act(async () => {
      select.value = "WEB_LINK";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector("input[name='externalUrl']")).not.toBeNull();
    expect(container.querySelector("input[name='courseFile']")).toBeNull();
  });

  it("offers only the sections it was given, plus whole course", async () => {
    await act(async () => {
      root.render(
        <AddResourceForm
          courseId="00000000-0000-4000-8000-0000000000a9"
          sections={[{ id: "00000000-0000-4000-8000-0000000000b1", name: "Morning Group" }]}
        />,
      );
    });
    const section = container.querySelector("select[name='sectionId']");
    if (!(section instanceof HTMLSelectElement)) throw new Error("missing section list");
    const labels = Array.from(section.options).map((option) => option.text);
    expect(labels).toEqual(["Whole course", "Morning Group"]);
    expect(labels).not.toContain("Evening Group");
  });

  it("shows the timetable message and keeps the material in the list", async () => {
    await act(async () => {
      root.render(
        <ResourceList
          courseId="00000000-0000-4000-8000-0000000000c1"
          downloadableCount={1}
          manage
          resources={[
            {
              id: "00000000-0000-4000-8000-0000000000aa",
              title: "Duplicate alphabet PDF",
              resourceType: "PDF",
              externalUrl: null,
              mimeType: "application/pdf",
              byteSize: 12,
              fileStatus: "private",
              bodyText: null,
              sectionId: null,
              sectionName: null,
            },
          ]}
        />,
      );
    });
    const open = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Remove");
    if (!(open instanceof HTMLButtonElement)) throw new Error("missing Remove button");
    await act(async () => {
      open.click();
    });
    expect(deleteResourceAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Duplicate alphabet PDF");
    expect(container.textContent).toContain("no longer be able to open this material");
    const confirm = container.querySelector("button[type='submit']");
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("missing confirm button");
    await act(async () => {
      confirm.click();
    });
    expect(deleteResourceAction).toHaveBeenCalledTimes(1);
    expect(linkedMessage).toBe(RESOURCE_IN_USE_MESSAGE);
    expect(container.textContent).toContain(linkedMessage);
    expect(container.textContent).toContain("Duplicate alphabet PDF");
    expect(container.querySelector("[role='alert']")).not.toBeNull();
    const group = container.querySelector("[role='group']");
    expect(group).not.toBeNull();
    expect(group?.contains(document.activeElement)).toBe(true);
  });

  it("closes the confirmation without deleting when Cancel is chosen", async () => {
    await act(async () => {
      root.render(
        <ResourceList
          courseId="00000000-0000-4000-8000-0000000000c1"
          downloadableCount={1}
          manage
          resources={[
            {
              id: "00000000-0000-4000-8000-0000000000aa",
              title: "Duplicate alphabet PDF",
              resourceType: "PDF",
              externalUrl: null,
              mimeType: "application/pdf",
              byteSize: 12,
              fileStatus: "private",
              bodyText: null,
              sectionId: null,
              sectionName: null,
            },
          ]}
        />,
      );
    });
    const open = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Remove");
    if (!(open instanceof HTMLButtonElement)) throw new Error("missing Remove button");
    await act(async () => {
      open.click();
    });
    const cancel = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cancel");
    if (!(cancel instanceof HTMLButtonElement)) throw new Error("missing Cancel button");
    await act(async () => {
      cancel.click();
    });
    expect(deleteResourceAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Duplicate alphabet PDF");
    expect(container.textContent).not.toContain("no longer be able to open this material");
    expect(container.querySelector("button[type='submit']")).toBeNull();
  });

  const sampleResource = {
    id: "00000000-0000-4000-8000-0000000000aa",
    title: "Duplicate alphabet PDF",
    resourceType: "PDF" as const,
    externalUrl: null,
    mimeType: "application/pdf",
    byteSize: 12,
    fileStatus: "private" as const,
    bodyText: null,
    sectionId: null,
    sectionName: null,
  };

  async function renderRemoval() {
    await act(async () => {
      root.render(
        <ResourceList courseId="00000000-0000-4000-8000-0000000000c1" downloadableCount={1} manage resources={[sampleResource]} />,
      );
    });
  }

  function openerButton() {
    const open = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Remove" && item.getAttribute("type") !== "submit");
    if (!(open instanceof HTMLButtonElement)) throw new Error("missing Remove button");
    return open;
  }

  function question() {
    const node = container.querySelector("[role='group'] p");
    if (!(node instanceof HTMLParagraphElement)) throw new Error("missing confirmation question");
    return node;
  }

  it("moves focus to the confirmation question", async () => {
    await renderRemoval();
    const open = openerButton();
    await act(async () => {
      open.click();
    });
    expect(document.activeElement).toBe(question());
    expect(deleteResourceAction).not.toHaveBeenCalled();
  });

  it("returns focus to Remove when Cancel closes the confirmation", async () => {
    await renderRemoval();
    await act(async () => {
      openerButton().click();
    });
    const cancel = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Cancel");
    if (!(cancel instanceof HTMLButtonElement)) throw new Error("missing Cancel button");
    await act(async () => {
      cancel.click();
    });
    expect(container.textContent).not.toContain("no longer be able to open this material");
    expect(document.activeElement).toBe(openerButton());
    expect(deleteResourceAction).not.toHaveBeenCalled();
  });

  it("returns focus to Remove when Escape closes the confirmation", async () => {
    await renderRemoval();
    await act(async () => {
      openerButton().click();
    });
    const group = container.querySelector("[role='group']");
    if (!(group instanceof HTMLElement)) throw new Error("missing confirmation");
    await act(async () => {
      group.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      group.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.textContent).not.toContain("no longer be able to open this material");
    expect(document.activeElement).toBe(openerButton());
    expect(deleteResourceAction).not.toHaveBeenCalled();
  });

  it("does not send a second removal while the first is still running", async () => {
    let release: (value: { error: string }) => void = () => undefined;
    deleteResourceAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      root.render(
        <ResourceList
          courseId="00000000-0000-4000-8000-0000000000c1"
          downloadableCount={1}
          manage
          resources={[
            {
              id: "00000000-0000-4000-8000-0000000000aa",
              title: "Duplicate alphabet PDF",
              resourceType: "PDF",
              externalUrl: null,
              mimeType: "application/pdf",
              byteSize: 12,
              fileStatus: "private",
              bodyText: null,
              sectionId: null,
              sectionName: null,
            },
          ]}
        />,
      );
    });
    const open = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Remove");
    if (!(open instanceof HTMLButtonElement)) throw new Error("missing Remove button");
    await act(async () => {
      open.click();
    });
    const confirm = container.querySelector("button[type='submit']");
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("missing confirm button");
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(deleteResourceAction).toHaveBeenCalledTimes(1);
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toBe("Removing…");
    await act(async () => {
      release({ error: "This material could not be removed. Try again." });
    });
    expect(container.textContent).toContain("This material could not be removed. Try again.");
    expect(deleteResourceAction).toHaveBeenCalledTimes(1);
  });
});

const morningId = "00000000-0000-4000-8000-0000000000b1";
const courseId = "00000000-0000-4000-8000-0000000000a9";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setControlValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function chooseFile(input: HTMLInputElement, file: File) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

class FakeUploadRequest {
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  send() {
    this.onload?.();
  }
}

async function renderFileForm() {
  await act(async () => {
    root.render(
      <AddResourceForm courseId={courseId} sections={[{ id: morningId, name: "Morning Group" }]} />,
    );
  });
}

async function fillUpload(kind: "PDF" | "AUDIO") {
  const type = container.querySelector("select[name='resourceType']");
  const title = container.querySelector("input[name='title']");
  const section = container.querySelector("select[name='sectionId']");
  if (!(type instanceof HTMLSelectElement) || !(title instanceof HTMLInputElement) || !(section instanceof HTMLSelectElement)) {
    throw new Error("missing upload fields");
  }
  await act(async () => {
    setControlValue(type, kind);
    setControlValue(title, kind === "PDF" ? "Alphabet practice" : "Letter sounds");
    setControlValue(section, morningId);
  });
  const fileInput = container.querySelector("input[name='courseFile']");
  if (!(fileInput instanceof HTMLInputElement)) throw new Error("missing file input");
  const bytes = kind === "PDF" ? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) : new Uint8Array([0x49, 0x44, 0x33, 0x04]);
  chooseFile(fileInput, new File([bytes], kind === "PDF" ? "lesson.pdf" : "sounds.mp3"));
  return { title, section, fileInput };
}

describe("course file upload form", () => {
  const calls: string[] = [];
  let finalize: Promise<Response> | null = null;
  let releaseFinalize: ((response: Response) => void) | null = null;
  let begin: Promise<Response> | null = null;
  let releaseBegin: ((response: Response) => void) | null = null;

  beforeEach(() => {
    calls.length = 0;
    refresh.mockClear();
    finalize = null;
    releaseFinalize = null;
    begin = null;
    releaseBegin = null;
    vi.stubGlobal("XMLHttpRequest", FakeUploadRequest);
    vi.stubGlobal("fetch", (input: RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/finalize")) return finalize ?? Promise.resolve(jsonResponse({ stored: true }));
      if (url.endsWith("/retry")) return Promise.resolve(jsonResponse({ uploadUrl: "https://storage.test/put/2" }));
      return begin ?? Promise.resolve(jsonResponse({ uploadUrl: "https://storage.test/put/1", uploadToken: "token" }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function submitUntil(ready: () => boolean) {
    const form = container.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("missing form");
    await act(async () => {
      form.requestSubmit();
    });
    await vi.waitFor(() => {
      if (!ready()) throw new Error(container.textContent ?? "empty form");
    });
  }

  it("clears a PDF only after the server accepts it and keeps the section", async () => {
    finalize = new Promise((resolve) => {
      releaseFinalize = resolve;
    });
    await renderFileForm();
    const { title, section, fileInput } = await fillUpload("PDF");
    await submitUntil(() => calls.some((url) => url.endsWith("/finalize")));

    expect(calls.some((url) => url.endsWith("/finalize"))).toBe(true);
    expect(title.value).toBe("Alphabet practice");
    expect(fileInput.files?.[0]?.name).toBe("lesson.pdf");
    expect(section.value).toBe(morningId);
    expect(container.textContent).not.toContain("Material uploaded successfully.");
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      releaseFinalize?.(jsonResponse({ stored: true }));
    });

    expect(title.value).toBe("");
    expect(fileInput.files?.length ?? 0).toBe(0);
    expect(section.value).toBe(morningId);
    expect(container.querySelector("input[name='courseId']")).toHaveProperty("value", courseId);
    expect(container.textContent).toContain("Material uploaded successfully.");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("clears an MP3 the same way and keeps the section", async () => {
    await renderFileForm();
    const { title, section, fileInput } = await fillUpload("AUDIO");
    await submitUntil(() => container.textContent?.includes("Material uploaded successfully.") === true);

    expect(title.value).toBe("");
    expect(fileInput.files?.length ?? 0).toBe(0);
    expect(section.value).toBe(morningId);
    expect(container.textContent).toContain("Material uploaded successfully.");
    expect(container.textContent).toContain("MP3 file, up to 20 MB");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the PDF and the MP3 details when the server rejects the file", async () => {
    finalize = Promise.resolve(jsonResponse({ error: "The file was not accepted. Try again." }, 400));
    await renderFileForm();
    const pdf = await fillUpload("PDF");
    await submitUntil(() => container.textContent?.includes("The file was not accepted. Try again.") === true);
    expect(pdf.title.value).toBe("Alphabet practice");
    expect(pdf.fileInput.files?.[0]?.name).toBe("lesson.pdf");
    expect(pdf.section.value).toBe(morningId);
    expect(container.textContent).toContain("The file was not accepted. Try again.");
    expect(container.textContent).not.toContain("Material uploaded successfully.");
    expect(refresh).not.toHaveBeenCalled();

    refresh.mockClear();
    finalize = Promise.resolve(jsonResponse({ error: "The file was not accepted. Try again." }, 400));
    const audio = await fillUpload("AUDIO");
    await submitUntil(() => audio.title.value === "Letter sounds" && refresh.mock.calls.length === 0 && calls.filter((url) => url.endsWith("/finalize")).length >= 2);
    expect(audio.title.value).toBe("Letter sounds");
    expect(audio.fileInput.files?.[0]?.name).toBe("sounds.mp3");
    expect(audio.section.value).toBe(morningId);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not start a second upload while the first is still being checked", async () => {
    begin = new Promise((resolve) => {
      releaseBegin = resolve;
    });
    await renderFileForm();
    const { title, fileInput } = await fillUpload("PDF");
    const form = container.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("missing form");
    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
      await vi.waitFor(() => {
        if (calls.filter((url) => url.endsWith("/api/resources/uploads")).length < 1) {
          throw new Error("upload has not started");
        }
      });
    });

    const begins = calls.filter((url) => url.endsWith("/api/resources/uploads"));
    expect(begins).toHaveLength(1);
    const button = container.querySelector("button[type='submit']");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing submit button");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Uploading…");
    expect(container.textContent).toContain("Uploading…");
    expect(title.value).toBe("Alphabet practice");
    expect(fileInput.files?.[0]?.name).toBe("lesson.pdf");

    await act(async () => {
      releaseBegin?.(jsonResponse({ error: "The file was not uploaded. Try again." }, 503));
    });
    expect(calls.filter((url) => url.endsWith("/api/resources/uploads"))).toHaveLength(1);
    expect(title.value).toBe("Alphabet practice");
  });
});
