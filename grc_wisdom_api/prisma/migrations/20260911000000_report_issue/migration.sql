-- CreateTable
CREATE TABLE "ReportIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "reportName" TEXT NOT NULL,
    "projectId" TEXT,
    "documentRef" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL DEFAULT 0,
    "format" TEXT NOT NULL,
    "marking" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileName" TEXT NOT NULL,
    "fileBytes" INTEGER,
    "sha256" TEXT,
    "documentHash" TEXT NOT NULL,
    "issued" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" TEXT NOT NULL DEFAULT '{}',
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportIssue_tenantId_reportKey_issuedAt_idx" ON "ReportIssue"("tenantId", "reportKey", "issuedAt");

-- CreateIndex
CREATE INDEX "ReportIssue_projectId_issuedAt_idx" ON "ReportIssue"("projectId", "issuedAt");

-- CreateIndex
CREATE INDEX "ReportIssue_tenantId_issued_issuedAt_idx" ON "ReportIssue"("tenantId", "issued", "issuedAt");

-- AddForeignKey
ALTER TABLE "ReportIssue" ADD CONSTRAINT "ReportIssue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportIssue" ADD CONSTRAINT "ReportIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportIssue" ADD CONSTRAINT "ReportIssue_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

