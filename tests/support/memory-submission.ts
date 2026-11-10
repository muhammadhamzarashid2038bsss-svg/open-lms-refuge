import { createHash } from "crypto";
import { Readable } from "stream";
import type { Actor } from "@/lib/auth/permissions";
import type { SubmissionDb, SubmissionRecord } from "@/lib/data/submission-db";
import { DuplicateSubmissionError } from "@/lib/data/submission-db";
import type { SubmissionDeps } from "@/lib/data/submissions";
import { type AllowedSubmissionMime } from "@/lib/storage/file-policy";
import type { StorageAdapter } from "@/lib/storage/types";
import { StorageUnavailableError } from "@/lib/storage/types";

const CENTER = "00000000-0000-4000-8000-0000000000c1";
const SECTION = "00000000-0000-4000-8000-0000000000b1";

export const ids = {
  center: CENTER,
  otherCenter: "00000000-0000-4000-8000-0000000000c2",
  section: SECTION,
  otherSection: "00000000-0000-4000-8000-0000000000b2",
  learner: "00000000-0000-4000-8000-0000000000a1",
  otherLearner: "00000000-0000-4000-8000-0000000000a2",
  user: "00000000-0000-4000-8000-0000000000d1",
  otherUser: "00000000-0000-4000-8000-0000000000d2",
  teacher: "00000000-0000-4000-8000-0000000000e1",
  digital: "00000000-0000-4000-8000-000000000011",
  both: "00000000-0000-4000-8000-000000000012",
  paper: "00000000-0000-4000-8000-000000000013",
  exam: "00000000-0000-4000-8000-000000000014",
  device: "00000000-0000-4000-8000-0000000000f1",
};

export function learnerActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: ids.user,
    role: "STUDENT",
    centerId: ids.center,
    active: true,
    displayName: "Demo Learner",
    learnerId: ids.learner,
    assignedSectionIds: [],
    enrolledSectionIds: [ids.section],
    ...overrides,
  };
}

export function teacherActor(sectionIds: string[]): Actor {
  return {
    id: ids.teacher,
    role: "TEACHER",
    centerId: ids.center,
    active: true,
    displayName: "Demo Teacher",
    learnerId: null,
    assignedSectionIds: sectionIds,
    enrolledSectionIds: [],
  };
}

type AssignmentSeed = {
  id: string;
  kind: "PAPER" | "DIGITAL" | "IN_CLASS_EXAM" | "BOTH";
  sectionId: string;
  centerId: string;
};

export class MemorySubmissionDb implements SubmissionDb {
  assignments: AssignmentSeed[] = [
    { id: ids.digital, kind: "DIGITAL", sectionId: ids.section, centerId: ids.center },
    { id: ids.both, kind: "BOTH", sectionId: ids.section, centerId: ids.center },
    { id: ids.paper, kind: "PAPER", sectionId: ids.section, centerId: ids.center },
    { id: ids.exam, kind: "IN_CLASS_EXAM", sectionId: ids.section, centerId: ids.center },
  ];
  learners = [
    { id: ids.learner, userId: ids.user, centerId: ids.center },
    { id: ids.otherLearner, userId: ids.otherUser, centerId: ids.center },
  ];
  activePairs = new Set([`${ids.learner}:${ids.section}`]);
  rows: SubmissionRecord[] = [];
  failFinalize = false;
  skipFirstLookup = false;

  async assignment(id: string) {
    return this.assignments.find((row) => row.id === id) ?? null;
  }

  async learner(id: string) {
    return this.learners.find((row) => row.id === id) ?? null;
  }

  async activeEnrollment(learnerId: string, sectionId: string) {
    return this.activePairs.has(`${learnerId}:${sectionId}`);
  }

  async byClientId(clientSubmissionId: string) {
    if (this.skipFirstLookup) {
      this.skipFirstLookup = false;
      return null;
    }
    const row = this.rows.find((item) => item.clientSubmissionId === clientSubmissionId);
    return row ? { ...row } : null;
  }

  async byId(id: string) {
    const row = this.rows.find((item) => item.id === id);
    return row ? { ...row } : null;
  }

