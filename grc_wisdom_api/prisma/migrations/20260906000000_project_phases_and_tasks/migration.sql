-- CreateTable
CREATE TABLE "ProjectPhase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objectives" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "targetEndDate" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NotStarted',
    "reportedProgress" INTEGER NOT NULL DEFAULT 0,
    "verifiedProgress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NotStarted',
    "completionPercent" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "side" TEXT NOT NULL DEFAULT 'Client',
    "department" TEXT,
    "assigneeId" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectPhase_projectId_sequence_idx" ON "ProjectPhase"("projectId", "sequence");

-- CreateIndex
CREATE INDEX "ProjectPhase_projectId_status_idx" ON "ProjectPhase"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_phaseId_sequence_idx" ON "ProjectTask"("phaseId", "sequence");

-- CreateIndex
CREATE INDEX "ProjectTask_phaseId_status_idx" ON "ProjectTask"("phaseId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_assigneeId_status_idx" ON "ProjectTask"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_projectId_dueDate_idx" ON "ProjectTask"("projectId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTask_projectId_ref_key" ON "ProjectTask"("projectId", "ref");

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

