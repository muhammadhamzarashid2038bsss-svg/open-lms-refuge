-- Optional completion date for an enrollment. Older completed rows stay
-- empty: there is no reliable historical date to backfill. updatedAt is not
-- used, because a later edit of the same row would change it.

ALTER TABLE "enrollments" ADD COLUMN "completedOn" DATE;

ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_withdrawn_check";

ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_status_dates_check" CHECK (
  ("status" = 'ACTIVE' AND "withdrawnOn" IS NULL AND "completedOn" IS NULL)
  OR
  ("status" = 'WITHDRAWN' AND "withdrawnOn" IS NOT NULL AND "completedOn" IS NULL)
  OR
  ("status" = 'COMPLETED' AND "withdrawnOn" IS NULL AND ("completedOn" IS NULL OR "completedOn" >= "enrolledOn"))
);
