"use client";

import { useEffect, useState } from "react";
import type { LearnerHomeworkItem } from "@/lib/data/learner-homework";
import { codecOrUnavailable } from "@/lib/device/browser-image";
import { browserStorageProbe } from "@/lib/device/storage-readiness";
import { sha256Hex } from "@/lib/device/sha256";
import { listQueuedFiles, queueHomeworkFile, type FileQueueRecord } from "@/lib/device/file-queue";
import { browserFileUploader, sendPendingSubmissions, type UploadProgress } from "@/lib/device/file-upload";
import { fileStatusLabel } from "@/lib/lms/gradebook";
import { formatFileSize, prepareStoredFile } from "@/lib/lms/photo-prepare";
import { buttonClass } from "./ui";

type Notice = { tone: "ok" | "error"; text: string };

function localFile(files: FileQueueRecord[], assignmentId: string): FileQueueRecord | undefined {
  const matches = files.filter((file) => file.assignmentId === assignmentId);
  return matches.find((file) => file.status !== "submitted") ?? matches.find((file) => file.status === "submitted");
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
}: {
  centerId: string;
  userId: string;
  learnerId: string;
  assignments: LearnerHomeworkItem[];
}) {
  const owner = { centerId, userId, learnerId };
  const [files, setFiles] = useState<FileQueueRecord[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  async function refresh() {
    const factory = globalThis.indexedDB;
    if (!factory) return;
    const listed = await listQueuedFiles(factory, owner);
    if (listed.ok) setFiles(listed.files);
  }

  useEffect(() => {
    const factory = globalThis.indexedDB;
    if (!factory) return;
    let active = true;
    void listQueuedFiles(factory, { centerId, userId, learnerId }).then((listed) => {
      if (active && listed.ok) setFiles(listed.files);
    });
    return () => {
      active = false;
    };
  }, [centerId, userId, learnerId]);

  async function choose(assignment: LearnerHomeworkItem, list: FileList | null) {
    const selected = list?.[0];
    const factory = globalThis.indexedDB;
    if (!selected || !factory) {
      setNotice({ tone: "error", text: "This phone cannot keep that file." });
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer());
      const prepared = await prepareStoredFile({ filename: selected.name, bytes }, codecOrUnavailable());
      if (!prepared.ok) {
        setNotice({ tone: "error", text: prepared.message });
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
      setNotice({ tone: saved.ok ? "ok" : "error", text: saved.ok && prepared.note ? `${saved.message} ${prepared.note}` : saved.message });
      await refresh();
    } catch {
      setNotice({ tone: "error", text: "This file could not be read. It was not saved." });
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const factory = globalThis.indexedDB;
    if (!factory) return;
    setBusy(true);
    setProgress(null);
    try {
      const result = await sendPendingSubmissions(factory, owner, {
        ...browserFileUploader(),
        put: (url, blob, contentType, onProgress) =>
          browserFileUploader().put(url, blob, contentType, (loaded, total) => {
            onProgress(loaded, total);
            setProgress({ clientSubmissionId: "", loaded, total });
          }),
      });
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
      await refresh();
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
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className="text-lg font-medium">
          {notice.text}
        </p>
      ) : null}
      {progress && progress.total > 0 ? (
        <p className="text-lg">
          <progress value={progress.loaded} max={progress.total} /> {Math.round((progress.loaded / progress.total) * 100)}%
        </p>
      ) : null}
      {assignments.length === 0 ? <p className="text-lg">No file homework yet.</p> : null}
      <ul className="flex flex-col gap-6">
        {assignments.map((assignment) => {
          const local = localFile(files, assignment.id);
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
                  {local.lastError ? ` · ${local.lastError}` : ""}
                </p>
              ) : null}
              <label className="text-base font-medium">
                Choose a photo or file
                <input
                  className="mt-2 block w-full text-lg"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={busy}
                  onChange={(event) => {
                    void choose(assignment, event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </li>
          );
        })}
      </ul>
      <button className={buttonClass} type="button" disabled={busy} onClick={() => void send()}>
        Send pending submissions
      </button>
    </div>
  );
}
