-- Links a resolved conflict to the new copy, and remembers a grade or note
-- mutation's fingerprint so a repeated id cannot change what was saved.
-- Existing attendance rows keep a null fingerprint. Existing open conflicts
-- keep null resolution links. No rows are deleted.

ALTER TABLE "sync_conflicts" ADD COLUMN "resolvedGradeVersionId" UUID;
ALTER TABLE "sync_conflicts" ADD COLUMN "resolvedNoteVersionId" UUID;

ALTER TABLE "json_sync_items" ADD COLUMN "contentFingerprint" VARCHAR(64);

CREATE UNIQUE INDEX "sync_conflicts_resolvedGradeVersionId_key" ON "sync_conflicts"("resolvedGradeVersionId");
CREATE UNIQUE INDEX "sync_conflicts_resolvedNoteVersionId_key" ON "sync_conflicts"("resolvedNoteVersionId");

ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolvedGradeVersionId_fkey" FOREIGN KEY ("resolvedGradeVersionId") REFERENCES "grade_entry_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolvedNoteVersionId_fkey" FOREIGN KEY ("resolvedNoteVersionId") REFERENCES "progress_note_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "json_sync_items" ADD CONSTRAINT "json_sync_items_fingerprint_check" CHECK (
  "contentFingerprint" IS NULL OR "contentFingerprint" ~ '^[0-9a-f]{64}$'
);

-- An open conflict has no resolution copy. A resolved conflict points at the
-- new copy for its own record type, and not at the other type.
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolved_version_check" CHECK (
  (
    "state" = 'OPEN'
    AND "resolvedGradeVersionId" IS NULL
    AND "resolvedNoteVersionId" IS NULL
  )
  OR
  (
    "state" = 'RESOLVED'
    AND "entityType" = 'GRADE_ENTRY'
    AND "resolvedGradeVersionId" IS NOT NULL
    AND "resolvedNoteVersionId" IS NULL
    AND "resolvedById" IS NOT NULL
  )
  OR
  (
    "state" = 'RESOLVED'
    AND "entityType" = 'PROGRESS_NOTE'
    AND "resolvedNoteVersionId" IS NOT NULL
    AND "resolvedGradeVersionId" IS NULL
    AND "resolvedById" IS NOT NULL
  )
);

CREATE OR REPLACE FUNCTION sync_conflict_versions_match_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."entityType" = 'GRADE_ENTRY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "grade_entry_versions" AS v
      WHERE v."id" = NEW."gradeVersionAId" AND v."gradeEntryId" = NEW."gradeEntryId"
    ) OR NOT EXISTS (
      SELECT 1 FROM "grade_entry_versions" AS v
      WHERE v."id" = NEW."gradeVersionBId" AND v."gradeEntryId" = NEW."gradeEntryId"
    ) THEN
      RAISE EXCEPTION 'grade conflict versions must belong to the same grade';
    END IF;
    IF NEW."resolvedGradeVersionId" IS NOT NULL AND (
      NOT EXISTS (
        SELECT 1 FROM "grade_entry_versions" AS v
        WHERE v."id" = NEW."resolvedGradeVersionId" AND v."gradeEntryId" = NEW."gradeEntryId"
      )
      OR NEW."resolvedGradeVersionId" = NEW."gradeVersionAId"
      OR NEW."resolvedGradeVersionId" = NEW."gradeVersionBId"
    ) THEN
      RAISE EXCEPTION 'grade resolution version must be a new copy of the same grade';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM "progress_note_versions" AS v
      WHERE v."id" = NEW."noteVersionAId" AND v."progressNoteId" = NEW."progressNoteId"
    ) OR NOT EXISTS (
      SELECT 1 FROM "progress_note_versions" AS v
      WHERE v."id" = NEW."noteVersionBId" AND v."progressNoteId" = NEW."progressNoteId"
    ) THEN
      RAISE EXCEPTION 'note conflict versions must belong to the same note';
    END IF;
    IF NEW."resolvedNoteVersionId" IS NOT NULL AND (
      NOT EXISTS (
        SELECT 1 FROM "progress_note_versions" AS v
        WHERE v."id" = NEW."resolvedNoteVersionId" AND v."progressNoteId" = NEW."progressNoteId"
      )
      OR NEW."resolvedNoteVersionId" = NEW."noteVersionAId"
      OR NEW."resolvedNoteVersionId" = NEW."noteVersionBId"
    ) THEN
      RAISE EXCEPTION 'note resolution version must be a new copy of the same note';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
