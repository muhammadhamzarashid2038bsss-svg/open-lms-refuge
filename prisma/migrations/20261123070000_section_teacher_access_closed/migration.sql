-- Switching a teacher off must remove class access immediately.
-- A date-only end date still includes the whole UTC day. That is correct for
-- an ordinary same-day reassignment and wrong for a switch-off, because the
-- end date cannot be earlier than the start date. This flag is the extra fact.
-- Existing rows stay false, so they keep the date-only rule. No backfill.

ALTER TABLE "section_teachers" ADD COLUMN "accessClosed" BOOLEAN NOT NULL DEFAULT false;
