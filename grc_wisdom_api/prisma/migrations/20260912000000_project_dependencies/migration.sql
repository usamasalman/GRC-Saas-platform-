-- CreateTable
CREATE TABLE "ProjectDependency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FinishToStart',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "linkedById" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDependency_projectId_idx" ON "ProjectDependency"("projectId");

-- CreateIndex
CREATE INDEX "ProjectDependency_successorId_idx" ON "ProjectDependency"("successorId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDependency_predecessorId_successorId_key" ON "ProjectDependency"("predecessorId", "successorId");

-- AddForeignKey
ALTER TABLE "ProjectDependency" ADD CONSTRAINT "ProjectDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDependency" ADD CONSTRAINT "ProjectDependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDependency" ADD CONSTRAINT "ProjectDependency_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

