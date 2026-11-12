-- Adds the identity of a teacher transition and the numbers a handoff
-- profile keeps from that moment. Existing demo rows stay. No rows are deleted.
-- Older profiles did not store attendance counts, so countsStored stays false
-- and the zero count defaults must not be read as a real tally.

CREATE TYPE "AttendanceSnapshotKind" AS ENUM (
  'RECORDED',
  'NO_ELIGIBLE_SESSIONS',
  'NO_ATTENDANCE_RECORDED'
);

ALTER TABLE "handoff_reports" ADD COLUMN "sourceKey" TEXT;
UPDATE "handoff_reports" SET "sourceKey" = 'legacy:' || "id"::text WHERE "sourceKey" IS NULL;
ALTER TABLE "handoff_reports" ALTER COLUMN "sourceKey" SET NOT NULL;

ALTER TABLE "handoff_reports" ADD COLUMN "sectionNameSnapshot" TEXT;
ALTER TABLE "handoff_reports" ADD COLUMN "courseTitleSnapshot" TEXT;
UPDATE "handoff_reports" AS handoff
SET "sectionNameSnapshot" = section."name",
    "courseTitleSnapshot" = course."title"
FROM "sections" AS section
JOIN "courses" AS course ON course."id" = section."courseId"
WHERE section."id" = handoff."sectionId"
  AND handoff."sectionNameSnapshot" IS NULL;
ALTER TABLE "handoff_reports" ALTER COLUMN "sectionNameSnapshot" SET NOT NULL;
ALTER TABLE "handoff_reports" ALTER COLUMN "courseTitleSnapshot" SET NOT NULL;

CREATE UNIQUE INDEX "handoff_reports_sectionId_reason_sourceKey_key"
  ON "handoff_reports"("sectionId", "reason", "sourceKey");

ALTER TABLE "transition_profiles" ALTER COLUMN "attendanceRate" DROP NOT NULL;
ALTER TABLE "transition_profiles" ADD COLUMN "attendanceKind" "AttendanceSnapshotKind" NOT NULL DEFAULT 'RECORDED';
ALTER TABLE "transition_profiles" ADD COLUMN "countsStored" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "transition_profiles" ADD COLUMN "eligibleSessionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transition_profiles" ADD COLUMN "presentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transition_profiles" ADD COLUMN "lateCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transition_profiles" ADD COLUMN "absentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transition_profiles" ADD COLUMN "excusedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transition_profiles" ADD COLUMN "unmarkedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transition_profiles" ADD COLUMN "gradeSettledCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transition_profiles" ADD COLUMN "gradeSnapshot" JSONB;
ALTER TABLE "transition_profiles" ADD COLUMN "historySnapshot" JSONB;
ALTER TABLE "transition_profiles" ADD COLUMN "lessonsTracked" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "transition_profiles" ADD CONSTRAINT "transition_profiles_attendance_check" CHECK (
  ("countsStored" = false)
  OR
  ("attendanceKind" = 'RECORDED' AND "attendanceRate" IS NOT NULL)
  OR
  ("attendanceKind" <> 'RECORDED' AND "attendanceRate" IS NULL)
);

ALTER TABLE "transition_profiles" ADD CONSTRAINT "transition_profiles_count_check" CHECK (
  "eligibleSessionCount" >= 0
  AND "presentCount" >= 0
  AND "lateCount" >= 0
  AND "absentCount" >= 0
  AND "excusedCount" >= 0
  AND "unmarkedCount" >= 0
  AND "unexcusedAbsenceCount" >= 0
  AND "gradeSettledCount" >= 0
  AND "lessonsCompleted" >= 0
  AND "lessonsTotal" >= 0
);

ALTER TABLE "transition_profile_notes" ADD COLUMN "progressNoteVersionId" UUID;
CREATE INDEX "transition_profile_notes_progressNoteVersionId_idx"
  ON "transition_profile_notes"("progressNoteVersionId");
ALTER TABLE "transition_profile_notes"
  ADD CONSTRAINT "transition_profile_notes_progressNoteVersionId_fkey"
  FOREIGN KEY ("progressNoteVersionId") REFERENCES "progress_note_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
