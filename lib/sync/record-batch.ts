// Checks one upload of grade and progress-note edits.
// Attendance stays on its own envelope. A grade upload sent to the attendance
// route does not match that route's keys, and this file does not accept
// attendance events. The signed-in person is not read from these fields.

import { isUuid } from "@/lib/lms/timetable";
import { utf8Bytes, MAX_UNCOMPRESSED_BYTES } from "@/lib/sync/batch";
import { canonicalInstant } from "@/lib/sync/retry";
import { canonicalVector, parseVersionVector, type VersionVector } from "@/lib/sync/version-vector";

export const RECORD_SYNC_VERSION = 1;
export const MAX_RECORD_MUTATIONS = 10;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;
const ENVELOPE_KEYS = ["version", "localDeviceId", "mutations"] as const;
const GRADE_KEYS = [
  "clientMutationId",
  "entityType",
  "recordId",
  "assignmentId",
  "learnerId",
  "points",
  "academicNote",
  "versionVector",
  "deviceRecordedAt",
  "createdOffline",
] as const;
const NOTE_KEYS = [
  "clientMutationId",
  "entityType",
  "recordId",
  "sectionId",
  "learnerId",
  "body",
  "skillGaps",
  "customSkillLabel",
  "versionVector",
  "deviceRecordedAt",
  "createdOffline",
] as const;

export const SKILL_GAPS = ["READING", "WRITING", "SPEAKING", "NUMBER_SENSE", "CUSTOM"] as const;
export type SkillGapName = (typeof SKILL_GAPS)[number];

export type GradeMutation = {
  entityType: "GRADE_ENTRY";
  clientMutationId: string;
  recordId: string;
  assignmentId: string;
  learnerId: string;
  points: string;
  academicNote: string | null;
  versionVector: VersionVector;
  deviceRecordedAt: string;
  createdOffline: boolean;
};

export type NoteMutation = {
  entityType: "PROGRESS_NOTE";
  clientMutationId: string;
  recordId: string;
  sectionId: string;
  learnerId: string;
  body: string;
  skillGaps: SkillGapName[];
  customSkillLabel: string | null;
  versionVector: VersionVector;
  deviceRecordedAt: string;
  createdOffline: boolean;
};

export type RecordMutation = GradeMutation | NoteMutation;

