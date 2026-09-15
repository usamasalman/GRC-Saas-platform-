-- CreateTable
CREATE TABLE "ProjectStandard" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "standardId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectStandard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectStandard_standardId_idx" ON "ProjectStandard"("standardId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStandard_projectId_standardId_key" ON "ProjectStandard"("projectId", "standardId");

-- AddForeignKey
ALTER TABLE "ProjectStandard" ADD CONSTRAINT "ProjectStandard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStandard" ADD CONSTRAINT "ProjectStandard_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "Standard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStandard" ADD CONSTRAINT "ProjectStandard_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

