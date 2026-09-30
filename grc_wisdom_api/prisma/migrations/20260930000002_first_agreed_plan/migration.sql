-- Consulting engagement, sprint 2: the plan as first agreed.
--
-- A rebaseline copies the current dates over the baseline columns, so after
-- one the plan that was first agreed is gone, and the Gantt could never show
-- how much of a slip was re-agreed rather than delivered late. These columns
-- are stamped once, with the first baseline, and never rewritten.
--
-- Backfilled only where it is exact: an engagement on its first agreed plan
-- (baselineVersion 1) still holds that plan in its baseline columns. One
-- already rebaselined has lost it; its columns stay null, and it is measured
-- from its current baseline with no days put down to a rebaseline.
--
-- Additive only: five nullable columns, filled from columns already there.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "firstBaselineStartDate" TIMESTAMP(3),
ADD COLUMN     "firstBaselineTargetEndDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectPhase" ADD COLUMN     "firstBaselineTargetEndDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "firstBaselineStartDate" TIMESTAMP(3),
ADD COLUMN     "firstBaselineDueDate" TIMESTAMP(3);

-- Backfill: engagements still on their first agreed plan
UPDATE "Project"
SET "firstBaselineStartDate" = "baselineStartDate",
    "firstBaselineTargetEndDate" = "baselineTargetEndDate"
WHERE "baselineVersion" = 1;

UPDATE "ProjectPhase" AS ph
SET "firstBaselineTargetEndDate" = ph."baselineTargetEndDate"
FROM "Project" AS p
WHERE ph."projectId" = p."id" AND p."baselineVersion" = 1;

UPDATE "ProjectTask" AS t
SET "firstBaselineStartDate" = t."baselineStartDate",
    "firstBaselineDueDate" = t."baselineDueDate"
FROM "Project" AS p
WHERE t."projectId" = p."id" AND p."baselineVersion" = 1;
