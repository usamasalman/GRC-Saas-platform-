-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "audienceKind" TEXT,
ADD COLUMN     "audienceValue" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "publishedVersion" TEXT;

-- AlterTable
ALTER TABLE "Acknowledgement" ADD COLUMN     "version" TEXT;

-- CreateTable
CREATE TABLE "AcknowledgementRequest" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),

    CONSTRAINT "AcknowledgementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcknowledgementRequest_userId_requestedAt_idx" ON "AcknowledgementRequest"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "AcknowledgementRequest_documentId_version_idx" ON "AcknowledgementRequest"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AcknowledgementRequest_documentId_version_userId_key" ON "AcknowledgementRequest"("documentId", "version", "userId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgementRequest" ADD CONSTRAINT "AcknowledgementRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgementRequest" ADD CONSTRAINT "AcknowledgementRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgementRequest" ADD CONSTRAINT "AcknowledgementRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

