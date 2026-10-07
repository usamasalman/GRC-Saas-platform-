-- Consulting engagement, sprint 1: when work on a task actually began.
--
-- A task stored its planned dates, its current due date and when it was
-- completed, but never when work on it began. actualStartDate is stamped the
-- first time a task moves to InProgress and never overwritten. It is null for
-- tasks already under way before this migration: when they started was never
-- recorded, and it is not invented here.
--
-- Additive only: one nullable column.

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "actualStartDate" TIMESTAMP(3);
