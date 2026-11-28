"use client";

import { useEffect, useState } from "react";
import type { LearnerHomeworkItem } from "@/lib/data/learner-homework";
import { codecOrUnavailable } from "@/lib/device/browser-image";
import { browserStorageProbe } from "@/lib/device/storage-readiness";
import { sha256Hex } from "@/lib/device/sha256";
import { listQueuedFiles, queueHomeworkFile, type FileQueueRecord } from "@/lib/device/file-queue";
import { browserFileUploader, sendPendingSubmissions, type UploadProgress } from "@/lib/device/file-upload";
import { HOMEWORK_QUEUE_EVENT } from "@/lib/device/homework-pending";
import { fileStatusLabel } from "@/lib/lms/gradebook";
import { formatFileSize, prepareStoredFile } from "@/lib/lms/photo-prepare";
import { buttonClass } from "./ui";

type Notice = { tone: "ok" | "error"; text: string };

function localFile(files: readonly FileQueueRecord[], assignmentId: string): FileQueueRecord | undefined {
  const matches = files.filter((file) => file.assignmentId === assignmentId);
  return matches.find((file) => file.status !== "submitted") ?? matches.find((file) => file.status === "submitted");
}

/// The batch reply is one sentence. A task is confirmed only when its own
/// waiting row is now submitted. An older submitted row does not clear a
/// message about a file that was not sent.
function confirmedThisSend(before: readonly FileQueueRecord[], after: readonly FileQueueRecord[]): Set<string> {
  const afterByClient = new Map(after.map((file) => [file.clientSubmissionId, file]));
  const confirmed = new Set<string>();
  for (const assignmentId of new Set(before.map((file) => file.assignmentId))) {
    const active = localFile(before, assignmentId);
    if (!active || active.status === "submitted") continue;
    const next = afterByClient.get(active.clientSubmissionId);
    if (next?.status === "submitted" && next.assignmentId === assignmentId) confirmed.add(assignmentId);
  }
  return confirmed;
}

/// Progress events do not name a file. Only one queue row marked uploading
/// identifies the task. Waiting for confirmation is not that row.
function activeUploadAssignment(queue: readonly FileQueueRecord[]): string | null {
  const assignments = new Set<string>();
  for (const file of queue) {
    if (file.status === "uploading") assignments.add(file.assignmentId);
  }
  if (assignments.size !== 1) return null;
  return [...assignments][0] ?? null;
}

function localStatus(file: FileQueueRecord | undefined, server: LearnerHomeworkItem["serverStatus"]): string {
  if (file && file.status !== "submitted") {
    if (file.status === "queued") return fileStatusLabel("waiting");
    if (file.status === "failed") return fileStatusLabel("failed");
    return fileStatusLabel("uploading");
  }
  if (file?.status === "submitted" || server === "submitted") return fileStatusLabel("submitted");
  return fileStatusLabel(server);
}

