-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "verificationPolicy" TEXT NOT NULL DEFAULT 'SelectedTasks';

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "verificationOverride" BOOLEAN,
ADD COLUMN     "verificationRound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "ProjectVerification" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorSide" TEXT NOT NULL,
    "note" TEXT,
    "reportedPercent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectVerification_projectId_createdAt_idx" ON "ProjectVerification"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectVerification_taskId_round_idx" ON "ProjectVerification"("taskId", "round");

-- CreateIndex
CREATE INDEX "ProjectVerification_actorId_createdAt_idx" ON "ProjectVerification"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectTask_projectId_status_idx" ON "ProjectTask"("projectId", "status");

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVerification" ADD CONSTRAINT "ProjectVerification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVerification" ADD CONSTRAINT "ProjectVerification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVerification" ADD CONSTRAINT "ProjectVerification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

