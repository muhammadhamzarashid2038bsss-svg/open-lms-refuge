-- A center-specific funder requirement for learner-level donor exports.
-- Aggregate reports stay the default. Nothing here is demo seed data.
-- The reason text stays on this row. Audit metadata stores the short reference only.

ALTER TYPE "AuditEntityType" ADD VALUE 'FUNDER_REQUIREMENT';

CREATE TABLE "funder_requirements" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "funderName" VARCHAR(80) NOT NULL,
    "requirementReference" VARCHAR(80) NOT NULL,
    "learnerLevelReason" VARCHAR(200) NOT NULL,
    "crossReportLinkage" BOOLEAN NOT NULL,
    "approvedById" UUID NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funder_requirements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "funder_requirements_centerId_requirementReference_key" ON "funder_requirements"("centerId", "requirementReference");
CREATE INDEX "funder_requirements_centerId_active_idx" ON "funder_requirements"("centerId", "active");

ALTER TABLE "funder_requirements" ADD CONSTRAINT "funder_requirements_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "funder_requirements" ADD CONSTRAINT "funder_requirements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "funder_requirements" ADD CONSTRAINT "funder_requirements_text_check" CHECK (
  char_length(btrim("funderName")) >= 2
  AND char_length("funderName") <= 80
  AND "funderName" = btrim("funderName")
  AND "funderName" !~ '[[:cntrl:]]'
  AND char_length(btrim("learnerLevelReason")) >= 10
  AND char_length("learnerLevelReason") <= 200
  AND "learnerLevelReason" = btrim("learnerLevelReason")
  AND "learnerLevelReason" !~ '[[:cntrl:]]'
  AND "requirementReference" ~ '^[A-Z0-9]{2,16}(-[A-Z0-9]{1,16}){0,5}$'
);

ALTER TABLE "funder_requirements" ADD CONSTRAINT "funder_requirements_active_check" CHECK (
  ("active" = true AND "deactivatedAt" IS NULL)
  OR
  ("active" = false AND "deactivatedAt" IS NOT NULL)
);
