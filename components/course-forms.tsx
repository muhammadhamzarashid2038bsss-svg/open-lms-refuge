"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import {
  createCourseAction,
  createResourceAction,
  createSectionAction,
  deleteResourceAction,
  type FormState,
} from "@/app/actions/courses";
import { sha256Hex } from "@/lib/device/sha256";
import { RESOURCE_TYPES, resourceTypeLabel } from "@/lib/lms/resources";
import { MP3_MIME, MP3_MAX_BYTES, PDF_MIME, PDF_MAX_BYTES, sniffCourseMime } from "@/lib/storage/course-file-rules";
import { buttonClass, inputClass, labelClass, secondaryButtonClass } from "./ui";

const initial: FormState = {};

export function CreateCourseForm({ defaultYear }: { defaultYear: number }) {
  const [state, action, pending] = useActionState(createCourseAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">New course</h2>
      <label className={labelClass}>
        Course name
        <input className={inputClass} name="title" required minLength={3} />
      </label>
      <label className={labelClass}>
        Short code
        <input className={inputClass} name="code" required minLength={2} maxLength={12} placeholder="ENG-101" />
      </label>
      <label className={labelClass}>
        Academic year
        <input className={inputClass} name="academicYear" type="number" required defaultValue={defaultYear} />
      </label>
      <label className={labelClass}>
        Semester
        <select className={inputClass} name="semester" defaultValue="SEMESTER_1">
          <option value="SEMESTER_1">Semester 1</option>
          <option value="SEMESTER_2">Semester 2</option>
        </select>
      </label>
      <label className={labelClass}>
        Short summary (optional)
        <input className={inputClass} name="summary" maxLength={500} />
      </label>
      <label className={labelClass}>
        First section name
        <input className={inputClass} name="firstSectionName" placeholder="Morning Group" />
      </label>
      <p className="text-base leading-6 text-zinc-700">
        If you are a teacher, add at least one section so you stay assigned to the course you create.
      </p>
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      <button className={buttonClass} type="submit" disabled={pending}>
        {pending ? "Saving…" : "Create course"}
      </button>
    </form>
  );
}

export function AddSectionForm({ courseId }: { courseId: string }) {
  return (
    <form action={createSectionAction} className="flex flex-col gap-3 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">Add section</h2>
      <input type="hidden" name="courseId" value={courseId} />
      <label className={labelClass}>
        Section name
        <input className={inputClass} name="name" required minLength={2} />
      </label>
      <button className={secondaryButtonClass} type="submit">
        Add section
      </button>
    </form>
  );
}

type UploadBody = { uploadUrl?: string; uploadToken?: string; stored?: boolean; error?: string };

async function postUpload(path: string, payload: unknown): Promise<{ ok: boolean; body: UploadBody }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as UploadBody | null;
  return { ok: response.ok, body: body ?? {} };
}

function putFile(url: string, file: File, contentType: string): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

