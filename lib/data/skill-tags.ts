// Directors add and turn off short skill categories for their own center.
// The tag name stays on the tag row. The audit row stores the tag id only.

import { Prisma } from "../../generated/prisma/client";
import { canManageSkillTags, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import { normalizeSkillTagName } from "../lms/skill-tags";

const REFUSED = "You cannot change skill tags.";
const INVALID = "Use a short skill name, such as map reading. Do not describe a family's situation or legal status.";
const NOT_SAVED = "The skill tag was not saved.";
const HIDDEN = "That skill tag is not available.";

export type SkillTagRow = {
  id: string;
  name: string;
  active: boolean;
};

export async function listCenterSkillTags(actor: Actor): Promise<SkillTagRow[] | null> {
  if (!canManageSkillTags(actor, actor.centerId)) return null;
  const rows = await prisma.centerSkillTag.findMany({
    where: { centerId: actor.centerId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, active: true },
  });
  return rows;
}

async function writeTagAudit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: "CREATE" | "DEACTIVATE" | "UPDATE",
  tagId: string,
  active: boolean,
): Promise<void> {
  const row = await tx.auditLog.create({
    data: {
      centerId: actor.centerId,
      actorId: actor.id,
      action,
      entityType: "SKILL_TAG",
      entityId: tagId,
      metadata: { source: "skill-tag", active },
    },
    select: { id: true },
  });
  if (!row.id) throw new Error(NOT_SAVED);
}

export async function createCenterSkillTag(
  actor: Actor,
  rawName: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!canManageSkillTags(actor, actor.centerId)) return { ok: false, message: REFUSED };
  const name = normalizeSkillTagName(rawName);
  if (!name) return { ok: false, message: INVALID };
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "centers" WHERE id = ${actor.centerId}::uuid FOR UPDATE`;
      const existing = await tx.centerSkillTag.findFirst({
        where: { centerId: actor.centerId, name: { equals: name, mode: "insensitive" } },
        select: { id: true, active: true },
      });
      if (existing?.active) return { ok: false, message: "That skill tag is already on the list." };
      if (existing) return { ok: false, message: "That skill tag was turned off. Turn it back on instead of adding it again." };
      const created = await tx.centerSkillTag.create({
        data: { centerId: actor.centerId, name, active: true },
        select: { id: true },
      });
      await writeTagAudit(tx, actor, "CREATE", created.id, true);
      return { ok: true, id: created.id };
    });
  } catch {
    return { ok: false, message: NOT_SAVED };
  }
}

export async function setCenterSkillTagActive(
  actor: Actor,
  tagId: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!canManageSkillTags(actor, actor.centerId)) return { ok: false, message: REFUSED };
  try {
    return await prisma.$transaction(async (tx) => {
      const tag = await tx.centerSkillTag.findFirst({
        where: { id: tagId, centerId: actor.centerId },
        select: { id: true, active: true },
      });
      if (!tag) return { ok: false, message: HIDDEN };
      if (tag.active === active) return { ok: true };
      await tx.centerSkillTag.update({
        where: { id: tag.id },
        data: { active, deactivatedAt: active ? null : new Date() },
      });
      await writeTagAudit(tx, actor, active ? "UPDATE" : "DEACTIVATE", tag.id, active);
      return { ok: true };
    });
  } catch {
    return { ok: false, message: NOT_SAVED };
  }
}
