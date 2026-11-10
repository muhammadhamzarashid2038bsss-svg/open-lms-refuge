import { randomUUID } from "crypto";
import { isUuid } from "../lms/timetable";

const SERVER_OBJECT_KEY = /^submissions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The key is a server id. A phone's filename is never part of it, and it is not a URL.
export function submissionObjectKey(submissionId: string = randomUUID()): { submissionId: string; storageKey: string } {
  const id = submissionId.toLowerCase();
  if (!isUuid(id)) throw new Error("Submission id is not a UUID.");
  return { submissionId: id, storageKey: `submissions/${id}` };
}

export function isServerObjectKey(storageKey: string): boolean {
  return SERVER_OBJECT_KEY.test(storageKey);
}
