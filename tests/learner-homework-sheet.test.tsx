// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { LearnerHomework } from "../components/learner-homework";
import type { LearnerHomeworkItem } from "../lib/data/learner-homework";
import type { FileQueueRecord } from "../lib/device/file-queue";
import { MAX_SUBMISSION_BYTES } from "../lib/storage/file-rules";

const { listQueuedFiles, queueHomeworkFile, sendPendingSubmissions } = vi.hoisted(() => ({
  listQueuedFiles: vi.fn(async () => ({ ok: true as const, files: [] as FileQueueRecord[] })),
  queueHomeworkFile: vi.fn(),
  sendPendingSubmissions: vi.fn(),
}));

vi.mock("../lib/device/file-queue", () => ({
  listQueuedFiles,
  queueHomeworkFile,
}));

vi.mock("../lib/device/file-upload", () => ({
  sendPendingSubmissions,
  browserFileUploader: () => ({
    fetch: vi.fn(),
    put: vi.fn(async (_url: string, _blob: Blob, _type: string, onProgress?: (loaded: number, total: number) => void) => {
      onProgress?.(40, 100);
      return { ok: true, status: 200 };
    }),
    online: () => true,
  }),
}));

const centerId = "00000000-0000-4000-8000-0000000000c1";
const userId = "00000000-0000-4000-8000-0000000000a1";
const learnerId = "00000000-0000-4000-8000-000000000022";
const sectionId = "00000000-0000-4000-8000-0000000000b1";
const readingId = "00000000-0000-4000-8000-000000000011";
const mapId = "00000000-0000-4000-8000-000000000012";

function task(id: string, title: string, serverStatus: LearnerHomeworkItem["serverStatus"]): LearnerHomeworkItem {
  return {
    id,
    title,
    sectionId,
    sectionName: "Morning group",
    courseTitle: "Literacy",
    kind: "DIGITAL",
    dueAt: null,
    maxPoints: "10.00",
    serverStatus,
    serverSubmissionId: null,
  };
}

function phoneFile(assignmentId: string, status: FileQueueRecord["status"], lastError: string | null = null): FileQueueRecord {
  return {
    clientSubmissionId: `file-${assignmentId.slice(-2)}`,
    centerId,
    userId,
    learnerId,
    assignmentId,
    sectionId,
    localDeviceId: "00000000-0000-4000-8000-0000000000d1",
    displayFilename: "sheet.pdf",
    mimeType: "application/pdf",
    byteSize: 8,
    checksumSha256: "ab".repeat(32),
    blob: null,
    status,
    lastError,
    serverSubmissionId: null,
    createdAt: "2026-11-28T00:00:00.000Z",
    lastAttemptAt: null,
  };
}

function tasks() {
  return [task(readingId, "Reading sheet", "not_submitted"), task(mapId, "Map sheet", "submitted")];
}

