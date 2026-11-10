import { createHash } from "crypto";
import { Readable } from "stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import { prismaSubmissionDb } from "../lib/data/submission-db";
import { downloadSubmission, finalizeSubmission, initiateSubmission } from "../lib/data/submissions";
import { prisma } from "../lib/db";
import { fingerprintStream } from "../lib/storage/checksum";
import { assessSubmissionClaim, MAX_SUBMISSION_BYTES, sniffSubmissionMime } from "../lib/storage/file-policy";
import { readR2Config } from "../lib/storage/r2-config";
import { submissionPutCommand } from "../lib/storage/r2";
import { isUuid } from "../lib/lms/timetable";
import { registerOfflinePhone } from "../lib/data/sync-attendance";
import {
  deps,
  fileClaim,
  ids,
  jpegBytes,
  learnerActor,
  MemorySubmissionDb,
  memoryStorage,
  putObject,
  teacherActor,
} from "./support/memory-submission";

const holder = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/lib/auth/actor", () => ({
  getActor: async () => holder.actor,
}));

import { POST as initiateRoute } from "../app/api/submissions/route";

describe("submission file rules", () => {
  it("accepts JPEG, PNG, WebP, and PDF signatures and rejects the other pilot types", () => {
    expect(sniffSubmissionMime(jpegBytes())).toBe("image/jpeg");
    expect(sniffSubmissionMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0);
    webp.write("WEBP", 8);
    expect(sniffSubmissionMime(webp)).toBe("image/webp");
    expect(sniffSubmissionMime(Buffer.from("%PDF-1.4"))).toBe("application/pdf");
    expect(sniffSubmissionMime(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"))).toBeNull();
    expect(sniffSubmissionMime(Buffer.from("<!DOCTYPE html><html></html>"))).toBeNull();
    expect(sniffSubmissionMime(Buffer.from([0x4d, 0x5a, 0x00, 0x00]))).toBeNull();
    expect(sniffSubmissionMime(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBeNull();
  });

  it("hashes a stream in pieces and stops past the 1 MB cap", async () => {
    const bytes = jpegBytes();
    const hashed = await fingerprintStream(Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]), MAX_SUBMISSION_BYTES);
    expect(hashed.checksumSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(hashed.complete).toBe(true);
    const huge = await fingerprintStream(Readable.from([Buffer.alloc(8, 1)]), 3);
    expect(huge.complete).toBe(false);
    expect(huge.byteSize).toBe(4);
  });

  it("keeps R2 turned off until every setting is present and does not sign an unsupported checksum", () => {
    expect(readR2Config({ R2_ACCOUNT_ID: "account", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "", R2_BUCKET_NAME: "bucket" })).toBeNull();
    const config = readR2Config({
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "bucket",
    });
    expect(config).toMatchObject({
      region: "auto",
      endpoint: "https://account.r2.cloudflarestorage.com",
      bucket: "bucket",
    });
    const command = submissionPutCommand("bucket", {
      key: "submissions/00000000-0000-4000-8000-000000000011",
      contentType: "image/jpeg",
      byteSize: 4,
    });
    expect(command.input.ChecksumSHA256).toBeUndefined();
    expect(command.input.ChecksumAlgorithm).toBeUndefined();
    expect(command.input.ContentMD5).toBeUndefined();
    expect(command.input.ContentType).toBe("image/jpeg");
  });

  it("rejects a file over 1 MB before a row would be created", () => {
    const claim = assessSubmissionClaim({
      ...fileClaim(jpegBytes(), "image/jpeg", ids.digital),
      byteSize: MAX_SUBMISSION_BYTES + 1,
      isUuid,
    });
    expect(claim.ok).toBe(false);
    if (claim.ok) return;
    expect(claim.code).toBe("TOO_LARGE");
  });
});

describe("submission workflow", () => {
  it("starts a Digital upload for the signed-in learner and keeps the key private", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const result = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    expect(result.status).toBe(200);
    expect(result.body.acknowledged).toBe(false);
    expect(result.body.uploadState).toBe("UPLOADING");
    expect(result.body.headers).toEqual({ "content-type": "image/jpeg" });
    expect(db.rows).toHaveLength(1);
    const row = db.rows[0];
    expect(row?.storageKey).toMatch(/^submissions\/[0-9a-f-]{36}$/);
    expect(row?.storageKey.startsWith("http")).toBe(false);
    expect(row?.storageKey.includes("secret")).toBe(false);
    expect(row?.mimeType).toBe("image/jpeg");
    expect(storage.puts[0]).toMatchObject({ key: row?.storageKey, contentType: "image/jpeg", byteSize: bytes.length, expiresInSeconds: 600 });
    expect(JSON.stringify(result.body)).not.toContain(row?.storageKey ?? "missing");
    expect(JSON.stringify(result.body)).not.toContain("storageKey");
  });

  it("starts a Both upload as Both, and refuses Paper and in-class exam files", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const both = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.both, { clientSubmissionId: "day10-file-both" }), deps(db, storage));
    expect(both.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    const paper = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.paper, { clientSubmissionId: "day10-file-paper" }), deps(db, storage));
    const exam = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.exam, { clientSubmissionId: "day10-file-exam" }), deps(db, storage));
    expect(paper.body.code).toBe("PAPER_NOT_ALLOWED");
    expect(exam.body.code).toBe("PAPER_NOT_ALLOWED");
    expect(db.rows).toHaveLength(1);
  });

  it("rejects an inactive learner, a missing enrollment, another center, and another learner", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const inactive = await initiateSubmission(learnerActor({ active: false }), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    expect(inactive.status).toBe(403);
    db.activePairs.clear();
    const withdrawn = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    expect(withdrawn.status).toBe(404);
    db.activePairs.add(`${ids.learner}:${ids.section}`);
    const otherCenter = await initiateSubmission(learnerActor({ centerId: ids.otherCenter }), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    expect(otherCenter.status).toBe(404);
    const otherLearner = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital, { learnerId: ids.otherLearner }), deps(db, storage));
    expect(otherLearner.status).toBe(404);
    expect(db.rows).toHaveLength(0);
  });

  it("rejects an unsupported type and reports storage unavailable without creating a row", async () => {
    const db = new MemorySubmissionDb();
    const bytes = jpegBytes();
    const svg = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital, { mimeType: "image/svg+xml" }), deps(db, memoryStorage()));
    expect(svg.status).toBe(415);
    expect(svg.body.code).toBe("UNSUPPORTED_TYPE");
    const offline = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, null));
    expect(offline.status).toBe(503);
    expect(offline.body.code).toBe("STORAGE_UNAVAILABLE");
    expect(offline.body.acknowledged).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it("reuses one row for the same upload and rejects the same id with different details", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const claim = fileClaim(bytes, "image/jpeg", ids.digital);
    const first = await initiateSubmission(learnerActor(), claim, deps(db, storage));
    const second = await initiateSubmission(learnerActor(), { ...claim, checksumSha256: claim.checksumSha256.toUpperCase() }, deps(db, storage));
    expect(first.body.submissionId).toBe(second.body.submissionId);
    expect(db.rows).toHaveLength(1);
    expect(storage.puts).toHaveLength(2);
    expect(storage.puts[0]?.key).toBe(storage.puts[1]?.key);
    const changed = await initiateSubmission(learnerActor(), { ...claim, byteSize: bytes.length + 1 }, deps(db, storage));
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe("CONFLICT");
    expect(db.rows).toHaveLength(1);
  });

  it("gives a fresh upload link after an interrupted attempt without a second row", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const claim = fileClaim(bytes, "image/jpeg", ids.digital);
    const started = await initiateSubmission(learnerActor(), claim, deps(db, storage));
    const row = db.rows[0];
    expect(row).toBeTruthy();
    const missing = await finalizeSubmission(learnerActor(), String(started.body.submissionId), deps(db, storage));
    expect(missing.body.code).toBe("OBJECT_NOT_FOUND");
    expect(missing.body.acknowledged).toBe(false);
    expect(db.rows[0]?.uploadState).toBe("FAILED");
    const again = await initiateSubmission(learnerActor(), claim, deps(db, storage));
    expect(again.body.submissionId).toBe(started.body.submissionId);
    expect(storage.puts[1]?.key).toBe(row?.storageKey);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.uploadState).toBe("UPLOADING");
  });

  it("finalizes only after the server hashes the stored bytes", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const started = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    const row = db.rows[0];
    if (!row) throw new Error("missing row");
    putObject(storage, row.storageKey, bytes, "image/jpeg");
    const saved = await finalizeSubmission(learnerActor(), String(started.body.submissionId), deps(db, storage));
    expect(saved.body).toMatchObject({ acknowledged: true, uploadState: "STORED" });
    expect(JSON.stringify(saved.body)).not.toContain("http");
    expect(db.rows[0]?.uploadState).toBe("STORED");
    const repeat = await finalizeSubmission(learnerActor(), row.id, deps(db, storage));
    expect(repeat.body.acknowledged).toBe(true);
    expect(storage.opens).toBe(1);
    expect(db.rows).toHaveLength(1);
  });

  it("rejects a checksum mismatch, a short upload, and a disguised file, then deletes the server key", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const started = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    const row = db.rows[0];
    if (!row) throw new Error("missing row");
    const tampered = Buffer.from(bytes);
    tampered[3] = 0x11;
    putObject(storage, row.storageKey, tampered, "image/jpeg");
    const mismatch = await finalizeSubmission(learnerActor(), String(started.body.submissionId), deps(db, storage));
    expect(mismatch.body.code).toBe("CHECKSUM_MISMATCH");
    expect(mismatch.body.acknowledged).toBe(false);
    expect(db.rows[0]?.uploadState).toBe("FAILED");
    expect(db.rows[0]?.lastErrorCode).toBe("CHECKSUM_MISMATCH");
    expect(storage.deleted).toEqual([row.storageKey]);
    expect(storage.objects.has(row.storageKey)).toBe(false);

    const again = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    expect(again.status).toBe(200);
    putObject(storage, row.storageKey, bytes, "image/jpeg");
    storage.shortRead = true;
    const incomplete = await finalizeSubmission(learnerActor(), row.id, deps(db, storage));
    expect(incomplete.body.code).toBe("INCOMPLETE");
    expect(db.rows[0]?.uploadState).toBe("FAILED");

    const restored = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    expect(restored.status).toBe(200);
    storage.shortRead = false;
    const pdf = Buffer.from("%PDF-1.4");
    putObject(storage, row.storageKey, pdf, "image/jpeg");
    db.rows[0]!.byteSize = pdf.length;
    const disguised = await finalizeSubmission(learnerActor(), row.id, deps(db, storage));
    expect(disguised.body.code).toBe("TYPE_MISMATCH");
    expect(db.rows[0]?.uploadState).not.toBe("STORED");
  });

  it("does not delete a key this server did not create", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const legacy = "private/demo/submissions/demo-sub-1.jpg";
    db.rows.push({
      id: "00000000-0000-4000-8000-000000000099",
      clientSubmissionId: "day10-legacy-01",
      assignmentId: ids.digital,
      learnerId: ids.learner,
      submittedById: ids.user,
      uploadState: "UPLOADING",
      byteSize: bytes.length,
      mimeType: "image/jpeg",
      checksumSha256: "a".repeat(64),
      storageKey: legacy,
      deviceId: ids.device,
      createdOffline: true,
      sectionId: ids.section,
      centerId: ids.center,
      attemptCount: 1,
      lastErrorCode: null,
    });
    putObject(storage, legacy, bytes, "image/jpeg");
    const result = await finalizeSubmission(learnerActor(), db.rows[0]!.id, deps(db, storage));
    expect(result.body.code).toBe("CHECKSUM_MISMATCH");
    expect(storage.deleted).toEqual([]);
    expect(storage.objects.has(legacy)).toBe(true);
  });

  it("keeps a valid object when the database cannot finish, then finishes on retry", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const started = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    const row = db.rows[0];
    if (!row) throw new Error("missing row");
    putObject(storage, row.storageKey, bytes, "image/jpeg");
    db.failFinalize = true;
    const failed = await finalizeSubmission(learnerActor(), String(started.body.submissionId), deps(db, storage));
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe("DATABASE_FAILED");
    expect(failed.body.acknowledged).toBe(false);
    expect(db.rows[0]?.uploadState).toBe("UPLOADING");
    expect(storage.objects.has(row.storageKey)).toBe(true);
    db.failFinalize = false;
    const saved = await finalizeSubmission(learnerActor(), row.id, deps(db, storage));
    expect(saved.body.acknowledged).toBe(true);
    expect(db.rows).toHaveLength(1);
  });

  it("lets the assigned teacher and the owner download, and refuses everyone else", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    const started = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    const row = db.rows[0];
    if (!row) throw new Error("missing row");
    putObject(storage, row.storageKey, bytes, "image/jpeg");
    await finalizeSubmission(learnerActor(), String(started.body.submissionId), deps(db, storage));

    const teacher = await downloadSubmission(teacherActor([ids.section]), row.id, deps(db, storage));
    expect(teacher.status).toBe(200);
    expect(String(teacher.body.downloadUrl)).toContain("https://storage.test/get/");
    expect(storage.gets[0]?.expiresInSeconds).toBe(120);
    expect(JSON.stringify(teacher.body)).not.toContain(row.storageKey);
    expect(JSON.stringify(teacher.body)).not.toContain("storageKey");

    const owner = await downloadSubmission(learnerActor(), row.id, deps(db, storage));
    expect(owner.status).toBe(200);
    const stranger = await downloadSubmission(learnerActor({ id: ids.otherUser, learnerId: ids.otherLearner }), row.id, deps(db, storage));
    expect(stranger.status).toBe(404);
    const otherTeacher = await downloadSubmission(teacherActor([ids.otherSection]), row.id, deps(db, storage));
    expect(otherTeacher.status).toBe(404);
    const director = await downloadSubmission({ ...teacherActor([]), id: ids.otherUser, role: "CENTER_DIRECTOR" }, row.id, deps(db, storage));
    expect(director.status).toBe(404);
    const admin = await downloadSubmission({ ...teacherActor([]), id: ids.otherUser, role: "ADMIN" }, row.id, deps(db, storage));
    expect(admin.status).toBe(404);
    expect(storage.gets).toHaveLength(2);
  });

  it("recovers when two starts race on the same upload id", async () => {
    const db = new MemorySubmissionDb();
    const storage = memoryStorage();
    const bytes = jpegBytes();
    await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    db.skipFirstLookup = true;
    const raced = await initiateSubmission(learnerActor(), fileClaim(bytes, "image/jpeg", ids.digital), deps(db, storage));
    expect(raced.status).toBe(200);
    expect(db.rows).toHaveLength(1);
  });
});

