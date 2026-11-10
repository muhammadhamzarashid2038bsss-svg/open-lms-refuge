// The gradebook writes marks through the same phone save as the single-grade
// screen. It does not post a new grade format and it does not write to the
// database from the browser. A browser that has room but will not promise to
// keep data must not be described as a safe save.

import type { GradebookDraft } from "@/lib/lms/gradebook";
import { saveLocalGrade, type LocalSaveOptions } from "./local-records";

type Owner = { centerId: string; userId: string };

export async function saveGradebookMarks(
  factory: IDBFactory,
  owner: Owner,
  drafts: readonly GradebookDraft[],
  options: LocalSaveOptions = {},
): Promise<{ ok: boolean; saved: number; message: string }> {
  if (drafts.length === 0) return { ok: true, saved: 0, message: "No mark was changed." };
  let saved = 0;
  let promised = true;
  for (const draft of drafts) {
    const result = await saveLocalGrade(
      factory,
      owner,
      {
        assignmentId: draft.assignmentId,
        learnerId: draft.learnerId,
        points: draft.points,
        academicNote: draft.academicNote,
        recordId: draft.recordId,
        baseVector: draft.baseVector,
      },
      options,
    );
    if (!result.ok) {
      const kept =
        saved === 0
          ? result.message
          : `${result.message} ${saved} mark${saved === 1 ? "" : "s"} already on this phone were kept.`;
      return { ok: false, saved, message: kept };
    }
    saved += 1;
    if (!result.message.startsWith("Saved on this phone")) promised = false;
  }
  if (!promised) {
    // Same wording as one grade save when the browser has room but will not
    // promise to keep it. "Saved on this phone" is only for a granted promise.
    return {
      ok: true,
      saved,
      message:
        saved === 1
          ? "This edit is on this phone, waiting to send. This browser did not promise to keep it."
          : "These edits are on this phone, waiting to send. This browser did not promise to keep them.",
    };
  }
  return { ok: true, saved, message: "Saved on this phone, waiting to send" };
}