export type RecordBatchItem =
  | { ok: true; mutation: RecordMutation }
  | { ok: false; clientMutationId: string; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function canonicalPoints(value: string): string | null {
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function textOrNull(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max || trimmed.includes("\0")) return undefined;
  return trimmed;
}

function sharedFields(value: Record<string, unknown>): {
  clientMutationId: string;
  recordId: string;
  versionVector: VersionVector;
  deviceRecordedAt: string;
  createdOffline: boolean;
} | null {
  if (typeof value.clientMutationId !== "string" || !SAFE_ID.test(value.clientMutationId)) return null;
  if (typeof value.recordId !== "string" || !isUuid(value.recordId)) return null;
  const versionVector = parseVersionVector(value.versionVector);
  if (!versionVector) return null;
  if (typeof value.deviceRecordedAt !== "string" || !canonicalInstant(value.deviceRecordedAt)) return null;
  if (typeof value.createdOffline !== "boolean") return null;
  return {
    clientMutationId: value.clientMutationId,
    recordId: value.recordId.toLowerCase(),
    versionVector: canonicalVector(versionVector),
    deviceRecordedAt: value.deviceRecordedAt,
    createdOffline: value.createdOffline,
  };
}

function parseGrade(value: Record<string, unknown>): GradeMutation | null {
  if (!exactKeys(value, GRADE_KEYS) || value.entityType !== "GRADE_ENTRY") return null;
  const shared = sharedFields(value);
  if (!shared) return null;
  if (typeof value.assignmentId !== "string" || !isUuid(value.assignmentId)) return null;
  if (typeof value.learnerId !== "string" || !isUuid(value.learnerId)) return null;
  if (typeof value.points !== "string") return null;
  const points = canonicalPoints(value.points);
  const academicNote = textOrNull(value.academicNote, 500);
  if (!points || academicNote === undefined) return null;
  return {
    entityType: "GRADE_ENTRY",
    ...shared,
    assignmentId: value.assignmentId.toLowerCase(),
    learnerId: value.learnerId.toLowerCase(),
    points,
    academicNote,
  };
}

function parseNote(value: Record<string, unknown>): NoteMutation | null {
  if (!exactKeys(value, NOTE_KEYS) || value.entityType !== "PROGRESS_NOTE") return null;
  const shared = sharedFields(value);
  if (!shared) return null;
  if (typeof value.sectionId !== "string" || !isUuid(value.sectionId)) return null;
  if (typeof value.learnerId !== "string" || !isUuid(value.learnerId)) return null;
  if (typeof value.body !== "string") return null;
  const body = value.body.trim();
  if (body.length < 1 || body.length > 2000 || body.includes("\0")) return null;
  if (!Array.isArray(value.skillGaps) || value.skillGaps.length > SKILL_GAPS.length) return null;
  const gaps: SkillGapName[] = [];
  for (const gap of value.skillGaps) {
    if (typeof gap !== "string" || !SKILL_GAPS.includes(gap as SkillGapName) || gaps.includes(gap as SkillGapName)) return null;
    gaps.push(gap as SkillGapName);
  }
  gaps.sort();
  const customSkillLabel = textOrNull(value.customSkillLabel, 80);
  if (customSkillLabel === undefined) return null;
  const custom = gaps.includes("CUSTOM");
  if (custom !== (customSkillLabel !== null)) return null;
  return {
    entityType: "PROGRESS_NOTE",
    ...shared,
    sectionId: value.sectionId.toLowerCase(),
    learnerId: value.learnerId.toLowerCase(),
    body,
    skillGaps: gaps,
    customSkillLabel,
  };
}

function mutationIdOf(value: unknown, index: number): string {
  if (isRecord(value) && typeof value.clientMutationId === "string" && value.clientMutationId.length <= 80) {
    return value.clientMutationId;
  }
  return `invalid-${index}`;
}

/// A broken edit becomes its own result. The other edits in the list still proceed.
export function validateRecordEnvelope(value: unknown): { ok: true; localDeviceId: string; items: RecordBatchItem[] } | { ok: false } {
  if (!isRecord(value) || !exactKeys(value, ENVELOPE_KEYS)) return { ok: false };
  if (value.version !== RECORD_SYNC_VERSION) return { ok: false };
  if (typeof value.localDeviceId !== "string" || !isUuid(value.localDeviceId)) return { ok: false };
  if (!Array.isArray(value.mutations) || value.mutations.length < 1 || value.mutations.length > MAX_RECORD_MUTATIONS) return { ok: false };
  if (utf8Bytes(JSON.stringify(value)).byteLength > MAX_UNCOMPRESSED_BYTES) return { ok: false };
  const seen = new Set<string>();
  const items: RecordBatchItem[] = [];
  for (let index = 0; index < value.mutations.length; index += 1) {
    const raw = value.mutations[index];
    const clientMutationId = mutationIdOf(raw, index);
    if (!isRecord(raw)) {
      items.push({ ok: false, clientMutationId, code: "invalid_mutation" });
      continue;
    }
    const mutation = raw.entityType === "PROGRESS_NOTE" ? parseNote(raw) : raw.entityType === "GRADE_ENTRY" ? parseGrade(raw) : null;
    if (!mutation || seen.has(mutation.clientMutationId)) {
      items.push({ ok: false, clientMutationId, code: "invalid_mutation" });
      continue;
    }
    seen.add(mutation.clientMutationId);
    items.push({ ok: true, mutation });
  }
  return { ok: true, localDeviceId: value.localDeviceId.toLowerCase(), items };
}
