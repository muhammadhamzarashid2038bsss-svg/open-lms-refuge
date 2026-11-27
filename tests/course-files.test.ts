import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import type { Actor } from "../lib/auth/permissions";
import { canReadResource } from "../lib/auth/permissions";
import { createResource } from "../lib/data/courses";
import {
  beginCourseUpload,
  courseResourceDownloadResponse,
  finalizeCourseUpload,
  refreshCourseUpload,
  type CourseFileDb,
  type CourseFileDeps,
  type VerifiedCourseFile,
} from "../lib/data/course-files";
import { MP3_MAX_BYTES, PDF_MAX_BYTES } from "../lib/storage/course-file-rules";
import { GET_URL_SECONDS, PUT_URL_SECONDS } from "../lib/storage/file-rules";
import { memoryStorage, putObject, type MemoryStorage } from "./support/memory-submission";

const SECRET = "test-only-session-secret-must-be-32";
const CENTER = "00000000-0000-4000-8000-0000000000c1";
const COURSE = "00000000-0000-4000-8000-0000000000a9";
const MORNING = "00000000-0000-4000-8000-0000000000b1";
const AFTERNOON = "00000000-0000-4000-8000-0000000000b2";
const TEACHER = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const DIRECTOR = "00000000-0000-4000-8000-0000000000e3";

function teacher(id: string, sections: string[]): Actor {
  return {
    id,
    role: "TEACHER",
    centerId: CENTER,
    active: true,
    displayName: "Teacher",
    learnerId: null,
    assignedSectionIds: sections,
    enrolledSectionIds: [],
  };
}

function learner(sections: string[]): Actor {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    role: "STUDENT",
    centerId: CENTER,
    active: true,
    displayName: "Learner",
    learnerId: "00000000-0000-4000-8000-0000000000a1",
    assignedSectionIds: [],
    enrolledSectionIds: sections,
  };
}

class MemoryCourseDb implements CourseFileDb {
  rows: VerifiedCourseFile[] = [];
  async course(id: string) {
    if (id !== COURSE) return null;
    return { id: COURSE, centerId: CENTER, sectionIds: [MORNING, AFTERNOON] };
  }
  async resource(id: string) {
    return this.rows.find((row) => row.id === id) ?? null;
  }
  async insertVerified(row: VerifiedCourseFile) {
    if (this.rows.some((item) => item.id === row.id)) return "exists";
    this.rows.push(row);
    return "created";
  }
}

function bundle(storage: StorageAdapterOrNull = memoryStorage()): { db: MemoryCourseDb; deps: CourseFileDeps; storage: MemoryStorage } {
  const db = new MemoryCourseDb();
  const store = storage ?? memoryStorage();
  return {
    db,
    storage: store,
    deps: { db, storage, now: new Date("2026-11-27T00:00:00.000Z"), secret: SECRET },
  };
}

type StorageAdapterOrNull = MemoryStorage | null;

function checksum(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
}

function mp3Bytes(): Buffer {
  return Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90, 0x00]);
}

function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
}

const morningTeacher = teacher(TEACHER, [MORNING]);

async function upload(
  actor: Actor,
  bytes: Buffer,
  resourceType: "PDF" | "AUDIO",
  sectionId: string | null,
  storage: MemoryStorage,
  deps: CourseFileDeps,
) {
  const started = await beginCourseUpload(
    actor,
    {
      courseId: COURSE,
      sectionId,
      title: resourceType === "PDF" ? "Week one letters" : "Week one sounds",
      resourceType,
      byteSize: bytes.length,
      checksumSha256: checksum(bytes),
      mimeType: "image/jpeg",
    },
    deps,
  );
  const token = typeof started.body.uploadToken === "string" ? started.body.uploadToken : "";
  const key = storage.puts.at(-1)?.key ?? "";
  if (started.status === 200 && key) putObject(storage, key, bytes, resourceType === "PDF" ? "application/pdf" : "audio/mpeg");
  const saved = token ? await finalizeCourseUpload(actor, token, deps) : started;
  return { started, saved, token, key };
}

