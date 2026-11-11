-- Adds center-owned skill tags and a note-view sync type.
-- Existing progress notes are not rewritten. A row that already has a custom
-- label, including the synthetic "map reading" label, keeps that label and
-- gets an empty customSkillTagId. New saves use the tag id and leave the
-- label empty. No rows are deleted.

ALTER TYPE "AuditEntityType" ADD VALUE 'SKILL_TAG';
ALTER TYPE "JsonSyncEntityType" ADD VALUE 'NOTE_VIEW';

CREATE TABLE "center_skill_tags" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "center_skill_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "center_skill_tags_centerId_name_key" ON "center_skill_tags"("centerId", "name");
CREATE INDEX "center_skill_tags_centerId_active_idx" ON "center_skill_tags"("centerId", "active");

ALTER TABLE "center_skill_tags" ADD CONSTRAINT "center_skill_tags_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "center_skill_tags" ADD CONSTRAINT "center_skill_tags_name_check" CHECK (
  char_length(btrim("name")) >= 2
  AND char_length("name") <= 40
  AND "name" = btrim("name")
  AND "name" !~ '[[:cntrl:]]'
  AND "name" ~ '^[A-Za-z0-9]+([ ''-][A-Za-z0-9]+)*$'
);

ALTER TABLE "center_skill_tags" ADD CONSTRAINT "center_skill_tags_active_check" CHECK (
  ("active" = true AND "deactivatedAt" IS NULL)
  OR
  ("active" = false AND "deactivatedAt" IS NOT NULL)
);

ALTER TABLE "progress_notes" ADD COLUMN "customSkillTagId" UUID;
ALTER TABLE "progress_note_versions" ADD COLUMN "customSkillTagId" UUID;

CREATE INDEX "progress_notes_customSkillTagId_idx" ON "progress_notes"("customSkillTagId");
CREATE INDEX "progress_note_versions_customSkillTagId_idx" ON "progress_note_versions"("customSkillTagId");

ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_customSkillTagId_fkey" FOREIGN KEY ("customSkillTagId") REFERENCES "center_skill_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "progress_note_versions" ADD CONSTRAINT "progress_note_versions_customSkillTagId_fkey" FOREIGN KEY ("customSkillTagId") REFERENCES "center_skill_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "progress_notes" DROP CONSTRAINT "progress_notes_custom_skill_check";
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_custom_skill_check" CHECK (
  (
    NOT ('CUSTOM'::"SkillGap" = ANY("skillGaps"))
    AND "customSkillLabel" IS NULL
    AND "customSkillTagId" IS NULL
  )
  OR
  (
    'CUSTOM'::"SkillGap" = ANY("skillGaps")
    AND "customSkillLabel" IS NOT NULL
    AND "customSkillTagId" IS NULL
  )
  OR
  (
    'CUSTOM'::"SkillGap" = ANY("skillGaps")
    AND "customSkillLabel" IS NULL
    AND "customSkillTagId" IS NOT NULL
  )
);

ALTER TABLE "progress_note_versions" DROP CONSTRAINT "progress_note_versions_custom_skill_check";
ALTER TABLE "progress_note_versions" ADD CONSTRAINT "progress_note_versions_custom_skill_check" CHECK (
  (
    NOT ('CUSTOM'::"SkillGap" = ANY("skillGaps"))
    AND "customSkillLabel" IS NULL
    AND "customSkillTagId" IS NULL
  )
  OR
  (
    'CUSTOM'::"SkillGap" = ANY("skillGaps")
    AND "customSkillLabel" IS NOT NULL
    AND "customSkillTagId" IS NULL
  )
  OR
  (
    'CUSTOM'::"SkillGap" = ANY("skillGaps")
    AND "customSkillLabel" IS NULL
    AND "customSkillTagId" IS NOT NULL
  )
);
