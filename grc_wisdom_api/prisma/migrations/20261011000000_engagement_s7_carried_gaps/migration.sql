-- Consulting engagement, sprint 7: a follow-on carries the open gaps.
--
-- Additive: one nullable column on ClauseAssessment naming the assessment a
-- follow-on engagement carried over from the engagement before, with its open
-- gap. The gap stays one Issue in the organisation's register, linked from
-- both engagements' assessments.

-- AlterTable
ALTER TABLE "ClauseAssessment" ADD COLUMN     "carriedFromId" TEXT;