  async insertPending(input: Parameters<SubmissionDb["insertPending"]>[0]) {
    if (this.rows.some((row) => row.clientSubmissionId === input.clientSubmissionId || row.id === input.id)) {
      throw new DuplicateSubmissionError();
    }
    const assignment = this.assignments.find((row) => row.id === input.assignmentId);
    if (!assignment) throw new Error("missing assignment");
    const row: SubmissionRecord = {
      ...input,
      uploadState: "QUEUED",
      sectionId: assignment.sectionId,
      centerId: assignment.centerId,
      attemptCount: 0,
      lastErrorCode: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async markUploading(id: string) {
    const row = this.rows.find((item) => item.id === id);
    if (!row || row.uploadState === "STORED") return;
    row.uploadState = "UPLOADING";
    row.attemptCount += 1;
    row.lastErrorCode = null;
  }

  async markFailed(id: string, code: SubmissionRecord["lastErrorCode"]) {
    const row = this.rows.find((item) => item.id === id);
    if (!row || row.uploadState === "STORED") return;
    row.uploadState = "FAILED";
    row.lastErrorCode = code;
  }

  async finalize(id: string) {
    if (this.failFinalize) throw new Error("database down");
    const row = this.rows.find((item) => item.id === id);
    if (!row) return "missing" as const;
    if (row.uploadState === "STORED") return "already" as const;
    row.uploadState = "STORED";
    row.lastErrorCode = null;
    return "stored" as const;
  }
}

export type MemoryStorage = StorageAdapter & {
  objects: Map<string, { bytes: Buffer; contentType: string | null }>;
  puts: { key: string; contentType: string; byteSize: number; expiresInSeconds: number }[];
  gets: { key: string; expiresInSeconds: number }[];
  deleted: string[];
  opens: number;
  failPut: boolean;
  failHead: boolean;
  shortRead: boolean;
};

export function memoryStorage(): MemoryStorage {
  const objects = new Map<string, { bytes: Buffer; contentType: string | null }>();
  const store: MemoryStorage = {
    objects,
    puts: [],
    gets: [],
    deleted: [],
    opens: 0,
    failPut: false,
    failHead: false,
    shortRead: false,
    async presignPut(input) {
      if (store.failPut) throw new StorageUnavailableError();
      store.puts.push(input);
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();
      return { url: `https://storage.test/put/${store.puts.length}`, expiresAt };
    },
    async presignGet(input) {
      store.gets.push(input);
      const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();
      return { url: `https://storage.test/get/${store.gets.length}`, expiresAt };
    },
    async head(key) {
      if (store.failHead) throw new StorageUnavailableError();
      const found = objects.get(key);
      if (!found) return null;
      return { byteSize: found.bytes.length, contentType: found.contentType };
    },
    async open(key) {
      store.opens += 1;
      const found = objects.get(key);
      if (!found) return null;
      const bytes = store.shortRead ? found.bytes.subarray(0, 1) : found.bytes;
      return Readable.from([bytes]);
    },
    async delete(key) {
      store.deleted.push(key);
      objects.delete(key);
    },
  };
  return store;
}

export function deps(db: SubmissionDb, storage: StorageAdapter | null, registerDevice?: SubmissionDeps["registerDevice"]): SubmissionDeps {
  return {
    db,
    storage,
    now: new Date("2026-11-10T01:00:00.000Z"),
    registerDevice: registerDevice ?? (async (_actor, deviceId) => ({ ok: true, deviceId })),
  };
}

export function fileClaim(bytes: Buffer, mime: AllowedSubmissionMime, assignmentId: string, extra: Record<string, unknown> = {}) {
  return {
    clientSubmissionId: "day10-file-01",
    assignmentId,
    learnerId: ids.learner,
    deviceId: ids.device,
    byteSize: bytes.length,
    mimeType: mime,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    createdOffline: true,
    filename: "secret.jpg",
    ...extra,
  };
}

export function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
}

export function putObject(storage: MemoryStorage, key: string, bytes: Buffer, contentType: string | null) {
  storage.objects.set(key, { bytes, contentType });
}
