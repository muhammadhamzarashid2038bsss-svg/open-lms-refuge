// Sends homework files in the foreground. This does not use the attendance
// batch or the grade sync route. The local file is removed only after the
// server says the submission is stored.

import { listQueuedFiles, updateQueuedFile, type FileOwner, type FileQueueRecord } from "./file-queue";

export type UploadProgress = { clientSubmissionId: string; loaded: number; total: number };

export type FileUploader = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  put: (url: string, blob: Blob, contentType: string, onProgress: (loaded: number, total: number) => void) => Promise<{ ok: boolean; status: number }>;
  online: () => boolean;
};

const OFFLINE = "This phone is offline. The file stays here until you send it.";
const SENDING = "This file is already being sent.";
const FAILED = "The file was not confirmed. It is still on this phone.";
const STORED = "The server has the file.";

const inFlight = new Set<string>();

function jsonBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return jsonBody(await response.json());
  } catch {
    return null;
  }
}

function stored(body: Record<string, unknown> | null): boolean {
  return Boolean(body && body.acknowledged === true && body.uploadState === "STORED");
}

export function putBlobWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(event.loaded, event.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.onabort = () => resolve({ ok: false, status: 0 });
    xhr.send(blob);
  });
}

async function mark(
  factory: IDBFactory,
  owner: FileOwner,
  file: FileQueueRecord,
  patch: Parameters<typeof updateQueuedFile>[3],
): Promise<void> {
  await updateQueuedFile(factory, owner, file.clientSubmissionId, patch);
}

async function sendOne(
  factory: IDBFactory,
  owner: FileOwner,
  file: FileQueueRecord,
  uploader: FileUploader,
  progress: UploadProgress[],
): Promise<{ ok: boolean; message: string }> {
  if (!file.blob) return { ok: false, message: FAILED };
  if (inFlight.has(file.clientSubmissionId)) return { ok: false, message: SENDING };
  inFlight.add(file.clientSubmissionId);
  try {
    await mark(factory, owner, file, { status: "uploading", lastAttemptAt: new Date().toISOString(), lastError: null });
    if (file.status === "awaiting_confirmation" && file.serverSubmissionId) {
      const finished = await finish(factory, owner, file, file.serverSubmissionId, uploader);
      if (finished.ok || finished.keep) return finished.result;
    }
    const response = await uploader.fetch("/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        clientSubmissionId: file.clientSubmissionId,
        assignmentId: file.assignmentId,
        learnerId: file.learnerId,
        deviceId: file.localDeviceId,
        byteSize: file.byteSize,
        mimeType: file.mimeType,
        checksumSha256: file.checksumSha256,
        createdOffline: true,
      }),
    });
    const body = await readJson(response);
    if (stored(body)) {
      await mark(factory, owner, file, { status: "submitted", blob: null, serverSubmissionId: typeof body?.submissionId === "string" ? body.submissionId : file.serverSubmissionId, lastError: null });
      return { ok: true, message: STORED };
    }
    const uploadUrl = typeof body?.uploadUrl === "string" ? body.uploadUrl : "";
    const submissionId = typeof body?.submissionId === "string" ? body.submissionId : "";
    if (!response.ok || !uploadUrl || !submissionId) {
      const message = typeof body?.error === "string" ? body.error : FAILED;
      await mark(factory, owner, file, { status: "failed", lastError: message, serverSubmissionId: submissionId || file.serverSubmissionId });
      return { ok: false, message };
    }
    await mark(factory, owner, file, { serverSubmissionId: submissionId, status: "uploading" });
    const uploaded = await uploader.put(uploadUrl, file.blob, file.mimeType, (loaded, total) => {
      progress.push({ clientSubmissionId: file.clientSubmissionId, loaded, total });
    });
    if (!uploaded.ok) {
      await mark(factory, owner, file, { status: "failed", lastError: FAILED, serverSubmissionId: submissionId });
      return { ok: false, message: FAILED };
    }
    await mark(factory, owner, file, { status: "awaiting_confirmation", serverSubmissionId: submissionId });
    const confirmed = await finish(factory, owner, file, submissionId, uploader);
    return confirmed.result;
  } catch {
    await mark(factory, owner, file, { status: "failed", lastError: FAILED });
    return { ok: false, message: FAILED };
  } finally {
    inFlight.delete(file.clientSubmissionId);
  }
}

async function finish(
  factory: IDBFactory,
  owner: FileOwner,
  file: FileQueueRecord,
  submissionId: string,
  uploader: FileUploader,
): Promise<{ ok: boolean; keep: boolean; result: { ok: boolean; message: string } }> {
  let response: Response;
  try {
    response = await uploader.fetch(`/api/submissions/${submissionId}/finalize`, { method: "POST", cache: "no-store" });
  } catch {
    await mark(factory, owner, file, { status: "awaiting_confirmation", serverSubmissionId: submissionId, lastError: FAILED });
    return { ok: false, keep: true, result: { ok: false, message: FAILED } };
  }
  const body = await readJson(response);
  if (stored(body)) {
    await mark(factory, owner, file, { status: "submitted", blob: null, serverSubmissionId: submissionId, lastError: null });
    return { ok: true, keep: false, result: { ok: true, message: STORED } };
  }
  const message = typeof body?.error === "string" ? body.error : FAILED;
  await mark(factory, owner, file, { status: "failed", lastError: message, serverSubmissionId: submissionId });
  return { ok: false, keep: false, result: { ok: false, message } };
}

export async function sendPendingSubmissions(
  factory: IDBFactory,
  owner: FileOwner,
  uploader: FileUploader,
): Promise<{ ok: boolean; message: string; progress: UploadProgress[] }> {
  if (!uploader.online()) return { ok: false, message: OFFLINE, progress: [] };
  const listed = await listQueuedFiles(factory, owner);
  if (!listed.ok) return { ok: false, message: listed.message, progress: [] };
  const pending = listed.files.filter((file) => file.status !== "submitted" && file.blob);
  if (pending.length === 0) return { ok: true, message: "There is no file waiting to send.", progress: [] };
  const progress: UploadProgress[] = [];
  let failed = 0;
  let alreadySending = 0;
  for (const file of pending) {
    if (file.userId !== owner.userId || file.centerId !== owner.centerId || file.learnerId !== owner.learnerId) continue;
    const result = await sendOne(factory, owner, file, uploader, progress);
    if (result.message === SENDING) alreadySending += 1;
    else if (!result.ok) failed += 1;
  }
  if (failed > 0) return { ok: false, message: FAILED, progress };
  if (alreadySending > 0) return { ok: false, message: SENDING, progress };
  return { ok: true, message: STORED, progress };
}

export function browserFileUploader(): FileUploader {
  return {
    fetch: (input, init) => fetch(input, init),
    put: putBlobWithProgress,
    online: () => globalThis.navigator?.onLine !== false,
  };
}
