import "server-only";

import { randomUUID } from "crypto";
import { isUuid } from "../lms/timetable";

// A course file is not a homework file. The prefix keeps a cleanup of one
// kind from deleting the other. The id is chosen here. The browser never
// sends a storage key.
export function courseResourceObjectKey(resourceId: string = randomUUID()): { resourceId: string; storageKey: string } {
  const id = resourceId.toLowerCase();
  if (!isUuid(id)) throw new Error("Course resource id is not a UUID.");
  return { resourceId: id, storageKey: `course-resources/${id}` };
}
