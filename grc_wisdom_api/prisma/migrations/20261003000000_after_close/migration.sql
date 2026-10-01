-- Consulting engagement, sprint 7: after close.
--
-- The window after close the organisation sets (how long the firm may still
-- read an engagement, 0 to 365 days) and its notices; whether issued reports
-- are copied to the firm; the follow-on link to the engagement before; who
-- keeps read-only access after close; what a follow-on carried over.
-- EngagementRecord is the firm's own record, frozen at close in its tenant;
-- EngagementReportCopy is a copy of an issued report kept by the firm.
--
-- Additive only: two new tables and nullable columns.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "closeAccessUntil" TIMESTAMP(3),
ADD COLUMN     "closeEndNoticeAt" TIMESTAMP(3),
ADD COLUMN     "closeWarnedAt" TIMESTAMP(3),
ADD COLUMN     "closeWindowDays" INTEGER,
ADD COLUMN     "closeWindowSetAt" TIMESTAMP(3),
ADD COLUMN     "closeWindowSetById" TEXT,
ADD COLUMN     "previousInScope" BOOLEAN,
ADD COLUMN     "previousProjectId" TEXT,
ADD COLUMN     "reportCopiesAllowed" BOOLEAN,
ADD COLUMN     "reportCopiesSetAt" TIMESTAMP(3),
ADD COLUMN     "reportCopiesSetById" TEXT;

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "afterCloseAccess" BOOLEAN;

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "carriedFromTaskId" TEXT;

-- AlterTable
ALTER TABLE "ProjectImpediment" ADD COLUMN     "carriedFromId" TEXT;

-- CreateTable
CREATE TABLE "EngagementRecord" (
    "id" TEXT NOT NULL,
    "firmTenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientTenantId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "deliveryStyle" TEXT,
    "outcome" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "targetEndDate" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "team" TEXT NOT NULL DEFAULT '[]',
    "plan" TEXT NOT NULL DEFAULT '[]',
    "figures" TEXT NOT NULL DEFAULT '{}',
    "delayLedger" TEXT NOT NULL DEFAULT '[]',
    "madeById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementReportCopy" (
    "id" TEXT NOT NULL,
    "firmTenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientTenantId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "projectRef" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "reportName" TEXT NOT NULL,
    "documentRef" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementReportCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngagementRecord_firmTenantId_closedAt_idx" ON "EngagementRecord"("firmTenantId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementRecord_projectId_firmTenantId_key" ON "EngagementRecord"("projectId", "firmTenantId");

-- CreateIndex
CREATE INDEX "EngagementReportCopy_firmTenantId_issuedAt_idx" ON "EngagementReportCopy"("firmTenantId", "issuedAt");

-- CreateIndex
CREATE INDEX "EngagementReportCopy_firmTenantId_clientTenantId_projectRef_idx" ON "EngagementReportCopy"("firmTenantId", "clientTenantId", "projectRef");

-- CreateIndex
CREATE INDEX "EngagementReportCopy_projectId_idx" ON "EngagementReportCopy"("projectId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_closeWindowSetById_fkey" FOREIGN KEY ("closeWindowSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_reportCopiesSetById_fkey" FOREIGN KEY ("reportCopiesSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_previousProjectId_fkey" FOREIGN KEY ("previousProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementRecord" ADD CONSTRAINT "EngagementRecord_firmTenantId_fkey" FOREIGN KEY ("firmTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementRecord" ADD CONSTRAINT "EngagementRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementRecord" ADD CONSTRAINT "EngagementRecord_madeById_fkey" FOREIGN KEY ("madeById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementReportCopy" ADD CONSTRAINT "EngagementReportCopy_firmTenantId_fkey" FOREIGN KEY ("firmTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementReportCopy" ADD CONSTRAINT "EngagementReportCopy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