describe("submission routes and the demo database", () => {
  const deviceId = "00000000-0000-4000-8000-00000000d010";
  const clientSubmissionId = "day10-stage3-photo01";

  async function cleanup() {
    await prisma.fileUploadQueueItem.deleteMany({
      where: { submission: { clientSubmissionId: { in: [clientSubmissionId, "day10-stage3-paper1"] } } },
    });
    await prisma.submission.deleteMany({ where: { clientSubmissionId: { in: [clientSubmissionId, "day10-stage3-paper1"] } } });
    await prisma.device.deleteMany({ where: { id: deviceId, submissions: { none: {} } } });
  }

  beforeAll(cleanup);
  afterAll(cleanup);

  it("requires a sign-in and does not cache the answer", async () => {
    holder.actor = null;
    const response = await initiateRoute(
      new Request("http://localhost/api/submissions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("writes one real submission row, checks it, and does not give the afternoon teacher the file", async () => {
    const learner = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { id: true, userId: true },
    });
    const actor = await loadActor(learner.userId, new Date("2026-11-10T01:00:00.000Z"));
    if (!actor) throw new Error("Demo learner is not active.");
    const digital = await prisma.assignment.findFirstOrThrow({
      where: { title: "Demo photo homework", section: { name: "Morning Group", course: { center: { code: "DEMO" } } } },
      select: { id: true },
    });
    const paper = await prisma.assignment.findFirstOrThrow({
      where: { title: "Demo paper homework 1", section: { name: "Morning Group", course: { center: { code: "DEMO" } } } },
      select: { id: true },
    });
    const storage = memoryStorage();
    const bundle = {
      db: prismaSubmissionDb(prisma),
      storage,
      now: new Date("2026-11-10T01:00:00.000Z"),
      registerDevice: registerOfflinePhone,
    };
    const bytes = jpegBytes();
    const refused = await initiateSubmission(
      actor,
      fileClaim(bytes, "image/jpeg", paper.id, { clientSubmissionId: "day10-stage3-paper1", learnerId: learner.id }),
      bundle,
    );
    expect(refused.body.code).toBe("PAPER_NOT_ALLOWED");

    const started = await initiateSubmission(
      actor,
      fileClaim(bytes, "image/jpeg", digital.id, { clientSubmissionId, deviceId, learnerId: learner.id }),
      bundle,
    );
    expect(started.status).toBe(200);
    const row = await prisma.submission.findUniqueOrThrow({
      where: { clientSubmissionId },
      include: { fileQueueItem: true },
    });
    expect(row.storageKey.startsWith("http")).toBe(false);
    expect(row.storageKey).toMatch(/^submissions\//);
    expect(JSON.stringify(started.body)).not.toContain(row.storageKey);
    putObject(storage, row.storageKey, bytes, "image/jpeg");
    const saved = await finalizeSubmission(actor, row.id, bundle);
    expect(saved.body.acknowledged).toBe(true);
    const stored = await prisma.submission.findUniqueOrThrow({ where: { id: row.id }, include: { fileQueueItem: true } });
    expect(stored.uploadState).toBe("STORED");
    expect(stored.fileQueueItem?.state).toBe("STORED");
    const again = await finalizeSubmission(actor, row.id, bundle);
    expect(again.body.acknowledged).toBe(true);
    expect(await prisma.submission.count({ where: { clientSubmissionId } })).toBe(1);

    const morning = await prisma.user.findFirstOrThrow({ where: { email: "teacher.one@demo.invalid" }, select: { id: true } });
    const afternoon = await prisma.user.findFirstOrThrow({ where: { email: "teacher.two@demo.invalid" }, select: { id: true } });
    const director = await prisma.user.findFirstOrThrow({ where: { email: "director@demo.invalid" }, select: { id: true } });
    const otherLearner = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0016", center: { code: "DEMO" } },
      select: { userId: true },
    });
    const now = new Date("2026-11-10T01:00:00.000Z");
    const allowed = await downloadSubmission(await loadActor(morning.id, now), row.id, bundle);
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(allowed.body)).not.toContain(row.storageKey);
    expect((await downloadSubmission(await loadActor(afternoon.id, now), row.id, bundle)).status).toBe(404);
    expect((await downloadSubmission(await loadActor(director.id, now), row.id, bundle)).status).toBe(404);
    expect((await downloadSubmission(await loadActor(otherLearner.userId, now), row.id, bundle)).status).toBe(404);
  });
});
