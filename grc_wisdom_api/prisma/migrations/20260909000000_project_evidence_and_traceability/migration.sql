-- CreateTable
CREATE TABLE "ProjectEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'Internal',
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "side" TEXT NOT NULL DEFAULT 'Client',
    "uploadedInRound" INTEGER NOT NULL DEFAULT 0,
    "withdrawnById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTaskClause" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,
    "note" TEXT,
    "linkedById" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTaskClause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEvidence_storageKey_key" ON "ProjectEvidence"("storageKey");

-- CreateIndex
CREATE INDEX "ProjectEvidence_taskId_withdrawnAt_idx" ON "ProjectEvidence"("taskId", "withdrawnAt");

-- CreateIndex
CREATE INDEX "ProjectEvidence_projectId_uploadedAt_idx" ON "ProjectEvidence"("projectId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ProjectEvidence_uploadedById_idx" ON "ProjectEvidence"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEvidence_projectId_ref_key" ON "ProjectEvidence"("projectId", "ref");

-- CreateIndex
CREATE INDEX "ProjectTaskClause_clauseId_idx" ON "ProjectTaskClause"("clauseId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTaskClause_taskId_clauseId_key" ON "ProjectTaskClause"("taskId", "clauseId");

-- AddForeignKey
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskClause" ADD CONSTRAINT "ProjectTaskClause_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskClause" ADD CONSTRAINT "ProjectTaskClause_clauseId_fkey" FOREIGN KEY ("clauseId") REFERENCES "StandardClause"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskClause" ADD CONSTRAINT "ProjectTaskClause_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

