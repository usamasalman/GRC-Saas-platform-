-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "baselineSetAt" TIMESTAMP(3),
ADD COLUMN     "baselineStartDate" TIMESTAMP(3),
ADD COLUMN     "baselineTargetEndDate" TIMESTAMP(3),
ADD COLUMN     "baselineVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProjectPhase" ADD COLUMN     "baselineTargetEndDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "baselineDueDate" TIMESTAMP(3),
ADD COLUMN     "baselineStartDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectImpediment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "taskId" TEXT,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "owingSide" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'Medium',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "impactDays" INTEGER,
    "expectedClearDate" TIMESTAMP(3),
    "raisedById" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectImpediment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectImpediment_projectId_resolvedAt_idx" ON "ProjectImpediment"("projectId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ProjectImpediment_projectId_owingSide_idx" ON "ProjectImpediment"("projectId", "owingSide");

-- CreateIndex
CREATE INDEX "ProjectImpediment_taskId_resolvedAt_idx" ON "ProjectImpediment"("taskId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ProjectImpediment_phaseId_resolvedAt_idx" ON "ProjectImpediment"("phaseId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectImpediment_projectId_ref_key" ON "ProjectImpediment"("projectId", "ref");

-- AddForeignKey
ALTER TABLE "ProjectImpediment" ADD CONSTRAINT "ProjectImpediment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImpediment" ADD CONSTRAINT "ProjectImpediment_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImpediment" ADD CONSTRAINT "ProjectImpediment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImpediment" ADD CONSTRAINT "ProjectImpediment_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImpediment" ADD CONSTRAINT "ProjectImpediment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

