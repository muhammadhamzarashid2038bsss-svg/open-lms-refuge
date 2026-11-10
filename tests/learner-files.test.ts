import { createHash } from "crypto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import { prismaSubmissionDb } from "../lib/data/submission-db";
import { downloadSubmission } from "../lib/data/submissions";
import { loadSectionGradebook } from "../lib/data/assignments";
import { listLearnerHomework } from "../lib/data/learner-homework";
import { prisma } from "../lib/db";
import {
  closeWorkingDatabase,
  LOCAL_DB_NAME,
  LOCAL_DB_VERSION,
  localRequest,
  openWorkingDatabase,
  runLocalTransaction,
} from "../lib/device/local-db";
import { listQueuedFiles, queueHomeworkFile, type FileOwner } from "../lib/device/file-queue";
import { sendPendingSubmissions, type FileUploader } from "../lib/device/file-upload";
import { sha256Hex } from "../lib/device/sha256";
import { PHOTO_TARGET_BYTES, prepareStoredFile, type ImageCodec } from "../lib/lms/photo-prepare";
import { MAX_SUBMISSION_BYTES, sniffSubmissionMime } from "../lib/storage/file-rules";
import { registerOfflinePhone } from "../lib/data/sync-attendance";

globalThis.IDBKeyRange = IDBKeyRange;

const owner: FileOwner = {
  centerId: "00000000-0000-4000-8000-0000000000c1",
  userId: "00000000-0000-4000-8000-0000000000a1",
  learnerId: "00000000-0000-4000-8000-0000000000b1",
};
const assignmentId = "00000000-0000-4000-8000-000000000011";
const sectionId = "00000000-0000-4000-8000-000000000012";

const granted = {
  persist: async () => true,
  estimate: async () => ({ quota: 5_000_000, usage: 1000 }),
};
const denied = {
  persist: async () => false,
  estimate: async () => ({ quota: 5_000_000, usage: 1000 }),
};
const full = {
  persist: async () => true,
  estimate: async () => ({ quota: 2000, usage: 1900 }),
};
const blind = { persist: async () => true };

