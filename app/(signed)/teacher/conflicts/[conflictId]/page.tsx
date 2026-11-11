import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ConflictResolveForm } from "@/components/conflict-resolve-form";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { readConflict, type ConflictCopy } from "@/lib/data/conflicts";
import { NOTE_VIEW_FAILED } from "@/lib/data/progress-notes";

export const instant = false;

export default function ConflictPage({ params }: { params: Promise<{ conflictId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading the conflict…</p>}>
      <ConflictDetail params={params} />
    </Suspense>
  );
}

function when(value: string): string {
  return value.replace("T", " ").replace(".000Z", " UTC");
}

function CopyCard({ title, copy, kind }: { title: string; copy: ConflictCopy; kind: "Grade" | "Progress note" }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {copy.provisional ? (
        <p className="text-lg font-medium">Shown for now. The server received this copy later.</p>
      ) : (
        <p className="text-lg">The other saved copy.</p>
      )}
      {kind === "Grade" ? (
        <>
          <p className="text-lg">Points: {copy.points}</p>
          <p className="text-lg">Academic note: {copy.academicNote ?? "None"}</p>
        </>
      ) : (
        <>
          <p className="text-lg whitespace-pre-wrap">{copy.body}</p>
          <p className="text-lg">Skill gaps: {copy.skillGaps && copy.skillGaps.length > 0 ? copy.skillGaps.join(", ") : "None"}</p>
          {copy.customSkillTagName ? (
            <p className="text-lg">
              Custom skill: {copy.customSkillTagName}
              {copy.customSkillTagActive ? "" : " (no longer used for new notes)"}
            </p>
          ) : null}
          {copy.customSkillLabel ? <p className="text-lg">Earlier custom label: {copy.customSkillLabel}</p> : null}
        </>
      )}
      <p className="text-base">Time on the phone: {when(copy.deviceRecordedAt)}. This does not decide the order.</p>
      <p className="text-base">Server received it: {when(copy.syncedAt)}.</p>
    </article>
  );
}

async function ConflictDetail({ params }: { params: Promise<{ conflictId: string }> }) {
  const { conflictId } = await params;
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  let conflict: Awaited<ReturnType<typeof readConflict>> = null;
  try {
    conflict = actor ? await readConflict(actor, conflictId) : null;
  } catch (error) {
    if (error instanceof Error && error.message === NOTE_VIEW_FAILED) {
      return (
        <Shell title="Conflict" lede="The note was not opened because the view could not be recorded.">
          <p className="text-lg">{NOTE_VIEW_FAILED}</p>
        </Shell>
      );
    }
    throw error;
  }
  if (!conflict) {
    return (
      <Shell title="Conflict" lede="That conflict is not one you can review.">
        <p className="text-lg">
          <Link className="underline" href="/teacher/conflicts">
            Back to open conflicts
          </Link>
        </p>
      </Shell>
    );
  }
  return (
    <Shell wide title={`${conflict.kind} conflict`} lede={`${conflict.learnerCode} · ${conflict.learnerName} · ${conflict.context}`}>
      <p className="text-lg">{conflict.explanation}</p>
      <CopyCard title="Copy shown for now" copy={conflict.shown} kind={conflict.kind} />
      <CopyCard title="Other saved copy" copy={conflict.other} kind={conflict.kind} />
      <ConflictResolveForm
        conflictId={conflict.id}
        kind={conflict.kind}
        shownPoints={conflict.shown.points ?? ""}
        shownNote={conflict.shown.academicNote ?? ""}
        shownBody={conflict.shown.body ?? ""}
        shownGaps={conflict.shown.skillGaps ?? []}
        shownTagId={conflict.shown.customSkillTagId ?? ""}
        skillTags={conflict.skillTags}
        maxPoints={conflict.maxPoints}
      />
    </Shell>
  );
}
