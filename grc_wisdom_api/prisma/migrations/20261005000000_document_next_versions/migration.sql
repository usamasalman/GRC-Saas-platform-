-- Documents: next versions.
--
-- A published document can be revised: its next version is a DocumentVersion
-- row with its own state (Draft, InReview, Approved, Returned, Published,
-- Discarded) and its own approvals, while the Document row stays the live
-- policy until the next version is published. The version it replaces is kept
-- as Superseded, with its own retention clock. Open acknowledgement requests
-- for a replaced version are closed as superseded. Answers to information
-- requests record the document version they linked.
--
-- Additive only: new nullable columns and indexes. The partial unique index
-- at the end lets a document have one open next version at a time; Prisma
-- does not model partial indexes, so it lives only here.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "openVersionId" TEXT;

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "baseHash" TEXT,
ADD COLUMN     "baseVersion" TEXT,
ADD COLUMN     "checkedOutAt" TIMESTAMP(3),
ADD COLUMN     "checkedOutById" TEXT,
ADD COLUMN     "discardReason" TEXT,
ADD COLUMN     "discardedAt" TIMESTAMP(3),
ADD COLUMN     "discardedById" TEXT,
ADD COLUMN     "disposalDueAt" TIMESTAMP(3),
ADD COLUMN     "disposalReason" TEXT,
ADD COLUMN     "disposedAt" TIMESTAMP(3),
ADD COLUMN     "disposedById" TEXT,
ADD COLUMN     "proposedAudienceKind" TEXT,
ADD COLUMN     "proposedAudienceValue" TEXT,
ADD COLUMN     "proposedCategory" TEXT,
ADD COLUMN     "proposedClassification" TEXT,
ADD COLUMN     "proposedLinks" TEXT,
ADD COLUMN     "proposedTitle" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "startReason" TEXT,
ADD COLUMN     "startedById" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededBy" TEXT;

-- AlterTable
ALTER TABLE "AcknowledgementRequest" ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededBy" TEXT;

-- AlterTable
ALTER TABLE "ApprovalQueue" ADD COLUMN     "versionId" TEXT;

-- AlterTable
ALTER TABLE "RequestAnswer" ADD COLUMN     "documentVersion" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Document_openVersionId_key" ON "Document"("openVersionId");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_state_idx" ON "DocumentVersion"("documentId", "state");

-- CreateIndex
CREATE INDEX "DocumentVersion_disposalDueAt_idx" ON "DocumentVersion"("disposalDueAt");

-- CreateIndex
CREATE INDEX "ApprovalQueue_versionId_idx" ON "ApprovalQueue"("versionId");

-- AddForeignKey
ALTER TABLE "ApprovalQueue" ADD CONSTRAINT "ApprovalQueue_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One open next version per document.
CREATE UNIQUE INDEX "DocumentVersion_one_open_per_document" ON "DocumentVersion"("documentId") WHERE "state" IN ('Draft', 'InReview', 'Approved', 'Returned');
