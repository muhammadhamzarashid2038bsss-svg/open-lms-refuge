import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SkillTagManager } from "@/components/skill-tag-manager";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listCenterSkillTags } from "@/lib/data/skill-tags";

export const instant = false;

export default function SkillTagsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading skill tags…</p>}>
      <SkillTags />
    </Suspense>
  );
}

async function SkillTags() {
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  const tags = actor ? await listCenterSkillTags(actor) : null;
  if (!tags) redirect("/director");
  return (
    <Shell title="Skill tags" lede="These short names are the only custom skill gaps teachers can choose. Turning one off keeps it on older notes.">
      <p className="text-lg">
        <Link className="underline" href="/director">
          Back to the center home
        </Link>
      </p>
      <SkillTagManager tags={tags} />
    </Shell>
  );
}
