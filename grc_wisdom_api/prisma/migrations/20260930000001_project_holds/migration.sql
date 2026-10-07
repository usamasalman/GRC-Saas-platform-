-- Consulting engagement, sprint 1: the days a project stood still.
--
-- A project could be put on hold and resumed through the API, but nothing
-- recorded when or why, so the days it stood still could not be told apart
-- from anyone's delay. ProjectHold keeps each interval with the reason it
-- was put on hold, the reason it resumed, and who did each.
--
-- Additive only: one new table.

-- CreateTable
CREATE TABLE "ProjectHold" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "startedById" TEXT,
    "resumeReason" TEXT,
    "endedById" TEXT,

    CONSTRAINT "ProjectHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectHold_projectId_startedAt_idx" ON "ProjectHold"("projectId", "startedAt");

-- AddForeignKey
ALTER TABLE "ProjectHold" ADD CONSTRAINT "ProjectHold_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHold" ADD CONSTRAINT "ProjectHold_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHold" ADD CONSTRAINT "ProjectHold_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
