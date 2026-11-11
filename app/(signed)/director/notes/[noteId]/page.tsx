import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { NOTE_VIEW_FAILED, readProgressNote } from "@/lib/data/progress-notes";

export const instant = false;

export default function DirectorNotePage({ params }: { params: Promise<{ noteId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading the note…</p>}>
      <DirectorNote params={params} />
    </Suspense>
  );
}

async function DirectorNote({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  let note: Awaited<ReturnType<typeof readProgressNote>> = null;
  try {
    note = actor ? await readProgressNote(actor, noteId) : null;
  } catch (error) {
    if (error instanceof Error && error.message === NOTE_VIEW_FAILED) {
      return (
        <Shell title="Progress note" lede="The note was not opened because the view could not be recorded.">
          <p className="text-lg">{NOTE_VIEW_FAILED}</p>
        </Shell>
      );
    }
    throw error;
  }
  if (!note) {
    return (
      <Shell title="Progress note" lede="That note is not available.">
        <p className="text-lg">
          <Link className="underline" href="/director/notes">
            Back to progress notes
          </Link>
        </p>
      </Shell>
    );
  }
  return (
    <Shell title="Progress note" lede={`${note.learnerCode} · ${note.learnerName} · ${note.sectionName}`}>
      <p className="text-lg whitespace-pre-wrap">{note.body}</p>
      <p className="text-lg">Skill gaps: {note.skillGaps.length > 0 ? note.skillGaps.join(", ") : "None"}</p>
      {note.customTagName ? (
        <p className="text-lg">
          Custom skill: {note.customTagName}
          {note.customTagActive ? "" : " (no longer used for new notes)"}
        </p>
      ) : null}
      {note.legacyCustomLabel ? <p className="text-lg">Earlier custom label: {note.legacyCustomLabel}</p> : null}
      <p className="text-lg">
        <Link className="underline" href="/director/notes">
          Back to progress notes
        </Link>
      </p>
    </Shell>
  );
}