function jpeg(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

function png(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((byte, index) => {
    bytes[index] = byte;
  });
  return bytes;
}

function codec(encoded: Uint8Array | null, seen: { mime: string }[] = []): ImageCodec {
  return {
    async decode() {
      return { hasAlpha: false };
    },
    async encode(options) {
      seen.push({ mime: options.mime });
      return encoded;
    },
  };
}

function openVersion(factory: IDBFactory, version: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(LOCAL_DB_NAME, version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

describe("file database upgrade", () => {
  it("opens version 3 from version 2 without dropping saved rows", async () => {
    const factory = new IDBFactory();
    const old = await openVersion(factory, 2, (db) => {
      db.createObjectStore("events", { keyPath: "clientEventId" });
      db.createObjectStore("recordMutations", { keyPath: "clientMutationId" });
      db.createObjectStore("meta", { keyPath: "key" });
    });
    await new Promise<void>((resolve, reject) => {
      const tx = old.transaction(["events", "recordMutations", "meta"], "readwrite");
      tx.objectStore("events").put({ clientEventId: "keep-attendance", centerId: "center-a", mark: "present" });
      tx.objectStore("recordMutations").put({ clientMutationId: "keep-grade", entityType: "GRADE_ENTRY", points: "14.00" });
      tx.objectStore("meta").put({
        key: "migration",
        schemaVersion: 1,
        importStatus: "verified",
        legacyPresence: "missing",
        legacyFingerprint: null,
        itemCount: 0,
        releaseCount: 0,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    old.close();
    const opened = await openWorkingDatabase(factory);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.db.version).toBe(LOCAL_DB_VERSION);
    expect(LOCAL_DB_VERSION).toBe(3);
    expect([...opened.db.objectStoreNames]).toEqual(expect.arrayContaining(["events", "recordMutations", "meta", "fileQueue"]));
    const indexes = await runLocalTransaction(opened.db, ["fileQueue", "events", "recordMutations", "meta"], "readonly", async (tx) => {
      const event = await localRequest(tx.objectStore("events").get("keep-attendance"));
      const grade = await localRequest(tx.objectStore("recordMutations").get("keep-grade"));
      const meta = await localRequest(tx.objectStore("meta").get("migration"));
      return {
        event,
        grade,
        meta,
        fileIndexes: [...tx.objectStore("fileQueue").indexNames],
      };
    });
    expect(indexes.event).toMatchObject({ mark: "present" });
    expect(indexes.grade).toMatchObject({ points: "14.00" });
    expect(indexes.meta).toMatchObject({ importStatus: "verified" });
    expect(indexes.fileIndexes.sort()).toEqual(["byAssignment", "byOwner"]);
    closeWorkingDatabase(opened.db);
  });
});

describe("photo preparation", () => {
  it("keeps an allowed small file, refuses other types, and does not compress a PDF", async () => {
    const calls: { mime: string }[] = [];
    const small = await prepareStoredFile({ filename: "sheet.jpg", bytes: jpeg() }, codec(null, calls));
    expect(small.ok && small.mimeType).toBe("image/jpeg");
    expect(calls).toHaveLength(0);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const kept = await prepareStoredFile({ filename: "work.pdf", bytes: pdf }, codec(jpeg(), calls));
    expect(kept.ok && kept.bytes).toEqual(pdf);
    expect(calls).toHaveLength(0);
    const svg = await prepareStoredFile({ filename: "x.svg", bytes: new TextEncoder().encode("<svg></svg>") }, codec(jpeg()));
    expect(svg.ok).toBe(false);
    const html = await prepareStoredFile({ filename: "x.html", bytes: new TextEncoder().encode("<html></html>") }, codec(jpeg()));
    expect(html.ok).toBe(false);
    const exe = await prepareStoredFile({ filename: "x.exe", bytes: Uint8Array.from([0x4d, 0x5a, 0, 0]) }, codec(jpeg()));
    expect(exe.ok).toBe(false);
    const zip = await prepareStoredFile({ filename: "x.zip", bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]) }, codec(jpeg()));
    expect(zip.ok).toBe(false);
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const webpKept = await prepareStoredFile({ filename: "scan.webp", bytes: webp }, codec(jpeg(), calls));
    expect(webpKept.ok && webpKept.mimeType).toBe("image/webp");
    expect(calls).toHaveLength(0);
  });

  it("shrinks a large photo in the same format and refuses a result over 1 MB", async () => {
    const seen: { mime: string }[] = [];
    const source = jpeg(PHOTO_TARGET_BYTES + 20);
    const smaller = jpeg(1000);
    const prepared = await prepareStoredFile({ filename: "board.jpg", bytes: source }, codec(smaller, seen));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.mimeType).toBe("image/jpeg");
    expect(prepared.bytes.byteLength).toBe(1000);
    expect(seen.every((call) => call.mime === "image/jpeg")).toBe(true);
    expect(sniffSubmissionMime(prepared.bytes)).toBe("image/jpeg");
    const hash = await sha256Hex(prepared.bytes);
    expect(hash).toBe(createHash("sha256").update(prepared.bytes).digest("hex"));
    const pngSeen: { mime: string }[] = [];
    const pngSource = png(PHOTO_TARGET_BYTES + 10);
    const pngResult = await prepareStoredFile(
      { filename: "scan.png", bytes: pngSource },
      {
        async decode() {
          return { hasAlpha: true };
        },
        async encode(options) {
          pngSeen.push({ mime: options.mime });
          return png(800);
        },
      },
    );
    expect(pngResult.ok && pngResult.mimeType).toBe("image/png");
    expect(pngSeen.every((call) => call.mime === "image/png")).toBe(true);
    const tooBig = jpeg(MAX_SUBMISSION_BYTES + 10);
    const refused = await prepareStoredFile({ filename: "huge.jpg", bytes: tooBig }, codec(jpeg(MAX_SUBMISSION_BYTES + 5)));
    expect(refused.ok).toBe(false);
    const changed = await prepareStoredFile({ filename: "bad.jpg", bytes: source }, codec(new Uint8Array([0x25, 0x50, 0x44, 0x46])));
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.mimeType).toBe("image/jpeg");
    expect(sniffSubmissionMime(changed.bytes)).toBe("image/jpeg");
    const readable = jpeg(PHOTO_TARGET_BYTES + 80);
    const keptLarge = await prepareStoredFile({ filename: "writing.jpg", bytes: source }, codec(readable));
    expect(keptLarge.ok).toBe(true);
    if (!keptLarge.ok) return;
    expect(keptLarge.note).toContain("500 KB");
    expect(keptLarge.bytes.byteLength).toBeLessThanOrEqual(MAX_SUBMISSION_BYTES);
  });

  it("explains when the phone cannot shrink a readable photo that is still under 1 MB", async () => {
    const source = jpeg(PHOTO_TARGET_BYTES + 30);
    const prepared = await prepareStoredFile(
      { filename: "writing.jpg", bytes: source },
      {
        async decode() {
          return null;
        },
        async encode() {
          throw new Error("no canvas");
        },
      },
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.note).toContain("could not shrink");
    expect(prepared.bytes).toEqual(source);
  });
});

describe("homework file queue", () => {
  it("keeps a file for this account and hides it from another account", async () => {
    const factory = new IDBFactory();
    const saved = await queueHomeworkFile(
      factory,
      owner,
      { assignmentId, sectionId, displayFilename: "secret.jpg", mimeType: "image/jpeg", checksumSha256: createHash("sha256").update(jpeg()).digest("hex"), bytes: jpeg() },
      granted,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.message).toBe("This file is on this phone, waiting to send.");
    expect(saved.file.clientSubmissionId.startsWith("file-")).toBe(true);
    expect(saved.file.displayFilename).toBe("secret.jpg");
    expect(saved.file.blob?.size).toBe(jpeg().byteLength);
    const listed = await listQueuedFiles(factory, owner);
    expect(listed.ok && listed.files).toHaveLength(1);
    const other = await listQueuedFiles(factory, { ...owner, userId: "00000000-0000-4000-8000-0000000000a2" });
    expect(other.ok && other.files).toEqual([]);
    const again = await openWorkingDatabase(factory);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    closeWorkingDatabase(again.db);
    const reread = await listQueuedFiles(factory, owner);
    expect(reread.ok && reread.files[0]?.clientSubmissionId).toBe(saved.file.clientSubmissionId);
  });

  it("warns when the browser has not promised to keep the file, and refuses an unmeasured or full phone", async () => {
    const warned = await queueHomeworkFile(
      new IDBFactory(),
      owner,
      { assignmentId, sectionId, displayFilename: "a.jpg", mimeType: "image/jpeg", checksumSha256: "ab".repeat(32), bytes: jpeg() },
      denied,
    );
    expect(warned.ok).toBe(true);
    if (!warned.ok) return;
    expect(warned.message).toContain("did not promise to keep it");
    expect(warned.message.toLowerCase()).not.toContain("permanent");
    const packed = await queueHomeworkFile(
      new IDBFactory(),
      owner,
      { assignmentId, sectionId, displayFilename: "a.jpg", mimeType: "image/jpeg", checksumSha256: "ab".repeat(32), bytes: jpeg() },
      full,
    );
    expect(packed.ok).toBe(false);
    const unknown = await queueHomeworkFile(
      new IDBFactory(),
      owner,
      { assignmentId, sectionId, displayFilename: "a.jpg", mimeType: "image/jpeg", checksumSha256: "ab".repeat(32), bytes: jpeg() },
      blind,
    );
    expect(unknown.ok).toBe(false);
  });

  it("does not save or show a file while the phone is locked for someone else", async () => {
    const factory = new IDBFactory();
    const opened = await openWorkingDatabase(factory);
    if (!opened.ok) throw new Error("db");
    await runLocalTransaction(opened.db, ["deviceLock"], "readwrite", async (tx) => {
      await localRequest(tx.objectStore("deviceLock").put({ key: "current", lock: { userId: "other-user", centerId: owner.centerId } }));
    });
    closeWorkingDatabase(opened.db);
    const saved = await queueHomeworkFile(
      factory,
      owner,
      { assignmentId, sectionId, displayFilename: "a.jpg", mimeType: "image/jpeg", checksumSha256: "cd".repeat(32), bytes: jpeg() },
      granted,
    );
    expect(saved.ok).toBe(false);
    const listed = await listQueuedFiles(factory, owner);
    expect(listed.ok && listed.files).toEqual([]);
  });

  it("reuses the upload id for the same file and mints a new id for a different file", async () => {
    const factory = new IDBFactory();
    const bytes = jpeg();
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const first = await queueHomeworkFile(factory, owner, { assignmentId, sectionId, displayFilename: "a.jpg", mimeType: "image/jpeg", checksumSha256: checksum, bytes }, granted);
    const second = await queueHomeworkFile(factory, owner, { assignmentId, sectionId, displayFilename: "a.jpg", mimeType: "image/jpeg", checksumSha256: checksum, bytes }, granted);
    expect(first.ok && second.ok && first.ok && second.ok && first.file.clientSubmissionId).toBe(second.ok ? second.file.clientSubmissionId : "");
    const otherBytes = jpeg(40);
    const third = await queueHomeworkFile(
      factory,
      owner,
      { assignmentId, sectionId, displayFilename: "b.jpg", mimeType: "image/jpeg", checksumSha256: createHash("sha256").update(otherBytes).digest("hex"), bytes: otherBytes },
      granted,
    );
    expect(third.ok).toBe(true);
    if (!first.ok || !third.ok) return;
    expect(third.file.clientSubmissionId).not.toBe(first.file.clientSubmissionId);
    const listed = await listQueuedFiles(factory, owner);
    expect(listed.ok && listed.files).toHaveLength(1);
  });
});

describe("homework upload", () => {
  function uploader(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, putOk = true): { uploader: FileUploader; calls: string[]; puts: number } {
    const calls: string[] = [];
    let puts = 0;
    const transport = {
      calls,
      get puts() {
        return puts;
      },
      uploader: {
        online: () => true,
        async fetch(url: string, init?: RequestInit) {
          calls.push(`${init?.method ?? "GET"} ${url}`);
          return handler(url, init);
        },
        async put(_url: string, _blob: Blob, _type: string, onProgress: (loaded: number, total: number) => void) {
          puts += 1;
          onProgress(40, 100);
          onProgress(100, 100);
          return { ok: putOk, status: putOk ? 200 : 403 };
        },
      },
    };
    return transport;
  }

  async function queued(factory: IDBFactory) {
    const bytes = jpeg();
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    const saved = await queueHomeworkFile(
      factory,
      owner,
      { assignmentId, sectionId, displayFilename: "sheet.jpg", mimeType: "image/jpeg", checksumSha256, bytes },
      granted,
    );
    if (!saved.ok) throw new Error(saved.message);
    return saved.file;
  }

  it("uploads through the submission routes and drops the local file only after confirmation", async () => {
    const factory = new IDBFactory();
    const file = await queued(factory);
    let finalized = false;
    const transport = uploader(async (url, init) => {
      if (url === "/api/submissions") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.filename).toBeUndefined();
        expect(body.clientSubmissionId).toBe(file.clientSubmissionId);
        return Response.json({ submissionId: "00000000-0000-4000-8000-000000000099", uploadUrl: "https://storage.test/put/1", acknowledged: false, uploadState: "UPLOADING" });
      }
      finalized = true;
      return Response.json({ acknowledged: true, uploadState: "STORED", submissionId: "00000000-0000-4000-8000-000000000099" });
    });
    const sent = await sendPendingSubmissions(factory, owner, transport.uploader);
    expect(sent.ok).toBe(true);
    expect(finalized).toBe(true);
    expect(sent.progress.map((item) => item.loaded)).toEqual([40, 100]);
    expect(transport.calls.some((call) => call.includes("/api/sync"))).toBe(false);
    const left = await listQueuedFiles(factory, owner);
    expect(left.ok && left.files[0]?.status).toBe("submitted");
    expect(left.ok && left.files[0]?.blob).toBeNull();
  });

  it("keeps the file when the upload or the confirmation fails, then recovers", async () => {
    const factory = new IDBFactory();
    const file = await queued(factory);
    const interrupted = uploader(() => Response.json({ submissionId: "00000000-0000-4000-8000-000000000099", uploadUrl: "https://storage.test/put/1" }), false);
    const first = await sendPendingSubmissions(factory, owner, interrupted.uploader);
    expect(first.ok).toBe(false);
    const kept = await listQueuedFiles(factory, owner);
    expect(kept.ok && kept.files[0]?.blob?.size).toBe(file.byteSize);
    const mismatch = uploader(async (url) => {
      if (url === "/api/submissions") return Response.json({ submissionId: "00000000-0000-4000-8000-000000000099", uploadUrl: "https://storage.test/put/2", acknowledged: false });
      return Response.json({ acknowledged: false, code: "CHECKSUM_MISMATCH", error: "The file does not match the checksum from this phone." }, { status: 409 });
    });
    expect((await sendPendingSubmissions(factory, owner, mismatch.uploader)).ok).toBe(false);
    expect((await listQueuedFiles(factory, owner)).ok).toBe(true);
    const still = await listQueuedFiles(factory, owner);
    expect(still.ok && still.files[0]?.blob).not.toBeNull();
    const offline = await sendPendingSubmissions(factory, owner, { ...mismatch.uploader, online: () => false });
    expect(offline.message).toContain("offline");
    const recovered = uploader(async (url, init) => {
      const body = url === "/api/submissions" ? JSON.parse(String(init?.body)) as { clientSubmissionId?: string } : null;
      if (body) expect(body.clientSubmissionId).toBe(file.clientSubmissionId);
      if (url === "/api/submissions") return Response.json({ acknowledged: true, uploadState: "STORED", submissionId: "00000000-0000-4000-8000-000000000099" });
      return Response.json({ acknowledged: false }, { status: 503 });
    });
    expect((await sendPendingSubmissions(factory, owner, recovered.uploader)).ok).toBe(true);
    const done = await listQueuedFiles(factory, owner);
    expect(done.ok && done.files[0]?.blob).toBeNull();
    expect(recovered.puts).toBe(0);
  });

  it("does not send another account's file or call the grade sync route when storage is down", async () => {
    const factory = new IDBFactory();
    await queued(factory);
    const calls: string[] = [];
    const stranger = await sendPendingSubmissions(factory, { ...owner, userId: "00000000-0000-4000-8000-0000000000a9" }, {
      online: () => true,
      fetch: async (url) => {
        calls.push(url);
        return Response.json({ error: "no" }, { status: 500 });
      },
      put: async () => ({ ok: true, status: 200 }),
    });
    expect(stranger.ok).toBe(true);
    expect(calls).toEqual([]);
    const down = await sendPendingSubmissions(factory, owner, {
      online: () => true,
      fetch: async (url) => {
        calls.push(url);
        return Response.json({ acknowledged: false, code: "STORAGE_UNAVAILABLE", error: "File storage is not available right now." }, { status: 503 });
      },
      put: async () => ({ ok: true, status: 200 }),
    });
    expect(down.ok).toBe(false);
    expect(calls.every((url) => url.startsWith("/api/submissions"))).toBe(true);
    expect((await listQueuedFiles(factory, owner)).ok && (await listQueuedFiles(factory, owner)).ok).toBe(true);
    const rows = await listQueuedFiles(factory, owner);
    expect(rows.ok && rows.files[0]?.blob).not.toBeNull();
  });

  it("ignores a second send while the first upload is still running", async () => {
    const factory = new IDBFactory();
    await queued(factory);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    const uploader: FileUploader = {
      online: () => true,
      fetch: async () => {
        posts += 1;
        await gate;
        return Response.json({ submissionId: "00000000-0000-4000-8000-000000000099", uploadUrl: "https://storage.test/put/1" });
      },
      put: async (_url, _blob, _type, onProgress) => {
        onProgress(100, 100);
        return { ok: true, status: 200 };
      },
    };
    const first = sendPendingSubmissions(factory, owner, uploader);
    for (let attempt = 0; attempt < 20 && posts < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const second = await sendPendingSubmissions(factory, owner, uploader);
    expect(second.message).toContain("already being sent");
    expect(posts).toBe(1);
    release();
    await first;
  });

  it("keeps the file when confirmation cannot be reached, then accepts a later confirmation", async () => {
    const factory = new IDBFactory();
    const file = await queued(factory);
    let finalizeAttempts = 0;
    const transport = uploader(async (url) => {
      if (url === "/api/submissions") {
        return Response.json({ submissionId: "00000000-0000-4000-8000-000000000099", uploadUrl: "https://storage.test/put/1", acknowledged: false });
      }
      finalizeAttempts += 1;
      if (finalizeAttempts === 1) throw new Error("network");
      return Response.json({ acknowledged: true, uploadState: "STORED", submissionId: "00000000-0000-4000-8000-000000000099" });
    });
    const first = await sendPendingSubmissions(factory, owner, transport.uploader);
    expect(first.ok).toBe(false);
    const waiting = await listQueuedFiles(factory, owner);
    expect(waiting.ok && waiting.files[0]?.status).toBe("awaiting_confirmation");
    expect(waiting.ok && waiting.files[0]?.blob?.size).toBe(file.byteSize);
    const second = await sendPendingSubmissions(factory, owner, transport.uploader);
    expect(second.ok).toBe(true);
    const done = await listQueuedFiles(factory, owner);
    expect(done.ok && done.files[0]?.blob).toBeNull();
    expect(done.ok && done.files[0]?.status).toBe("submitted");
    expect(transport.puts).toBe(1);
  });
});

describe("learner homework and gradebook files", () => {
  it("shows the learner only Digital and Both homework, and the teacher the stored file state", async () => {
    const now = new Date("2026-11-10T01:00:00.000Z");
    const learner = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { userId: true },
    });
    const actor = await loadActor(learner.userId, now);
    if (!actor) throw new Error("missing learner");
    const homework = await listLearnerHomework(actor);
    expect(homework?.some((item) => item.title === "Demo photo homework" && item.kind === "DIGITAL")).toBe(true);
    expect(homework?.some((item) => item.title === "Demo paper homework 1")).toBe(false);
    expect(homework?.every((item) => item.kind === "DIGITAL" || item.kind === "BOTH")).toBe(true);
    const teacher = await loadActor((await prisma.user.findFirstOrThrow({ where: { email: "teacher.one@demo.invalid" }, select: { id: true } })).id, now);
    expect(teacher && (await listLearnerHomework(teacher))).toBeNull();
    const afternoon = await loadActor(
      (await prisma.learnerProfile.findFirstOrThrow({ where: { learnerCode: "LNR-0016", center: { code: "DEMO" } }, select: { userId: true } })).userId,
      now,
    );
    const afternoonWork = afternoon ? await listLearnerHomework(afternoon) : [];
    expect(afternoonWork?.some((item) => item.sectionName === "Morning Group")).toBe(false);
    if (!teacher) return;
    const book = await loadSectionGradebook(teacher, (await prisma.section.findFirstOrThrow({ where: { name: "Morning Group", course: { center: { code: "DEMO" } } }, select: { id: true } })).id);
    expect(book?.files.some((file) => file.status === "submitted" && file.submissionId)).toBe(true);
    const stored = book?.files.find((file) => file.status === "submitted" && file.submissionId);
    if (!stored?.submissionId) return;
    const otherTeacher = await loadActor((await prisma.user.findFirstOrThrow({ where: { email: "teacher.two@demo.invalid" }, select: { id: true } })).id, now);
    const otherLearner = await loadActor(
      (await prisma.learnerProfile.findFirstOrThrow({ where: { learnerCode: "LNR-0016", center: { code: "DEMO" } }, select: { userId: true } })).userId,
      now,
    );
    const bundle = { db: prismaSubmissionDb(prisma), storage: null, now, registerDevice: registerOfflinePhone };
    expect((await downloadSubmission(otherTeacher, stored.submissionId, bundle)).status).toBe(404);
    expect((await downloadSubmission(otherLearner, stored.submissionId, bundle)).status).toBe(404);
    const allowed = await downloadSubmission(teacher, stored.submissionId, bundle);
    expect(allowed.status).toBe(503);
    expect(JSON.stringify(allowed.body)).not.toContain("http");
  });
});
