-- Consulting engagement, sprint 5: the engagement's own access window.
--
-- Additive: two nullable columns on Project. Every approved firm person's
-- window sits inside them; an engagement set up before them has none until
-- its next person is approved or their dates change, which gives it the
-- design's default, widened to hold everyone already approved.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "engagementAccessFrom" TIMESTAMP(3),
ADD COLUMN     "engagementAccessTo" TIMESTAMP(3);
