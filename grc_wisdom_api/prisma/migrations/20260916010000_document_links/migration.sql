-- CreateTable
CREATE TABLE "DocumentLink" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "controlId" TEXT,
    "riskId" TEXT,
    "clauseId" TEXT,
    "note" TEXT,
    "linkedById" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentLink_controlId_idx" ON "DocumentLink"("controlId");

-- CreateIndex
CREATE INDEX "DocumentLink_riskId_idx" ON "DocumentLink"("riskId");

-- CreateIndex
CREATE INDEX "DocumentLink_clauseId_idx" ON "DocumentLink"("clauseId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLink_documentId_controlId_key" ON "DocumentLink"("documentId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLink_documentId_riskId_key" ON "DocumentLink"("documentId", "riskId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLink_documentId_clauseId_key" ON "DocumentLink"("documentId", "clauseId");

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_clauseId_fkey" FOREIGN KEY ("clauseId") REFERENCES "StandardClause"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