function taskHtml(html: string, title: string): string {
  const start = html.indexOf(title);
  const next = html.indexOf("<h2", start + title.length);
  return html.slice(start, next === -1 ? undefined : next);
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  listQueuedFiles.mockReset();
  listQueuedFiles.mockResolvedValue({ ok: true, files: [] });
  queueHomeworkFile.mockReset();
  sendPendingSubmissions.mockReset();
  vi.stubGlobal("indexedDB", {});
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("learner homework sheet", () => {
  it("keeps each result and status with its task and one Send action", () => {
    const html = renderToStaticMarkup(
      <LearnerHomework
        centerId={centerId}
        userId={userId}
        learnerId={learnerId}
        assignments={tasks()}
        initialFiles={[phoneFile(readingId, "queued"), phoneFile(mapId, "submitted")]}
      />,
    );
    const reading = taskHtml(html, "Reading sheet");
    const map = taskHtml(html, "Map sheet");
    expect(reading).toContain("Waiting on this phone");
    expect(reading).toContain("sheet.pdf");
    expect(reading).not.toContain("Submitted");
    expect(map).toContain("Submitted");
    expect(map).not.toContain("Waiting on this phone");
    expect(html.match(/Send pending submissions/g)).toHaveLength(1);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    const inputs = html.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain('accept="image/jpeg,image/png,image/webp,application/pdf"');
      expect(input).toContain("min-h-12");
      expect(input).toContain("file:min-h-12");
    }
    expect(html).toContain("Choose a photo or file");
  });

  it("shows a file result only on the task that was chosen, and only after the save finishes", async () => {
    let release: (value: { ok: true; message: string }) => void = () => undefined;
    queueHomeworkFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    listQueuedFiles.mockResolvedValue({ ok: true, files: [] });
    await act(async () => {
      root.render(
        <LearnerHomework
          centerId={centerId}
          userId={userId}
          learnerId={learnerId}
          assignments={tasks()}
          initialFiles={[]}
        />,
      );
    });
    const inputs = container.querySelectorAll("input[type='file']");
    const readingInput = inputs[0];
    if (!(readingInput instanceof HTMLInputElement)) throw new Error("missing file input");
    expect(readingInput.labels?.[0]?.textContent).toContain("Choose a photo or file");
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "sheet.pdf", { type: "application/pdf" });
    const transfer = new DataTransfer();
    transfer.items.add(pdf);
    await act(async () => {
      readingInput.files = transfer.files;
      readingInput.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() => {
        if (queueHomeworkFile.mock.calls.length < 1) throw new Error("the file is still being prepared");
      });
    });
    expect(container.textContent).not.toContain("This file is on this phone, waiting to send.");
    expect(container.querySelector("[role='status']")).toBeNull();
    await act(async () => {
      release({ ok: true, message: "This file is on this phone, waiting to send." });
    });
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[0]?.textContent).toContain("This file is on this phone, waiting to send.");
    expect(items[1]?.textContent).not.toContain("This file is on this phone, waiting to send.");
    expect(items[0]?.querySelector("[role='status']")?.textContent).toContain("This file is on this phone, waiting to send.");
    expect(queueHomeworkFile).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected file on that task and leaves the other task alone", async () => {
    await act(async () => {
      root.render(
        <LearnerHomework
          centerId={centerId}
          userId={userId}
          learnerId={learnerId}
          assignments={tasks()}
          initialFiles={[]}
        />,
      );
    });
    const inputs = container.querySelectorAll("input[type='file']");
    const mapInput = inputs[1];
    if (!(mapInput instanceof HTMLInputElement)) throw new Error("missing file input");
    const tooBig = new Uint8Array(MAX_SUBMISSION_BYTES + 1);
    tooBig.set([0x25, 0x50, 0x44, 0x46]);
    const transfer = new DataTransfer();
    transfer.items.add(new File([tooBig], "huge.pdf", { type: "application/pdf" }));
    await act(async () => {
      mapInput.files = transfer.files;
      mapInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[1]?.textContent).toContain("The limit is 1 MB.");
    expect(items[0]?.textContent).not.toContain("The limit is 1 MB.");
    expect(queueHomeworkFile).not.toHaveBeenCalled();
    expect(items[1]?.querySelector("[role='alert']")).not.toBeNull();

    const readingInput = inputs[0];
    if (!(readingInput instanceof HTMLInputElement)) throw new Error("missing first file input");
    const wrongType = new DataTransfer();
    wrongType.items.add(new File([new Uint8Array([1, 2, 3, 4])], "notes.txt", { type: "text/plain" }));
    await act(async () => {
      readingInput.files = wrongType.files;
      readingInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const after = Array.from(container.querySelectorAll("li"));
    expect(after[0]?.textContent).toContain("Use a JPEG, PNG, WebP, or PDF.");
    expect(after[1]?.textContent).not.toContain("Use a JPEG, PNG, WebP, or PDF.");
  });

  it("puts a failed send on the task that failed and keeps one Send action", async () => {
    const waiting = phoneFile(mapId, "queued");
    const failed = phoneFile(mapId, "failed", "The file was not confirmed. It is still on this phone.");
    let sent = false;
    listQueuedFiles.mockImplementation(async () => ({ ok: true, files: sent ? [failed] : [waiting] }));
    sendPendingSubmissions.mockImplementation(async () => {
      sent = true;
      return { ok: false, message: "The file was not confirmed. It is still on this phone.", progress: [] };
    });
    await act(async () => {
      root.render(
        <LearnerHomework
          centerId={centerId}
          userId={userId}
          learnerId={learnerId}
          assignments={tasks()}
          initialFiles={[waiting]}
        />,
      );
    });
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Send pending submissions");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing Send button");
    expect(container.textContent).not.toContain("The file was not confirmed");
    await act(async () => {
      button.click();
    });
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[0]?.textContent).not.toContain("The file was not confirmed");
    expect(items[1]?.querySelector("[role='alert']")?.textContent).toContain("The file was not confirmed. It is still on this phone.");
    expect(items[1]?.textContent).toContain("Upload failed");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(sendPendingSubmissions).toHaveBeenCalledTimes(1);
  });

  const waitingSentence = "This file is on this phone, waiting to send.";

  async function choosePdf(input: HTMLInputElement) {
    const calls = queueHomeworkFile.mock.calls.length;
    queueHomeworkFile.mockResolvedValue({ ok: true, message: waitingSentence });
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "sheet.pdf", { type: "application/pdf" }));
    await act(async () => {
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() => {
        if (queueHomeworkFile.mock.calls.length < calls + 1) throw new Error("the file is still being saved");
      });
    });
  }

  it("clears a waiting sentence after that task is submitted and leaves another task's message", async () => {
    const readingQueued = phoneFile(readingId, "queued");
    const mapQueued = phoneFile(mapId, "queued");
    let sent = false;
    listQueuedFiles.mockImplementation(async () => ({
      ok: true,
      files: sent ? [phoneFile(readingId, "submitted"), mapQueued] : [readingQueued, mapQueued],
    }));
    await act(async () => {
      root.render(
        <LearnerHomework centerId={centerId} userId={userId} learnerId={learnerId} assignments={tasks()} initialFiles={[]} />,
      );
    });
    const inputs = container.querySelectorAll("input[type='file']");
    if (!(inputs[0] instanceof HTMLInputElement) || !(inputs[1] instanceof HTMLInputElement)) throw new Error("missing file inputs");
    await choosePdf(inputs[0]);
    await choosePdf(inputs[1]);
    sent = true;
    sendPendingSubmissions.mockResolvedValue({ ok: true, message: "The server has the file.", progress: [] });
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Send pending submissions");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing Send button");
    expect(container.textContent).not.toContain("The server has the file.");
    await act(async () => {
      button.click();
    });
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[0]?.textContent).not.toContain(waitingSentence);
    expect(items[0]?.textContent).toContain("Submitted");
    expect(items[1]?.textContent).toContain(waitingSentence);
    expect(items[1]?.textContent).toContain("Waiting on this phone");
    expect(container.textContent).toContain("The server has the file.");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("keeps a failed task's own message when another task is submitted", async () => {
    const failure = "The map was not confirmed.";
    let sent = false;
    listQueuedFiles.mockImplementation(async () => ({
      ok: true,
      files: sent
        ? [phoneFile(readingId, "submitted"), phoneFile(mapId, "failed", failure)]
        : [phoneFile(readingId, "queued"), phoneFile(mapId, "queued")],
    }));
    await act(async () => {
      root.render(
        <LearnerHomework centerId={centerId} userId={userId} learnerId={learnerId} assignments={tasks()} initialFiles={[]} />,
      );
    });
    const inputs = container.querySelectorAll("input[type='file']");
    if (!(inputs[0] instanceof HTMLInputElement) || !(inputs[1] instanceof HTMLInputElement)) throw new Error("missing file inputs");
    await choosePdf(inputs[0]);
    await choosePdf(inputs[1]);
    sent = true;
    sendPendingSubmissions.mockResolvedValue({ ok: false, message: "The file was not confirmed. It is still on this phone.", progress: [] });
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Send pending submissions");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing Send button");
    await act(async () => {
      button.click();
    });
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[0]?.textContent).not.toContain(waitingSentence);
    expect(items[0]?.textContent).toContain("Submitted");
    expect(items[1]?.textContent).toContain(failure);
    expect(items[1]?.textContent).toContain("Upload failed");
    expect(items[1]?.textContent).not.toContain("Submitted");
  });

  it("keeps a validation message on a task whose file was not sent", async () => {
    let sent = false;
    listQueuedFiles.mockImplementation(async () => ({
      ok: true,
      files: sent ? [phoneFile(mapId, "submitted")] : [phoneFile(mapId, "queued")],
    }));
    await act(async () => {
      root.render(
        <LearnerHomework centerId={centerId} userId={userId} learnerId={learnerId} assignments={tasks()} initialFiles={[]} />,
      );
    });
    const inputs = container.querySelectorAll("input[type='file']");
    const readingInput = inputs[0];
    const mapInput = inputs[1];
    if (!(readingInput instanceof HTMLInputElement) || !(mapInput instanceof HTMLInputElement)) throw new Error("missing file inputs");
    const wrongType = new DataTransfer();
    wrongType.items.add(new File([new Uint8Array([1, 2, 3, 4])], "notes.txt", { type: "text/plain" }));
    await act(async () => {
      readingInput.files = wrongType.files;
      readingInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await choosePdf(mapInput);
    sent = true;
    sendPendingSubmissions.mockResolvedValue({ ok: true, message: "The server has the file.", progress: [] });
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Send pending submissions");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing Send button");
    await act(async () => {
      button.click();
    });
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[0]?.textContent).toContain("Use a JPEG, PNG, WebP, or PDF.");
    expect(items[1]?.textContent).not.toContain(waitingSentence);
    expect(items[1]?.textContent).toContain("Submitted");
  });

  async function sendWithProgress(queue: FileQueueRecord[]) {
    listQueuedFiles.mockResolvedValue({ ok: true, files: queue });
    sendPendingSubmissions.mockImplementation(async (_factory, _owner, uploader) => {
      await uploader.put("https://storage.example/put", new Blob(["a"]), "application/pdf", () => undefined);
      return { ok: false, message: "The file was not confirmed. It is still on this phone.", progress: [] };
    });
    await act(async () => {
      root.render(
        <LearnerHomework
          centerId={centerId}
          userId={userId}
          learnerId={learnerId}
          assignments={tasks()}
          initialFiles={queue}
        />,
      );
    });
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Send pending submissions");
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing Send button");
    await act(async () => {
      button.click();
    });
    return button;
  }

  it("does not show another file's percentage on a task that is waiting for confirmation", async () => {
    await sendWithProgress([phoneFile(readingId, "awaiting_confirmation"), phoneFile(mapId, "uploading")]);
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[0]?.querySelector("progress")).toBeNull();
    expect(items[1]?.querySelector("progress")).not.toBeNull();
    expect(items[1]?.textContent).toContain("40%");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("keeps the percentage beside Send when the uploading task is not unambiguous", async () => {
    await sendWithProgress([phoneFile(readingId, "uploading"), phoneFile(mapId, "uploading")]);
    const items = Array.from(container.querySelectorAll("li"));
    expect(items[0]?.querySelector("progress")).toBeNull();
    expect(items[1]?.querySelector("progress")).toBeNull();
    const besideSend = container.querySelector("progress");
    expect(besideSend).not.toBeNull();
    expect(besideSend?.parentElement?.textContent).toContain("40%");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});
