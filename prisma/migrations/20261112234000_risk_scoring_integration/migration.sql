-- Day 15. Adds scoring runs and the numbers needed to explain an old RiskFlag.
-- Existing rows stay. No table is dropped and no demo data is deleted.
-- A flag saved before this migration has an empty scoring run. New flags do not.

CREATE TYPE "RiskRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

CREATE TABLE "risk_scoring_runs" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "requestedById" UUID NOT NULL,
    "scoringDate" DATE NOT NULL,
    "status" "RiskRunStatus" NOT NULL,
    "learnerCount" INTEGER NOT NULL,
    "savedCount" INTEGER NOT NULL DEFAULT 0,
    "unscoredCount" INTEGER NOT NULL DEFAULT 0,
    "calculationVersion" VARCHAR(40) NOT NULL,
    "watchThreshold" INTEGER NOT NULL,
    "highThreshold" INTEGER NOT NULL,
    "weightAbsence" DECIMAL(4,3) NOT NULL,
    "weightMissing" DECIMAL(4,3) NOT NULL,
    "weightGrade" DECIMAL(4,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "risk_scoring_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "risk_scoring_runs_centerId_idempotencyKey_key"
  ON "risk_scoring_runs"("centerId", "idempotencyKey");

CREATE INDEX "risk_scoring_runs_centerId_scoringDate_idx"
  ON "risk_scoring_runs"("centerId", "scoringDate");

ALTER TABLE "risk_scoring_runs"
  ADD CONSTRAINT "risk_scoring_runs_centerId_fkey"
  FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "risk_scoring_runs"
  ADD CONSTRAINT "risk_scoring_runs_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "risk_scoring_runs" ADD CONSTRAINT "risk_scoring_runs_counts_check" CHECK (
  "learnerCount" >= 0
  AND "savedCount" >= 0
  AND "unscoredCount" >= 0
);

ALTER TABLE "risk_scoring_runs" ADD CONSTRAINT "risk_scoring_runs_thresholds_check" CHECK (
  "watchThreshold" >= 0
  AND "watchThreshold" <= 100
  AND "highThreshold" >= 0
  AND "highThreshold" <= 100
  AND "watchThreshold" < "highThreshold"
);

ALTER TABLE "risk_scoring_runs" ADD CONSTRAINT "risk_scoring_runs_weights_check" CHECK (
  "weightAbsence" >= 0 AND "weightAbsence" <= 1
  AND "weightMissing" >= 0 AND "weightMissing" <= 1
  AND "weightGrade" >= 0 AND "weightGrade" <= 1
);

ALTER TABLE "risk_scoring_runs" ADD CONSTRAINT "risk_scoring_runs_key_check" CHECK (
  "idempotencyKey" ~ '^[A-Za-z0-9_.:-]{8,80}$'
);

ALTER TABLE "risk_flags" ADD COLUMN "scoringRunId" UUID;
ALTER TABLE "risk_flags" ADD COLUMN "reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "risk_flags" ADD COLUMN "scoringDate" DATE;
ALTER TABLE "risk_flags" ADD COLUMN "calculationVersion" VARCHAR(40);
ALTER TABLE "risk_flags" ADD COLUMN "weightAbsence" DECIMAL(4,3);
ALTER TABLE "risk_flags" ADD COLUMN "weightMissing" DECIMAL(4,3);
ALTER TABLE "risk_flags" ADD COLUMN "weightGrade" DECIMAL(4,3);
ALTER TABLE "risk_flags" ADD COLUMN "watchThreshold" INTEGER;
ALTER TABLE "risk_flags" ADD COLUMN "highThreshold" INTEGER;
ALTER TABLE "risk_flags" ADD COLUMN "absenceAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "risk_flags" ADD COLUMN "absenceValue" DECIMAL(6,4);
ALTER TABLE "risk_flags" ADD COLUMN "missingAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "risk_flags" ADD COLUMN "missingValue" DECIMAL(6,4);
ALTER TABLE "risk_flags" ADD COLUMN "gradeTrendAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "risk_flags" ADD COLUMN "gradeTrendValue" DECIMAL(6,4);
ALTER TABLE "risk_flags" ADD COLUMN "checkInNote" VARCHAR(160);

CREATE UNIQUE INDEX "risk_flags_scoringRunId_learnerId_key"
  ON "risk_flags"("scoringRunId", "learnerId");

CREATE INDEX "risk_flags_scoringRunId_idx" ON "risk_flags"("scoringRunId");

ALTER TABLE "risk_flags"
  ADD CONSTRAINT "risk_flags_scoringRunId_fkey"
  FOREIGN KEY ("scoringRunId") REFERENCES "risk_scoring_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_trace_check" CHECK (
  "scoringRunId" IS NULL
  OR (
    "scoringDate" IS NOT NULL
    AND "calculationVersion" IS NOT NULL
    AND "weightAbsence" IS NOT NULL
    AND "weightMissing" IS NOT NULL
    AND "weightGrade" IS NOT NULL
    AND "watchThreshold" IS NOT NULL
    AND "highThreshold" IS NOT NULL
    AND "watchThreshold" >= 0
    AND "watchThreshold" <= 100
    AND "highThreshold" >= 0
    AND "highThreshold" <= 100
    AND "watchThreshold" < "highThreshold"
    AND "weightAbsence" >= 0 AND "weightAbsence" <= 1
    AND "weightMissing" >= 0 AND "weightMissing" <= 1
    AND "weightGrade" >= 0 AND "weightGrade" <= 1
  )
);

ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_absence_indicator_check" CHECK (
  ("absenceAvailable" = false AND "absenceValue" IS NULL)
  OR ("absenceAvailable" = true AND "absenceValue" IS NOT NULL AND "absenceValue" >= 0 AND "absenceValue" <= 1)
);

ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_missing_indicator_check" CHECK (
  ("missingAvailable" = false AND "missingValue" IS NULL)
  OR ("missingAvailable" = true AND "missingValue" IS NOT NULL AND "missingValue" >= 0 AND "missingValue" <= 1)
);

ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_grade_indicator_check" CHECK (
  ("gradeTrendAvailable" = false AND "gradeTrendValue" IS NULL)
  OR ("gradeTrendAvailable" = true AND "gradeTrendValue" IS NOT NULL AND "gradeTrendValue" >= 0 AND "gradeTrendValue" <= 1)
);

ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_check_in_note_check" CHECK (
  "checkInNote" IS NULL
  OR (
    "status" = 'CHECK_IN_DONE'
    AND char_length("checkInNote") BETWEEN 1 AND 160
  )
);