export function AddResourceForm({
  courseId,
  sections,
  allowWholeCourse = true,
}: {
  courseId: string;
  sections: { id: string; name: string }[];
  allowWholeCourse?: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createResourceAction, initial);
  const [resourceType, setResourceType] = useState<string>("WEB_LINK");
  const [title, setTitle] = useState("");
  const [sectionId, setSectionId] = useState(allowWholeCourse ? "" : (sections[0]?.id ?? ""));
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [filePending, setFilePending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Set before the first await so a second tap cannot start another upload
  // while the phone is still hashing or waiting for the server check.
  const uploadLock = useRef(false);
  const fileType = resourceType === "PDF" || resourceType === "AUDIO";
  const linkType = resourceType !== "TEXT" && !fileType;
  const fileLimit = resourceType === "AUDIO" ? "20 MB" : "25 MB";
  const fileMime = resourceType === "AUDIO" ? MP3_MIME : PDF_MIME;

  async function uploadFile(form: HTMLFormElement) {
    setFileError(null);
    setFileMessage(null);
    try {
      const chosen = new FormData(form).get("courseFile");
      if (!(chosen instanceof File) || chosen.size < 1) {
        setFileError("Choose a file.");
        return;
      }
      const maxBytes = resourceType === "AUDIO" ? MP3_MAX_BYTES : PDF_MAX_BYTES;
      if (chosen.size > maxBytes) {
        setFileError(
          resourceType === "AUDIO" ? "This MP3 is too large. The limit is 20 MB." : "This PDF is too large. The limit is 25 MB.",
        );
        return;
      }
      setFilePending(true);
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      if (sniffCourseMime(bytes) !== fileMime) {
        setFileError(resourceType === "AUDIO" ? "This file is not an MP3." : "This file is not a PDF.");
        return;
      }
      const checksumSha256 = await sha256Hex(bytes);
      const started = await postUpload("/api/resources/uploads", {
        courseId,
        sectionId,
        title,
        resourceType,
        byteSize: chosen.size,
        checksumSha256,
      });
      const token = started.body.uploadToken ?? "";
      let uploadUrl = started.body.uploadUrl ?? "";
      if (!started.ok || !uploadUrl || !token) {
        setFileError(started.body.error ?? "The file was not uploaded. Try again.");
        return;
      }
      let sent = await putFile(uploadUrl, chosen, fileMime);
      if (!sent) {
        const again = await postUpload("/api/resources/uploads/retry", { uploadToken: token });
        uploadUrl = again.body.uploadUrl ?? "";
        if (!again.ok || !uploadUrl) {
          setFileError(again.body.error ?? "The file was not uploaded. Try again.");
          return;
        }
        sent = await putFile(uploadUrl, chosen, fileMime);
      }
      if (!sent) {
        setFileError("The file was not uploaded. Try again.");
        return;
      }
      const saved = await postUpload("/api/resources/uploads/finalize", { uploadToken: token });
      // The bytes can finish transferring before the server accepts them.
      // Clear the form only after the resource record exists, so the same
      // file is not sent twice by mistake.
      if (!saved.ok || saved.body.stored !== true) {
        setFileError(saved.body.error ?? "The file was not accepted. Try again.");
        return;
      }
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      setFileMessage("Material uploaded successfully.");
      router.refresh();
    } catch {
      setFileError("The file was not uploaded. Try again.");
    } finally {
      uploadLock.current = false;
      setFilePending(false);
    }
  }

  return (
    <form
      action={fileType ? undefined : action}
      className="flex flex-col gap-3 rounded-lg border-2 border-zinc-950 p-4"
      aria-busy={filePending}
      onSubmit={(event) => {
        if (!fileType) return;
        event.preventDefault();
        if (uploadLock.current) return;
        uploadLock.current = true;
        void uploadFile(event.currentTarget);
      }}
    >
      <h2 className="text-xl font-semibold">Add material</h2>
      <input type="hidden" name="courseId" value={courseId} />
      <label className={labelClass}>
        Title
        <input
          className={inputClass}
          name="title"
          required
          minLength={3}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className={labelClass}>
        Type
        <select
          className={inputClass}
          name="resourceType"
          value={resourceType}
          onChange={(event) => {
            setResourceType(event.target.value);
            setFileError(null);
          }}
        >
          {RESOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {resourceTypeLabel(type)}
            </option>
          ))}
        </select>
      </label>
      <p className="text-base leading-6 text-zinc-700">
        A PDF can be up to 25 MB. An MP3 can be up to 20 MB. Only MP3 audio is accepted. The file appears in the list
        after the server has checked its size, type, and checksum.
      </p>
      <label className={labelClass}>
        {allowWholeCourse ? "Section (leave blank for whole course)" : "Section"}
        <select className={inputClass} name="sectionId" value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
          {allowWholeCourse ? <option value="">Whole course</option> : null}
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
      </label>
      {fileType ? (
        <label className={labelClass}>
          {resourceType === "AUDIO" ? `MP3 file, up to ${fileLimit}` : `PDF file, up to ${fileLimit}`}
          <input
            ref={fileRef}
            className={inputClass}
            name="courseFile"
            type="file"
            required
            disabled={filePending}
            accept={resourceType === "AUDIO" ? "audio/mpeg,.mp3" : "application/pdf,.pdf"}
          />
        </label>
      ) : null}
      {linkType ? (
        <label className={labelClass}>
          Link (https)
          <input className={inputClass} name="externalUrl" type="url" placeholder="https://example.com/lesson" />
        </label>
      ) : null}
      {!fileType && !linkType ? (
        <label className={labelClass}>
          Reading-list text
          <textarea className={`${inputClass} min-h-28 py-2`} name="bodyText" rows={4} required minLength={8} />
        </label>
      ) : null}
      {state.error && !fileType ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      {fileMessage ? (
        <p role="status" className="text-lg font-medium">
          {fileMessage}
        </p>
      ) : null}
      {fileError ? (
        <p role="alert" className="text-lg font-medium">
          {fileError}
        </p>
      ) : null}
      {filePending ? (
        <p role="status" className="text-lg font-medium">
          Uploading…
        </p>
      ) : null}
      <button className={buttonClass} type="submit" disabled={pending || filePending}>
        {filePending ? "Uploading…" : pending ? "Saving…" : "Add material"}
      </button>
    </form>
  );
}

export function RemoveResourceForm({ courseId, resourceId }: { courseId: string; resourceId: string }) {
  const [state, action, pending] = useActionState(deleteResourceAction, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      {state.error ? (
        <p role="alert" className="text-lg font-medium">
          {state.error}
        </p>
      ) : null}
      <button className="min-h-12 w-full rounded-lg border-2 border-zinc-400 px-4 text-lg text-zinc-800" type="submit" disabled={pending}>
        {pending ? "Removing…" : "Remove"}
      </button>
    </form>
  );
}
