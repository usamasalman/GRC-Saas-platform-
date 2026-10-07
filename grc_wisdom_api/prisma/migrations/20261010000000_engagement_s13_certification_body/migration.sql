-- Consulting engagement, sprint 13: the certification body and independence.
--
-- Additive: a certification body's read-only, dated access to an
-- engagement (one live at a time, a partial unique index); the frozen audit
-- pack, each report as issued with its stored bytes' hash; the body's
-- questions, evidence requests and nonconformities; and two nullable columns
-- on an invitation for the independence warnings seen and why the
-- organisation went ahead.

-- AlterTable
ALTER TABLE "EngagementInvitation" ADD COLUMN     "independenceReason" TEXT,
ADD COLUMN     "independenceWarnings" TEXT;

-- CreateTable
CREATE TABLE "CertificationAccess" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bodyTenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Invited',
    "accessFrom" TIMESTAMP(3) NOT NULL,
    "accessTo" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "confirmationReason" TEXT,

    CONSTRAINT "CertificationAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPack" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "frozenById" TEXT NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPackItem" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "reportIssueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentRef" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,

    CONSTRAINT "AuditPackItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditorQuestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "clauseRef" TEXT,
    "askedById" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "answer" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "issueId" TEXT,

    CONSTRAINT "AuditorQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificationAccess_projectId_status_idx" ON "CertificationAccess"("projectId", "status");

-- CreateIndex
CREATE INDEX "CertificationAccess_bodyTenantId_idx" ON "CertificationAccess"("bodyTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditPack_projectId_ref_key" ON "AuditPack"("projectId", "ref");

-- CreateIndex
CREATE INDEX "AuditPackItem_packId_idx" ON "AuditPackItem"("packId");

-- CreateIndex
CREATE INDEX "AuditorQuestion_projectId_status_idx" ON "AuditorQuestion"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditorQuestion_projectId_ref_key" ON "AuditorQuestion"("projectId", "ref");

-- AddForeignKey
ALTER TABLE "CertificationAccess" ADD CONSTRAINT "CertificationAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificationAccess" ADD CONSTRAINT "CertificationAccess_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPack" ADD CONSTRAINT "AuditPack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPack" ADD CONSTRAINT "AuditPack_frozenById_fkey" FOREIGN KEY ("frozenById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPackItem" ADD CONSTRAINT "AuditPackItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "AuditPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditorQuestion" ADD CONSTRAINT "AuditorQuestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditorQuestion" ADD CONSTRAINT "AuditorQuestion_askedById_fkey" FOREIGN KEY ("askedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditorQuestion" ADD CONSTRAINT "AuditorQuestion_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One live access per engagement: invited or accepted.
CREATE UNIQUE INDEX "CertificationAccess_one_live" ON "CertificationAccess"("projectId") WHERE "status" IN ('Invited', 'Accepted');