export function LearnerHomework({
  centerId,
  userId,
  learnerId,
  assignments,
  initialFiles,
}: {
  centerId: string;
  userId: string;
  learnerId: string;
  assignments: LearnerHomeworkItem[];
  /// Already-read phone files. The page does not pass this. Tests do.
  initialFiles?: FileQueueRecord[];
}) {
  const owner = { centerId, userId, learnerId };
  const [files, setFiles] = useState<FileQueueRecord[]>(initialFiles ?? []);
  // Results stay on the task that produced them. A message above the whole
  // list is easy to miss when the learner is working on a later task.
  const [taskNotice, setTaskNotice] = useState<Record<string, Notice>>({});
  const [sendNotice, setSendNotice] = useState<Notice | null>(null);
  const [sendLive, setSendLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  function remember(assignmentId: string, tone: Notice["tone"], text: string) {
    setTaskNotice((previous) => ({ ...previous, [assignmentId]: { tone, text } }));
  }

  async function refresh() {
    const factory = globalThis.indexedDB;
    if (!factory) return;
    const listed = await listQueuedFiles(factory, owner);
    if (listed.ok) {
      setFiles(listed.files);
      window.dispatchEvent(new Event(HOMEWORK_QUEUE_EVENT));
    }
  }

  useEffect(() => {
    if (initialFiles) return;
    const factory = globalThis.indexedDB;
    if (!factory) return;
    let active = true;
    void listQueuedFiles(factory, { centerId, userId, learnerId }).then((listed) => {
      if (active && listed.ok) {
        setFiles(listed.files);
        window.dispatchEvent(new Event(HOMEWORK_QUEUE_EVENT));
      }
    });
    return () => {
      active = false;
    };
  }, [centerId, initialFiles, userId, learnerId]);

  async function choose(assignment: LearnerHomeworkItem, list: FileList | null) {
    const selected = list?.[0];
    const factory = globalThis.indexedDB;
    if (!selected || !factory) {
      remember(assignment.id, "error", "This phone cannot keep that file.");
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer());
      const prepared = await prepareStoredFile({ filename: selected.name, bytes }, codecOrUnavailable());
      if (!prepared.ok) {
        remember(assignment.id, "error", prepared.message);
        return;
      }
      const checksumSha256 = await sha256Hex(prepared.bytes);
      const saved = await queueHomeworkFile(
        factory,
        owner,
        {
          assignmentId: assignment.id,
          sectionId: assignment.sectionId,
          displayFilename: prepared.filename,
          mimeType: prepared.mimeType,
          checksumSha256,
          bytes: prepared.bytes,
        },
        browserStorageProbe(),
      );
      remember(assignment.id, saved.ok ? "ok" : "error", saved.ok && prepared.note ? `${saved.message} ${prepared.note}` : saved.message);
      await refresh();
    } catch {
      remember(assignment.id, "error", "This file could not be read. It was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const factory = globalThis.indexedDB;
    if (!factory) return;
    setBusy(true);
    setProgress(null);
    const beforeSend = files;
    try {
      let sawProgress = false;
      const result = await sendPendingSubmissions(factory, owner, {
        ...browserFileUploader(),
        put: (url, blob, contentType, onProgress) =>
          browserFileUploader().put(url, blob, contentType, (loaded, total) => {
            onProgress(loaded, total);
            setProgress({ clientSubmissionId: "", loaded, total });
            // The queue row is already marked uploading. Read it once so that
            // task can show Uploading while this transfer is moving.
            if (!sawProgress) {
              sawProgress = true;
              void refresh();
            }
          }),
      });
      const listed = await listQueuedFiles(factory, owner);
      const failedHere = listed.ok ? listed.files.filter((file) => file.status === "failed" && file.lastError) : [];
      setSendNotice({ tone: result.ok ? "ok" : "error", text: result.message });
      // A failed file already has its own sentence. Do not also announce the
      // same batch sentence. Announce the batch sentence when no file has one.
      setSendLive(result.ok || failedHere.length === 0);
      if (listed.ok) {
        const confirmed = confirmedThisSend(beforeSend, listed.files);
        setFiles(listed.files);
        setTaskNotice((previous) => {
          const next = { ...previous };
          for (const assignmentId of confirmed) delete next[assignmentId];
          for (const file of failedHere) {
            if (!file.lastError || confirmed.has(file.assignmentId)) continue;
            next[file.assignmentId] = { tone: "error", text: file.lastError };
          }
          return next;
        });
        window.dispatchEvent(new Event(HOMEWORK_QUEUE_EVENT));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg leading-7">
        Send a JPEG, PNG, WebP, or PDF. A photo is made smaller on this phone when the writing can stay readable. The
        limit is 1 MB. The file stays here until the server confirms it.
      </p>
      {assignments.length === 0 ? <p className="text-lg">No file homework yet.</p> : null}
      <ul className="flex flex-col gap-6">
        {assignments.map((assignment) => {
          const local = localFile(files, assignment.id);
          const result = taskNotice[assignment.id];
          const activeUpload = activeUploadAssignment(files);
          const sendingThis = Boolean(progress && progress.total > 0 && activeUpload === assignment.id);
          return (
            <li key={assignment.id} className="flex flex-col gap-2 border-t-2 border-zinc-950 pt-4">
              <h2 className="text-xl font-semibold">{assignment.title}</h2>
              <p className="text-lg">
                {assignment.sectionName} · {assignment.courseTitle}
              </p>
              <p className="text-lg">{assignment.kind === "BOTH" ? "Both" : "Digital"} · Maximum {assignment.maxPoints}</p>
              {assignment.dueAt ? <p className="text-lg">Due {assignment.dueAt.slice(0, 10)}</p> : null}
              <p className="text-lg">{localStatus(local, assignment.serverStatus)}</p>
              {local ? (
                <p className="text-base text-zinc-700">
                  {local.displayFilename} · {formatFileSize(local.byteSize)} · {local.mimeType}
                </p>
              ) : null}
              <label className="flex min-h-12 w-full flex-col justify-center gap-2 rounded-lg border-2 border-zinc-950 px-3 py-2 text-lg font-medium focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-[3px] focus-within:outline-zinc-950">
                Choose a photo or file
                <input
                  className="block min-h-12 w-full cursor-pointer text-lg file:mr-3 file:min-h-12 file:rounded-lg file:border-0 file:bg-zinc-950 file:px-4 file:text-lg file:font-medium file:text-white focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-zinc-950"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={busy}
                  onChange={(event) => {
                    void choose(assignment, event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {sendingThis && progress ? (
                <p className="text-lg">
                  <progress value={progress.loaded} max={progress.total} /> {Math.round((progress.loaded / progress.total) * 100)}%
                </p>
              ) : null}
              {result ? (
                <p role={result.tone === "error" ? "alert" : "status"} className="text-lg font-medium">
                  {result.text}
                </p>
              ) : local?.lastError ? (
                <p className="text-lg font-medium">{local.lastError}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {progress && progress.total > 0 && activeUploadAssignment(files) === null ? (
        <p className="text-lg">
          <progress value={progress.loaded} max={progress.total} /> {Math.round((progress.loaded / progress.total) * 100)}%
        </p>
      ) : null}
      {sendNotice ? (
        <p role={sendLive ? (sendNotice.tone === "error" ? "alert" : "status") : undefined} className="text-lg font-medium">
          {sendNotice.text}
        </p>
      ) : null}
      <button className={buttonClass} type="button" disabled={busy} onClick={() => void send()}>
        Send pending submissions
      </button>
    </div>
  );
}
