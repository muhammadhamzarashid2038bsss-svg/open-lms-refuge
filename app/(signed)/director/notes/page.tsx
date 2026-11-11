import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listProgressNoteSummaries } from "@/lib/data/progress-notes";

export const instant = false;

export default function DirectorNotesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading progress notes…</p>}>
      <DirectorNotes />
    </Suspense>
  );
}

async function DirectorNotes() {
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  const notes = actor ? await listProgressNoteSummaries(actor) : null;
  if (!notes) redirect("/director");
  return (
    <Shell title="Progress notes" lede="You can read notes for this center. You cannot change them.">
      <p className="text-lg">
        <Link className="underline" href="/director">
          Back to the center home
        </Link>
      </p>
      <ul className="flex flex-col gap-3">
        {notes.map((note) => (
          <li key={note.id}>
            <Link className="text-lg underline" href={`/director/notes/${note.id}`}>
              {note.learnerCode} · {note.learnerName} · {note.sectionName}
            </Link>
            <p className="text-base">
              {note.skillGaps.length > 0 ? note.skillGaps.join(", ") : "No skill tags"}
              {note.customTagName ? ` · ${note.customTagName}${note.customTagActive ? "" : " (no longer used)"}` : ""}
              {note.hasLegacyLabel ? " · earlier custom label on the note" : ""}
            </p>
          </li>
        ))}
        {notes.length === 0 ? <li className="text-lg">No progress notes yet.</li> : null}
      </ul>
    </Shell>
  );
}
