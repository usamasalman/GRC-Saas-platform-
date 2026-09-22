-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "disposalDueAt" TIMESTAMP(3),
ADD COLUMN     "disposalReason" TEXT,
ADD COLUMN     "disposedAt" TIMESTAMP(3),
ADD COLUMN     "disposedById" TEXT,
ADD COLUMN     "retentionScheduleId" TEXT;

-- CreateTable
CREATE TABLE "RetentionSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "retainMonths" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "reviewWindowDays" INTEGER NOT NULL DEFAULT 30,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetentionSchedule_tenantId_idx" ON "RetentionSchedule"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionSchedule_tenantId_code_key" ON "RetentionSchedule"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Document_tenantId_disposalDueAt_idx" ON "Document"("tenantId", "disposalDueAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_retentionScheduleId_fkey" FOREIGN KEY ("retentionScheduleId") REFERENCES "RetentionSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_disposedById_fkey" FOREIGN KEY ("disposedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionSchedule" ADD CONSTRAINT "RetentionSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionSchedule" ADD CONSTRAINT "RetentionSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

