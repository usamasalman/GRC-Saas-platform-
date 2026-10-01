-- Consulting engagement, sprint 8: information requests.
--
-- What a consulting firm asks the organisation for (evidence, a document, a
-- dataset or a clarification), the organisation's answers and the firm's
-- reviews of them; evidence files stored once and linked wherever they are
-- used (requests, tasks, controls); scope-change requests; and the link from
-- a blocker to the overdue request it was recorded from.
--
-- Additive only: six new tables and one nullable column.

-- AlterTable
ALTER TABLE "ProjectImpediment" ADD COLUMN     "informationRequestId" TEXT;

-- CreateTable
CREATE TABLE "InformationRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "criteria" TEXT,
    "targetType" TEXT NOT NULL DEFAULT 'Engagement',
    "targetId" TEXT,
    "targetLabel" TEXT,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "raisedById" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigneeId" TEXT NOT NULL,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "dueNoticeAt" TIMESTAMP(3),
    "importedFrom" TEXT,
    "scopeChangeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InformationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestAnswer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "documentId" TEXT,
    "register" TEXT,
    "recordId" TEXT,
    "recordLabel" TEXT,
    "answeredById" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "RequestAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestReview" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "relevant" TEXT,
    "complete" TEXT,
    "coversPeriod" TEXT,
    "authentic" TEXT,
    "testNotes" TEXT NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'Internal',
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemKind" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "answerId" TEXT,
    "projectId" TEXT,
    "linkedById" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeChangeRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "services" TEXT NOT NULL DEFAULT '[]',
    "entityIds" TEXT NOT NULL DEFAULT '[]',
    "frameworkIds" TEXT NOT NULL DEFAULT '[]',
    "classificationCeiling" TEXT,
    "reason" TEXT NOT NULL,
    "pendingRequest" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "scopeVersionId" TEXT,
    "raisedRequestId" TEXT,

    CONSTRAINT "ScopeChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InformationRequest_projectId_status_idx" ON "InformationRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "InformationRequest_assigneeId_status_idx" ON "InformationRequest"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "InformationRequest_status_dueDate_idx" ON "InformationRequest"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "InformationRequest_projectId_ref_key" ON "InformationRequest"("projectId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "RequestAnswer_requestId_version_key" ON "RequestAnswer"("requestId", "version");

-- CreateIndex
CREATE INDEX "RequestReview_requestId_reviewedAt_idx" ON "RequestReview"("requestId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceItem_storageKey_key" ON "EvidenceItem"("storageKey");

-- CreateIndex
CREATE INDEX "EvidenceItem_tenantId_sha256_idx" ON "EvidenceItem"("tenantId", "sha256");

-- CreateIndex
CREATE INDEX "EvidenceLink_itemKind_itemId_idx" ON "EvidenceLink"("itemKind", "itemId");

-- CreateIndex
CREATE INDEX "EvidenceLink_targetType_targetId_idx" ON "EvidenceLink"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "EvidenceLink_answerId_idx" ON "EvidenceLink"("answerId");

-- CreateIndex
CREATE INDEX "ScopeChangeRequest_projectId_status_idx" ON "ScopeChangeRequest"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeChangeRequest_projectId_ref_key" ON "ScopeChangeRequest"("projectId", "ref");

-- AddForeignKey
ALTER TABLE "ProjectImpediment" ADD CONSTRAINT "ProjectImpediment_informationRequestId_fkey" FOREIGN KEY ("informationRequestId") REFERENCES "InformationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationRequest" ADD CONSTRAINT "InformationRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationRequest" ADD CONSTRAINT "InformationRequest_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationRequest" ADD CONSTRAINT "InformationRequest_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationRequest" ADD CONSTRAINT "InformationRequest_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAnswer" ADD CONSTRAINT "RequestAnswer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "InformationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAnswer" ADD CONSTRAINT "RequestAnswer_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestReview" ADD CONSTRAINT "RequestReview_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "InformationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestReview" ADD CONSTRAINT "RequestReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeChangeRequest" ADD CONSTRAINT "ScopeChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeChangeRequest" ADD CONSTRAINT "ScopeChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeChangeRequest" ADD CONSTRAINT "ScopeChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