describe("course PDF and MP3 uploads", () => {
  it("stores a PDF only after the server checks size, type, and checksum", async () => {
    const { db, deps, storage } = bundle();
    const bytes = pdfBytes();
    const result = await upload(morningTeacher, bytes, "PDF", null, storage, deps);
    expect(result.started.status).toBe(200);
    expect(storage.puts[0]).toMatchObject({ contentType: "application/pdf", byteSize: bytes.length, expiresInSeconds: 60 * 60 });
    expect(result.key.startsWith("course-resources/")).toBe(true);
    expect(JSON.stringify(result.started.body)).not.toContain(result.key);
    expect(JSON.stringify(result.started.body)).not.toContain("storageKey");
    expect(JSON.stringify(result.started.body)).not.toContain(SECRET);
    expect(result.saved.body.stored).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.checksumSha256).toBe(checksum(bytes));
    expect(db.rows[0]?.sectionId).toBeNull();
  });

  it("stores an MP3 and ignores a browser MIME label", async () => {
    const { db, deps, storage } = bundle();
    const bytes = mp3Bytes();
    const result = await upload(morningTeacher, bytes, "AUDIO", MORNING, storage, deps);
    expect(result.saved.status).toBe(200);
    expect(storage.puts[0]?.contentType).toBe("audio/mpeg");
    expect(db.rows[0]?.sectionId).toBe(MORNING);
    expect(db.rows[0]?.mimeType).toBe("audio/mpeg");
  });

  it("refuses an oversized PDF or MP3 before it creates an upload link", async () => {
    const { db, deps, storage } = bundle();
    const pdf = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "Too big", resourceType: "PDF", byteSize: PDF_MAX_BYTES + 1, checksumSha256: "ab".repeat(32) },
      deps,
    );
    const mp3 = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "Too big", resourceType: "AUDIO", byteSize: MP3_MAX_BYTES + 1, checksumSha256: "ab".repeat(32) },
      deps,
    );
    const exact = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "Exact PDF", resourceType: "PDF", byteSize: PDF_MAX_BYTES, checksumSha256: "ab".repeat(32) },
      deps,
    );
    expect(pdf.status).toBe(413);
    expect(mp3.status).toBe(413);
    expect(exact.status).toBe(200);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]?.byteSize).toBe(PDF_MAX_BYTES);
    expect(db.rows).toHaveLength(0);
  });

  it("refuses a type that is not a PDF or MP3, and deletes a file whose bytes do not match", async () => {
    const { db, deps, storage } = bundle();
    const refused = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "A video", resourceType: "VIDEO_LINK", byteSize: 20, checksumSha256: "ab".repeat(32) },
      deps,
    );
    expect(refused.status).toBe(415);
    expect(storage.puts).toHaveLength(0);

    const bytes = pdfBytes();
    const started = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "Looks like a PDF", resourceType: "PDF", byteSize: jpegBytes().length, checksumSha256: checksum(jpegBytes()) },
      deps,
    );
    const key = storage.puts[0]?.key ?? "";
    putObject(storage, key, jpegBytes(), "application/pdf");
    const saved = await finalizeCourseUpload(morningTeacher, String(started.body.uploadToken), deps);
    expect(saved.status).toBe(415);
    expect(storage.deleted).toEqual([key]);
    expect(db.rows).toHaveLength(0);

    const audio = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "Not audio", resourceType: "AUDIO", byteSize: bytes.length, checksumSha256: checksum(bytes) },
      deps,
    );
    const audioKey = storage.puts[1]?.key ?? "";
    putObject(storage, audioKey, bytes, "audio/mpeg");
    const audioSaved = await finalizeCourseUpload(morningTeacher, String(audio.body.uploadToken), deps);
    expect(audioSaved.status).toBe(415);
    expect(storage.deleted).toContain(audioKey);
    expect(db.rows).toHaveLength(0);
  });

  it("deletes an object when the checksum does not match and keeps no resource", async () => {
    const { db, deps, storage } = bundle();
    const bytes = pdfBytes();
    const started = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "Changed file", resourceType: "PDF", byteSize: bytes.length, checksumSha256: "cd".repeat(32) },
      deps,
    );
    const key = storage.puts[0]?.key ?? "";
    putObject(storage, key, bytes, "application/pdf");
    const saved = await finalizeCourseUpload(morningTeacher, String(started.body.uploadToken), deps);
    expect(saved.body.code).toBe("CHECKSUM_MISMATCH");
    expect(storage.deleted).toEqual([key]);
    expect(db.rows).toHaveLength(0);
    expect(JSON.stringify(saved.body)).not.toContain(key);
  });

  it("gives a fresh upload link for the same object and accepts one finalize twice", async () => {
    const { db, deps, storage } = bundle();
    const bytes = pdfBytes();
    const started = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "Retry this PDF", resourceType: "PDF", byteSize: bytes.length, checksumSha256: checksum(bytes) },
      deps,
    );
    const token = String(started.body.uploadToken);
    const again = await refreshCourseUpload(morningTeacher, token, deps);
    expect(again.status).toBe(200);
    expect(storage.puts).toHaveLength(2);
    expect(storage.puts[1]?.key).toBe(storage.puts[0]?.key);
    expect(storage.puts[1]?.expiresInSeconds).toBe(60 * 60);
    expect(PUT_URL_SECONDS).toBe(600);
    const key = storage.puts[0]?.key ?? "";
    putObject(storage, key, bytes, "application/pdf");
    const first = await finalizeCourseUpload(morningTeacher, token, deps);
    const second = await finalizeCourseUpload(morningTeacher, token, deps);
    expect(first.body.stored).toBe(true);
    expect(second.body.resourceId).toBe(first.body.resourceId);
    expect(db.rows).toHaveLength(1);
  });

  it("does not create a resource when storage is missing or the upload never arrived", async () => {
    const missing = bundle(null);
    const refused = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "No bucket", resourceType: "PDF", byteSize: 32, checksumSha256: "ab".repeat(32) },
      missing.deps,
    );
    expect(refused.status).toBe(503);
    expect(missing.db.rows).toHaveLength(0);

    const { db, deps, storage } = bundle();
    const started = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, title: "Interrupted", resourceType: "PDF", byteSize: 32, checksumSha256: "ab".repeat(32) },
      deps,
    );
    const saved = await finalizeCourseUpload(morningTeacher, String(started.body.uploadToken), deps);
    expect(saved.body.code).toBe("OBJECT_NOT_FOUND");
    expect(storage.deleted).toHaveLength(0);
    expect(db.rows).toHaveLength(0);
  });

  it("lets a teacher upload to an assigned section or the whole course, and refuses another section", async () => {
    const { db, deps, storage } = bundle();
    const file = { resourceType: "PDF", byteSize: 32, checksumSha256: "ab".repeat(32) };
    const own = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, sectionId: MORNING, title: "Morning sheet", ...file },
      deps,
    );
    const whole = await beginCourseUpload(morningTeacher, { courseId: COURSE, title: "Whole sheet", ...file }, deps);
    const other = await beginCourseUpload(
      morningTeacher,
      { courseId: COURSE, sectionId: AFTERNOON, title: "Other sheet", ...file },
      deps,
    );
    const director = await beginCourseUpload(
      { ...teacher(DIRECTOR, []), role: "CENTER_DIRECTOR" },
      { courseId: COURSE, sectionId: AFTERNOON, title: "Director sheet", ...file },
      deps,
    );
    expect(own.status).toBe(200);
    expect(whole.status).toBe(200);
    expect(other.status).toBe(404);
    expect(director.status).toBe(200);
    expect(storage.puts).toHaveLength(3);
    expect(db.rows).toHaveLength(0);
  });

  it("keeps section files to that section and lets a whole-course file reach both", async () => {
    const { db, deps, storage } = bundle();
    const morning = await upload(morningTeacher, pdfBytes(), "PDF", MORNING, storage, deps);
    expect(morning.saved.status).toBe(200);
    const otherTeacher = teacher(OTHER, [AFTERNOON]);
    const blocked = await beginCourseUpload(
      otherTeacher,
      { courseId: COURSE, sectionId: MORNING, title: "Not your section", resourceType: "PDF", byteSize: 32, checksumSha256: "ab".repeat(32) },
      deps,
    );
    expect(blocked.status).toBe(404);
    const shared = await upload(otherTeacher, mp3Bytes(), "AUDIO", null, storage, deps);
    expect(shared.saved.status).toBe(200);

    const learnerActor = learner([AFTERNOON]);
    const morningRow = db.rows[0];
    const sharedRow = db.rows[1];
    if (!morningRow || !sharedRow) throw new Error("missing rows");
    expect(
      canReadResource(learnerActor, {
        id: morningRow.id,
        centerId: morningRow.centerId,
        sectionId: morningRow.sectionId,
        courseSectionIds: morningRow.courseSectionIds,
      }),
    ).toBe(false);
    expect(
      canReadResource(learner([MORNING]), {
        id: sharedRow.id,
        centerId: sharedRow.centerId,
        sectionId: sharedRow.sectionId,
        courseSectionIds: sharedRow.courseSectionIds,
      }),
    ).toBe(true);

    async function load(actor: Actor, id: string) {
      const row = db.rows.find((item) => item.id === id);
      if (!row) return null;
      if (
        !canReadResource(actor, {
          id: row.id,
          centerId: row.centerId,
          sectionId: row.sectionId,
          courseSectionIds: row.courseSectionIds,
        })
      ) {
        return null;
      }
      return {
        title: row.title,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        checksumSha256: row.checksumSha256,
        storageKey: row.storageKey,
      };
    }

    const denied = await courseResourceDownloadResponse(learnerActor, morningRow.id, { storage, load });
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain(morningRow.storageKey);

    const allowed = await courseResourceDownloadResponse(learner([MORNING]), sharedRow.id, { storage, load });
    expect(allowed.status).toBe(302);
    expect(allowed.headers.get("location")).toContain("https://storage.test/get/");
    expect(storage.gets.at(-1)?.expiresInSeconds).toBe(GET_URL_SECONDS);
    expect(allowed.headers.get("location") ?? "").not.toContain(sharedRow.storageKey);
    expect(await allowed.text()).not.toContain(sharedRow.storageKey);

    const teacherDenied = await courseResourceDownloadResponse(otherTeacher, morningRow.id, { storage, load });
    expect(teacherDenied.status).toBe(404);
  });

  it("refuses a learner, an admin, and a teacher from another centre, and allows a director", async () => {
    const { deps, storage } = bundle();
    const learnerStart = await beginCourseUpload(learner([MORNING]), {
      courseId: COURSE,
      title: "Learner upload",
      resourceType: "PDF",
      byteSize: 32,
      checksumSha256: "ab".repeat(32),
    }, deps);
    const adminStart = await beginCourseUpload(
      { ...teacher("00000000-0000-4000-8000-0000000000e4", [MORNING]), role: "ADMIN" },
      { courseId: COURSE, title: "Admin upload", resourceType: "PDF", byteSize: 32, checksumSha256: "ab".repeat(32) },
      deps,
    );
    const outsider = await beginCourseUpload(
      { ...morningTeacher, centerId: "00000000-0000-4000-8000-0000000000c2" },
      { courseId: COURSE, title: "Other centre", resourceType: "PDF", byteSize: 32, checksumSha256: "ab".repeat(32) },
      deps,
    );
    expect(learnerStart.status).toBe(404);
    expect(adminStart.status).toBe(404);
    expect(outsider.status).toBe(404);
    const director = await beginCourseUpload(
      { ...teacher(DIRECTOR, []), role: "CENTER_DIRECTOR" },
      { courseId: COURSE, title: "Director PDF", resourceType: "PDF", byteSize: pdfBytes().length, checksumSha256: checksum(pdfBytes()) },
      deps,
    );
    expect(director.status).toBe(200);
    expect(storage.puts).toHaveLength(1);
  });

  it("does not accept a typed storage key as a course file", async () => {
    const result = await createResource(morningTeacher, {
      courseId: COURSE,
      title: "Typed key",
      resourceType: "PDF",
      storageKey: "private/demo/resources/not-real.pdf",
      mimeType: "application/pdf",
      byteSize: 10,
      checksumSha256: "ab".repeat(32),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("private/");
  });

  it("keeps an old demo key as a filler download and does not send it to object storage", async () => {
    const storage = memoryStorage();
    const key = "private/demo/resources/letter-sounds.mp3";
    const response = await courseResourceDownloadResponse(learner([MORNING]), "00000000-0000-4000-8000-000000000099", {
      storage,
      load: async () => ({
        title: "Demo letter sounds",
        mimeType: "audio/mpeg",
        byteSize: 800000,
        checksumSha256: "ab".repeat(32),
        storageKey: key,
      }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(key);
    expect(text).not.toContain("course-resources/");
    expect(storage.gets).toHaveLength(0);
  });
});
